// Phase 7.5 Wave 4 — B13 Hyperlinks (link) engine.
//
// Canonical spec: docs/architecture-phase-7.5.md §4.1 row B13 + api-contracts
// §19.15.1 (`pdf:editLinks`).
//
// What this module does:
//   Read / add / update / remove `/Annot /Subtype /Link` annotations on
//   individual pages via pdf-lib's low-level PDFDict/PDFArray API. Three
//   target shapes are supported:
//     - URI: an external link (e.g. `https://example.com`). Authored as an
//       `/A /S /URI /URI <string>` action subdictionary.
//     - Goto-page: jump to a 0-based page index in the SAME document.
//       Authored as `/Dest [<pageRef> /Fit | /FitH ... | /XYZ ...]`.
//     - Goto-bookmark: at APPLY TIME the engine resolves the bookmarkId to
//       a page index via the injected `bookmarksResolver` and writes a
//       proper `/Dest [<pageRef> /Fit]` entry. The bookmarkId is ALSO
//       stamped on the annotation as `/ConductorBookmarkId` so list+round-
//       trip preserves the user's intent (bookmark vs raw page). This way
//       the link works in Adobe Acrobat AND our own viewer.
//
// Wave 5 carry-over (David, 2026-06-17): the original Wave 4 implementation
// wrote ONLY the private `/ConductorBookmarkId` key with no `/Dest`. That
// meant clicks in Acrobat / other PDF viewers did nothing — they have no
// idea what `/ConductorBookmarkId` is. The fix resolves bookmark → page
// at the moment the link is added/updated, so the link works everywhere.
// Callers without a resolver fall back to the legacy private-key path
// (engine still emits a link, viewer-only navigation, no /Dest).
//
// What this module does NOT do (honest deferrals):
//   - JavaScript actions on links (`/A /S /JavaScript`). By design we do not
//     emit them (matches the §14.6 strip-on-save security policy).
//   - Border / appearance styling. Annotations are drawn with the viewer's
//     default link border. Acrobat's "no underline" / "thin red box" knobs
//     map to `/Border` + `/H` keys; v1 omits them (viewers fall back to
//     a default).
//   - Quad-points for rotated / multi-line link text. The annotation `/Rect`
//     is the only hit region in v1.
//
// Link ID stability:
//   The engine assigns each `/Link` annotation a stable id of the form
//   `<pageIndex>:<indexInAnnotArray>` at LIST time. The renderer treats it
//   as opaque. UPDATE and REMOVE use the same lookup. This means ids are
//   STABLE across re-saves provided no add/remove between calls — which is
//   exactly the contract we want for renderer round-trips (list → edit →
//   list).
//
// Locked-instruction compliance:
//   - L-001..L-006: satisfied (pure pdf-lib, no pdf.js, no test channel).

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFContext,
} from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

// ============================================================================
// Public types
// ============================================================================

export type EngineLinkTarget =
  | { kind: 'uri'; uri: string }
  | { kind: 'goto-page'; pageIndex: number; zoom?: 'fit-page' | 'fit-width' | number }
  | { kind: 'goto-bookmark'; bookmarkId: number };

export type EngineLinkAction =
  | {
      kind: 'add';
      pageIndex: number;
      /** [llx, lly, urx, ury] in PDF user-space coordinates. */
      bbox: [number, number, number, number];
      target: EngineLinkTarget;
    }
  | { kind: 'update'; linkId: string; target: EngineLinkTarget }
  | { kind: 'remove'; linkId: string };

export interface LinkInfo {
  /** Stable id of the form `"<pageIndex>:<annotIndex>"`. */
  linkId: string;
  pageIndex: number;
  bbox: [number, number, number, number];
  target: EngineLinkTarget;
}

export type LinkEngineError =
  | 'pdf_load_failed'
  | 'invalid_payload'
  | 'page_out_of_range'
  | 'link_not_found'
  | 'engine_failed';

export interface EditLinksValue {
  bytes: Uint8Array;
  /** Stable ids for every added/updated link in request order. Remove ops
   *  contribute no id (renderer indexes by position relative to non-remove). */
  linkIds: string[];
}

export interface ListLinksValue {
  links: LinkInfo[];
}

/**
 * Optional resolver injected by the IPC handler so goto-bookmark targets
 * land in the PDF as a real `/Dest` (works in Acrobat too) instead of an
 * opaque private dict key. Returning `null` means "bookmarkId is unknown"
 * — the engine still writes the link but falls back to the private-key
 * pattern so the user's intent survives a future re-save where the
 * resolver does know the answer. (Wave 5 carry-over from Wave 4.)
 */
export type LinkBookmarkResolver = (bookmarkId: number) => number | null;

export interface EditLinksOptions {
  /** Optional bookmark→pageIndex resolver. See LinkBookmarkResolver doc. */
  bookmarksResolver?: LinkBookmarkResolver;
}

// ============================================================================
// List
// ============================================================================

export async function listLinks(
  pdfBytes: Uint8Array,
): Promise<Result<ListLinksValue, LinkEngineError>> {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    return fail<LinkEngineError>('invalid_payload', 'pdfBytes must be a non-empty Uint8Array');
  }
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    return fail<LinkEngineError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  const links: LinkInfo[] = [];
  const pageCount = doc.getPageCount();
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = doc.getPage(pageIndex);
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const annotDict = annots.lookupMaybe(i, PDFDict);
      if (!annotDict) continue;
      const subtype = annotDict.lookupMaybe(PDFName.of('Subtype'), PDFName);
      if (!subtype || subtype.asString() !== '/Link') continue;
      const rectArr = annotDict.lookupMaybe(PDFName.of('Rect'), PDFArray);
      if (!rectArr || rectArr.size() !== 4) continue;
      const bbox = readRect(rectArr);
      if (!bbox) continue;
      const target = readTarget(doc, annotDict);
      if (!target) continue;
      links.push({
        linkId: `${pageIndex}:${i}`,
        pageIndex,
        bbox,
        target,
      });
    }
  }
  return ok<ListLinksValue>({ links });
}

// ============================================================================
// Edit (multiplexed add / update / remove)
// ============================================================================

export async function editLinks(
  pdfBytes: Uint8Array,
  actions: ReadonlyArray<EngineLinkAction>,
  options: EditLinksOptions = {},
): Promise<Result<EditLinksValue, LinkEngineError>> {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    return fail<LinkEngineError>('invalid_payload', 'pdfBytes must be a non-empty Uint8Array');
  }
  if (!Array.isArray(actions)) {
    return fail<LinkEngineError>('invalid_payload', 'actions must be an array');
  }
  const bookmarksResolver = options.bookmarksResolver ?? null;

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    return fail<LinkEngineError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  const ctx = doc.context;
  const pageCount = doc.getPageCount();
  const newLinkIds: string[] = [];

  // Process in two passes so removes (which renumber the per-page annot index)
  // don't perturb the ids that later actions reference. Pass 1: validate every
  // action against the CURRENT state without mutating. Pass 2: apply, with
  // removes batched per-page-and-sorted-descending so indices stay valid.
  //
  // Adds happen INLINE in pass 2 because they can't be invalidated by other
  // actions in the same batch — they only append to the annot array.

  // --- Pass 1: validate ---
  for (const action of actions) {
    const err = validateAction(action, pageCount);
    if (err) return err;
    if (action.kind === 'update' || action.kind === 'remove') {
      const parsed = parseLinkId(action.linkId);
      if (!parsed) {
        return fail<LinkEngineError>('invalid_payload', `bad linkId: ${action.linkId}`);
      }
      if (parsed.pageIndex >= pageCount) {
        return fail<LinkEngineError>(
          'link_not_found',
          `linkId ${action.linkId}: page out of range`,
        );
      }
      const annots = doc.getPage(parsed.pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (!annots || parsed.annotIndex >= annots.size()) {
        return fail<LinkEngineError>(
          'link_not_found',
          `linkId ${action.linkId}: annot index out of range`,
        );
      }
      const annotDict = annots.lookupMaybe(parsed.annotIndex, PDFDict);
      if (!annotDict) {
        return fail<LinkEngineError>('link_not_found', `linkId ${action.linkId}: not a dict`);
      }
      const subtype = annotDict.lookupMaybe(PDFName.of('Subtype'), PDFName);
      if (!subtype || subtype.asString() !== '/Link') {
        return fail<LinkEngineError>(
          'link_not_found',
          `linkId ${action.linkId}: not a /Link annotation`,
        );
      }
    }
  }

  // --- Pass 2: apply ---
  // Group remove indices by page so we can sort descending and splice safely.
  const removeIndicesByPage = new Map<number, number[]>();

  for (const action of actions) {
    if (action.kind === 'add') {
      const linkId = applyAdd(doc, ctx, action, bookmarksResolver);
      if (!linkId.ok) return linkId;
      newLinkIds.push(linkId.value);
    } else if (action.kind === 'update') {
      const parsed = parseLinkId(action.linkId)!;
      const updated = applyUpdate(doc, ctx, parsed, action.target, bookmarksResolver);
      if (!updated.ok) return updated;
      // Update keeps the same id.
      newLinkIds.push(action.linkId);
    } else {
      const parsed = parseLinkId(action.linkId)!;
      const arr = removeIndicesByPage.get(parsed.pageIndex) ?? [];
      arr.push(parsed.annotIndex);
      removeIndicesByPage.set(parsed.pageIndex, arr);
    }
  }

  // Apply removes per page, sorted descending so earlier indices stay valid.
  for (const [pageIndex, indices] of removeIndicesByPage) {
    const annots = doc.getPage(pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    const sorted = [...new Set(indices)].sort((a, b) => b - a);
    for (const ix of sorted) {
      annots.remove(ix);
    }
  }

  let outBytes: Uint8Array;
  try {
    outBytes = await doc.save({ useObjectStreams: false });
  } catch (e) {
    return fail<LinkEngineError>(
      'engine_failed',
      e instanceof Error && e.message ? `save threw: ${e.message}` : 'save threw',
    );
  }
  return ok<EditLinksValue>({ bytes: outBytes, linkIds: newLinkIds });
}

// ============================================================================
// Add helpers
// ============================================================================

function applyAdd(
  doc: PDFDocument,
  ctx: PDFContext,
  action: Extract<EngineLinkAction, { kind: 'add' }>,
  bookmarksResolver: LinkBookmarkResolver | null,
): Result<string, LinkEngineError> {
  const page = doc.getPage(action.pageIndex);
  const annotDict = PDFDict.withContext(ctx);
  annotDict.set(PDFName.of('Type'), PDFName.of('Annot'));
  annotDict.set(PDFName.of('Subtype'), PDFName.of('Link'));

  const rect = PDFArray.withContext(ctx);
  for (const n of action.bbox) rect.push(PDFNumber.of(n));
  annotDict.set(PDFName.of('Rect'), rect);

  // /Border [0 0 0] — no visible border, matches Acrobat's "no border" default
  // for newly-authored links. Viewers that ignore /Border still show a
  // hover-cursor on the rect.
  const border = PDFArray.withContext(ctx);
  border.push(PDFNumber.of(0));
  border.push(PDFNumber.of(0));
  border.push(PDFNumber.of(0));
  annotDict.set(PDFName.of('Border'), border);

  // Wire the target.
  const wireErr = writeTarget(doc, ctx, annotDict, action.target, bookmarksResolver);
  if (wireErr) return fail<LinkEngineError>(wireErr.error, wireErr.message);

  // Attach to page.
  let annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) {
    annots = PDFArray.withContext(ctx);
    page.node.set(PDFName.of('Annots'), annots);
  }
  const annotRef = ctx.register(annotDict);
  annots.push(annotRef);
  const newIndex = annots.size() - 1;
  return ok(`${action.pageIndex}:${newIndex}`);
}

function applyUpdate(
  doc: PDFDocument,
  ctx: PDFContext,
  parsed: { pageIndex: number; annotIndex: number },
  target: EngineLinkTarget,
  bookmarksResolver: LinkBookmarkResolver | null,
): Result<true, LinkEngineError> {
  const page = doc.getPage(parsed.pageIndex);
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) {
    return fail<LinkEngineError>('link_not_found', 'page /Annots array missing');
  }
  const annotDict = annots.lookupMaybe(parsed.annotIndex, PDFDict);
  if (!annotDict) {
    return fail<LinkEngineError>('link_not_found', 'annot dict missing');
  }
  // Strip prior target keys so we don't end up with both /A and /Dest set.
  annotDict.delete(PDFName.of('A'));
  annotDict.delete(PDFName.of('Dest'));
  annotDict.delete(PDFName.of('ConductorBookmarkId'));

  const wireErr = writeTarget(doc, ctx, annotDict, target, bookmarksResolver);
  if (wireErr) return fail<LinkEngineError>(wireErr.error, wireErr.message);
  return ok(true);
}

interface WriteTargetErr {
  error: LinkEngineError;
  message: string;
}

function writeTarget(
  doc: PDFDocument,
  ctx: PDFContext,
  annotDict: PDFDict,
  target: EngineLinkTarget,
  bookmarksResolver: LinkBookmarkResolver | null,
): WriteTargetErr | null {
  const pageCount = doc.getPageCount();
  if (target.kind === 'uri') {
    if (typeof target.uri !== 'string' || target.uri.length === 0) {
      return { error: 'invalid_payload', message: 'uri must be a non-empty string' };
    }
    const action = PDFDict.withContext(ctx);
    action.set(PDFName.of('Type'), PDFName.of('Action'));
    action.set(PDFName.of('S'), PDFName.of('URI'));
    action.set(PDFName.of('URI'), PDFString.of(target.uri));
    annotDict.set(PDFName.of('A'), action);
    return null;
  }
  if (target.kind === 'goto-page') {
    if (
      !Number.isInteger(target.pageIndex) ||
      target.pageIndex < 0 ||
      target.pageIndex >= pageCount
    ) {
      return { error: 'page_out_of_range', message: `pageIndex ${target.pageIndex}` };
    }
    const destPage = doc.getPage(target.pageIndex);
    const dest = PDFArray.withContext(ctx);
    dest.push(destPage.ref);
    if (target.zoom === undefined || target.zoom === 'fit-page') {
      dest.push(PDFName.of('Fit'));
    } else if (target.zoom === 'fit-width') {
      dest.push(PDFName.of('FitH'));
      dest.push(PDFNumber.of(destPage.getHeight()));
    } else {
      // explicit numeric zoom
      dest.push(PDFName.of('XYZ'));
      dest.push(PDFNumber.of(0));
      dest.push(PDFNumber.of(destPage.getHeight()));
      dest.push(PDFNumber.of(target.zoom));
    }
    annotDict.set(PDFName.of('Dest'), dest);
    return null;
  }
  // goto-bookmark — Wave 5 carry-over (2026-06-17, David): resolve to a real
  // /Dest at apply time when we know how. Two paths:
  //   1. Resolver present + returns a valid pageIndex → emit
  //      `/Dest [<pageRef> /Fit]` SO THE LINK WORKS IN ACROBAT, plus stamp
  //      the bookmarkId on `/ConductorBookmarkId` so we can round-trip the
  //      user's intent (bookmark, not raw page) for re-edit.
  //   2. No resolver or resolver returns null → legacy path: only the
  //      private `/ConductorBookmarkId` key. The renderer resolves at
  //      navigate-time. Acrobat won't follow it, but our viewer will. This
  //      is the behavior the pre-Wave-5 engine had.
  annotDict.set(PDFName.of('ConductorBookmarkId'), PDFNumber.of(target.bookmarkId));
  if (bookmarksResolver !== null) {
    const resolved = bookmarksResolver(target.bookmarkId);
    if (resolved !== null && Number.isInteger(resolved) && resolved >= 0 && resolved < pageCount) {
      const destPage = doc.getPage(resolved);
      const dest = PDFArray.withContext(ctx);
      dest.push(destPage.ref);
      dest.push(PDFName.of('Fit'));
      annotDict.set(PDFName.of('Dest'), dest);
    }
  }
  return null;
}

// ============================================================================
// Read helpers
// ============================================================================

function readRect(arr: PDFArray): [number, number, number, number] | null {
  const out: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const n = arr.lookupMaybe(i, PDFNumber);
    if (!n) return null;
    out.push(n.asNumber());
  }
  return [out[0]!, out[1]!, out[2]!, out[3]!];
}

function readTarget(doc: PDFDocument, annotDict: PDFDict): EngineLinkTarget | null {
  // /A /URI takes precedence (Acrobat behavior).
  const actionDict = annotDict.lookupMaybe(PDFName.of('A'), PDFDict);
  if (actionDict) {
    const s = actionDict.lookupMaybe(PDFName.of('S'), PDFName);
    if (s && s.asString() === '/URI') {
      const uri = actionDict.lookupMaybe(PDFName.of('URI'), PDFString);
      if (uri) return { kind: 'uri', uri: uri.asString() };
    }
  }
  // /ConductorBookmarkId — our private key.
  const bookmarkId = annotDict.lookupMaybe(PDFName.of('ConductorBookmarkId'), PDFNumber);
  if (bookmarkId) {
    return { kind: 'goto-bookmark', bookmarkId: bookmarkId.asNumber() };
  }
  // /Dest [pageRef ...]
  const dest = annotDict.lookupMaybe(PDFName.of('Dest'), PDFArray);
  if (dest && dest.size() >= 2) {
    const pageRef = dest.get(0);
    if (pageRef instanceof PDFRef) {
      const pageIx = findPageIndexByRef(doc, pageRef);
      if (pageIx !== -1) {
        const fit = dest.lookupMaybe(1, PDFName);
        if (fit && fit.asString() === '/Fit') {
          return { kind: 'goto-page', pageIndex: pageIx, zoom: 'fit-page' };
        }
        if (fit && fit.asString() === '/FitH') {
          return { kind: 'goto-page', pageIndex: pageIx, zoom: 'fit-width' };
        }
        if (fit && fit.asString() === '/XYZ') {
          const z = dest.lookupMaybe(4, PDFNumber);
          if (z) {
            return { kind: 'goto-page', pageIndex: pageIx, zoom: z.asNumber() };
          }
          return { kind: 'goto-page', pageIndex: pageIx };
        }
        return { kind: 'goto-page', pageIndex: pageIx };
      }
    }
  }
  return null;
}

function findPageIndexByRef(doc: PDFDocument, ref: PDFRef): number {
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i += 1) {
    if (pages[i]!.ref === ref) return i;
  }
  return -1;
}

// ============================================================================
// Validation
// ============================================================================

function validateAction(
  action: EngineLinkAction,
  pageCount: number,
): null | Result<never, LinkEngineError> {
  if (action.kind === 'add') {
    if (!Number.isInteger(action.pageIndex) || action.pageIndex < 0) {
      return fail<LinkEngineError>('invalid_payload', 'add.pageIndex must be non-negative int');
    }
    if (action.pageIndex >= pageCount) {
      return fail<LinkEngineError>(
        'page_out_of_range',
        `add.pageIndex ${action.pageIndex} >= pageCount ${pageCount}`,
      );
    }
    if (!Array.isArray(action.bbox) || action.bbox.length !== 4) {
      return fail<LinkEngineError>('invalid_payload', 'add.bbox must be a 4-tuple');
    }
    for (const n of action.bbox) {
      if (!Number.isFinite(n)) {
        return fail<LinkEngineError>('invalid_payload', 'add.bbox values must be finite numbers');
      }
    }
    return validateTarget(action.target);
  }
  if (action.kind === 'update') {
    if (typeof action.linkId !== 'string' || action.linkId.length === 0) {
      return fail<LinkEngineError>('invalid_payload', 'update.linkId must be a non-empty string');
    }
    return validateTarget(action.target);
  }
  if (action.kind === 'remove') {
    if (typeof action.linkId !== 'string' || action.linkId.length === 0) {
      return fail<LinkEngineError>('invalid_payload', 'remove.linkId must be a non-empty string');
    }
    return null;
  }
  return fail<LinkEngineError>('invalid_payload', `unknown action kind`);
}

function validateTarget(t: EngineLinkTarget): null | Result<never, LinkEngineError> {
  if (t.kind === 'uri') {
    if (typeof t.uri !== 'string' || t.uri.length === 0) {
      return fail<LinkEngineError>('invalid_payload', 'target.uri must be a non-empty string');
    }
    return null;
  }
  if (t.kind === 'goto-page') {
    if (!Number.isInteger(t.pageIndex) || t.pageIndex < 0) {
      return fail<LinkEngineError>('invalid_payload', 'target.pageIndex must be non-negative int');
    }
    if (t.zoom !== undefined) {
      if (t.zoom !== 'fit-page' && t.zoom !== 'fit-width' && !Number.isFinite(t.zoom)) {
        return fail<LinkEngineError>('invalid_payload', 'target.zoom invalid');
      }
    }
    return null;
  }
  if (t.kind === 'goto-bookmark') {
    if (!Number.isInteger(t.bookmarkId) || t.bookmarkId < 0) {
      return fail<LinkEngineError>('invalid_payload', 'target.bookmarkId must be non-negative int');
    }
    return null;
  }
  return fail<LinkEngineError>('invalid_payload', `unknown target kind`);
}

function parseLinkId(id: string): { pageIndex: number; annotIndex: number } | null {
  const m = /^(\d+):(\d+)$/.exec(id);
  if (!m) return null;
  return { pageIndex: Number(m[1]), annotIndex: Number(m[2]) };
}
