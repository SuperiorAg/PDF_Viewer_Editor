// Phase 7.5 Wave 5c — C5 Alt-text engine.
//
// Canonical spec:
//   - docs/architecture-phase-7.5.md §4.8.
//   - docs/api-contracts.md §19.7.5.
//   - docs/accessibility-authoring-spec.md (alt-text section).
//
// What this module does:
//   - `listFiguresWithoutAltText(bytes)` walks the structure tree for
//     /Figure structure elements that have no /Alt entry, returning a
//     flat list with stable ids (`struct:<objectNumber>`), pageIndex,
//     and best-effort bbox (0,0,0,0 unless the production extractor
//     overlay supplies one).
//   - `setAltText(bytes, edits)` writes /Alt + optional /ActualText on
//     the structure elements matching the supplied ids. Multiple edits
//     are applied in one save so the renderer's "bulk-set" UX is a
//     single pdf-lib round-trip.
//
// What this module does NOT do (honest deferrals):
//   - Synthesise alt text. The renderer's bulk-set affordance is a
//     one-string-many-targets workflow; this engine does no image
//     analysis. (No tesseract, no vision-LLM — privacy + license.)
//   - Walk arbitrary structure types. Only /Figure dicts are reported.
//     /Formula / /Form fields that also need alt text are out of scope
//     for Wave 5c; the spec calls them out as a later iteration.
//
// Locked-instruction compliance:
//   - L-001..L-006 (no BrowserWindow, pure pdf-lib module).
//   - P7.5-L-12 (rebuild-from-scratch): writes mutate structure-element
//     dicts in place — no PDF graph rewriting beyond setting /Alt and
//     /ActualText keys on the matched dicts.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFString,
  type PDFObject,
} from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

export type AltTextEngineError =
  | 'invalid_payload'
  | 'pdf_load_failed'
  | 'node_not_found'
  | 'engine_failed';

/** A figure missing /Alt — what the Alt-text Inspector lists. */
export interface FigureRef {
  structNodeId: string;
  pageIndex: number;
  bbox: [number, number, number, number];
}

export interface ListFiguresValue {
  figures: FigureRef[];
  warnings: string[];
}

/** A single alt-text edit. `altText: ''` removes the /Alt entry. */
export interface AltTextEdit {
  structNodeId: string;
  altText: string;
  /** Optional /ActualText override. Skipped when undefined. */
  actualText?: string;
}

export interface SetAltTextValue {
  bytes: Uint8Array;
  applied: number;
  warnings: string[];
}

// Eager-walk cap. Matches struct-tree-engine.MAX_NODES_EAGER for
// consistency.
const MAX_NODES_EAGER = 10_000;

// =====================================================================
// listFiguresWithoutAltText
// =====================================================================

export async function listFiguresWithoutAltText(
  pdfBytes: Uint8Array,
): Promise<Result<ListFiguresValue, AltTextEngineError>> {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    return fail<AltTextEngineError>('invalid_payload', 'pdfBytes must be a non-empty Uint8Array');
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<AltTextEngineError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  const warnings: string[] = [];
  const structRoot = doc.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict);
  if (!structRoot) {
    // No tree = no figures. Honest empty result (NOT an error).
    return ok<ListFiguresValue>({ figures: [], warnings });
  }
  const pageRefToIndex = buildPageRefIndex(doc);

  const figures: FigureRef[] = [];
  let visited = 0;
  let truncated = false;

  const walk = (obj: PDFObject, parentPageIndex: number | null): void => {
    if (truncated) return;
    if (visited >= MAX_NODES_EAGER) {
      truncated = true;
      return;
    }
    const resolved = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
    if (resolved === undefined) return;
    if (resolved instanceof PDFArray) {
      for (let i = 0; i < resolved.size(); i += 1) {
        const e = resolved.get(i);
        if (e !== undefined) walk(e, parentPageIndex);
      }
      return;
    }
    if (!(resolved instanceof PDFDict)) return;
    const sName = resolved.lookupMaybe(PDFName.of('S'), PDFName);
    if (!sName) return; // marked-content dict — skip silently
    visited += 1;
    const typeStr = stripLeadingSlash(sName.asString());
    // Derive this node's page index from /Pg or inherit from parent.
    const myPgIndex = readPgIndex(resolved, pageRefToIndex) ?? parentPageIndex;

    if (typeStr === 'Figure') {
      const altPresent = hasNonEmptyAlt(resolved);
      if (!altPresent) {
        if (obj instanceof PDFRef) {
          figures.push({
            structNodeId: `struct:${obj.objectNumber}`,
            pageIndex: myPgIndex ?? 0,
            bbox: [0, 0, 0, 0],
          });
        } else {
          warnings.push('skipped inline figure — no stable id');
        }
      }
    }

    // Recurse into children regardless of the current node's type.
    const k = resolved.get(PDFName.of('K'));
    if (k !== undefined) walk(k, myPgIndex);
  };
  const rootK = structRoot.get(PDFName.of('K'));
  if (rootK !== undefined) walk(rootK, null);

  if (truncated) {
    warnings.push(`figure walk truncated at ${MAX_NODES_EAGER} structure nodes.`);
  }

  return ok<ListFiguresValue>({ figures, warnings });
}

// =====================================================================
// setAltText
// =====================================================================

export async function setAltText(
  pdfBytes: Uint8Array,
  edits: ReadonlyArray<AltTextEdit>,
): Promise<Result<SetAltTextValue, AltTextEngineError>> {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    return fail<AltTextEngineError>('invalid_payload', 'pdfBytes must be a non-empty Uint8Array');
  }
  if (!Array.isArray(edits)) {
    return fail<AltTextEngineError>('invalid_payload', 'edits must be an array');
  }
  if (edits.length === 0) {
    // Honest no-op — the renderer should not have called us but we can
    // round-trip an unchanged save without surprising the caller.
    return ok<SetAltTextValue>({ bytes: pdfBytes, applied: 0, warnings: [] });
  }
  for (const e of edits) {
    if (!e || typeof e !== 'object') {
      return fail<AltTextEngineError>('invalid_payload', 'edit must be an object');
    }
    if (typeof e.structNodeId !== 'string' || !e.structNodeId.startsWith('struct:')) {
      return fail<AltTextEngineError>(
        'invalid_payload',
        'edit.structNodeId must be a "struct:<objectNumber>" string',
      );
    }
    if (typeof e.altText !== 'string') {
      return fail<AltTextEngineError>('invalid_payload', 'edit.altText must be a string');
    }
    if (e.actualText !== undefined && typeof e.actualText !== 'string') {
      return fail<AltTextEngineError>('invalid_payload', 'edit.actualText must be a string');
    }
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<AltTextEngineError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  const ctx = doc.context;
  const warnings: string[] = [];
  let applied = 0;

  for (const edit of edits) {
    const objectNumber = parseObjectNumber(edit.structNodeId);
    if (objectNumber === null) {
      return fail<AltTextEngineError>('invalid_payload', `bad structNodeId ${edit.structNodeId}`);
    }
    // Look up the indirect object directly via its number.
    const dict = lookupByObjectNumber(doc, objectNumber);
    if (!dict) {
      return fail<AltTextEngineError>(
        'node_not_found',
        `no structure element with object number ${objectNumber}`,
      );
    }
    // Defensive: verify this is in fact a structure-element dict — we
    // never want to mutate a page or content stream by accident.
    const sName = dict.lookupMaybe(PDFName.of('S'), PDFName);
    if (!sName) {
      return fail<AltTextEngineError>(
        'node_not_found',
        `object ${objectNumber} is not a structure element (no /S key)`,
      );
    }
    // Set /Alt — empty string removes the key.
    if (edit.altText.length === 0) {
      dict.delete(PDFName.of('Alt'));
    } else {
      dict.set(PDFName.of('Alt'), PDFString.of(edit.altText));
    }
    if (edit.actualText !== undefined) {
      if (edit.actualText.length === 0) {
        dict.delete(PDFName.of('ActualText'));
      } else {
        dict.set(PDFName.of('ActualText'), PDFString.of(edit.actualText));
      }
    }
    applied += 1;
  }

  // Ensure /MarkInfo /Marked true is set if it isn't — we just added
  // accessibility metadata so the doc IS tagged from a reader's
  // perspective.
  let markInfo = doc.catalog.lookupMaybe(PDFName.of('MarkInfo'), PDFDict);
  if (!markInfo) {
    markInfo = PDFDict.withContext(ctx);
    doc.catalog.set(PDFName.of('MarkInfo'), markInfo);
  }
  markInfo.set(PDFName.of('Marked'), ctx.obj(true));

  let outBytes: Uint8Array;
  try {
    outBytes = await doc.save({ useObjectStreams: false });
  } catch (e) {
    return fail<AltTextEngineError>(
      'engine_failed',
      e instanceof Error && e.message ? `save threw: ${e.message}` : 'save threw',
    );
  }

  return ok<SetAltTextValue>({ bytes: outBytes, applied, warnings });
}

// =====================================================================
// Helpers
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

function stripLeadingSlash(name: string): string {
  return name.startsWith('/') ? name.slice(1) : name;
}

function hasNonEmptyAlt(dict: PDFDict): boolean {
  const alt = dict.get(PDFName.of('Alt'));
  if (alt === undefined) return false;
  if (alt instanceof PDFString) return alt.asString().length > 0;
  // Hex / other string forms — count as present if any non-empty
  // serialised form exists. Conservative: if a key is present at all
  // we treat the figure as already-alt'd (the renderer can still
  // overwrite via setAltText).
  return true;
}

function parseObjectNumber(structNodeId: string): number | null {
  if (!structNodeId.startsWith('struct:')) return null;
  const tail = structNodeId.slice('struct:'.length);
  const n = Number.parseInt(tail, 10);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function lookupByObjectNumber(doc: PDFDocument, objectNumber: number): PDFDict | null {
  // pdf-lib doesn't expose a "get by object number" directly, but
  // PDFContext.indirectObjects is a Map<PDFRef, PDFObject>. We iterate
  // once to find the matching ref. For Wave 5c this is acceptable —
  // each setAltText call has O(edits * indirectObjects) which on a
  // 1064-page doc is still cheap (<1ms per lookup on modern hardware
  // for a few hundred edits). If the user batches >10k edits we'd
  // want to build a one-shot index; that's a Wave-5d concern.
  const indirect = doc.context.enumerateIndirectObjects();
  for (const [ref, obj] of indirect) {
    if (ref.objectNumber === objectNumber && obj instanceof PDFDict) {
      return obj;
    }
  }
  return null;
}
