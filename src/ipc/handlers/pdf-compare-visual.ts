// Handler: pdf:compareVisualOnPage (Phase 7.5 Wave 7 — B2 Compare Files).
//
// Contract: docs/api-contracts.md §19.9.
// Engine:   src/main/compare/visual-compare-engine.ts +
//           src/main/compare/compare-session-store.ts.
//
// Pure engine + INJECTED rasterizer seam. The wiring boundary (register.ts)
// supplies a pdf.js + canvas rasterizer that produces PNG bytes for a
// given (handle, pageIndex, renderWidth). The engine pixelmatches the
// two PNGs and composes the diff-mask PNG. L-005 (loadPdfJs polyfills-
// before-import) lives at the production rasterizer's loader; this
// handler stays pdf.js-free.
//
// Lazy semantics + caching:
//   The session-store's `renderCache` is keyed by `${pageIndex}@${width}`
//   per side. Cache hits skip rasterize entirely. Cache fills happen
//   per-side, independently — a request that hits left cache + misses
//   right cache only rasterizes the right side.
//
// Memory:
//   We DO NOT cache the diff-mask PNG — only the per-side renders. The
//   diff-mask is regenerated cheaply by pixelmatch on every request;
//   caching it would double our peak memory for no win.

import { z } from 'zod';

import {
  compareSessionStore,
  renderCacheKey,
  type CompareSession,
  type CompareSessionStore,
} from '../../main/compare/compare-session-store.js';
import {
  compareVisuals,
  DEFAULT_RENDER_WIDTH_PX,
  MAX_RENDER_WIDTH_PX,
  MIN_RENDER_WIDTH_PX,
  type VisualCompareEngineError,
} from '../../main/compare/visual-compare-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfCompareVisualOnPageError,
  PdfCompareVisualOnPageResponse,
} from '../contracts.js';

// =====================================================================
// Schema
// =====================================================================

const requestSchema = z.object({
  compareSessionId: z.string().min(1),
  leftPageIndex: z.number().int().nonnegative().nullable(),
  rightPageIndex: z.number().int().nonnegative().nullable(),
  renderWidth: z.number().positive().optional(),
});

// =====================================================================
// Deps
// =====================================================================

/** Rasterizer seam — given a document handle + 0-based page index +
 *  target render width in CSS pixels, return PNG bytes + the rendered
 *  height (the rasterizer picks height from the page's aspect ratio).
 *  Production wires pdf.js + canvas via the same loader the OCR
 *  rasterizer uses (L-005 compliance at the loader). Tests inject
 *  deterministic PNGs. */
export type CompareRasterizer = (
  handle: DocumentHandle,
  pageIndex: number,
  renderWidth: number,
) => Promise<{ pngBytes: Uint8Array; width: number; height: number }>;

export interface PdfCompareVisualDeps {
  store?: CompareSessionStore;
  /** Production wires this to a pdf.js + canvas rasterizer. */
  rasterizer: CompareRasterizer;
}

// =====================================================================
// Handler
// =====================================================================

export async function handlePdfCompareVisualOnPage(
  req: unknown,
  deps: PdfCompareVisualDeps,
): Promise<PdfCompareVisualOnPageResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfCompareVisualOnPageError>('invalid_payload', parsed.error.message);
  }
  const { compareSessionId, leftPageIndex, rightPageIndex } = parsed.data;
  if (leftPageIndex === null && rightPageIndex === null) {
    return fail<PdfCompareVisualOnPageError>(
      'invalid_payload',
      'at least one of leftPageIndex / rightPageIndex must be non-null',
    );
  }

  const store = deps.store ?? compareSessionStore;
  const session = store.get(compareSessionId);
  if (session === null) {
    return fail<PdfCompareVisualOnPageError>(
      'session_not_found',
      `compare session ${compareSessionId} is not open`,
    );
  }
  const rangeErr = checkPageRange(session, leftPageIndex, rightPageIndex);
  if (rangeErr !== null) return rangeErr;

  const renderWidth = clampWidth(parsed.data.renderWidth ?? DEFAULT_RENDER_WIDTH_PX);

  // Rasterize per side (with cache); orphan sides skip.
  let leftRender: { pngBytes: Uint8Array; width: number; height: number } | null = null;
  let rightRender: { pngBytes: Uint8Array; width: number; height: number } | null = null;
  try {
    if (leftPageIndex !== null) {
      const key = renderCacheKey(leftPageIndex, renderWidth);
      const cached = session.left.renderCache.get(key);
      if (cached !== undefined) {
        leftRender = { pngBytes: cached.pngBytes, width: cached.width, height: cached.height };
      } else {
        leftRender = await deps.rasterizer(session.left.handle, leftPageIndex, renderWidth);
        session.left.renderCache.set(key, {
          width: leftRender.width,
          height: leftRender.height,
          pngBytes: leftRender.pngBytes,
        });
      }
    }
    if (rightPageIndex !== null) {
      const key = renderCacheKey(rightPageIndex, renderWidth);
      const cached = session.right.renderCache.get(key);
      if (cached !== undefined) {
        rightRender = { pngBytes: cached.pngBytes, width: cached.width, height: cached.height };
      } else {
        rightRender = await deps.rasterizer(session.right.handle, rightPageIndex, renderWidth);
        session.right.renderCache.set(key, {
          width: rightRender.width,
          height: rightRender.height,
          pngBytes: rightRender.pngBytes,
        });
      }
    }
  } catch (e) {
    return fail<PdfCompareVisualOnPageError>(
      'rasterize_failed',
      safeMessage(e, 'rasterizer threw'),
    );
  }

  // Pair sides up. When both are present, widths must agree (the
  // rasterizer rendered both at the same target renderWidth — if the
  // returned widths differ that's a rasterizer bug we surface honestly).
  const engineRes = compareVisuals({
    leftPng: leftRender?.pngBytes ?? null,
    rightPng: rightRender?.pngBytes ?? null,
  });
  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message);
  }

  const pageNumber = ((leftPageIndex ?? rightPageIndex) as number) + 1;
  return ok({
    pageNumber,
    leftPageIndex,
    rightPageIndex,
    width: engineRes.value.width,
    height: engineRes.value.height,
    diffPixelCount: engineRes.value.diffPixelCount,
    totalPixelCount: engineRes.value.totalPixelCount,
    diffPercent: engineRes.value.diffPercent,
    diffMaskPng: toBase64(engineRes.value.diffMaskPng),
    leftPagePng: leftRender !== null ? toBase64(leftRender.pngBytes) : null,
    rightPagePng: rightRender !== null ? toBase64(rightRender.pngBytes) : null,
  });
}

// =====================================================================
// Helpers
// =====================================================================

function checkPageRange(
  session: CompareSession,
  leftPageIndex: number | null,
  rightPageIndex: number | null,
): PdfCompareVisualOnPageResponse | null {
  if (leftPageIndex !== null && leftPageIndex >= session.pageCountLeft) {
    return fail<PdfCompareVisualOnPageError>(
      'page_out_of_range',
      `leftPageIndex ${leftPageIndex} >= pageCountLeft ${session.pageCountLeft}`,
    );
  }
  if (rightPageIndex !== null && rightPageIndex >= session.pageCountRight) {
    return fail<PdfCompareVisualOnPageError>(
      'page_out_of_range',
      `rightPageIndex ${rightPageIndex} >= pageCountRight ${session.pageCountRight}`,
    );
  }
  return null;
}

function clampWidth(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_RENDER_WIDTH_PX;
  return Math.max(MIN_RENDER_WIDTH_PX, Math.min(MAX_RENDER_WIDTH_PX, Math.round(requested)));
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function mapEngineErr(err: VisualCompareEngineError, msg: string): PdfCompareVisualOnPageResponse {
  switch (err) {
    case 'invalid_payload':
      // Engine 'invalid_payload' here typically means rasterized widths
      // disagreed — that's a rasterizer bug; map to rasterize_failed for
      // honest client feedback.
      return fail<PdfCompareVisualOnPageError>('rasterize_failed', msg);
    case 'png_decode_failed':
      return fail<PdfCompareVisualOnPageError>('rasterize_failed', msg);
    case 'engine_failed':
    default:
      return fail<PdfCompareVisualOnPageError>('rasterize_failed', msg);
  }
}
