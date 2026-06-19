// Phase 7.5 Wave 7 — B2 Compare Files visual-compare engine.
//
// Canonical spec:
//   - docs/project-plan.md §"Wave 7 — Compare Files (parallel)".
//   - docs/ui-spec-phase-7.5.md §2.3 (visual diff rendering).
//
// What this module does:
//   Given two already-rasterized PNG buffers for a page-pair, runs
//   pixelmatch (ISC) and composes a diff-mask PNG that the renderer
//   overlays on the modified page. Pure function: rasterization lives
//   at the wiring boundary (L-005) — the wiring layer rasterizes via
//   pdf.js + canvas and hands the engine raw PNG bytes.
//
// Threshold:
//   `DEFAULT_PIXELMATCH_THRESHOLD = 0.1` (the pixelmatch default).
//   Smaller = more sensitive (more pixels reported as differing).
//   Exported as a named constant so a future wave can wire a renderer-
//   visible tuning slider (Riley's call whether she surfaces it; if so,
//   she may want to drift-gate it Wave-5d-style).
//
// Orphan-page handling (one side null):
//   The handler synthesizes a full-coverage diff: it passes the present
//   side's PNG as `present`, omits the missing-side PNG, and asks for
//   `orphanFullDiff`. The engine returns:
//     - `diffPixelCount == totalPixelCount`
//     - `diffPercent == 100`
//     - `diffMaskPng` = solid-tinted overlay covering the full canvas
//   so the renderer's per-page badge can flag the page as "deleted-
//   only" or "inserted-only" without any extra branching.
//
// L-001 (path-sanitizer): n/a — engine writes no files.
// L-004 (buffer-copy-before-pdf.js): n/a — engine does not call pdf.js.
// L-005 (loadPdfJs polyfills): n/a — engine does not load pdf.js.

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { fail, ok, type Result } from '../../shared/result.js';

export type VisualCompareEngineError = 'invalid_payload' | 'png_decode_failed' | 'engine_failed';

/** Default pixelmatch threshold. 0.1 is the library default and a
 *  reasonable starting point for PDF pages (anti-aliasing tolerance
 *  baked in). Riley may want to surface this as a renderer slider in
 *  v0.9.0 — exported as a named constant so the handover is mechanical. */
export const DEFAULT_PIXELMATCH_THRESHOLD = 0.1;

/** Hard ceiling on the rendered canvas width. Larger → bigger base64
 *  payload + slower pixelmatch. 1600px wide is enough for retina
 *  rendering of a US-Letter page at ~140 DPI; bigger is overkill for an
 *  overlay thumbnail. The handler clamps the caller's `renderWidth`
 *  through this constant — see pdf-compare-visual.ts. */
export const MAX_RENDER_WIDTH_PX = 1600;
/** Floor (avoids degenerate 1x1 canvases). */
export const MIN_RENDER_WIDTH_PX = 64;
/** Default when the renderer doesn't supply a width. */
export const DEFAULT_RENDER_WIDTH_PX = 800;

/** Diff-mask tint colour. Bright red, full-opacity for differing pixels;
 *  transparent elsewhere. Renderer composes this over the modified-side
 *  page render. */
export const DIFF_MASK_RGB: [number, number, number] = [255, 0, 0];

export interface VisualCompareInput {
  /** Left/baseline rendered PNG bytes. `null` ⇒ orphan (right-only). */
  leftPng: Uint8Array | null;
  /** Right/modified rendered PNG bytes. `null` ⇒ orphan (left-only). */
  rightPng: Uint8Array | null;
  /** Pixelmatch threshold. Defaults to `DEFAULT_PIXELMATCH_THRESHOLD`. */
  threshold?: number;
}

export interface VisualCompareResult {
  /** Width of the diff canvas. Equals the present side's width (orphan
   *  path) or both sides' width (matched path; engine errors if they
   *  differ — the wiring layer must rasterize at the same width). */
  width: number;
  /** Taller of the two side heights (orphan path: the present side's
   *  height). */
  height: number;
  diffPixelCount: number;
  totalPixelCount: number;
  /** 0..100, fixed-point to 2 decimal places. */
  diffPercent: number;
  /** Raw PNG bytes for the diff mask overlay. The wiring layer base64-
   *  encodes for the IPC payload. */
  diffMaskPng: Uint8Array;
}

/** Compute the visual-compare result for a page-pair. */
export function compareVisuals(
  input: VisualCompareInput,
): Result<VisualCompareResult, VisualCompareEngineError> {
  const threshold = input.threshold ?? DEFAULT_PIXELMATCH_THRESHOLD;
  if (
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1
  ) {
    return fail<VisualCompareEngineError>(
      'invalid_payload',
      `threshold must be in [0,1] (got ${String(threshold)})`,
    );
  }
  if (input.leftPng !== null && !(input.leftPng instanceof Uint8Array)) {
    return fail<VisualCompareEngineError>('invalid_payload', 'leftPng must be Uint8Array | null');
  }
  if (input.rightPng !== null && !(input.rightPng instanceof Uint8Array)) {
    return fail<VisualCompareEngineError>('invalid_payload', 'rightPng must be Uint8Array | null');
  }
  if (input.leftPng === null && input.rightPng === null) {
    return fail<VisualCompareEngineError>(
      'invalid_payload',
      'both sides null — nothing to compare',
    );
  }

  // Orphan-page path: synthesize a full-coverage mask. The present
  // side's dimensions drive the canvas.
  if (input.leftPng === null || input.rightPng === null) {
    const presentBytes = (input.leftPng ?? input.rightPng) as Uint8Array;
    let presentPng: PNG;
    try {
      presentPng = decodePng(presentBytes);
    } catch (e) {
      return fail<VisualCompareEngineError>('png_decode_failed', describe(e));
    }
    return ok(buildOrphanResult(presentPng));
  }

  // Matched path. Decode both sides; dimensions MUST agree (the wiring
  // layer is responsible for rasterizing at the same width — when one
  // side's page is naturally taller, the wiring layer up-pads the
  // shorter side and writes that BEFORE calling the engine).
  let leftPng: PNG;
  let rightPng: PNG;
  try {
    leftPng = decodePng(input.leftPng);
  } catch (e) {
    return fail<VisualCompareEngineError>('png_decode_failed', `left: ${describe(e)}`);
  }
  try {
    rightPng = decodePng(input.rightPng);
  } catch (e) {
    return fail<VisualCompareEngineError>('png_decode_failed', `right: ${describe(e)}`);
  }
  if (leftPng.width !== rightPng.width || leftPng.height !== rightPng.height) {
    return fail<VisualCompareEngineError>(
      'invalid_payload',
      `left and right PNG dimensions must match (got ${leftPng.width}x${leftPng.height} vs ${rightPng.width}x${rightPng.height})`,
    );
  }
  const width = leftPng.width;
  const height = leftPng.height;
  const totalPixelCount = width * height;
  // Diff-mask buffer: RGBA, same dimensions, fully transparent
  // baseline. pixelmatch writes the highlighted pixels into it.
  const diffMask = new PNG({ width, height });
  diffMask.data.fill(0);

  let diffPixelCount: number;
  try {
    diffPixelCount = pixelmatch(leftPng.data, rightPng.data, diffMask.data, width, height, {
      threshold,
      diffMask: true,
      diffColor: DIFF_MASK_RGB,
    });
  } catch (e) {
    return fail<VisualCompareEngineError>('engine_failed', `pixelmatch threw: ${describe(e)}`);
  }

  const diffMaskPng = encodePng(diffMask);
  return ok({
    width,
    height,
    diffPixelCount,
    totalPixelCount,
    diffPercent: percentageOf(diffPixelCount, totalPixelCount),
    diffMaskPng,
  });
}

// =====================================================================
// Helpers
// =====================================================================

function decodePng(bytes: Uint8Array): PNG {
  // PNG.sync.read expects a Node Buffer. Wrap (zero-copy via subarray).
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return PNG.sync.read(buf);
}

function encodePng(png: PNG): Uint8Array {
  const buf = PNG.sync.write(png);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function buildOrphanResult(presentPng: PNG): VisualCompareResult {
  const width = presentPng.width;
  const height = presentPng.height;
  const totalPixelCount = width * height;
  // Mask: solid DIFF_MASK_RGB with full alpha across every pixel.
  const mask = new PNG({ width, height });
  for (let i = 0; i < mask.data.length; i += 4) {
    mask.data[i] = DIFF_MASK_RGB[0];
    mask.data[i + 1] = DIFF_MASK_RGB[1];
    mask.data[i + 2] = DIFF_MASK_RGB[2];
    mask.data[i + 3] = 255;
  }
  return {
    width,
    height,
    diffPixelCount: totalPixelCount,
    totalPixelCount,
    diffPercent: 100,
    diffMaskPng: encodePng(mask),
  };
}

function percentageOf(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  const raw = (numerator / denominator) * 100;
  return Math.round(raw * 100) / 100;
}

function describe(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return String(e);
}
