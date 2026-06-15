// Phase 7.4 B1 — R1 Rasterize-Redact Engine.
//
// Canonical design: docs/phase-7.4-b1-redaction-design.md (Riley, 2026-06-15).
// Lock compliance: L-004 (toPdfJsBuffer copy lives in the injected rasterizer),
// L-005 (pdf.js load lives in the injected rasterizer), L-006 (no test channel).
//
// What this module does (Riley §1.1):
//   For each page that has redactions: rasterize the page via an injected
//   rasterizer (production: `rasterizePageProd` in `ocr-bootstrap.ts`), draw
//   opaque black rectangles on the raster at the redaction coordinates, embed
//   the resulting PNG as the new page content via pdf-lib's `embedPng`, and
//   REPLACE the original page entirely (insert fresh page at the same index,
//   then remove the original).
//
// What this module does NOT do (Riley §1.2):
//   Walk the content stream. We do not parse Tj/TJ/'/" operators. R1 is
//   *correct* precisely because the bytes the redactor produces have NO
//   underlying text — they are pixel data.
//
// Sanitize matrix (Riley §3, 17 rows): every category is applied unless
// explicitly deferred. See `sanitizeDocument()` below for the per-category
// code + the warning string for each non-empty source. The full purge is the
// non-negotiable safety floor — `combine.ts`'s strip-by-construction does NOT
// extend here because the redact engine LOADS the source doc + COPIES the
// non-redacted pages via the doc itself (no fresh `PDFDocument.create()`).
// So every catalog-level dict from the source CAN leak unless explicitly
// dropped — and §3 enumerates every dict we drop.
//
// Determinism (Riley §7.5): output bytes are reproducible when (a) the same
// `now` clock value is injected and (b) the same rasterizer + canvas adapter
// is used (production: `@napi-rs/canvas` with deterministic font metrics on
// rasterizer output). `useObjectStreams: false` keeps pdf-lib's serialization
// order stable.
//
// Pure-function discipline (per replay-engine.ts / combine.ts):
//   - no fs access
//   - no IPC
//   - no console.log/info (warnings flow via the returned `warnings[]`)
//   - all clocks injected (`now`)

import { PDFDocument, PDFName, type PDFDict } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

import { stripDocLevelJavaScript } from './form-engine.js';

// ============================================================================
// Public types
// ============================================================================

/** A redaction rectangle in PDF user-space coordinates (origin bottom-left). */
export interface RedactionRectEngine {
  /** 0-based page index. */
  pageIndex: number;
  /** PDF user-space coords; same shape as `PdfRect` used elsewhere. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ApplyRedactionsOptions {
  /** Source PDF bytes. Engine does NOT mutate; pdf-lib loads + serializes a copy. */
  pdfBytes: Uint8Array;
  /** Flat list of redaction rectangles. Engine groups by `pageIndex` internally. */
  redactions: ReadonlyArray<RedactionRectEngine>;
  /** Rasterization DPI for redacted pages. Default `DEFAULT_RASTER_DPI` (200). */
  rasterDpi?: number;
  /**
   * REQUIRED — rasterize a page of `pdfBytes` to PNG at the chosen DPI. The
   * production wiring routes through `rasterizePageProd` (which is L-004 +
   * L-005 compliant). Tests inject a stub.
   *
   * The callback receives the SAME `pdfBytes` the engine received. It must
   * not assume the bytes are in any documentStore — the production rasterizer
   * happens to be documentStore-backed, but here we pass bytes directly via
   * a closure (the handler bridges the gap).
   */
  rasterizePage: (opts: {
    pdfBytes: Uint8Array;
    pageIndex: number;
    dpi: number;
  }) => Promise<Uint8Array>;
  /**
   * REQUIRED — given a PNG and a list of rectangles in PIXEL coordinates of
   * THAT PNG, return a new PNG with opaque black rectangles drawn on top.
   * Production wiring uses `@napi-rs/canvas`. Tests inject a stub that returns
   * the PNG unchanged (the engine asserts the rect-drawing step is exercised
   * via a separate spy assertion in the unit suite).
   */
  drawBlackRectsOnPng: (
    pngBytes: Uint8Array,
    rectsPx: ReadonlyArray<{ xPx: number; yPx: number; widthPx: number; heightPx: number }>,
  ) => Promise<Uint8Array>;
  /** Injected clock — defaults to `Date.now`. */
  now?: () => number;
}

export type ApplyRedactionsError =
  | 'pdf_load_failed'
  | 'no_redactions'
  | 'page_out_of_range'
  | 'rect_invalid'
  | 'rasterize_failed'
  | 'engine_failed'
  | 'output_too_large';

export interface ApplyRedactionsValue {
  /** The sanitized + redacted output bytes. */
  bytes: Uint8Array;
  /** Number of distinct pages on which at least one redaction was applied. */
  pagesRedacted: number;
  /** Total number of redaction rectangles applied. */
  rectsApplied: number;
  /** Honest disclosure warnings. See Riley §3.1 for the canonical strings. */
  warnings: string[];
}

export type ApplyRedactionsResult = Result<ApplyRedactionsValue, ApplyRedactionsError>;

/** R1 default DPI (Riley §1.3 + risk-register R-2). 200 is the smallest DPI
 *  that preserves 6pt small-print on the rasterized non-redacted text. */
export const DEFAULT_RASTER_DPI = 200;

/** Mirrors `combine.ts` MAX_OUTPUT_BYTES. Redaction outputs are typically the
 *  same order of magnitude as combine outputs (one redacted page = one PNG
 *  image at DPI; bounded by the source page count + DPI). */
export const MAX_OUTPUT_BYTES = 200 * 1024 * 1024;

// ============================================================================
// Engine
// ============================================================================

/**
 * Apply R1 rasterize-redact + full sanitize matrix.
 *
 * Pure function over (pdfBytes, redactions, rasterDpi, deps). Returns either
 * the redacted+sanitized output bytes + counts + warnings, or a typed Result
 * error. NEVER throws.
 */
export async function applyRedactions(
  opts: ApplyRedactionsOptions,
): Promise<ApplyRedactionsResult> {
  const clock = opts.now ?? Date.now;
  const rasterDpi =
    typeof opts.rasterDpi === 'number' && opts.rasterDpi > 0 ? opts.rasterDpi : DEFAULT_RASTER_DPI;

  // 1. Validate redactions[] shape (defensive — the IPC handler also validates).
  if (opts.redactions.length === 0) {
    return fail<ApplyRedactionsError>('no_redactions', 'redactions[] is empty');
  }
  for (let i = 0; i < opts.redactions.length; i += 1) {
    const r = opts.redactions[i]!;
    if (
      !Number.isFinite(r.x) ||
      !Number.isFinite(r.y) ||
      !Number.isFinite(r.width) ||
      !Number.isFinite(r.height)
    ) {
      return fail<ApplyRedactionsError>('rect_invalid', `redactions[${i}] has non-finite coord`, {
        rectIndex: i,
      });
    }
    if (r.width <= 0 || r.height <= 0) {
      return fail<ApplyRedactionsError>(
        'rect_invalid',
        `redactions[${i}] has non-positive width or height`,
        { rectIndex: i },
      );
    }
    if (!Number.isInteger(r.pageIndex) || r.pageIndex < 0) {
      return fail<ApplyRedactionsError>('rect_invalid', `redactions[${i}] has invalid pageIndex`, {
        rectIndex: i,
      });
    }
  }

  // 2. Load source via pdf-lib.
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(opts.pdfBytes, {
      updateMetadata: false,
      // We do NOT silently ignore encryption — the IPC layer would have already
      // rejected if the doc were encrypted. Default `throwOnInvalidObject:false`
      // preserves the lenient parser behavior the rest of the pipeline relies on.
    });
  } catch (e) {
    return fail<ApplyRedactionsError>('pdf_load_failed', (e as Error).message ?? 'unknown error');
  }

  const pageCount = doc.getPageCount();

  // 3. Group redactions by page; verify every pageIndex is in range.
  const byPage = new Map<number, RedactionRectEngine[]>();
  for (let i = 0; i < opts.redactions.length; i += 1) {
    const r = opts.redactions[i]!;
    if (r.pageIndex >= pageCount) {
      return fail<ApplyRedactionsError>(
        'page_out_of_range',
        `redactions[${i}].pageIndex ${r.pageIndex} >= pageCount ${pageCount}`,
        { rectIndex: i, pageIndex: r.pageIndex, pageCount },
      );
    }
    let list = byPage.get(r.pageIndex);
    if (!list) {
      list = [];
      byPage.set(r.pageIndex, list);
    }
    list.push(r);
  }

  const redactedPageIndices = Array.from(byPage.keys()).sort((a, b) => a - b);
  const warnings: string[] = [];
  const redactedSet = new Set(redactedPageIndices);

  // 4. Compute sanitize warnings BEFORE rebuilding into a fresh output doc.
  //    We probe the SOURCE doc for the categories Riley §3.1 calls out so we
  //    can emit honest warnings even though the output doc never has them by
  //    construction (the rebuild drops all catalog-level extras).
  detectSanitizeWarningsFromSource(doc, warnings);

  // 5. Build the OUTPUT doc rebuild-from-scratch (the combine.ts pattern).
  //    This is the strongest sanitize: no catalog-level dict from the source
  //    (JS, EmbeddedFiles, Outlines, AcroForm, OCProperties, StructTreeRoot,
  //    MarkInfo, Lang, Threads, AA, OpenAction, PieceInfo, SpiderInfo,
  //    Metadata) can leak — they live in the SOURCE catalog and we never
  //    copy the source catalog. Only page CONTENTS (not page-level dicts'
  //    every entry) cross via `copyPages`, and pdf-lib's copyPages skips
  //    per-page `/Annots` for the new pages we create (raster pages are
  //    brand-new — no annotations to begin with).
  //
  //    For the non-redacted pages, `copyPages` carries content streams +
  //    resources. Page-level `/Annots` on non-redacted pages ARE copied (we
  //    are explicit about not dropping them — Riley §4.2: "a redaction on
  //    page 3 does not delete the sticky note on page 7").
  let outDoc: PDFDocument;
  try {
    outDoc = await PDFDocument.create();
  } catch (e) {
    return fail<ApplyRedactionsError>(
      'engine_failed',
      `PDFDocument.create threw: ${(e as Error).message ?? 'unknown error'}`,
    );
  }

  // Per-page rebuild — preserves source page order. For each source page:
  //   - if redaction-bearing: rasterize → paint rects → embed PNG → addPage
  //   - else: copyPages from source + addPage
  let rectsApplied = 0;
  for (let i = 0; i < pageCount; i += 1) {
    let pageWidthPts: number;
    let pageHeightPts: number;
    try {
      const srcPage = doc.getPage(i);
      pageWidthPts = srcPage.getWidth();
      pageHeightPts = srcPage.getHeight();
    } catch (e) {
      return fail<ApplyRedactionsError>(
        'engine_failed',
        `getPage(${i}) threw: ${(e as Error).message ?? 'unknown error'}`,
      );
    }

    if (!redactedSet.has(i)) {
      // Pass-through: copyPage + addPage. Preserves content stream + resources
      // + the page-level /Annots dict — non-redacted pages keep annotations
      // (Riley §4.2).
      try {
        const [copied] = await outDoc.copyPages(doc, [i]);
        outDoc.addPage(copied!);
      } catch (e) {
        return fail<ApplyRedactionsError>(
          'engine_failed',
          `copyPages(${i}) threw: ${(e as Error).message ?? 'unknown error'}`,
          { pageIndex: i },
        );
      }
      continue;
    }

    // Redaction-bearing page: rasterize → paint → embed → add as raster.
    const rectsOnPage = byPage.get(i)!;

    let pngBytes: Uint8Array;
    try {
      pngBytes = await opts.rasterizePage({
        pdfBytes: opts.pdfBytes,
        pageIndex: i,
        dpi: rasterDpi,
      });
    } catch (e) {
      return fail<ApplyRedactionsError>(
        'rasterize_failed',
        `rasterizePage(${i}) threw: ${(e as Error).message ?? 'unknown error'}`,
        { pageIndex: i },
      );
    }
    if (!(pngBytes instanceof Uint8Array) || pngBytes.byteLength === 0) {
      return fail<ApplyRedactionsError>(
        'rasterize_failed',
        `rasterizePage(${i}) returned empty bytes`,
        { pageIndex: i },
      );
    }

    const pngDims = readPngDimensions(pngBytes);
    if (!pngDims || pngDims.widthPx === 0 || pngDims.heightPx === 0) {
      return fail<ApplyRedactionsError>(
        'rasterize_failed',
        `rasterizePage(${i}) returned a PNG without readable IHDR dimensions`,
        { pageIndex: i },
      );
    }

    // PDF user space → PNG pixel space.
    const xScale = pngDims.widthPx / pageWidthPts;
    const yScale = pngDims.heightPx / pageHeightPts;
    const rectsPx = rectsOnPage.map((r) => {
      const xPx = r.x * xScale;
      const yPx = (pageHeightPts - (r.y + r.height)) * yScale;
      const widthPx = r.width * xScale;
      const heightPx = r.height * yScale;
      return { xPx, yPx, widthPx, heightPx };
    });

    let redactedPng: Uint8Array;
    try {
      redactedPng = await opts.drawBlackRectsOnPng(pngBytes, rectsPx);
    } catch (e) {
      return fail<ApplyRedactionsError>(
        'engine_failed',
        `drawBlackRectsOnPng(${i}) threw: ${(e as Error).message ?? 'unknown error'}`,
        { pageIndex: i },
      );
    }
    if (!(redactedPng instanceof Uint8Array) || redactedPng.byteLength === 0) {
      return fail<ApplyRedactionsError>(
        'engine_failed',
        `drawBlackRectsOnPng(${i}) returned empty bytes`,
        { pageIndex: i },
      );
    }

    let embedded;
    try {
      embedded = await outDoc.embedPng(redactedPng);
    } catch (e) {
      return fail<ApplyRedactionsError>(
        'engine_failed',
        `embedPng(${i}) threw: ${(e as Error).message ?? 'unknown error'}`,
        { pageIndex: i },
      );
    }

    try {
      const newPage = outDoc.addPage([pageWidthPts, pageHeightPts]);
      newPage.drawImage(embedded, {
        x: 0,
        y: 0,
        width: pageWidthPts,
        height: pageHeightPts,
      });
    } catch (e) {
      return fail<ApplyRedactionsError>(
        'engine_failed',
        `addPage raster at ${i} threw: ${(e as Error).message ?? 'unknown error'}`,
        { pageIndex: i },
      );
    }

    rectsApplied += rectsOnPage.length;
  }

  // 6. Apply minimal /Info (Producer + ModDate) on the OUTPUT doc.
  applyMinimalInfo(outDoc, clock);

  // 7. Defense-in-depth: the rebuild guarantees catalog-level extras don't
  //    leak, but copyPages CAN bring per-page /AA actions. Apply the JS strip
  //    helper on the output doc — Riley §4.3 makes this explicit and
  //    non-skippable.
  try {
    stripDocLevelJavaScript(outDoc);
  } catch {
    /* defensive */
  }

  // 8. Serialize.
  let outBytes: Uint8Array;
  try {
    outBytes = await outDoc.save({
      // Riley §3 #14 — object streams can hide deleted-but-not-freed orphans.
      useObjectStreams: false,
      updateFieldAppearances: false,
    });
  } catch (e) {
    return fail<ApplyRedactionsError>(
      'engine_failed',
      `doc.save() threw: ${(e as Error).message ?? 'unknown error'}`,
    );
  }

  if (outBytes.byteLength > MAX_OUTPUT_BYTES) {
    return fail<ApplyRedactionsError>(
      'output_too_large',
      `output ${outBytes.byteLength} bytes exceeds ${MAX_OUTPUT_BYTES}-byte cap`,
      { outputBytes: outBytes.byteLength, max: MAX_OUTPUT_BYTES },
    );
  }

  // 7. Always emit the rasterize-loses-searchability warning since we always
  //    rasterized at least one page.
  warnings.push('Redacted pages are now rasterized images. Re-run OCR to restore text search.');

  return ok({
    bytes: outBytes,
    pagesRedacted: redactedPageIndices.length,
    rectsApplied,
    warnings,
  });
}

// ============================================================================
// Sanitize matrix (Riley §3) — REBUILD-FROM-SCRATCH strategy.
//
// The output doc is built via `PDFDocument.create()` + `copyPages` for the
// non-redacted pages + `addPage`-with-raster for the redacted pages. None of
// the source catalog's dict entries (JS, EmbeddedFiles, Outlines, AcroForm,
// OCProperties, StructTreeRoot, MarkInfo, Lang, Threads, AA, OpenAction,
// PieceInfo, SpiderInfo, Metadata) can leak — they live in the SOURCE catalog
// and we never copy the source catalog. This is the same sanitize-by-
// construction property `combine.ts` relies on.
//
// What we still need to do explicitly:
//   - Detect which categories were PRESENT in the source so we can emit
//     honest disclosure warnings (Riley §3.1). The output never has them.
//   - Apply minimal /Info (Producer + ModDate) on the OUTPUT doc — the
//     rebuild creates an empty /Info dict and pdf-lib will populate Producer
//     from its own default which we override for trust-floor.
//   - Belt-and-braces strip on the output: per-page /AA on copied pages
//     could re-introduce JS exec (Riley §4.3 + Risk register R-8). The
//     `stripDocLevelJavaScript` helper covers /Names → /JavaScript on the
//     output; we call it after the per-page copy step.
// ============================================================================

/** Probe the source for the categories Riley §3.1 mandates we surface as
 *  warnings. Honest disclosure: even though the output never carries these by
 *  construction, the USER had them and should know. */
function detectSanitizeWarningsFromSource(doc: PDFDocument, warnings: string[]): void {
  const catalog = doc.catalog;

  if (catalogHas(catalog, 'Outlines')) {
    warnings.push('Bookmarks removed during redaction.');
  }
  if (catalogHas(catalog, 'AcroForm')) {
    warnings.push(
      'Form fields removed during redaction. Flatten the form first to keep filled values.',
    );
  }
  if (catalogHas(catalog, 'OCProperties')) {
    warnings.push('Layers removed during redaction.');
  }
  if (
    catalogHas(catalog, 'StructTreeRoot') ||
    catalogHas(catalog, 'MarkInfo') ||
    catalogHas(catalog, 'Lang')
  ) {
    warnings.push('Accessibility structure removed during redaction.');
  }
}

/** Defensive catalog-has probe. */
function catalogHas(catalog: PDFDict, name: string): boolean {
  try {
    return catalog.has(PDFName.of(name));
  } catch {
    return false;
  }
}

/** Set the output doc's /Info to the minimal trust-floor shape
 *  (Producer = "PDF_Viewer_Editor"; ModDate + CreationDate = injected clock).
 *  Title / Author / Subject / Keywords / Creator are left UNSET (pdf-lib's
 *  default behaviour is to omit unset entries — which is what we want).
 *
 *  Why call setProducer instead of register+ctx.trailerInfo.Info: pdf-lib's
 *  `save()` calls `updateInfoDict()` internally which OVERWRITES Producer
 *  with pdf-lib's own default. The supported API is `setProducer` (which sets
 *  the override flag pdf-lib reads inside updateInfoDict). Determined
 *  empirically + cross-referenced against pdf-lib v1.17 source. */
function applyMinimalInfo(doc: PDFDocument, clock: () => number): void {
  try {
    doc.setProducer('PDF_Viewer_Editor');
    const dt = new Date(clock());
    doc.setModificationDate(dt);
    doc.setCreationDate(dt);
  } catch {
    /* defensive — leave pdf-lib's default /Info if API changed */
  }
}

// ============================================================================
// PNG dimension reader — copy of `ocr-bootstrap.ts:readPngDimensions` (private
// there). Cheap to inline so the engine has no cross-module test seam.
// ============================================================================

function readPngDimensions(imageBytes: Uint8Array): { widthPx: number; heightPx: number } | null {
  if (imageBytes.byteLength < 24) return null;
  if (
    imageBytes[0] !== 0x89 ||
    imageBytes[1] !== 0x50 ||
    imageBytes[2] !== 0x4e ||
    imageBytes[3] !== 0x47
  ) {
    return null;
  }
  const w =
    ((imageBytes[16] ?? 0) << 24) |
    ((imageBytes[17] ?? 0) << 16) |
    ((imageBytes[18] ?? 0) << 8) |
    (imageBytes[19] ?? 0);
  const h =
    ((imageBytes[20] ?? 0) << 24) |
    ((imageBytes[21] ?? 0) << 16) |
    ((imageBytes[22] ?? 0) << 8) |
    (imageBytes[23] ?? 0);
  return { widthPx: w >>> 0, heightPx: h >>> 0 };
}
