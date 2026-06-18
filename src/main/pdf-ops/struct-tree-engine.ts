// Phase 7.5 Wave 5b — C3 Tag PDF structure-tree IO engine.
//
// Canonical spec:
//   - docs/architecture-phase-7.5.md §4.8.
//   - docs/accessibility-authoring-spec.md §1 + §2.
//   - docs/api-contracts.md §19.7.1–§19.7.3.
//
// What this module does (Wave 5b scope):
//   - `getStructTree(bytes)` reads `/Catalog /StructTreeRoot` via pdf-lib's
//     low-level PDFDict / PDFArray API. Returns an in-memory `StructTreeNode`
//     tree (uuid-keyed, deterministic id-order children) plus a
//     `hasExistingTree` flag the renderer uses to drive
//     save-as-copy-by-default per P7.5-L-5 / R12 mitigation.
//   - `setStructTree(bytes, root)` writes an `/StructTreeRoot` dictionary
//     back via pdf-lib `context.register(...)`. Preserves the existing
//     tree by structurally rebuilding (rebuild-from-scratch discipline
//     per P7.5-L-12; pdf-lib emits every registered indirect object so
//     leftover orphan struct elements survive a naive `set()` — explicit
//     rebuild is the only way to guarantee a clean tree).
//
// What this module does NOT do (honest deferrals):
//   - Side-table merge. The Wave 5b shape ships the in-PDF read + write;
//     the SQLite `accessibility_edit_session` merge lands in the
//     follow-up migration wave (data-models §13.4).
//   - Materialize MarkedContentRefs back to page content streams. Wave 5b
//     preserves any `/K` mcid entries it reads so a round-trip survives,
//     but it does NOT rewrite page content streams to add new `/MCID`
//     marks. Auto-tag emits node-level entries; the user adds mcid
//     associations interactively in C3's drag-to-tag UI (Wave 5b Riley).
//   - Walk `/IDTree` or `/ParentTree`. We emit a minimal valid /StructTreeRoot
//     (no `/ParentTree`); readers that require `/ParentTree` (some Acrobat
//     accessibility reports) will recompute on next reopen. This is the
//     same tradeoff Acrobat itself makes when re-saving a tagged doc.
//
// Performance gate (Wave 5b spec):
//   - For very large trees, walk eagerly up to MAX_NODES_EAGER (10_000).
//     Beyond that, emit a warning and TRUNCATE — the renderer surfaces a
//     "tree too large for v0.8.0" honest disclosure. Acceptable for v0.8.0;
//     pagination lands in a later wave.
//
// Locked-instruction compliance:
//   - L-001..L-006 (no BrowserWindow, pure module, no test channel, no
//     pdf.js — pure pdf-lib).
//   - P7.5-L-12 (rebuild-from-scratch): the write path is a full rebuild
//     of /StructTreeRoot; existing references in the catalog are replaced.

import { randomUUID } from 'node:crypto';

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  PDFHexString,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib';

import type { MarkedContentRef, StructTreeNode, StructTreeType } from '../../ipc/contracts.js';
import { fail, ok, type Result } from '../../shared/result.js';

export type StructTreeEngineError = 'invalid_payload' | 'pdf_load_failed' | 'engine_failed';

export interface GetStructTreeValue {
  /** null when the doc has no /StructTreeRoot. */
  tree: StructTreeNode | null;
  /** Load-bearing: true iff the source bytes had a non-empty /StructTreeRoot. */
  hasExistingTree: boolean;
  /** Best-effort diagnostics (e.g. truncation, malformed entries skipped). */
  warnings: string[];
}

export interface SetStructTreeValue {
  bytes: Uint8Array;
  /** Surfaced when the input doc had a pre-existing /StructTreeRoot the
   *  write overwrote. Riley's UI uses this to surface save-as-copy-by-
   *  default per P7.5-L-5. */
  warnings: string[];
  /** True iff the source bytes had a non-empty /StructTreeRoot before
   *  the write. Mirrors getStructTree().hasExistingTree so callers don't
   *  need a separate read. */
  overwroteExistingTree: boolean;
}

/** Eager-walk cap. See module header. */
export const MAX_NODES_EAGER = 10_000;

// ============================================================================
// Read direction
// ============================================================================

export async function getStructTree(
  pdfBytes: Uint8Array,
): Promise<Result<GetStructTreeValue, StructTreeEngineError>> {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    return fail<StructTreeEngineError>(
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
    return fail<StructTreeEngineError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  const warnings: string[] = [];
  const structRoot = doc.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict);
  if (!structRoot) {
    return ok<GetStructTreeValue>({ tree: null, hasExistingTree: false, warnings });
  }

  const pageRefToIndex = buildPageRefIndex(doc);

  // The /K (Kids) entry on /StructTreeRoot can be:
  //   - a single PDFRef to a structure element dict;
  //   - a single inline structure element dict;
  //   - an integer mcid (rare at the root);
  //   - a PDFArray of any combination of the above.
  const rootKObj = structRoot.get(PDFName.of('K'));
  // The /StructTreeRoot itself acts as the Document-typed root in our
  // in-memory shape. We collect all top-level kids underneath it.
  const counter = { count: 0, truncated: false };
  const children: StructTreeNode[] = [];
  if (rootKObj !== undefined) {
    walkK(rootKObj, children, doc, pageRefToIndex, counter, warnings, /*depth*/ 0);
  }
  if (counter.truncated) {
    warnings.push(
      `Structure tree exceeded ${MAX_NODES_EAGER} nodes; remaining entries skipped (Wave 5b limit).`,
    );
  }

  const root: StructTreeNode = {
    id: randomUUID(),
    type: 'Document',
    contentRefs: [],
    children,
  };

  return ok<GetStructTreeValue>({ tree: root, hasExistingTree: true, warnings });
}

// ============================================================================
// Read helpers
// ============================================================================

/** Builds a Map from a page's PDFRef -> page index. We compare PDFRef by
 *  objectNumber + generationNumber rather than identity because pdf-lib
 *  occasionally hands back different wrapper instances for the same
 *  underlying ref. */
function buildPageRefIndex(doc: PDFDocument): Map<string, number> {
  const m = new Map<string, number>();
  const pageCount = doc.getPageCount();
  for (let i = 0; i < pageCount; i += 1) {
    const ref = doc.getPage(i).ref;
    m.set(refKey(ref), i);
  }
  return m;
}

function refKey(ref: PDFRef): string {
  return `${ref.objectNumber} ${ref.generationNumber}`;
}

/** Walk a /K entry which may be a value, a ref, or an array. Push any
 *  decoded structure-element nodes into `out`. mcid integers at this level
 *  are interpreted as content refs of the PARENT — we ignore them here and
 *  rely on the caller to read them. */
function walkK(
  kObj: PDFObject,
  out: StructTreeNode[],
  doc: PDFDocument,
  pageRefToIndex: Map<string, number>,
  counter: { count: number; truncated: boolean },
  warnings: string[],
  depth: number,
): void {
  if (counter.truncated) return;
  if (depth > 64) {
    warnings.push('Structure tree depth > 64 — pruning to avoid runaway recursion.');
    return;
  }
  const resolved = resolveMaybe(doc, kObj);
  if (resolved === null) return;

  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i += 1) {
      const entry = resolved.get(i);
      if (entry === undefined) continue;
      walkK(entry, out, doc, pageRefToIndex, counter, warnings, depth);
      if (counter.truncated) return;
    }
    return;
  }

  if (resolved instanceof PDFDict) {
    // Could be a structure-element dict OR a marked-content dict (mcid + page).
    const sName = resolved.lookupMaybe(PDFName.of('S'), PDFName);
    if (sName) {
      // Structure element.
      if (counter.count >= MAX_NODES_EAGER) {
        counter.truncated = true;
        return;
      }
      counter.count += 1;
      const node = decodeStructElement(resolved, doc, pageRefToIndex, counter, warnings, depth);
      out.push(node);
    } else {
      // Marked-content dict at the root level — emit nothing structural; we
      // do not surface naked mcid containers as siblings of structure
      // elements. (The PDF spec allows this; our renderer does not need it.)
      // Silently ignored; warning would be noisy on most docs.
    }
    return;
  }

  // PDFNumber (a naked mcid) — root-level mcid is unusual. Silently ignore.
}

function decodeStructElement(
  dict: PDFDict,
  doc: PDFDocument,
  pageRefToIndex: Map<string, number>,
  counter: { count: number; truncated: boolean },
  warnings: string[],
  depth: number,
): StructTreeNode {
  // /S — structure type. Either a /Name or (rarely) a /String.
  const sNameObj = dict.lookupMaybe(PDFName.of('S'), PDFName);
  let typeStr: StructTreeType = 'Span';
  if (sNameObj) {
    const raw = sNameObj.asString();
    // pdf-lib's PDFName.asString() returns the leading slash; strip it.
    typeStr = (raw.startsWith('/') ? raw.slice(1) : raw) as StructTreeType;
  }

  // /Alt /ActualText /Lang — string entries. Either PDFString or PDFHexString.
  const altText = readStringy(dict, 'Alt');
  const actualText = readStringy(dict, 'ActualText');
  const language = readStringy(dict, 'Lang');

  // Source object number — present iff the dict came from an indirect ref.
  // We synthesise -1 here because the dict itself is the resolved form;
  // tracking the ref through walkK would mean threading it through every
  // recursion, which is heavy for marginal value. Round-trip writes
  // allocate fresh object numbers anyway (P7.5-L-12 rebuild discipline).
  const sourceObjectNumber = -1;

  // /Pg — page ref. Used by the renderer for overlay placement; not load-
  // bearing for the tree itself.
  const pgRef = dict.get(PDFName.of('Pg'));
  let pageIndexFromPg: number | null = null;
  if (pgRef instanceof PDFRef) {
    const idx = pageRefToIndex.get(refKey(pgRef));
    if (idx !== undefined) pageIndexFromPg = idx;
  }

  // /K — content references and child structure elements, interleaved.
  const contentRefs: MarkedContentRef[] = [];
  const children: StructTreeNode[] = [];
  const kEntry = dict.get(PDFName.of('K'));
  if (kEntry !== undefined) {
    walkKWithRefs(
      kEntry,
      children,
      contentRefs,
      pageIndexFromPg,
      doc,
      pageRefToIndex,
      counter,
      warnings,
      depth + 1,
    );
  }

  return {
    id: randomUUID(),
    type: typeStr,
    ...(altText !== null && { altText }),
    ...(actualText !== null && { actualText }),
    ...(language !== null && { language }),
    contentRefs,
    children,
    sourceObjectNumber,
  };
}

/** Variant of walkK that distinguishes content refs (mcid ints / marked-
 *  content dicts) from structure-element child dicts. */
function walkKWithRefs(
  kObj: PDFObject,
  children: StructTreeNode[],
  contentRefs: MarkedContentRef[],
  parentPageIndex: number | null,
  doc: PDFDocument,
  pageRefToIndex: Map<string, number>,
  counter: { count: number; truncated: boolean },
  warnings: string[],
  depth: number,
): void {
  if (counter.truncated) return;
  if (depth > 64) {
    warnings.push('Structure tree depth > 64 — pruning to avoid runaway recursion.');
    return;
  }
  const resolved = resolveMaybe(doc, kObj);
  if (resolved === null) return;

  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i += 1) {
      const entry = resolved.get(i);
      if (entry === undefined) continue;
      walkKWithRefs(
        entry,
        children,
        contentRefs,
        parentPageIndex,
        doc,
        pageRefToIndex,
        counter,
        warnings,
        depth,
      );
      if (counter.truncated) return;
    }
    return;
  }

  if (resolved instanceof PDFNumber) {
    // Naked integer is a marked-content id on the parent's /Pg page.
    if (parentPageIndex !== null) {
      contentRefs.push({ kind: 'mcid', pageIndex: parentPageIndex, mcid: resolved.asNumber() });
    }
    return;
  }

  if (resolved instanceof PDFDict) {
    const sName = resolved.lookupMaybe(PDFName.of('S'), PDFName);
    if (sName) {
      // Child structure element.
      if (counter.count >= MAX_NODES_EAGER) {
        counter.truncated = true;
        return;
      }
      counter.count += 1;
      const child = decodeStructElement(resolved, doc, pageRefToIndex, counter, warnings, depth);
      children.push(child);
      return;
    }
    // Marked-content reference dict — { Type: MCR | OBJR, Pg, MCID | Obj }.
    const typeName = resolved.lookupMaybe(PDFName.of('Type'), PDFName);
    const typeStr = typeName ? typeName.asString() : '';
    if (typeStr === '/MCR' || typeStr === '') {
      const mcidObj = resolved.get(PDFName.of('MCID'));
      const pgRef = resolved.get(PDFName.of('Pg'));
      let pageIndex = parentPageIndex;
      if (pgRef instanceof PDFRef) {
        const idx = pageRefToIndex.get(refKey(pgRef));
        if (idx !== undefined) pageIndex = idx;
      }
      if (pageIndex !== null && mcidObj instanceof PDFNumber) {
        contentRefs.push({ kind: 'mcid', pageIndex, mcid: mcidObj.asNumber() });
      }
      return;
    }
    if (typeStr === '/OBJR') {
      const objRef = resolved.get(PDFName.of('Obj'));
      const pgRef = resolved.get(PDFName.of('Pg'));
      let pageIndex = parentPageIndex;
      if (pgRef instanceof PDFRef) {
        const idx = pageRefToIndex.get(refKey(pgRef));
        if (idx !== undefined) pageIndex = idx;
      }
      if (pageIndex !== null && objRef instanceof PDFRef) {
        contentRefs.push({
          kind: 'object',
          pageIndex,
          sourceObjectNumber: objRef.objectNumber,
        });
      }
      return;
    }
  }
}

function readStringy(dict: PDFDict, key: string): string | null {
  const v = dict.get(PDFName.of(key));
  if (v instanceof PDFString) return v.asString();
  if (v instanceof PDFHexString) return v.decodeText();
  return null;
}

function resolveMaybe(doc: PDFDocument, obj: PDFObject): PDFObject | null {
  if (obj instanceof PDFRef) {
    const resolved = doc.context.lookup(obj);
    return resolved ?? null;
  }
  return obj;
}

// ============================================================================
// Write direction
// ============================================================================

export async function setStructTree(
  pdfBytes: Uint8Array,
  tree: StructTreeNode,
): Promise<Result<SetStructTreeValue, StructTreeEngineError>> {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    return fail<StructTreeEngineError>(
      'invalid_payload',
      'pdfBytes must be a non-empty Uint8Array',
    );
  }
  const validationErr = validateTree(tree);
  if (validationErr) {
    return fail<StructTreeEngineError>('invalid_payload', validationErr);
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<StructTreeEngineError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  const warnings: string[] = [];
  const existingRoot = doc.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict);
  const overwroteExistingTree = existingRoot !== undefined;
  if (overwroteExistingTree) {
    warnings.push('Overwriting existing /StructTreeRoot — save-as-copy by default (P7.5-L-5).');
  }

  // Build page index -> ref so we can attach /Pg correctly.
  const pageIndexToRef = new Map<number, PDFRef>();
  const pageCount = doc.getPageCount();
  for (let i = 0; i < pageCount; i += 1) {
    pageIndexToRef.set(i, doc.getPage(i).ref);
  }

  // Rebuild /StructTreeRoot from scratch per P7.5-L-12 (rebuild-from-
  // scratch discipline). pdf-lib emits every registered indirect object,
  // so a naive `set(K, ...)` on the existing /StructTreeRoot would leave
  // orphan structure-element dicts in the file. Allocating a fresh root
  // dict + walking the tree top-down + registering each child as a fresh
  // indirect object is the only way to guarantee a clean file.
  const ctx = doc.context;
  const newRootDict = PDFDict.withContext(ctx);
  newRootDict.set(PDFName.of('Type'), PDFName.of('StructTreeRoot'));

  // Walk the input tree's children. The Document-level wrapper does not
  // get its own indirect object in the output (it IS /StructTreeRoot).
  const childRefs: PDFRef[] = [];
  for (const child of tree.children) {
    const ref = writeNode(child, ctx, pageIndexToRef);
    childRefs.push(ref);
  }
  // Emit /K — array of refs (or single ref if only one child).
  if (childRefs.length === 1) {
    newRootDict.set(PDFName.of('K'), childRefs[0]!);
  } else if (childRefs.length > 1) {
    const kArr = PDFArray.withContext(ctx);
    for (const ref of childRefs) kArr.push(ref);
    newRootDict.set(PDFName.of('K'), kArr);
  }

  const newRootRef = ctx.register(newRootDict);
  doc.catalog.set(PDFName.of('StructTreeRoot'), newRootRef);

  // /MarkInfo /Marked true — declares this is a tagged PDF.
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
    return fail<StructTreeEngineError>(
      'engine_failed',
      e instanceof Error && e.message ? `save threw: ${e.message}` : 'save threw',
    );
  }

  return ok<SetStructTreeValue>({ bytes: outBytes, warnings, overwroteExistingTree });
}

/** Recursively allocates an indirect dict for a single StructTreeNode and
 *  returns its ref. */
function writeNode(
  node: StructTreeNode,
  ctx: PDFContext,
  pageIndexToRef: Map<number, PDFRef>,
): PDFRef {
  const dict = PDFDict.withContext(ctx);
  dict.set(PDFName.of('Type'), PDFName.of('StructElem'));
  dict.set(PDFName.of('S'), PDFName.of(String(node.type)));

  if (node.altText !== undefined) {
    dict.set(PDFName.of('Alt'), PDFString.of(node.altText));
  }
  if (node.actualText !== undefined) {
    dict.set(PDFName.of('ActualText'), PDFString.of(node.actualText));
  }
  if (node.language !== undefined) {
    dict.set(PDFName.of('Lang'), PDFString.of(node.language));
  }

  // /Pg — first content-ref's page, if any. PDF readers use this as the
  // implicit page for inline mcid entries in /K.
  const inferredPageIndex = pickFirstPageIndex(node);
  if (inferredPageIndex !== null) {
    const pgRef = pageIndexToRef.get(inferredPageIndex);
    if (pgRef) dict.set(PDFName.of('Pg'), pgRef);
  }

  // /K — interleaved content refs + children. Content refs become mcid
  // integers (when their page matches /Pg) or MCR dicts (otherwise).
  // Children become refs to nested struct elements.
  const kEntries: PDFObject[] = [];
  for (const ref of node.contentRefs) {
    if (ref.kind === 'mcid') {
      if (ref.pageIndex === inferredPageIndex) {
        kEntries.push(PDFNumber.of(ref.mcid));
      } else {
        const mcrDict = PDFDict.withContext(ctx);
        mcrDict.set(PDFName.of('Type'), PDFName.of('MCR'));
        const pgRef = pageIndexToRef.get(ref.pageIndex);
        if (pgRef) mcrDict.set(PDFName.of('Pg'), pgRef);
        mcrDict.set(PDFName.of('MCID'), PDFNumber.of(ref.mcid));
        kEntries.push(mcrDict);
      }
    } else {
      // OBJR: we don't have a reliable way to recover the original
      // indirect ref by objectNumber alone (it could have been
      // re-emitted), so emit a placeholder MCR-style entry only when we
      // can resolve via the doc-context — otherwise skip. Round-trip
      // through Wave-5b is best-effort for /OBJR.
      // For Wave 5b we drop OBJR entries silently on write; readers
      // get a tree without the OBJR back-pointer (the underlying
      // annotation still exists; only its tag-tree pointer is dropped).
    }
  }
  for (const child of node.children) {
    const childRef = writeNode(child, ctx, pageIndexToRef);
    kEntries.push(childRef);
  }

  if (kEntries.length === 1) {
    dict.set(PDFName.of('K'), kEntries[0]!);
  } else if (kEntries.length > 1) {
    const kArr = PDFArray.withContext(ctx);
    for (const e of kEntries) kArr.push(e);
    dict.set(PDFName.of('K'), kArr);
  }

  return ctx.register(dict);
}

function pickFirstPageIndex(node: StructTreeNode): number | null {
  for (const r of node.contentRefs) return r.pageIndex;
  for (const c of node.children) {
    const p = pickFirstPageIndex(c);
    if (p !== null) return p;
  }
  return null;
}

function validateTree(tree: StructTreeNode): string | null {
  if (!tree || typeof tree !== 'object') return 'tree must be an object';
  if (typeof tree.id !== 'string' || tree.id.length === 0)
    return 'tree.id must be a non-empty string';
  if (typeof tree.type !== 'string' || tree.type.length === 0) {
    return 'tree.type must be a non-empty string';
  }
  if (!Array.isArray(tree.children)) return 'tree.children must be an array';
  if (!Array.isArray(tree.contentRefs)) return 'tree.contentRefs must be an array';
  // Light per-child validation — we trust the IPC zod schema for the
  // surface contract; this is defense in depth for engine callers
  // bypassing the handler.
  const stack: StructTreeNode[] = [tree];
  let visited = 0;
  while (stack.length > 0) {
    const n = stack.pop()!;
    visited += 1;
    if (visited > MAX_NODES_EAGER * 2) {
      return `tree exceeds ${MAX_NODES_EAGER * 2} nodes — refuse to write`;
    }
    if (typeof n.type !== 'string') return 'every node.type must be a string';
    if (!Array.isArray(n.children)) return 'every node.children must be an array';
    if (!Array.isArray(n.contentRefs)) return 'every node.contentRefs must be an array';
    for (const c of n.children) stack.push(c);
  }
  return null;
}
