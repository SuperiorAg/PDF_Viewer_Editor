// Tests for tiff-decoder.ts — Phase 2 (Wave 7, David).
//
// The decoder dynamically imports `utif` which isn't installed in the
// dev environment until Diego's Wave 8. These tests assert the graceful
// degradation path (tiff_decoder_unavailable) AND the header-magic
// pre-check (which runs before the dynamic import and so works without
// utif being installed).

import { describe, expect, it } from 'vitest';

import { decodeTiff } from './tiff-decoder.js';

describe('tiff-decoder', () => {
  it('rejects empty input', async () => {
    const r = await decodeTiff(new Uint8Array());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('tiff_decode_failed');
  });

  it('rejects non-TIFF magic header', async () => {
    const r = await decodeTiff(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('tiff_decode_failed');
  });

  it('rejects BigTIFF (version 43)', async () => {
    // Little-endian BigTIFF: II + 0x2b (43) + 0x00
    const r = await decodeTiff(new Uint8Array([0x49, 0x49, 0x2b, 0x00, 0, 0, 0, 0]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('tiff_bigtiff_unsupported');
  });

  it('returns tiff_decoder_unavailable when utif is not installed (or any decode failure)', async () => {
    // Valid TIFF header magic (little-endian, classic), zero-length IFD —
    // utif (if installed) will fail to decode; if NOT installed, the
    // graceful-degradation branch fires and returns tiff_decoder_unavailable.
    const minimalTiffHeader = new Uint8Array([
      0x49,
      0x49,
      0x2a,
      0x00, // II*\0 (LE classic TIFF)
      0x08,
      0x00,
      0x00,
      0x00, // offset to first IFD
      0x00,
      0x00, // entry count = 0
    ]);
    const r = await decodeTiff(minimalTiffHeader);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(['tiff_decoder_unavailable', 'tiff_decode_failed']).toContain(r.error);
    }
  });
});
