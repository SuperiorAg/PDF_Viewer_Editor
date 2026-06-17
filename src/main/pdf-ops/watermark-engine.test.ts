// Unit tests for the Phase 7.5 Wave 3 B4 Watermark engine.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { applyWatermark } from './watermark-engine.js';

async function makePdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([200, 300]);
  return doc.save();
}

// A 1x1 white PNG (constructed by hand; pdf-lib's embedPng accepts it).
// IHDR(1,1,8,2) + IDAT(deflated solid white pixel) + IEND.
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f,
  0x00, 0x05, 0xfe, 0x02, 0xfe, 0x0d, 0xef, 0x46, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe('applyWatermark', () => {
  it('rejects opacity outside [0,1]', async () => {
    const bytes = await makePdf(1);
    const res = await applyWatermark({
      pdfBytes: bytes,
      target: { kind: 'all' },
      source: {
        kind: 'text',
        text: 'DRAFT',
        fontSize: 24,
        fontColor: '#C2272D',
        rotationDegrees: 0,
      },
      opacity: 1.5,
      position: 'center',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects non-#RRGGBB color', async () => {
    const bytes = await makePdf(1);
    const res = await applyWatermark({
      pdfBytes: bytes,
      target: { kind: 'all' },
      source: { kind: 'text', text: 'X', fontSize: 12, fontColor: 'red', rotationDegrees: 0 },
      opacity: 0.5,
      position: 'center',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects page-range out of bounds with page_out_of_range', async () => {
    const bytes = await makePdf(3);
    const res = await applyWatermark({
      pdfBytes: bytes,
      target: { kind: 'range', start: 0, end: 9 },
      source: { kind: 'text', text: 'X', fontSize: 12, fontColor: '#000000', rotationDegrees: 0 },
      opacity: 1,
      position: 'center',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('page_out_of_range');
  });

  it('applies text watermark to the requested range only', async () => {
    const bytes = await makePdf(5);
    const res = await applyWatermark({
      pdfBytes: bytes,
      target: { kind: 'range', start: 1, end: 3 },
      source: {
        kind: 'text',
        text: 'CONFIDENTIAL',
        fontSize: 18,
        fontColor: '#C2272D',
        rotationDegrees: 45,
      },
      opacity: 0.5,
      position: 'center',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.pagesAffected).toBe(3);
      // The output is a valid PDF.
      const reload = await PDFDocument.load(res.value.bytes);
      expect(reload.getPageCount()).toBe(5);
    }
  });

  it('applies image watermark (PNG) and emits no warnings', async () => {
    const bytes = await makePdf(2);
    const res = await applyWatermark({
      pdfBytes: bytes,
      target: { kind: 'all' },
      source: { kind: 'image', imageBytes: TINY_PNG },
      opacity: 0.3,
      position: 'top-right',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.pagesAffected).toBe(2);
      expect(res.value.warnings).toEqual([]);
    }
  });

  it('rejects non-PNG / non-JPEG image bytes with image_invalid', async () => {
    const bytes = await makePdf(1);
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const res = await applyWatermark({
      pdfBytes: bytes,
      target: { kind: 'all' },
      source: { kind: 'image', imageBytes: garbage },
      opacity: 1,
      position: 'center',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('image_invalid');
  });

  it('does not affect pages outside the target range', async () => {
    // We can't easily compare visual output, but pagesAffected proves the
    // engine only iterated the requested subset.
    const bytes = await makePdf(10);
    const res = await applyWatermark({
      pdfBytes: bytes,
      target: { kind: 'list', indices: [0, 9] },
      source: { kind: 'text', text: 'X', fontSize: 12, fontColor: '#000000', rotationDegrees: 0 },
      opacity: 1,
      position: 'center',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.pagesAffected).toBe(2);
    }
  });
});
