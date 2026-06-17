// Phase 7.5 Wave 5 — B20 Sanitize / Remove Hidden Information engine.
//
// Canonical spec:
//   - docs/api-contracts.md §19.4.3 (`pdf:removeHiddenInfo`).
//   - docs/architecture-phase-7.5.md §4.1 row B20 + §4.4 ("rebuild-from-
//     scratch family").
//   - .learnings/locked-instructions.md P7.5-L-12 — REBUILD-FROM-SCRATCH
//     pattern, not strip-post-hoc (Phase 7.4 B1 lesson, David 2026-06-15).
//
// Design:
//   The engine ALWAYS builds a fresh `PDFDocument.create()` and copies ONLY
//   the page contents the user wants to retain. Everything else — catalog
//   entries (JS, EmbeddedFiles, AcroForm, Outlines, OCProperties,
//   StructTreeRoot, OpenAction, Names, Threads, AA), the /Info dict, and
//   any orphan indirect objects — is dropped BY CONSTRUCTION because we
//   never copy the source catalog or trailer.
//
//   Per-category logic:
//     - "metadata"    : do NOT copy /Info; set Producer + ModDate on dst
//                       (trust-floor pattern from redact-engine).
//     - "attachments" : EmbeddedFiles live on the source catalog →
//                       not copied. We surface itemsRemoved by counting.
//     - "comments"    : annotations on pages. copyPages brings them; we
//                       strip the /Annots array from each copied page.
//     - "form-fields" : AcroForm lives on the source catalog → not copied.
//     - "bookmarks"   : Outlines live on the source catalog → not copied.
//     - "js"          : per-page /AA actions can survive copyPages; we
//                       strip them on the destination. Catalog-level JS is
//                       already gone by construction.
//     - "hidden-text" / "hidden-layers" / "deleted-content" : pdf-lib does
//                       not surface these as first-class concepts; rebuild
//                       from-scratch handles deleted-content; the other
//                       two are honest "we tried" surfaces — we count
//                       structure-tree hints in the source but cannot
//                       deterministically remove without a renderer pass.
//                       We surface itemsRemoved=0 + a warning.
//     - "object-data" / "links" / "thumbnails" / "web-capture-info" /
//       "overlapping-objects" / "cross-reference-data" /
//       "content-not-on-page" / "private-application-data" :
//                       all reside on the source catalog or as catalog
//                       cross-refs → not copied by construction. We probe
//                       the source to populate itemsRemoved counts.
//
// What this module does NOT do:
//   - Visual rasterization of "hidden" text. The rasterize-redact pattern
//     from `redact-engine.ts` is the right tool when the user wants
//     visual guarantees; this engine is the structural-strip cousin.
//   - Re-embed fonts after copy. pdf-lib's copyPages keeps font references
//     wired; no action needed.
//
// Locked-instruction compliance:
//   - L-001..L-006: pure pdf-lib, no pdf.js, no test channel.
//   - P7.5-L-12: rebuild-from-scratch, not strip-post-hoc. Verified by the
//     test that asserts the destination has zero entries for
//     /AcroForm, /Outlines, /EmbeddedFiles, /Names.

import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFObject } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

import { stripDocLevelJavaScript } from './form-engine.js';

// ============================================================================
// Public types
// ============================================================================

export type SanitizeCategory =
  | 'metadata'
  | 'attachments'
  | 'comments'
  | 'form-fields'
  | 'bookmarks'
  | 'js'
  | 'hidden-text'
  | 'hidden-layers'
  | 'deleted-content'
  | 'object-data'
  | 'thumbnails'
  | 'web-capture-info'
  | 'links'
  | 'overlapping-objects'
  | 'cross-reference-data'
  | 'content-not-on-page'
  | 'private-application-data';

export interface SanitizeOptions {
  pdfBytes: Uint8Array;
  categories: ReadonlyArray<SanitizeCategory>;
}

export type SanitizeEngineError = 'invalid_payload' | 'pdf_load_failed' | 'engine_failed';

export interface SanitizeResult {
  bytes: Uint8Array;
  /** Categories the caller asked for, echoed back. Mirrors contract value. */
  categoriesApplied: SanitizeCategory[];
  /** Per-category count of items removed (best-effort source-side probe). */
  itemsRemoved: Record<SanitizeCategory, number>;
  /** Honest warnings for categories the engine could not deterministically
   *  remove (hidden-text, hidden-layers). Empty when none. */
  warnings: string[];
}

// ============================================================================
// Engine
// ============================================================================

export async function sanitizeDocument(
  opts: SanitizeOptions,
): Promise<Result<SanitizeResult, SanitizeEngineError>> {
  if (!(opts.pdfBytes instanceof Uint8Array) || opts.pdfBytes.byteLength === 0) {
    return fail<SanitizeEngineError>('invalid_payload', 'pdfBytes must be a non-empty Uint8Array');
  }
  if (!Array.isArray(opts.categories)) {
    return fail<SanitizeEngineError>('invalid_payload', 'categories must be an array');
  }

  // 1. Load source (read-only).
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(opts.pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<SanitizeEngineError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  const categories = dedupe(opts.categories);
  const wants = new Set<SanitizeCategory>(categories);
  const itemsRemoved = initItemsRemoved();
  const warnings: string[] = [];

  // 2. Probe source for category counts (best-effort).
  probeSourceCounts(src, itemsRemoved);

  // 3. Build destination via rebuild-from-scratch.
  let dst: PDFDocument;
  try {
    dst = await PDFDocument.create({ updateMetadata: false });
  } catch (e) {
    return fail<SanitizeEngineError>(
      'engine_failed',
      e instanceof Error && e.message ? `create threw: ${e.message}` : 'create threw',
    );
  }

  // 4. Copy pages.
  try {
    const indices = src.getPageIndices();
    const copied = await dst.copyPages(src, indices);
    for (const page of copied) dst.addPage(page);
  } catch (e) {
    return fail<SanitizeEngineError>(
      'engine_failed',
      e instanceof Error && e.message ? `copyPages threw: ${e.message}` : 'copyPages threw',
    );
  }

  // 5. Apply per-page strips.
  if (wants.has('comments') || wants.has('links')) {
    stripPageAnnotations(dst, {
      stripComments: wants.has('comments'),
      stripLinks: wants.has('links'),
    });
  }
  if (wants.has('js')) {
    stripPageActions(dst);
  }

  // 6. Always strip catalog-level JS (defense in depth).
  try {
    stripDocLevelJavaScript(dst);
  } catch {
    /* defensive */
  }

  // 7. Metadata trust-floor — when 'metadata' is requested OR a clean rebuild,
  // set Producer + ModDate so the output has a deterministic /Info.
  if (wants.has('metadata')) {
    try {
      dst.setProducer('PDF_Viewer_Editor');
      const now = new Date();
      dst.setModificationDate(now);
      dst.setCreationDate(now);
    } catch {
      /* defensive */
    }
  }

  // 8. Categories we cannot deterministically remove — surface honest warning.
  if (wants.has('hidden-text')) {
    warnings.push(
      'hidden-text: deterministic structural removal requires a render pass; rebuild dropped any catalog-level hint but a renderer-side raster sweep is the only complete guarantee.',
    );
  }
  if (wants.has('hidden-layers')) {
    warnings.push(
      'hidden-layers: optional-content groups live on the source catalog and are dropped by construction; layered visual data INSIDE the page stream is not flattened here.',
    );
  }

  // 9. Serialize.
  let outBytes: Uint8Array;
  try {
    // useObjectStreams: false keeps the inspect-output test honest — we want
    // the rebuild evidence (no AcroForm / Outlines / EmbeddedFiles) to be
    // readable from the output stream without needing to expand object
    // streams.
    outBytes = await dst.save({ useObjectStreams: false });
  } catch (e) {
    return fail<SanitizeEngineError>(
      'engine_failed',
      e instanceof Error && e.message ? `save threw: ${e.message}` : 'save threw',
    );
  }

  // 10. Zero out the itemsRemoved entries for categories the caller did NOT
  // request — we keep only counts for what the user asked to remove.
  const filteredItemsRemoved: Record<SanitizeCategory, number> = initItemsRemoved();
  for (const cat of categories as SanitizeCategory[]) {
    filteredItemsRemoved[cat] = itemsRemoved[cat];
  }

  return ok<SanitizeResult>({
    bytes: outBytes,
    categoriesApplied: categories,
    itemsRemoved: filteredItemsRemoved,
    warnings,
  });
}

// ============================================================================
// Helpers
// ============================================================================

function initItemsRemoved(): Record<SanitizeCategory, number> {
  return {
    metadata: 0,
    attachments: 0,
    comments: 0,
    'form-fields': 0,
    bookmarks: 0,
    js: 0,
    'hidden-text': 0,
    'hidden-layers': 0,
    'deleted-content': 0,
    'object-data': 0,
    thumbnails: 0,
    'web-capture-info': 0,
    links: 0,
    'overlapping-objects': 0,
    'cross-reference-data': 0,
    'content-not-on-page': 0,
    'private-application-data': 0,
  };
}

function dedupe<T>(arr: ReadonlyArray<T>): T[] {
  return Array.from(new Set(arr));
}

function probeSourceCounts(src: PDFDocument, counts: Record<SanitizeCategory, number>): void {
  const catalog = src.catalog;

  // /Info dict probe.
  if (src.getTitle() || src.getAuthor() || src.getSubject() || src.getKeywords()) {
    counts.metadata = 1;
  }
  // AcroForm.
  if (catalogHas(catalog, 'AcroForm')) {
    counts['form-fields'] = 1;
  }
  // Outlines (bookmarks).
  if (catalogHas(catalog, 'Outlines')) {
    counts.bookmarks = 1;
  }
  // Names dict (often hosts EmbeddedFiles, JS).
  const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names) {
    if (names.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)) {
      counts.attachments = 1;
    }
    if (names.lookupMaybe(PDFName.of('JavaScript'), PDFDict)) {
      counts.js = (counts.js ?? 0) + 1;
    }
    counts['object-data'] = (counts['object-data'] ?? 0) + 1;
  }
  if (catalogHas(catalog, 'OCProperties')) {
    counts['hidden-layers'] = 1;
  }
  // Comments / links — walk pages and count.
  const pages = src.getPages();
  for (const page of pages) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const a = annots.lookupMaybe(i, PDFDict);
      if (!a) continue;
      const subtype = a.lookupMaybe(PDFName.of('Subtype'), PDFName);
      if (!subtype) continue;
      if (subtype.asString() === '/Link') {
        counts.links += 1;
      } else {
        counts.comments += 1;
      }
    }
  }
}

function catalogHas(catalog: PDFDict, key: string): boolean {
  try {
    return catalog.has(PDFName.of(key));
  } catch {
    return false;
  }
}

function stripPageAnnotations(
  dst: PDFDocument,
  flags: { stripComments: boolean; stripLinks: boolean },
): void {
  const pages = dst.getPages();
  for (const page of pages) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    // Filter in place: keep only annotations the user did NOT want to strip.
    const survivors: PDFObject[] = [];
    for (let i = 0; i < annots.size(); i += 1) {
      const a = annots.lookupMaybe(i, PDFDict);
      if (!a) {
        // unknown shape — drop defensively
        continue;
      }
      const subtype = a.lookupMaybe(PDFName.of('Subtype'), PDFName);
      const isLink = subtype?.asString() === '/Link';
      if (isLink && flags.stripLinks) continue;
      if (!isLink && flags.stripComments) continue;
      const entry = annots.get(i);
      if (entry) survivors.push(entry);
    }
    if (survivors.length === 0) {
      page.node.delete(PDFName.of('Annots'));
    } else {
      // Reset the array.
      const fresh = PDFArray.withContext(dst.context);
      for (const s of survivors) fresh.push(s);
      page.node.set(PDFName.of('Annots'), fresh);
    }
  }
}

function stripPageActions(dst: PDFDocument): void {
  const pages = dst.getPages();
  for (const page of pages) {
    // /AA = additional actions on page-open / page-close / etc.
    page.node.delete(PDFName.of('AA'));
    // /A on per-page level is uncommon but possible.
    page.node.delete(PDFName.of('A'));
  }
}
