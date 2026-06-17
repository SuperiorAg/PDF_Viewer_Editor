// Unit tests for the Phase 7.5 Wave 3 B4 Background engine.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { applyBackground } from './background-engine.js';

async function makePdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([200, 300]);
  return doc.save();
}

const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f,
  0x00, 0x05, 0xfe, 0x02, 0xfe, 0x0d, 0xef, 0x46, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe('applyBackground', () => {
  it('rejects non-#RRGGBB color', async () => {
    const bytes = await makePdf(1);
    const res = await applyBackground({
      pdfBytes: bytes,
      target: { kind: 'all' },
      source: { kind: 'color', color: 'green' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('applies solid color background to all pages', async () => {
    const bytes = await makePdf(2);
    const res = await applyBackground({
      pdfBytes: bytes,
      target: { kind: 'all' },
      source: { kind: 'color', color: '#FFFFE0' },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.pagesAffected).toBe(2);
      // Honest disclosure: background draws ON TOP of existing content (see
      // engine file header). The warning must always be present.
      expect(res.value.warnings).toContain('background_rendered_over_content');
      // Round-trip verify.
      const reload = await PDFDocument.load(res.value.bytes);
      expect(reload.getPageCount()).toBe(2);
    }
  });

  it('applies image background with opacity', async () => {
    const bytes = await makePdf(3);
    const res = await applyBackground({
      pdfBytes: bytes,
      target: { kind: 'range', start: 0, end: 1 },
      source: { kind: 'image', imageBytes: TINY_PNG, opacity: 0.2 },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.pagesAffected).toBe(2);
    }
  });

  it('rejects out-of-range target with page_out_of_range', async () => {
    const bytes = await makePdf(2);
    const res = await applyBackground({
      pdfBytes: bytes,
      target: { kind: 'list', indices: [5] },
      source: { kind: 'color', color: '#000000' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('page_out_of_range');
  });

  it('rejects garbage image bytes with image_invalid', async () => {
    const bytes = await makePdf(1);
    const res = await applyBackground({
      pdfBytes: bytes,
      target: { kind: 'all' },
      source: { kind: 'image', imageBytes: new Uint8Array([0, 0, 0, 0]), opacity: 1 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('image_invalid');
  });
});
