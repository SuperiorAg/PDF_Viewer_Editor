// Phase 7.5 Wave 5d — Accessibility Checker engine.
//
// Canonical spec:
//   - docs/architecture-phase-7.5.md §4.8.
//   - docs/api-contracts.md §19.8.
//   - docs/accessibility-authoring-spec.md §6.
//
// What this module does:
//   - `runAccessibilityCheck(bytes, opts?)` parses the PDF once via pdf-lib,
//     builds a `AccessibilityCheckContext` snapshot (catalog + flattened
//     struct tree + per-page diagnostics) and runs every rule in
//     `ALL_A11Y_RULES` against the snapshot. Returns the aggregated value
//     in the IPC-contract shape (`PdfRunAccessibilityCheckValue`).
//
// Honest contract:
//   - `shippedRuleCount` always equals `ALL_A11Y_RULES.length`. The
//     regression test asserts equality so any future drift surfaces in
//     CI.
//   - `subsetDisclosure` is the verbatim string from the JSDoc on the
//     contract type (see PdfRunAccessibilityCheckValue.subsetDisclosure).
//     Both are required by P7.5-L-10 (honesty clause).
//   - `pageDiagnostics` is `null` when no text extractor is wired. This
//     forces extractor-dependent rules (`content.non-text-tagged`,
//     `content.scanned-searchable`) to emit `'unevaluated'` honestly
//     rather than pretending to know the answer. v0.8.0 ships with the
//     extractor seam unwired in production by default. A future wave
//     can wire a pdf.js text-content walker through `RunAccessibilityCheckDeps`
//     without changing the engine surface.
//
// Engine purity:
//   - No BrowserWindow, no IPC, no pdf.js. The extractor seam is the
//     only external coupling — same pattern as auto-tag-heuristic and
//     auto-bookmark-engine.
//   - Read-only against the doc — never mutates the document handle's
//     bytes. (P7.5-L-12 rebuild-from-scratch is N/A — no write path.)

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFString,
  PDFHexString,
  type PDFObject,
} from 'pdf-lib';

import type {
  AccessibilityCheckSummary,
  AccessibilityRuleResult,
  PdfRunAccessibilityCheckValue,
} from '../../ipc/contracts.js';
import { fail, ok, type Result } from '../../shared/result.js';

import {
  ALL_A11Y_RULES,
  type AccessibilityCheckContext,
  type AccessibilityRuleOutcome,
  type PageTextDiagnostic,
  type StructElementRef,
} from './accessibility-rules/index.js';

export type AccessibilityEngineError = 'invalid_payload' | 'pdf_load_failed' | 'engine_failed';

/** Verbatim disclosure string carried in the IPC response per P7.5-L-10.
 *  Mirrored in the regression test so any future drift fails CI. */
export const SUBSET_DISCLOSURE =
  'Subset of WCAG 2.1 + PDF/UA-1 — see Help for the shipped rule set.';

/** Snapshot-build cap. Mirrors auto-tag-heuristic + alt-text-engine. */
const MAX_NODES_EAGER = 10_000;

/** Optional per-page text extractor seam. Production wires a pdf.js text-
 *  content walker; tests inject deterministic fixtures. When omitted,
 *  the engine sets `pageDiagnostics = null` and extractor-dependent rules
 *  emit `'unevaluated'`. */
export type AccessibilityPageExtractor = (
  bytes: Uint8Array,
  pageCount: number,
) => Promise<PageTextDiagnostic[]>;

export interface RunAccessibilityCheckDeps {
  /** Optional extractor; absent → `pageDiagnostics === null`. */
  extractor?: AccessibilityPageExtractor;
}

// =====================================================================
// Entry point
// =====================================================================

export async function runAccessibilityCheck(
  pdfBytes: Uint8Array,
  deps: RunAccessibilityCheckDeps = {},
): Promise<Result<PdfRunAccessibilityCheckValue, AccessibilityEngineError>> {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    return fail<AccessibilityEngineError>(
      'invalid_payload',
      'pdfBytes must be a non-empty Uint8Array',
    );
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<AccessibilityEngineError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  let ctx: AccessibilityCheckContext;
  try {
    ctx = await buildContext(doc, pdfBytes, deps.extractor);
  } catch (e) {
    return fail<AccessibilityEngineError>(
      'engine_failed',
      e instanceof Error && e.message ? `context build threw: ${e.message}` : 'context build threw',
    );
  }

  const results: AccessibilityRuleResult[] = [];
  for (const rule of ALL_A11Y_RULES) {
    let outcome: AccessibilityRuleOutcome;
    try {
      outcome = rule.check(ctx);
    } catch (e) {
      // Catch-around-rule: a single throwing rule doesn't kill the
      // whole run. Synthetic 'fail' carries enough breadcrumb for the
      // user to file a bug.
      const msg = e instanceof Error && e.message ? e.message : 'unknown error';
      // Log via console — main-process logger picks this up.
      // eslint-disable-next-line no-console -- main process logging
      console.error(`[a11y-engine] rule ${rule.id} threw: ${msg}`);
      outcome = {
        status: 'fail',
        message: 'a11y.engine.rule-threw',
        locations: [],
      };
    }
    results.push({
      ruleId: rule.id,
      severity: rule.severity,
      status: outcome.status,
      passed: outcome.status === 'pass',
      message: outcome.message,
      locations: outcome.locations,
      ...(outcome.quickFix ? { quickFix: outcome.quickFix } : {}),
    });
  }

  const summary: AccessibilityCheckSummary = {
    pass: results.filter((r) => r.status === 'pass').length,
    warn: results.filter((r) => r.status === 'warn').length,
    fail: results.filter((r) => r.status === 'fail').length,
    unevaluated: results.filter((r) => r.status === 'unevaluated').length,
  };

  const value: PdfRunAccessibilityCheckValue = {
    results,
    summary,
    ranAt: Date.now(),
    shippedRuleCount: ALL_A11Y_RULES.length,
    subsetDisclosure: SUBSET_DISCLOSURE,
  };
  return ok(value);
}

// =====================================================================
// Snapshot builder
// =====================================================================

async function buildContext(
  doc: PDFDocument,
  pdfBytes: Uint8Array,
  extractor: AccessibilityPageExtractor | undefined,
): Promise<AccessibilityCheckContext> {
  const pageRefToIndex = buildPageRefIndex(doc);
  const structElements: StructElementRef[] = [];

  const structRoot = doc.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict);
  if (structRoot) {
    const rootK = structRoot.get(PDFName.of('K'));
    if (rootK !== undefined) {
      walkStructTree(rootK, structElements, doc, pageRefToIndex, /* depth */ 0);
    }
  }

  let pageDiagnostics: PageTextDiagnostic[] | null = null;
  if (extractor) {
    try {
      pageDiagnostics = await extractor(pdfBytes, doc.getPageCount());
    } catch {
      // Extractor failure → honest 'unevaluated' on dependent rules.
      pageDiagnostics = null;
    }
  }

  return {
    doc,
    structElements,
    catalog: doc.catalog,
    pageDiagnostics,
    pageCount: doc.getPageCount(),
  };
}

/** Flatten /StructTreeRoot in pre-order, collecting every structure
 *  element (dicts with /S). Naked mcid integers and MCR/OBJR dicts at
 *  child positions are ignored — rules don't care about per-content
 *  refs at this level. Mirrors struct-tree-engine's walker but
 *  produces flat snapshot records instead of the nested in-memory tree. */
function walkStructTree(
  kObj: PDFObject,
  out: StructElementRef[],
  doc: PDFDocument,
  pageRefToIndex: Map<string, number>,
  depth: number,
): void {
  if (out.length >= MAX_NODES_EAGER) return;
  if (depth > 64) return; // pathological doc → silently prune
  const ref = kObj instanceof PDFRef ? kObj : null;
  const resolved = ref ? doc.context.lookup(ref) : kObj;
  if (resolved === undefined) return;
  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i += 1) {
      const entry = resolved.get(i);
      if (entry !== undefined) {
        walkStructTree(entry, out, doc, pageRefToIndex, depth);
        if (out.length >= MAX_NODES_EAGER) return;
      }
    }
    return;
  }
  if (!(resolved instanceof PDFDict)) {
    return;
  }
  const sName = resolved.lookupMaybe(PDFName.of('S'), PDFName);
  if (!sName) {
    // Marked-content / object reference — not a structure element.
    return;
  }
  const typeStr = stripLeadingSlash(sName.asString());
  const pageIndex = readPgIndex(resolved, pageRefToIndex) ?? -1;
  const altInfo = readAltInfo(resolved);
  const childTypes = readChildTypes(resolved, doc);
  const hasScopeAttribute = readHasScopeAttribute(resolved, doc);

  const objectNumber = ref ? ref.objectNumber : -1;
  if (objectNumber >= 0) {
    out.push({
      structNodeId: `struct:${objectNumber}`,
      type: typeStr,
      pageIndex,
      childTypes,
      hasNonEmptyAlt: altInfo.hasNonEmptyAlt,
      hasAltKey: altInfo.hasAltKey,
      altValue: altInfo.altValue,
      hasScopeAttribute,
    });
  }

  // Recurse into children.
  const k = resolved.get(PDFName.of('K'));
  if (k !== undefined) {
    walkStructTree(k, out, doc, pageRefToIndex, depth + 1);
  }
}

// =====================================================================
// Snapshot field readers
// =====================================================================

function buildPageRefIndex(doc: PDFDocument): Map<string, number> {
  const m = new Map<string, number>();
  const pageCount = doc.getPageCount();
  for (let i = 0; i < pageCount; i += 1) {
    const ref = doc.getPage(i).ref;
    m.set(`${ref.objectNumber} ${ref.generationNumber}`, i);
  }
  return m;
}

function readPgIndex(dict: PDFDict, pageRefToIndex: Map<string, number>): number | null {
  const pg = dict.get(PDFName.of('Pg'));
  if (pg instanceof PDFRef) {
    const idx = pageRefToIndex.get(`${pg.objectNumber} ${pg.generationNumber}`);
    if (idx !== undefined) return idx;
  }
  return null;
}

interface AltInfo {
  hasAltKey: boolean;
  hasNonEmptyAlt: boolean;
  altValue: string | null;
}

function readAltInfo(dict: PDFDict): AltInfo {
  const alt = dict.get(PDFName.of('Alt'));
  if (alt === undefined) {
    return { hasAltKey: false, hasNonEmptyAlt: false, altValue: null };
  }
  let value: string | null = null;
  if (alt instanceof PDFString) value = alt.asString();
  else if (alt instanceof PDFHexString) value = alt.decodeText();
  const hasNonEmptyAlt = value !== null && value.length > 0;
  return { hasAltKey: true, hasNonEmptyAlt, altValue: value };
}

/** Read the direct-child structure-element types (the /S name of each
 *  immediate child dict). Used by the table-headers rule as a shallow
 *  signal. Inline non-struct children are skipped silently. */
function readChildTypes(dict: PDFDict, doc: PDFDocument): string[] {
  const types: string[] = [];
  const k = dict.get(PDFName.of('K'));
  if (k === undefined) return types;
  const visit = (entry: PDFObject): void => {
    const resolved = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
    if (resolved === undefined) return;
    if (resolved instanceof PDFArray) {
      for (let i = 0; i < resolved.size(); i += 1) {
        const e = resolved.get(i);
        if (e !== undefined) visit(e);
      }
      return;
    }
    if (resolved instanceof PDFDict) {
      const s = resolved.lookupMaybe(PDFName.of('S'), PDFName);
      if (s) types.push(stripLeadingSlash(s.asString()));
    }
  };
  visit(k);
  return types;
}

/** A TH's `/Scope` attribute can live directly on the structure-element
 *  dict OR inside an /A (attribute owner) dict whose /O is /Table.
 *  We accept either form. */
function readHasScopeAttribute(dict: PDFDict, doc: PDFDocument): boolean {
  // Direct /Scope on the element itself.
  const directScope = dict.get(PDFName.of('Scope'));
  if (directScope !== undefined) return true;
  // /A attribute owner dict (or array of such dicts).
  const a = dict.get(PDFName.of('A'));
  if (a === undefined) return false;
  const candidates: PDFObject[] = [];
  if (a instanceof PDFArray) {
    for (let i = 0; i < a.size(); i += 1) {
      const entry = a.get(i);
      if (entry !== undefined) candidates.push(entry);
    }
  } else {
    candidates.push(a);
  }
  for (const c of candidates) {
    const resolved = c instanceof PDFRef ? doc.context.lookup(c) : c;
    if (!(resolved instanceof PDFDict)) continue;
    if (resolved.get(PDFName.of('Scope')) !== undefined) return true;
  }
  return false;
}

function stripLeadingSlash(s: string): string {
  return s.startsWith('/') ? s.slice(1) : s;
}
