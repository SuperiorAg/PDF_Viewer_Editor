// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { decodeBmp } from './bmp-decoder.js';

// Build a minimal uncompressed 24-bit BMP (BITMAPFILEHEADER + BITMAPINFOHEADER).
// Bottom-up, 4-byte aligned rows. Pixels are BGR.
function make24bitBmp(width: number, height: number, fill: [number, number, number]): Uint8Array {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelDataSize = rowSize * height;
  const fileHeaderSize = 14;
  const dibHeaderSize = 40;
  const pixelOffset = fileHeaderSize + dibHeaderSize;
  const total = pixelOffset + pixelDataSize;
  const b = new Uint8Array(total);
  // BITMAPFILEHEADER
  b[0] = 0x42;
  b[1] = 0x4d; // 'BM'
  const w32 = (o: number, v: number): void => {
    b[o] = v & 0xff;
    b[o + 1] = (v >>> 8) & 0xff;
    b[o + 2] = (v >>> 16) & 0xff;
    b[o + 3] = (v >>> 24) & 0xff;
  };
  const w16 = (o: number, v: number): void => {
    b[o] = v & 0xff;
    b[o + 1] = (v >>> 8) & 0xff;
  };
  w32(2, total);
  w32(10, pixelOffset);
  // BITMAPINFOHEADER
  w32(14, dibHeaderSize);
  w32(18, width);
  w32(22, height); // positive => bottom-up
  w16(26, 1); // planes
  w16(28, 24); // bpp
  w32(30, 0); // BI_RGB
  w32(34, pixelDataSize);
  // pixels (BGR)
  const [r, g, bl] = fill;
  for (let row = 0; row < height; row += 1) {
    const off = pixelOffset + row * rowSize;
    for (let x = 0; x < width; x += 1) {
      b[off + x * 3] = bl;
      b[off + x * 3 + 1] = g;
      b[off + x * 3 + 2] = r;
    }
  }
  return b;
}

describe('decodeBmp', () => {
  it('decodes a 24-bit uncompressed BMP to PNG bytes', () => {
    const bmp = make24bitBmp(4, 3, [255, 128, 64]);
    const r = decodeBmp(bmp);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.format).toBe('png');
      expect(r.value.width).toBe(4);
      expect(r.value.height).toBe(3);
      // PNG signature.
      expect([...r.value.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });

  it('rejects a non-BMP buffer', () => {
    const r = decodeBmp(new Uint8Array([0, 1, 2, 3, 4, 5]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bmp_decode_failed');
  });

  it('rejects a compressed (non-BI_RGB) BMP as unsupported', () => {
    const bmp = make24bitBmp(2, 2, [0, 0, 0]);
    bmp[30] = 1; // biCompression = BI_RLE8
    const r = decodeBmp(bmp);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bmp_unsupported');
  });
});
