// Unit tests for the B10 Split Document engine.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { splitDocument } from './split-document.js';

async function makePdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) doc.addPage([100 + i, 200]);
  return doc.save();
}

describe('splitDocument', () => {
  it('splits by-page-count, last part absorbs remainder', async () => {
    const bytes = await makePdf(7);
    const res = await splitDocument({
      pdfBytes: bytes,
      strategy: { kind: 'by-page-count', pagesPerFile: 3 },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.parts.length).toBe(3);
      expect(res.value.parts[0]!.pageRange).toEqual({ start: 0, end: 2 });
      expect(res.value.parts[1]!.pageRange).toEqual({ start: 3, end: 5 });
      expect(res.value.parts[2]!.pageRange).toEqual({ start: 6, end: 6 });
      const reloaded = await PDFDocument.load(res.value.parts[1]!.newBytes);
      expect(reloaded.getPageCount()).toBe(3);
    }
  });

  it('splits by-file-count, evenly distributing remainder across leading parts', async () => {
    const bytes = await makePdf(10);
    const res = await splitDocument({
      pdfBytes: bytes,
      strategy: { kind: 'by-file-count', targetFileCount: 3 },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // 10/3 -> sizes [4, 3, 3].
      expect(res.value.parts.map((p) => p.pageRange.end - p.pageRange.start + 1)).toEqual([
        4, 3, 3,
      ]);
    }
  });

  it('caps file-count at pageCount when targetFileCount > pageCount', async () => {
    const bytes = await makePdf(2);
    const res = await splitDocument({
      pdfBytes: bytes,
      strategy: { kind: 'by-file-count', targetFileCount: 10 },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.parts.length).toBe(2);
    }
  });

  it('rejects non-positive pagesPerFile', async () => {
    const bytes = await makePdf(3);
    const res = await splitDocument({
      pdfBytes: bytes,
      strategy: { kind: 'by-page-count', pagesPerFile: 0 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_strategy');
  });

  it('rejects non-positive targetFileCount', async () => {
    const bytes = await makePdf(3);
    const res = await splitDocument({
      pdfBytes: bytes,
      strategy: { kind: 'by-file-count', targetFileCount: -1 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_strategy');
  });

  it('returns no_bookmarks_for_split when source has no outline', async () => {
    const bytes = await makePdf(4);
    const res = await splitDocument({
      pdfBytes: bytes,
      strategy: { kind: 'by-bookmarks', topLevelOnly: true },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('no_bookmarks_for_split');
  });

  it('returns pdf_load_failed on corrupt bytes', async () => {
    const res = await splitDocument({
      pdfBytes: new Uint8Array([0, 0, 0]),
      strategy: { kind: 'by-page-count', pagesPerFile: 1 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('pdf_load_failed');
  });

  it('single-page input becomes a single-part output', async () => {
    // pdf-lib's PDFDocument.save() requires at least one page, so the
    // engine's `pageCount === 0` early-return cannot be reached via real
    // pdf-lib bytes — but its single-page behavior IS meaningful and tested.
    const bytes = await makePdf(1);
    const res = await splitDocument({
      pdfBytes: bytes,
      strategy: { kind: 'by-page-count', pagesPerFile: 3 },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.parts.length).toBe(1);
      expect(res.value.parts[0]!.pageRange).toEqual({ start: 0, end: 0 });
    }
  });

  it('each split part round-trips through pdf-lib load', async () => {
    const bytes = await makePdf(5);
    const res = await splitDocument({
      pdfBytes: bytes,
      strategy: { kind: 'by-page-count', pagesPerFile: 2 },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      for (const part of res.value.parts) {
        const reloaded = await PDFDocument.load(part.newBytes);
        const expected = part.pageRange.end - part.pageRange.start + 1;
        expect(reloaded.getPageCount()).toBe(expected);
      }
    }
  });
});
