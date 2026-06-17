// Unit tests for the B5 Crop Pages engine.

import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { cropPages } from './crop-engine.js';

async function makePdf(
  pageSpecs: Array<{ width: number; height: number; rotate?: 0 | 90 | 180 | 270 }>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const { width, height, rotate } of pageSpecs) {
    const page = doc.addPage([width, height]);
    if (rotate) page.setRotation(degrees(rotate));
  }
  return doc.save();
}

describe('cropPages', () => {
  it('rejects negative insets with invalid_inset', async () => {
    const bytes = await makePdf([{ width: 100, height: 100 }]);
    const res = await cropPages({
      pdfBytes: bytes,
      cropBox: { top: -1, right: 0, bottom: 0, left: 0 },
      pages: { kind: 'all' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_inset');
  });

  it('rejects out-of-range page index', async () => {
    const bytes = await makePdf([{ width: 100, height: 100 }]);
    const res = await cropPages({
      pdfBytes: bytes,
      cropBox: { top: 5, right: 5, bottom: 5, left: 5 },
      pages: { kind: 'list', indices: [3] },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('page_out_of_range');
  });

  it('rejects inverted range', async () => {
    const bytes = await makePdf([
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ]);
    const res = await cropPages({
      pdfBytes: bytes,
      cropBox: { top: 5, right: 5, bottom: 5, left: 5 },
      pages: { kind: 'range', start: 1, end: 0 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_scope');
  });

  it('applies CropBox insets to all pages with kind:all', async () => {
    const bytes = await makePdf([
      { width: 200, height: 300 },
      { width: 200, height: 300 },
    ]);
    const res = await cropPages({
      pdfBytes: bytes,
      cropBox: { top: 10, right: 20, bottom: 30, left: 40 },
      pages: { kind: 'all' },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.pagesAffected).toBe(2);

      // Round-trip through pdf-lib and confirm the CropBox values.
      const reload = await PDFDocument.load(res.value.bytes);
      for (let i = 0; i < 2; i += 1) {
        const cb = reload.getPage(i).getCropBox();
        // x = left, y = bottom, width = 200-left-right, height = 300-top-bottom
        expect(cb.x).toBeCloseTo(40);
        expect(cb.y).toBeCloseTo(30);
        expect(cb.width).toBeCloseTo(140);
        expect(cb.height).toBeCloseTo(260);
      }
    }
  });

  it('respects /Rotate 90 by remapping insets', async () => {
    const bytes = await makePdf([{ width: 200, height: 300, rotate: 90 }]);
    const res = await cropPages({
      pdfBytes: bytes,
      // User asks to crop 10pt off the visual top.
      cropBox: { top: 10, right: 0, bottom: 0, left: 0 },
      pages: { kind: 'all' },
      respectRotation: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const reload = await PDFDocument.load(res.value.bytes);
      const cb = reload.getPage(0).getCropBox();
      // /Rotate 90 maps user-top -> right edge in raw PDF coords.
      // Original media: x=0,y=0,w=200,h=300. We crop 10pt off the RIGHT.
      expect(cb.x).toBeCloseTo(0);
      expect(cb.y).toBeCloseTo(0);
      expect(cb.width).toBeCloseTo(190);
      expect(cb.height).toBeCloseTo(300);
    }
  });

  it('ignores rotation when respectRotation=false', async () => {
    const bytes = await makePdf([{ width: 200, height: 300, rotate: 90 }]);
    const res = await cropPages({
      pdfBytes: bytes,
      cropBox: { top: 10, right: 0, bottom: 0, left: 0 },
      pages: { kind: 'all' },
      respectRotation: false,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const reload = await PDFDocument.load(res.value.bytes);
      const cb = reload.getPage(0).getCropBox();
      // top inset applied to raw PDF top -> y is unchanged at 0 (bottom),
      // height shrinks by 10.
      expect(cb.x).toBeCloseTo(0);
      expect(cb.y).toBeCloseTo(0);
      expect(cb.height).toBeCloseTo(290);
      expect(cb.width).toBeCloseTo(200);
    }
  });

  it('warns and skips when insets exceed page size, but still serializes', async () => {
    const bytes = await makePdf([
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ]);
    const res = await cropPages({
      pdfBytes: bytes,
      cropBox: { top: 60, right: 60, bottom: 60, left: 60 }, // would invert
      pages: { kind: 'all' },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.pagesAffected).toBe(0);
      expect(res.value.warnings.length).toBe(2);
      expect(res.value.warnings[0]).toMatch(/exceed page size/);
    }
  });

  it('returns pdf_load_failed on corrupt input', async () => {
    const corrupt = new Uint8Array([1, 2, 3, 4, 5]);
    const res = await cropPages({
      pdfBytes: corrupt,
      cropBox: { top: 5, right: 5, bottom: 5, left: 5 },
      pages: { kind: 'all' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('pdf_load_failed');
  });

  it('crops only the listed page indices', async () => {
    const bytes = await makePdf([
      { width: 200, height: 200 },
      { width: 200, height: 200 },
      { width: 200, height: 200 },
    ]);
    const res = await cropPages({
      pdfBytes: bytes,
      cropBox: { top: 10, right: 10, bottom: 10, left: 10 },
      pages: { kind: 'list', indices: [0, 2] },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.pagesAffected).toBe(2);
      const reload = await PDFDocument.load(res.value.bytes);
      // page 0 + 2 changed; page 1 unchanged.
      expect(reload.getPage(0).getCropBox().width).toBeCloseTo(180);
      expect(reload.getPage(1).getCropBox().width).toBeCloseTo(200);
      expect(reload.getPage(2).getCropBox().width).toBeCloseTo(180);
    }
  });
});
