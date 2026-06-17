// Phase 7.5 Wave 3 — B4 Background engine.
//
// Canonical spec: docs/architecture-phase-7.5.md §4.3 ("B4 Watermark / H&F /
// Background — shared engine") and docs/api-contracts.md §19.3.3
// (`pdf:applyBackground`).
//
// What this module does:
//   For each target page, fill the MediaBox with either a solid color (rgb)
//   OR a full-bleed image stretched to the page bounds. The fill is drawn
//   BEFORE existing content so existing text/images remain visible on top.
//
// Limitation honestly disclosed:
//   pdf-lib's public API appends content-stream operators at the tail. To
//   achieve a true "behind existing content" effect we would need to rewrite
//   the page's content stream so our rectangle/image appears at the head.
//   pdf-lib's PDFPage doesn't expose that as a direct API. For v0.8.0 we
//   accept that backgrounds render on top of opaque content (warning emitted
//   so the renderer surfaces this honestly) and document the limitation in
//   the user-guide. Wave 4+ may add a `prependContentStream` helper.

import { PDFDocument, rgb, type PDFImage, type PDFPage } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

// ============================================================================
// Public types
// ============================================================================

export type BackgroundTarget =
  | { kind: 'all' }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'list'; indices: ReadonlyArray<number> };

export type BackgroundSource =
  | { kind: 'color'; color: string /* #RRGGBB */ }
  | { kind: 'image'; imageBytes: Uint8Array; opacity: number };

export interface ApplyBackgroundOptions {
  pdfBytes: Uint8Array;
  target: BackgroundTarget;
  source: BackgroundSource;
}

export type ApplyBackgroundError =
  | 'pdf_load_failed'
  | 'invalid_payload'
  | 'invalid_target'
  | 'page_out_of_range'
  | 'image_invalid'
  | 'engine_failed';

export interface ApplyBackgroundValue {
  bytes: Uint8Array;
  pagesAffected: number;
  warnings: string[];
}

export type ApplyBackgroundResult = Result<ApplyBackgroundValue, ApplyBackgroundError>;

// ============================================================================
// Engine
// ============================================================================

export async function applyBackground(
  opts: ApplyBackgroundOptions,
): Promise<ApplyBackgroundResult> {
  const payloadErr = validatePayload(opts);
  if (payloadErr) return fail<ApplyBackgroundError>('invalid_payload', payloadErr);

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(opts.pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<ApplyBackgroundError>('pdf_load_failed', (e as Error).message ?? 'unknown');
  }

  const pageCount = doc.getPageCount();
  const targetsRes = resolveTarget(opts.target, pageCount);
  if (!targetsRes.ok) return targetsRes;
  const targets = targetsRes.value;

  const warnings: string[] = [];
  // Honest disclosure (see file header): backgrounds today layer on TOP of
  // existing content because pdf-lib's public API appends to the tail of the
  // content stream. Emit once per call so the UI can render one banner.
  warnings.push('background_rendered_over_content');

  let image: PDFImage | null = null;
  if (opts.source.kind === 'image') {
    const embed = await tryEmbedImage(doc, opts.source.imageBytes);
    if (!embed.ok) return embed;
    image = embed.value;
  }

  let pagesAffected = 0;
  for (const pageIndex of targets) {
    let page: PDFPage;
    try {
      page = doc.getPage(pageIndex);
    } catch (e) {
      warnings.push(
        `page ${pageIndex}: getPage threw (${(e as Error).message ?? 'unknown'}); skipped`,
      );
      continue;
    }
    try {
      const { width, height } = page.getSize();
      if (opts.source.kind === 'color') {
        const c = parseHexColor(opts.source.color);
        page.drawRectangle({
          x: 0,
          y: 0,
          width,
          height,
          color: rgb(c.r, c.g, c.b),
        });
      } else if (image) {
        page.drawImage(image, {
          x: 0,
          y: 0,
          width,
          height,
          opacity: opts.source.opacity,
        });
      }
      pagesAffected += 1;
    } catch (e) {
      warnings.push(
        `page ${pageIndex}: draw threw (${(e as Error).message ?? 'unknown'}); skipped`,
      );
    }
  }

  let outBytes: Uint8Array;
  try {
    outBytes = await doc.save({ useObjectStreams: true });
  } catch (e) {
    return fail<ApplyBackgroundError>(
      'engine_failed',
      `save threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }
  return ok<ApplyBackgroundValue>({ bytes: outBytes, pagesAffected, warnings });
}

// ============================================================================
// Helpers
// ============================================================================

function validatePayload(opts: ApplyBackgroundOptions): string | null {
  if (opts.source.kind === 'color') {
    if (!/^#[0-9a-fA-F]{6}$/.test(opts.source.color)) {
      return `color must be #RRGGBB (got ${opts.source.color})`;
    }
    return null;
  }
  if (opts.source.kind === 'image') {
    if (
      !(opts.source.imageBytes instanceof Uint8Array) ||
      opts.source.imageBytes.byteLength === 0
    ) {
      return 'imageBytes must be a non-empty Uint8Array';
    }
    if (
      typeof opts.source.opacity !== 'number' ||
      !Number.isFinite(opts.source.opacity) ||
      opts.source.opacity < 0 ||
      opts.source.opacity > 1
    ) {
      return 'opacity must be in [0, 1]';
    }
    return null;
  }
  return `unknown source kind: ${String((opts.source as { kind: string }).kind)}`;
}

function resolveTarget(
  target: BackgroundTarget,
  pageCount: number,
): Result<number[], ApplyBackgroundError> {
  if (target.kind === 'all') {
    const all: number[] = [];
    for (let i = 0; i < pageCount; i += 1) all.push(i);
    return ok(all);
  }
  if (target.kind === 'range') {
    if (!Number.isInteger(target.start) || !Number.isInteger(target.end)) {
      return fail<ApplyBackgroundError>('invalid_target', 'range start/end must be integers');
    }
    if (target.start < 0 || target.end < 0 || target.end < target.start) {
      return fail<ApplyBackgroundError>('invalid_target', 'range start/end must be in order >= 0');
    }
    if (target.end >= pageCount) {
      return fail<ApplyBackgroundError>(
        'page_out_of_range',
        `range.end ${target.end} >= pageCount ${pageCount}`,
      );
    }
    const list: number[] = [];
    for (let i = target.start; i <= target.end; i += 1) list.push(i);
    return ok(list);
  }
  const seen = new Set<number>();
  const out: number[] = [];
  for (const ix of target.indices) {
    if (!Number.isInteger(ix) || ix < 0) {
      return fail<ApplyBackgroundError>(
        'invalid_target',
        `index ${ix} is not a non-negative integer`,
      );
    }
    if (ix >= pageCount) {
      return fail<ApplyBackgroundError>(
        'page_out_of_range',
        `index ${ix} >= pageCount ${pageCount}`,
      );
    }
    if (!seen.has(ix)) {
      seen.add(ix);
      out.push(ix);
    }
  }
  return ok(out);
}

async function tryEmbedImage(
  doc: PDFDocument,
  bytes: Uint8Array,
): Promise<Result<PDFImage, ApplyBackgroundError>> {
  if (bytes.byteLength < 4) {
    return fail<ApplyBackgroundError>('image_invalid', 'image bytes too short');
  }
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpg) {
    return fail<ApplyBackgroundError>('image_invalid', 'image bytes are not PNG or JPEG');
  }
  try {
    const owned = bytes.slice();
    const img = isPng ? await doc.embedPng(owned) : await doc.embedJpg(owned);
    return ok(img);
  } catch (e) {
    return fail<ApplyBackgroundError>(
      'image_invalid',
      `image embed failed: ${(e as Error).message ?? 'unknown'}`,
    );
  }
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b };
}
