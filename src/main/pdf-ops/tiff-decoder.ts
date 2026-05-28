// TIFF decoder for the Phase-2 image-embed pipeline.
//
// Contract: edit-replay-engine.md §8 + §11.
// Spec scope:
//   - Single-page TIFF: LZW, Deflate, Uncompressed (default).
//   - CCITT Group 4 (faxed scans): best-effort.
//   - JPEG-in-TIFF: best-effort.
//   - Multi-page TIFF: first-page only with a `warnings` flag — David's call
//     in Wave 7 per the design doc; chosen path is "use first page, warn"
//     rather than error out.
//   - BigTIFF / CMYK ICC: not supported in Phase 2.
//
// Dependency contract:
//   This module dynamically requires `utif` (MIT, pure-JS). If the package
//   isn't installed, the decoder returns 'tiff_decode_failed' with a clear
//   message and the IPC handler surfaces a toast directing the user to
//   convert their TIFF to PNG. Diego adds `utif` to package.json in Wave 8
//   (status row flags this dep).
//
// Output format: PNG bytes (re-encoded via a manual encoder because utif
// already decodes to RGBA pixel buffers — we wrap with a minimal PNG writer
// to keep the dep surface small). pdf-lib's embedPng accepts these directly.

import { deflateSync, crc32 } from 'node:zlib';

import type { Result } from '../../shared/result.js';
import { fail, ok } from '../../shared/result.js';

export type TiffDecodeError =
  | 'tiff_decoder_unavailable'
  | 'tiff_decode_failed'
  | 'tiff_unsupported_compression'
  | 'tiff_bigtiff_unsupported';

export interface TiffDecodeResult {
  format: 'png';
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Non-fatal observations (e.g. "multi-page TIFF: first page used"). */
  warnings: string[];
}

/**
 * Decode a TIFF byte buffer to PNG. Returns the first page only when the
 * source TIFF is multi-page (with a warning); errors only on hard decoder
 * failures.
 *
 * Pure function; no FS, no DB, no logging (per conventions §13.2). Async
 * because we dynamically import `utif` to decouple build-time from
 * runtime — see the dep-contract note in the file header.
 */
export async function decodeTiff(
  input: Uint8Array,
): Promise<Result<TiffDecodeResult, TiffDecodeError>> {
  if (!(input instanceof Uint8Array) || input.byteLength === 0) {
    return fail<TiffDecodeError>('tiff_decode_failed', 'empty or non-Uint8Array input');
  }

  // Sniff the magic header: II*\0 (little-endian) or MM\0* (big-endian).
  // BigTIFF: II+\0 / MM\0+ — version 43 instead of 42.
  if (input.byteLength < 4) {
    return fail<TiffDecodeError>('tiff_decode_failed', 'too short for TIFF header');
  }
  const b0 = input[0] ?? 0;
  const b1 = input[1] ?? 0;
  const b2 = input[2] ?? 0;
  const b3 = input[3] ?? 0;
  const isLE = b0 === 0x49 && b1 === 0x49;
  const isBE = b0 === 0x4d && b1 === 0x4d;
  if (!isLE && !isBE) {
    return fail<TiffDecodeError>('tiff_decode_failed', 'not a TIFF (header magic mismatch)');
  }
  const version = isLE ? b2 : b3;
  if (version === 0x2b) {
    return fail<TiffDecodeError>('tiff_bigtiff_unsupported', 'BigTIFF is not supported in Phase 2');
  }

  let utif: {
    decode: (buf: ArrayBufferLike) => Array<{ width: number; height: number; data?: Uint8Array }>;
    decodeImage: (
      buf: ArrayBufferLike,
      ifd: { width: number; height: number; data?: Uint8Array },
    ) => void;
    toRGBA8: (ifd: { width: number; height: number; data?: Uint8Array }) => Uint8Array;
  };
  try {
    // Dynamic import keeps the dep optional. The IPC layer surfaces a
    // friendly error if utif isn't installed (Diego adds in Wave 8).
    // The name is variable-bound so TypeScript doesn't try to resolve the
    // module at build time (it isn't in package.json until Diego's Wave 8).
    const utifModule = 'utif';
    utif = (await import(/* @vite-ignore */ utifModule)) as typeof utif;
  } catch {
    return fail<TiffDecodeError>(
      'tiff_decoder_unavailable',
      'utif package is not installed; convert TIFF to PNG/JPEG and retry',
    );
  }

  let ifds: Array<{ width: number; height: number; data?: Uint8Array }>;
  try {
    const arrayBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    ifds = utif.decode(arrayBuffer);
    if (!Array.isArray(ifds) || ifds.length === 0) {
      return fail<TiffDecodeError>('tiff_decode_failed', 'utif returned no IFDs');
    }
  } catch (e) {
    return fail<TiffDecodeError>(
      'tiff_decode_failed',
      `utif.decode threw: ${(e as Error).message}`,
    );
  }

  const warnings: string[] = [];
  if (ifds.length > 1) {
    warnings.push(`Multi-page TIFF detected (${ifds.length} pages); only the first page was used`);
  }

  const ifd = ifds[0];
  if (!ifd) {
    return fail<TiffDecodeError>('tiff_decode_failed', 'first IFD is undefined');
  }

  try {
    const arrayBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    utif.decodeImage(arrayBuffer, ifd);
  } catch (e) {
    const msg = (e as Error).message;
    if (/compression|ccitt|jpeg/i.test(msg)) {
      return fail<TiffDecodeError>('tiff_unsupported_compression', msg);
    }
    return fail<TiffDecodeError>('tiff_decode_failed', `utif.decodeImage threw: ${msg}`);
  }

  let rgba: Uint8Array;
  try {
    rgba = utif.toRGBA8(ifd);
  } catch (e) {
    return fail<TiffDecodeError>(
      'tiff_decode_failed',
      `utif.toRGBA8 threw: ${(e as Error).message}`,
    );
  }

  if (rgba.byteLength !== ifd.width * ifd.height * 4) {
    return fail<TiffDecodeError>(
      'tiff_decode_failed',
      `decoded RGBA byte length mismatch (got ${rgba.byteLength}, expected ${ifd.width * ifd.height * 4})`,
    );
  }

  const pngBytes = encodePngRgba(rgba, ifd.width, ifd.height);
  return ok({ format: 'png', bytes: pngBytes, width: ifd.width, height: ifd.height, warnings });
}

// ============================================================================
// Minimal PNG encoder (RGBA, 8-bit, no interlace, single IDAT chunk).
// ============================================================================
//
// We only need an encoder for the TIFF -> PNG bridge (pdf-lib's embedPng
// expects PNG bytes). The encoder is fully self-contained — no `sharp`, no
// canvas dep. ~100 LOC.
//
// Compression: zlib via node's built-in `zlib.deflateSync`. The PNG spec
// requires zlib-wrapped deflate (RFC1950 header + deflate stream).
// (The `node:zlib` import is hoisted to the top import group per import/order.)

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Exported for tests that need a known-good PNG fixture without depending
 * on external libraries (canvas, sharp). Encodes an RGBA buffer to PNG
 * bytes using the same encoder the TIFF -> PNG bridge uses.
 */
export function encodePngRgbaForTest(rgba: Uint8Array, width: number, height: number): Uint8Array {
  return encodePngRgba(rgba, width, height);
}

function encodePngRgba(rgba: Uint8Array, width: number, height: number): Uint8Array {
  // 1. Build the filtered raw scanlines: prefix each row with filter byte 0 (None).
  const rowBytes = width * 4;
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (rowBytes + 1)] = 0; // filter: None
    const srcOff = y * rowBytes;
    const dstOff = y * (rowBytes + 1) + 1;
    raw.set(rgba.subarray(srcOff, srcOff + rowBytes), dstOff);
  }

  // 2. zlib-compress
  const idatData = deflateSync(raw);

  // 3. Assemble chunks
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', idatData);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(
    PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let off = 0;
  out.set(PNG_SIGNATURE, off);
  off += PNG_SIGNATURE.length;
  out.set(ihdrChunk, off);
  off += ihdrChunk.length;
  out.set(idatChunk, off);
  off += idatChunk.length;
  out.set(iendChunk, off);
  return out;
}

function writeUint32BE(buf: Uint8Array, off: number, value: number): void {
  buf[off] = (value >>> 24) & 0xff;
  buf[off + 1] = (value >>> 16) & 0xff;
  buf[off + 2] = (value >>> 8) & 0xff;
  buf[off + 3] = value & 0xff;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  // Chunk layout: length(4) + type(4) + data + crc(4)
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) typeBytes[i] = type.charCodeAt(i);

  const chunk = new Uint8Array(12 + data.length);
  writeUint32BE(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);

  // CRC over [type || data]
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  const crc = crc32(crcInput);
  writeUint32BE(chunk, 8 + data.length, crc);
  return chunk;
}
