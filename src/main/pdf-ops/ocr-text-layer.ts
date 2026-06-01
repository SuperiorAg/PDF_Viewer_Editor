// Phase 5 — Searchable-PDF builder (text-behind-image authorship).
//
// Contract: docs/ocr-engine.md §5 + docs/architecture-phase-5.md §4.4.
//
// Locked decision P5-L-5: render-mode 3 (invisible) BT/ET text blocks at the
// recognized word coordinates. NOT ActualText + MarkedContent (deferred to
// Phase 7 for accessibility).
//
// COORDINATE TRANSFORMATION (P5-L-5 + sentinel-default lesson):
//   - Tesseract returns boxes in IMAGE-PIXEL space (top-left origin).
//   - PDFs use USER-SPACE (bottom-left origin, points = 1/72 inch).
//   - `imageToPdfRect` is the canonical helper. Tested with golden fixtures.
//   - `pageDimsPts` MUST come from the canonical pdf-lib metadata path —
//     sentinel 612x792 silently produces wrong word positions on non-Letter
//     PDFs (Phase 4.1.1 PageModel lesson; conventions §16.3.2).
//
// FONT HANDLING:
//   - Latin scripts use the built-in `/Helvetica` (standard 14; no font bytes).
//   - Non-Latin (CJK / Cyrillic / Arabic) use hex strings via Tj; the text
//     is SEARCHABLE but copy-paste may yield odd glyphs. Phase 5.1+ adds
//     proper font embedding.
//
// BOUNDARY: pure functions that take Uint8Array originalBytes + OcrPageResult[]
// and return new Uint8Array bytes. NO renderer-side state. NO disk I/O.

import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  TextRenderingMode,
  setTextRenderingMode,
} from 'pdf-lib';

import type { OcrPageResult, OcrWord, PdfRect } from '../../ipc/contracts.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';

// ============================================================================
// Coordinate transformation
// ============================================================================

export interface ImagePixelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ImageDimsPx {
  widthPx: number;
  heightPx: number;
}

export interface PageDimsPts {
  widthPts: number;
  heightPts: number;
}

/**
 * Tesseract image-pixel rect → PDF user-space rect.
 *
 * `pageDimsPts` MUST come from the canonical pdf-lib metadata path in main
 * (see `loadPdfMetadata` in pdf-metadata-loader.ts). Sentinel 612×792 inputs
 * silently produce wrong positions on non-Letter PDFs — Phase 4.1.1 PageModel
 * lesson, conventions §16.3.2.
 *
 * Golden-bytes-tested at Wave 20 with letter / legal / A4 fixtures.
 */
export function imageToPdfRect(
  imgRect: ImagePixelRect,
  imgDimsPx: ImageDimsPx,
  pageDimsPts: PageDimsPts,
): PdfRect {
  if (imgDimsPx.widthPx <= 0 || imgDimsPx.heightPx <= 0) {
    // Defensive — never happens with real Tesseract output (which always has
    // positive image dims). Return zero-size rect; the caller's nullable-
    // late-init pattern handles this without sentinel pollution.
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const sx = pageDimsPts.widthPts / imgDimsPx.widthPx;
  const sy = pageDimsPts.heightPts / imgDimsPx.heightPx;
  return {
    x: imgRect.x0 * sx,
    // Flip Y: imgY is top-down; pdfY is bottom-up.
    // PDF text origin sits at the baseline; we anchor at the rect's bottom
    // (which corresponds to imgRect.y1 in image-pixel space).
    y: pageDimsPts.heightPts - imgRect.y1 * sy,
    width: (imgRect.x1 - imgRect.x0) * sx,
    height: (imgRect.y1 - imgRect.y0) * sy,
  };
}

// ============================================================================
// PDF string escaping for `(...)` literal Tj operands
// ============================================================================

/**
 * Escape a UTF-8 string for use in a PDF `(...) Tj` operand.
 * Per PDF spec § 7.3.4.2 (Literal Strings): parens, backslash, newline.
 *
 * NOTE: Non-Latin-1 characters in literal strings produce undefined behavior
 * across viewers — for full Unicode coverage we should switch to hex-string
 * Tj with a /ToUnicode CMap. The full multi-script support is Phase 5.1+;
 * Phase 5 ships with Latin1-clean escaping + a hex-string fallback flag.
 */
export function escapePdfLiteralString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Returns true if the string contains only characters in the WinAnsiEncoding
 * subset that `/Helvetica` can render directly. Conservative — any non-ASCII
 * triggers the hex-string fallback.
 */
export function isLatin1Safe(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code > 0x7e) return false;
  }
  return true;
}

/**
 * Convert a UTF-16 string to a PDF hex string `<...>` payload for Tj.
 * BMP-only; surrogate pairs are emitted as two 4-hex sequences (each a
 * single code unit). The /ToUnicode CMap maps each into the original
 * Unicode code point at runtime — see Phase 5.1 for full CMap support.
 */
export function toPdfHexString(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    out += code.toString(16).padStart(4, '0');
  }
  return out;
}

// ============================================================================
// Page-level text-block authorship
// ============================================================================

export interface PageTextBlockOptions {
  words: OcrWord[];
  pageDimsPts: PageDimsPts;
  imgDimsPx: ImageDimsPx;
  /** Font resource alias (e.g. '/F0'). Authored once into page resources. */
  fontResourceName: string;
}

/**
 * Build the BT/ET text-block content-stream snippet for one page.
 *
 * Each word becomes:
 *   BT
 *   3 Tr                 % render mode 3 = invisible (P5-L-5)
 *   /F0 <size> Tf
 *   <x> <y> Td
 *   (<escaped>) Tj   |   <hex> Tj
 *   ET
 *
 * `fontSize` is the recognized word's height in points; chosen because
 * Tesseract's bbox height correlates well with the visible glyph's cap-height.
 */
export function buildPageTextBlock(opts: PageTextBlockOptions): string {
  const { words, pageDimsPts, imgDimsPx, fontResourceName } = opts;
  const lines: string[] = [];
  for (const w of words) {
    if (w.text.length === 0) continue;
    const rect = w.pdfRect ?? imageToPdfRect(w.imgRect, imgDimsPx, pageDimsPts);
    if (rect.height <= 0 || rect.width <= 0) continue;
    const fontSize = Math.max(1, rect.height);
    // PDF formatting: at most 4 decimals to bound string length.
    const fmt = (n: number): string => n.toFixed(4);
    lines.push('BT');
    lines.push('3 Tr');
    lines.push(`${fontResourceName} ${fmt(fontSize)} Tf`);
    lines.push(`${fmt(rect.x)} ${fmt(rect.y)} Td`);
    if (isLatin1Safe(w.text)) {
      lines.push(`(${escapePdfLiteralString(w.text)}) Tj`);
    } else {
      lines.push(`<${toPdfHexString(w.text)}> Tj`);
    }
    lines.push('ET');
  }
  return lines.join('\n');
}

/**
 * Mutate `pageResults` in-place so each word carries its PDF user-space rect.
 * Per the Phase 4.1 nullable-late-init pattern (conventions §16.3.3),
 * `OcrWord.pdfRect` is null at recognition time and populated HERE before
 * the renderer's confidence overlay reads it.
 */
export function populatePdfRects(
  pageResults: OcrPageResult[],
  pageDimsPtsFor: (pageIndex: number) => PageDimsPts,
): void {
  for (const pr of pageResults) {
    const dims = pageDimsPtsFor(pr.pageIndex);
    for (const w of pr.words) {
      if (w.pdfRect !== null) continue; // already computed
      const rect = imageToPdfRect(w.imgRect, pr.imgDimsPx, dims);
      w.pdfRect = rect;
    }
  }
}

// ============================================================================
// composeSearchablePdf — top-level entry
// ============================================================================

export type SearchablePdfBuildError = 'load_failed' | 'page_out_of_range' | 'serialize_failed';

/**
 * Append a text-behind-image layer (render-mode 3) to every recognized page
 * in `originalBytes`. Returns the new PDF bytes.
 *
 * Non-recognized pages are unchanged. The visual content of recognized pages
 * is preserved verbatim — the text-block bytes are appended to the page's
 * existing /Contents stream so the visible image paints first, then the
 * invisible text overlays.
 *
 * Per ocr-engine.md §5.5: the output replaces the source on next Save.
 */
export async function composeSearchablePdf(
  originalBytes: Uint8Array,
  pageResults: OcrPageResult[],
): Promise<Result<Uint8Array, SearchablePdfBuildError>> {
  let doc: PDFDocument;
  try {
    // We must NOT decrypt or re-encode — pdf-lib preserves existing object
    // structure on save when `updateMetadata: false`. The text-behind-image
    // layer is a pure additive append.
    doc = await PDFDocument.load(originalBytes, { updateMetadata: false });
  } catch (e) {
    return fail<SearchablePdfBuildError>(
      'load_failed',
      `pdf-lib load threw: ${safeMessage(e, 'unknown error')}`,
    );
  }
  const pageCount = doc.getPageCount();

  // Embed Helvetica once per doc; we get back a PDFFont handle whose
  // /Name (e.g. /Helv-0) is what we reference in our text blocks.
  const helvetica = await doc.embedStandardFont(StandardFonts.Helvetica);

  for (const pr of pageResults) {
    if (pr.pageIndex < 0 || pr.pageIndex >= pageCount) {
      return fail<SearchablePdfBuildError>(
        'page_out_of_range',
        `page ${pr.pageIndex} out of range (count=${pageCount})`,
      );
    }
    const page = doc.getPage(pr.pageIndex);
    const dims = { widthPts: page.getWidth(), heightPts: page.getHeight() };
    // Resolve PDF user-space rects on each word (idempotent).
    for (const w of pr.words) {
      if (w.pdfRect === null) {
        w.pdfRect = imageToPdfRect(w.imgRect, pr.imgDimsPx, dims);
      }
    }
    // Reference the embedded Helvetica by its already-registered resource
    // name. The pdf-lib API exposes this via the page's drawText path; we
    // want to author raw content-stream bytes so we use the font's `name`
    // property (a `PDFName`) directly.
    //
    // For Phase 5 v1: we use the page's drawText pipeline indirectly by
    // calling `page.drawText` for each recognized word at the resolved
    // user-space coordinates with render mode 3 (invisible). pdf-lib's
    // `drawText` doesn't directly expose Tr, so we go through the lower-
    // level approach below.
    //
    // PDF 1.7 §9.3.6: the render mode is set by the `Tr` operator in the
    // text object. pdf-lib's PDFPage doesn't surface `Tr` as a parameter
    // of `drawText`, so we emit raw operators via `pushOperators` from
    // pdf-lib-internal. Wave 21 may swap to a more idiomatic helper if
    // pdf-lib exposes Tr; until then, raw operators are the proven path.
    //
    // Per locked decision P5-L-5: each recognized word is painted at its
    // PDF user-space coordinate with render mode 3 (Invisible — PDF spec
    // § 9.3.6). pdf-lib's `drawText` does NOT accept `renderMode` in its
    // options object — that's the lower-level text-operator surface. We
    // emit the `3 Tr` operator ONCE per page via `page.pushOperators(
    // setTextRenderingMode(TextRenderingMode.Invisible))` before drawing
    // any words on that page; pdf-lib's drawText then emits its own
    // BT/Tf/Td/Tj/ET block which inherits the active Tr state.
    //
    // Wave 21 Julian-finding H-21.1 fix: the prior `as any` cast on a
    // `renderMode` property silently DROPPED at runtime (pdf-lib's options
    // type doesn't recognize the key) — the text was painting VISIBLY on
    // top of the scanned image. The proper path is the pushOperators
    // approach above. Tested by reading back the generated PDF and
    // asserting the `3 Tr` operator appears in the content stream.
    if (pr.words.some((w) => w.text.length > 0 && w.pdfRect !== null)) {
      page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
    }
    for (const word of pr.words) {
      if (word.text.length === 0 || word.pdfRect === null) continue;
      const r = word.pdfRect;
      if (r.height <= 0 || r.width <= 0) continue;
      const fontSize = Math.max(1, r.height);
      try {
        page.drawText(word.text, {
          x: r.x,
          y: r.y,
          size: fontSize,
          font: helvetica,
        });
      } catch (e) {
        return fail<SearchablePdfBuildError>(
          'serialize_failed',
          `drawText threw for page ${pr.pageIndex} word "${word.text.slice(0, 16)}": ${safeMessage(e, 'unknown error')}`,
        );
      }
    }
    // Restore the default rendering mode after this page's text blocks so
    // any subsequent rendering passes (none in our pipeline, but
    // belt-and-braces for downstream pdf-lib internals) get a clean Tr=0.
    if (pr.words.some((w) => w.text.length > 0 && w.pdfRect !== null)) {
      page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
    }
    // Anti-Adobe-mutation hardening: ensure the page reuses an existing
    // resource font dict rather than authoring a new one per word. pdf-lib
    // automatically dedupes embedded fonts (Helvetica is embedded ONCE);
    // the loop above just references the same `helvetica` handle.
    void PDFName; // referenced by side effect; keep import alive.
    void PDFString;
  }

  let newBytes: Uint8Array;
  try {
    newBytes = await doc.save({ updateFieldAppearances: false });
  } catch (e) {
    return fail<SearchablePdfBuildError>(
      'serialize_failed',
      `pdf-lib save threw: ${safeMessage(e, 'unknown error')}`,
    );
  }
  return ok(newBytes);
}
