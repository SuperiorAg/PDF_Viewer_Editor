// Phase 7.4 B1 — production canvas adapter for the redact engine.
//
// Wraps `@napi-rs/canvas` (the same module the OCR rasterize pipeline uses)
// to paint OPAQUE BLACK rectangles on a PNG. Returns a fresh PNG buffer.
//
// Why this module exists separately from `ocr-bootstrap.ts`:
//   - The OCR rasterizer outputs PNG bytes; the redact engine asks "paint
//     black rectangles AT these pixel coords on this PNG". That's a distinct
//     responsibility — image decode + composite + re-encode — and the
//     pipeline lives entirely on the @napi-rs/canvas side (no pdf.js).
//   - Keeping it OUT of `ocr-bootstrap.ts` keeps the OCR bootstrap focused
//     on pdf.js rasterize.
//
// Failure modes: if `@napi-rs/canvas` is not installed, throws a descriptive
// error (same posture as `tryLoadCanvas()` in ocr-bootstrap.ts). The handler's
// catch surface maps this to `engine_failed`.

import { tryLoadCanvas } from './ocr-bootstrap.js';

interface CanvasImageNs {
  loadImage: (input: Uint8Array | Buffer) => Promise<unknown>;
}

/**
 * Paint opaque-black rectangles at the given pixel coords on `pngBytes`.
 * Returns a fresh PNG. NEVER mutates the input buffer.
 *
 * Coordinates are in PNG pixel space (origin top-left, y grows down) — the
 * engine has already done the PDF→PNG y-flip + scale conversion.
 */
export async function drawBlackRectsOnPngProd(
  pngBytes: Uint8Array,
  rectsPx: ReadonlyArray<{ xPx: number; yPx: number; widthPx: number; heightPx: number }>,
): Promise<Uint8Array> {
  const loaded = tryLoadCanvas();
  if (!loaded.ok) {
    throw new Error(
      `@napi-rs/canvas / canvas required for redaction painting. Details: ${loaded.errorMessage}`,
    );
  }

  // `loadImage` is exported alongside `createCanvas`. We import dynamically
  // to avoid a hard compile-time dep on the package — the load gate above
  // already verified the module is present.
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const canvasNs = require(loaded.source) as CanvasImageNs;
  const img = (await canvasNs.loadImage(pngBytes)) as { width: number; height: number };

  const width = img.width;
  const height = img.height;
  const canvas = loaded.createCanvas(width, height);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- canvas ctx is napi-rs-typed
  const ctx = canvas.getContext('2d') as any;
  // 1. Paint the source PNG onto the canvas.
  ctx.drawImage(img, 0, 0);
  // 2. Paint opaque black on every rect.
  ctx.fillStyle = '#000000';
  ctx.globalAlpha = 1.0;
  for (const r of rectsPx) {
    if (r.widthPx <= 0 || r.heightPx <= 0) continue;
    ctx.fillRect(r.xPx, r.yPx, r.widthPx, r.heightPx);
  }
  // 3. Re-encode to PNG bytes.
  const buf = canvas.toBuffer('image/png');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
