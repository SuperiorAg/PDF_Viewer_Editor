// Uncompressed BMP -> PNG decoder for the Phase-5.1 scan pipeline.
//
// WIA's IWiaItem2 default transfer format is BMP (Windows DIB). pdf-lib only
// embeds PNG / JPEG, so we decode WIA's BMP output to PNG before composing the
// scanned pages into a PDF. We reuse the same minimal PNG encoder the TIFF
// bridge uses (tiff-decoder.encodePngRgbaForTest) so no new image dep is added.
//
// Scope (matches what WIA actually emits for scans):
//   - BITMAPINFOHEADER (40-byte) DIBs, biCompression == BI_RGB (0).
//   - 24-bit BGR and 32-bit BGRA and 8-bit palette and 1-bit (B/W threshold).
//   - Bottom-up (positive biHeight) and top-down (negative biHeight) rows.
//   - 4-byte row alignment (DIB scanline padding).
// Out of scope: BI_RLE / BI_BITFIELDS / 16-bit (WIA does not emit these for
// the data types we request). Those return 'bmp_unsupported'.
//
// Pure function; no FS, no DB, no logging (conventions §13.2).

import type { Result } from '../../shared/result.js';
import { fail, ok } from '../../shared/result.js';
import { encodePngRgbaForTest } from './tiff-decoder.js';

export type BmpDecodeError = 'bmp_decode_failed' | 'bmp_unsupported';

export interface BmpDecodeResult {
  format: 'png';
  bytes: Uint8Array;
  width: number;
  height: number;
}

function u16(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}
function i32(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24);
}

export function decodeBmp(input: Uint8Array): Result<BmpDecodeResult, BmpDecodeError> {
  if (!(input instanceof Uint8Array) || input.byteLength < 54) {
    return fail<BmpDecodeError>('bmp_decode_failed', 'too small to be a BMP');
  }
  // BITMAPFILEHEADER: 'BM' + size(4) + reserved(4) + pixelOffset(4) = 14 bytes.
  if (input[0] !== 0x42 || input[1] !== 0x4d) {
    return fail<BmpDecodeError>('bmp_decode_failed', 'missing BM signature');
  }
  const pixelOffset = u32(input, 10);
  const dibSize = u32(input, 14);
  if (dibSize < 40) {
    return fail<BmpDecodeError>('bmp_unsupported', `unsupported DIB header size ${dibSize}`);
  }
  const width = i32(input, 18);
  const rawHeight = i32(input, 22);
  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  const bpp = u16(input, 28);
  const compression = u32(input, 30);
  if (compression !== 0) {
    return fail<BmpDecodeError>('bmp_unsupported', `unsupported compression ${compression}`);
  }
  if (width <= 0 || height <= 0 || width > 100000 || height > 100000) {
    return fail<BmpDecodeError>('bmp_decode_failed', `bad dimensions ${width}x${height}`);
  }

  // Palette (for <= 8bpp) sits right after the DIB header.
  const paletteOffset = 14 + dibSize;
  let paletteCount = u32(input, 46); // biClrUsed
  if (paletteCount === 0 && bpp <= 8) paletteCount = 1 << bpp;
  const palette: Array<[number, number, number]> = [];
  for (let i = 0; i < paletteCount; i += 1) {
    const o = paletteOffset + i * 4;
    if (o + 2 >= input.byteLength) break;
    // palette entries are BGRA
    palette.push([input[o + 2]!, input[o + 1]!, input[o]!]);
  }

  const rowSize = Math.floor((bpp * width + 31) / 32) * 4; // 4-byte aligned
  const rgba = new Uint8Array(width * height * 4);

  const putPixel = (x: number, yOut: number, r: number, g: number, b: number): void => {
    const di = (yOut * width + x) * 4;
    rgba[di] = r;
    rgba[di + 1] = g;
    rgba[di + 2] = b;
    rgba[di + 3] = 255;
  };

  try {
    for (let row = 0; row < height; row += 1) {
      const srcRow = pixelOffset + row * rowSize;
      // Bottom-up DIBs store the last image row first.
      const yOut = topDown ? row : height - 1 - row;
      if (bpp === 24 || bpp === 32) {
        const step = bpp === 32 ? 4 : 3;
        for (let x = 0; x < width; x += 1) {
          const o = srcRow + x * step;
          if (o + 2 >= input.byteLength) break;
          putPixel(x, yOut, input[o + 2]!, input[o + 1]!, input[o]!); // BGR -> RGB
        }
      } else if (bpp === 8) {
        for (let x = 0; x < width; x += 1) {
          const idx = input[srcRow + x] ?? 0;
          const c = palette[idx] ?? [0, 0, 0];
          putPixel(x, yOut, c[0], c[1], c[2]);
        }
      } else if (bpp === 1) {
        for (let x = 0; x < width; x += 1) {
          const byte = input[srcRow + (x >> 3)] ?? 0;
          const bit = (byte >> (7 - (x & 7))) & 1;
          const c = palette[bit] ?? (bit ? [255, 255, 255] : [0, 0, 0]);
          putPixel(x, yOut, c[0], c[1], c[2]);
        }
      } else {
        return fail<BmpDecodeError>('bmp_unsupported', `unsupported bpp ${bpp}`);
      }
    }
  } catch (e) {
    return fail<BmpDecodeError>('bmp_decode_failed', `decode threw: ${(e as Error).message}`);
  }

  const png = encodePngRgbaForTest(rgba, width, height);
  return ok({ format: 'png', bytes: png, width, height });
}
