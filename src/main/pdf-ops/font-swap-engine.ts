// Phase 7.5 Wave 5 — B18 Font swap engine.
//
// Canonical spec:
//   - docs/api-contracts.md §19.16.1 (`pdf:swapEmbeddedFont`).
//   - docs/architecture-phase-7.5.md §4.1 row B18.
//
// v0.8.0 scope:
//   Swap a referenced font with one of the 14 standard PDF fonts (Helvetica
//   family, Times family, Courier family, Symbol, ZapfDingbats). pdf-lib's
//   `StandardFonts` enum enumerates exactly these. They are "Type1" fonts
//   that EVERY conforming PDF viewer must include — we DO NOT embed their
//   bytes; the PDF references them by name. That's why the swap is so
//   cheap: we rewrite the per-font dictionary's `/BaseFont` (and adjust
//   `/Subtype` to `/Type1`) on every font reference matching the source
//   PostScript name.
//
// What this engine does NOT do (deferred to v0.9.0):
//   - Custom-font embedding from a `.ttf/.otf` on disk. Requires fontkit
//     subset + embed + width-table rewriting — large surface, deferred.
//     The contract field `toFontPath` exists but is IGNORED in v0.8.0 if
//     `toFontRef` is non-standard. We surface a warning AND a typed error.
//   - Glyph-coverage check. v0.8.0 standard fonts cover the Latin-1
//     supplement; users typing Greek / Cyrillic / CJK get visible
//     replacement. We surface a warning when the source font name suggests
//     a non-Latin character set ("CN", "JP", "Han", "Kanji", etc.).
//   - Width-table rewrite. Standard PDF fonts have implicit width tables;
//     this means glyph positioning DOES SHIFT after a swap. Acrobat does
//     the same; we surface a warning explicitly.
//
// Locked-instruction compliance:
//   - L-001..L-006: pure pdf-lib, no pdf.js, no test channel.
//   - P7.5-L-12 (rebuild-from-scratch) does NOT apply here — the engine is
//     a surgical rewrite, not a sanitize-class op.

import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

// ============================================================================
// Public types
// ============================================================================

/** The 14 standard PDF fonts — every conforming viewer ships these. */
export const STANDARD_PDF_FONTS = [
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Times-BoldItalic',
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
  'Symbol',
  'ZapfDingbats',
] as const;
export type StandardPdfFont = (typeof STANDARD_PDF_FONTS)[number];

export interface SwapEmbeddedFontOptions {
  pdfBytes: Uint8Array;
  /** PostScript name of the source font referenced in the PDF. */
  fromFontName: string;
  /** Destination font. v0.8.0: must be one of `STANDARD_PDF_FONTS`. */
  toFontName: StandardPdfFont;
}

export type FontSwapEngineError =
  | 'invalid_payload'
  | 'pdf_load_failed'
  | 'from_font_not_found'
  | 'to_font_invalid'
  | 'engine_failed';

export interface FontSwapResult {
  bytes: Uint8Array;
  fontsRewritten: number; // count of /BaseFont entries we updated
  warnings: string[];
}

// ============================================================================
// Engine
// ============================================================================

export async function swapEmbeddedFont(
  opts: SwapEmbeddedFontOptions,
): Promise<Result<FontSwapResult, FontSwapEngineError>> {
  // 1. Validate.
  if (!(opts.pdfBytes instanceof Uint8Array) || opts.pdfBytes.byteLength === 0) {
    return fail<FontSwapEngineError>('invalid_payload', 'pdfBytes must be a non-empty Uint8Array');
  }
  if (typeof opts.fromFontName !== 'string' || opts.fromFontName.length === 0) {
    return fail<FontSwapEngineError>('invalid_payload', 'fromFontName must be a non-empty string');
  }
  if (!isStandardFont(opts.toFontName)) {
    return fail<FontSwapEngineError>(
      'to_font_invalid',
      `toFontName "${opts.toFontName}" is not one of the 14 standard PDF fonts. Custom font embed deferred to v0.9.0.`,
    );
  }

  // 2. Load source.
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(opts.pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<FontSwapEngineError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  // 3. Walk all indirect objects, rewrite matching /Font dicts.
  const fromCandidates = candidateFontNames(opts.fromFontName);
  const warnings: string[] = [];
  let fontsRewritten = 0;

  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.lookupMaybe(PDFName.of('Type'), PDFName);
    if (!type || type.asString() !== '/Font') continue;
    const baseFont = obj.lookupMaybe(PDFName.of('BaseFont'), PDFName);
    if (!baseFont) continue;
    const baseStr = baseFont.asString().replace(/^\//, '');
    // PDF subset fonts use a `XXXXXX+ActualName` prefix. Strip it.
    const stripped = baseStr.replace(/^[A-Z]{6}\+/, '');
    if (!fromCandidates.has(stripped) && !fromCandidates.has(baseStr)) continue;

    rewriteFontDict(obj, opts.toFontName);
    fontsRewritten += 1;
  }

  if (fontsRewritten === 0) {
    return fail<FontSwapEngineError>(
      'from_font_not_found',
      `No /Font dict with /BaseFont matching "${opts.fromFontName}" was found.`,
    );
  }

  // 4. Honest warnings.
  warnings.push(
    'Glyph widths are not rewritten; text layout will shift slightly. Standard PDF fonts cover Latin-1; non-Latin glyphs may render as missing.',
  );
  if (looksLikeNonLatinHint(opts.fromFontName)) {
    warnings.push(
      `Source font "${opts.fromFontName}" name suggests non-Latin coverage; swap to a standard font (Latin-1 only) may produce missing-glyph boxes.`,
    );
  }

  // 5. Save.
  let outBytes: Uint8Array;
  try {
    outBytes = await doc.save({ useObjectStreams: false });
  } catch (e) {
    return fail<FontSwapEngineError>(
      'engine_failed',
      e instanceof Error && e.message ? `save threw: ${e.message}` : 'save threw',
    );
  }

  return ok<FontSwapResult>({ bytes: outBytes, fontsRewritten, warnings });
}

// ============================================================================
// Helpers
// ============================================================================

function isStandardFont(name: string): name is StandardPdfFont {
  return (STANDARD_PDF_FONTS as ReadonlyArray<string>).includes(name);
}

function candidateFontNames(input: string): Set<string> {
  // The caller may pass "Helvetica" or "Helvetica-Bold" or "/Helvetica" or a
  // subset-prefixed "AAAAAA+Helvetica-Bold". Build a set of plausible matches.
  const out = new Set<string>();
  const stripped = input.replace(/^\//, '');
  out.add(stripped);
  out.add(stripped.replace(/^[A-Z]{6}\+/, ''));
  return out;
}

function rewriteFontDict(fontDict: PDFDict, toFontName: StandardPdfFont): void {
  // Standard PDF fonts are Type1 (Symbol / ZapfDingbats included).
  fontDict.set(PDFName.of('Subtype'), PDFName.of('Type1'));
  fontDict.set(PDFName.of('BaseFont'), PDFName.of(toFontName));
  // Drop subset-related entries — standard fonts are not subsetted.
  fontDict.delete(PDFName.of('FontDescriptor'));
  fontDict.delete(PDFName.of('Widths'));
  fontDict.delete(PDFName.of('FirstChar'));
  fontDict.delete(PDFName.of('LastChar'));
  // Encoding stays — caller's CMap typically remains valid for Latin-1.
}

function looksLikeNonLatinHint(name: string): boolean {
  const upper = name.toUpperCase();
  return /CN|JP|KR|HAN|KANJI|HANGUL|MINGKAI|MINGTI|HEITI|SONGTI/.test(upper);
}
