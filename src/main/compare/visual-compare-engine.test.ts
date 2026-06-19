// Tests for the visual-compare engine (Phase 7.5 Wave 7).
//
// Synthetic PNGs are constructed via pngjs's `PNG` class + sync writer
// — same library the engine uses internally, but it's a single-file
// engine API call so this tests the integration without external
// fixtures.

import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import {
  compareVisuals,
  DEFAULT_PIXELMATCH_THRESHOLD,
  DIFF_MASK_RGB,
  MAX_RENDER_WIDTH_PX,
} from './visual-compare-engine.js';

/** Build a synthetic PNG with all pixels set to the given RGBA. */
function makeSolidPng(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Uint8Array {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  const buf = PNG.sync.write(png);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Build a synthetic PNG with a single pixel at (x,y) set to `pixel`,
 *  rest set to `base`. */
function makeOnePixelDiffPng(
  width: number,
  height: number,
  base: [number, number, number, number],
  pixel: [number, number, number, number],
  x: number,
  y: number,
): Uint8Array {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = base[0];
    png.data[i + 1] = base[1];
    png.data[i + 2] = base[2];
    png.data[i + 3] = base[3];
  }
  const idx = (y * width + x) * 4;
  png.data[idx] = pixel[0];
  png.data[idx + 1] = pixel[1];
  png.data[idx + 2] = pixel[2];
  png.data[idx + 3] = pixel[3];
  const buf = PNG.sync.write(png);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe('compareVisuals', () => {
  it('returns zero diff when both images are identical', () => {
    const a = makeSolidPng(8, 8, [255, 255, 255, 255]);
    const b = makeSolidPng(8, 8, [255, 255, 255, 255]);
    const res = compareVisuals({ leftPng: a, rightPng: b });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.width).toBe(8);
    expect(res.value.height).toBe(8);
    expect(res.value.diffPixelCount).toBe(0);
    expect(res.value.totalPixelCount).toBe(64);
    expect(res.value.diffPercent).toBe(0);
  });

  it('returns high diff when one image is solid white and the other solid black', () => {
    const a = makeSolidPng(4, 4, [255, 255, 255, 255]);
    const b = makeSolidPng(4, 4, [0, 0, 0, 255]);
    const res = compareVisuals({ leftPng: a, rightPng: b });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Every pixel differs.
    expect(res.value.diffPixelCount).toBe(16);
    expect(res.value.totalPixelCount).toBe(16);
    expect(res.value.diffPercent).toBe(100);
    expect(res.value.diffMaskPng).toBeInstanceOf(Uint8Array);
    expect(res.value.diffMaskPng.length).toBeGreaterThan(0);
  });

  it('returns one diff pixel when exactly one pixel differs', () => {
    const a = makeSolidPng(4, 4, [255, 255, 255, 255]);
    const b = makeOnePixelDiffPng(4, 4, [255, 255, 255, 255], [0, 0, 0, 255], 2, 2);
    const res = compareVisuals({ leftPng: a, rightPng: b });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.diffPixelCount).toBe(1);
    expect(res.value.totalPixelCount).toBe(16);
    expect(res.value.diffPercent).toBe(6.25);
  });

  it('rejects mismatched dimensions', () => {
    const a = makeSolidPng(4, 4, [255, 255, 255, 255]);
    const b = makeSolidPng(8, 8, [255, 255, 255, 255]);
    const res = compareVisuals({ leftPng: a, rightPng: b });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('invalid_payload');
  });

  it('orphan: left=null returns full-coverage mask at right size', () => {
    const right = makeSolidPng(4, 6, [128, 128, 128, 255]);
    const res = compareVisuals({ leftPng: null, rightPng: right });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.width).toBe(4);
    expect(res.value.height).toBe(6);
    expect(res.value.diffPixelCount).toBe(24);
    expect(res.value.totalPixelCount).toBe(24);
    expect(res.value.diffPercent).toBe(100);
    // Decode the returned mask and confirm every pixel is DIFF_MASK_RGB
    // with full alpha.
    const buf = Buffer.from(res.value.diffMaskPng);
    const mask = PNG.sync.read(buf);
    expect(mask.width).toBe(4);
    expect(mask.height).toBe(6);
    for (let i = 0; i < mask.data.length; i += 4) {
      expect(mask.data[i]).toBe(DIFF_MASK_RGB[0]);
      expect(mask.data[i + 1]).toBe(DIFF_MASK_RGB[1]);
      expect(mask.data[i + 2]).toBe(DIFF_MASK_RGB[2]);
      expect(mask.data[i + 3]).toBe(255);
    }
  });

  it('orphan: right=null returns full-coverage mask at left size', () => {
    const left = makeSolidPng(8, 4, [200, 200, 200, 255]);
    const res = compareVisuals({ leftPng: left, rightPng: null });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.width).toBe(8);
    expect(res.value.height).toBe(4);
    expect(res.value.diffPercent).toBe(100);
  });

  it('rejects both-null input', () => {
    const res = compareVisuals({ leftPng: null, rightPng: null });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('invalid_payload');
  });

  it('rejects out-of-range threshold', () => {
    const a = makeSolidPng(4, 4, [255, 255, 255, 255]);
    const b = makeSolidPng(4, 4, [255, 255, 255, 255]);
    const r1 = compareVisuals({ leftPng: a, rightPng: b, threshold: -0.1 });
    expect(r1.ok).toBe(false);
    if (r1.ok) return;
    expect(r1.error).toBe('invalid_payload');
    const r2 = compareVisuals({ leftPng: a, rightPng: b, threshold: 1.5 });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error).toBe('invalid_payload');
  });

  it('returns png_decode_failed on garbage bytes', () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    const b = makeSolidPng(4, 4, [255, 255, 255, 255]);
    const res = compareVisuals({ leftPng: garbage, rightPng: b });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('png_decode_failed');
  });

  it('exports a sane default threshold + max render width', () => {
    expect(DEFAULT_PIXELMATCH_THRESHOLD).toBe(0.1);
    expect(MAX_RENDER_WIDTH_PX).toBeGreaterThanOrEqual(800);
    expect(DIFF_MASK_RGB).toHaveLength(3);
  });

  it('rejects non-Uint8Array left input', () => {
    const b = makeSolidPng(4, 4, [255, 255, 255, 255]);
    const res = compareVisuals({
      leftPng: 'not a buffer' as unknown as Uint8Array,
      rightPng: b,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('invalid_payload');
  });
});
