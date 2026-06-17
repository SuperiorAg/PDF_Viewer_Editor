// Unit tests for the B10 Extract Pages engine.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { extractPages } from './extract-pages.js';

async function makePdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) doc.addPage([100 + i, 200 + i]);
  return doc.save();
}

describe('extractPages', () => {
  it('extracts a contiguous range', async () => {
    const bytes = await makePdf(5);
    const res = await extractPages({
      pdfBytes: bytes,
      pages: { kind: 'range', start: 1, end: 3 },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const reload = await PDFDocument.load(res.value.bytes);
      expect(reload.getPageCount()).toBe(3);
      expect(res.value.pagesExtracted).toBe(3);
    }
  });

  it('extracts an arbitrary index list, preserving order + dedup', async () => {
    const bytes = await makePdf(4);
    const res = await extractPages({
      pdfBytes: bytes,
      pages: { kind: 'list', indices: [3, 0, 3, 2] },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const reload = await PDFDocument.load(res.value.bytes);
      expect(reload.getPageCount()).toBe(3);
      // page-0 of output is original page 3; expect width 100+3.
      expect(reload.getPage(0).getWidth()).toBe(103);
      expect(reload.getPage(1).getWidth()).toBe(100);
      expect(reload.getPage(2).getWidth()).toBe(102);
    }
  });

  it('rejects out-of-range index', async () => {
    const bytes = await makePdf(3);
    const res = await extractPages({
      pdfBytes: bytes,
      pages: { kind: 'list', indices: [5] },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('page_out_of_range');
  });

  it('rejects inverted range', async () => {
    const bytes = await makePdf(3);
    const res = await extractPages({
      pdfBytes: bytes,
      pages: { kind: 'range', start: 2, end: 0 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_page_range');
  });

  it('returns pdf_load_failed on corrupt input', async () => {
    const res = await extractPages({
      pdfBytes: new Uint8Array([0, 0, 0]),
      pages: { kind: 'range', start: 0, end: 0 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('pdf_load_failed');
  });

  it('output is fully independent of source bytes', async () => {
    const bytes = await makePdf(2);
    const beforeLength = bytes.byteLength;
    const res = await extractPages({
      pdfBytes: bytes,
      pages: { kind: 'range', start: 0, end: 0 },
    });
    expect(res.ok).toBe(true);
    // Source untouched (L-005 / engine purity).
    expect(bytes.byteLength).toBe(beforeLength);
    if (res.ok) {
      expect(res.value.bytes).not.toBe(bytes);
    }
  });
});
