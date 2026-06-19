// Tests for pdf:listEmbeddedFonts handler.

import { describe, expect, it, vi } from 'vitest';

import { ok } from '../../shared/result.js';

import {
  handlePdfListEmbeddedFonts,
  type PdfListEmbeddedFontsDeps,
} from './pdf-list-embedded-fonts.js';

describe('handlePdfListEmbeddedFonts', () => {
  it('rejects an invalid payload', async () => {
    const r = await handlePdfListEmbeddedFonts(
      { handle: 'oops' },
      { getBytes: () => new Uint8Array() },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_payload');
  });

  it('reports handle_not_found when the handle is unknown', async () => {
    const r = await handlePdfListEmbeddedFonts({ handle: 1 }, { getBytes: () => null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('handle_not_found');
  });

  it('returns the engine result on the happy path', async () => {
    const engine = vi
      .fn()
      .mockResolvedValue(
        ok([{ name: 'Helvetica', isEmbedded: false, isSubset: false, pageRefs: [0] }]),
      );
    const deps: PdfListEmbeddedFontsDeps = {
      getBytes: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      engine,
    };
    const r = await handlePdfListEmbeddedFonts({ handle: 1 }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fonts.length).toBe(1);
    expect(r.value.fonts[0]!.name).toBe('Helvetica');
  });
});
