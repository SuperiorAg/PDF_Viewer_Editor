// Unit tests for the B10 Replace Pages engine.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { replacePages } from './replace-pages.js';

async function makePdfWithSizes(sizes: Array<[number, number]>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h] of sizes) doc.addPage([w, h]);
  return doc.save();
}

describe('replacePages', () => {
  it('replaces a contiguous target range with a contiguous source range', async () => {
    // Target: 5 pages widths 100..104.
    const target = await makePdfWithSizes(
      [0, 1, 2, 3, 4].map((i) => [100 + i, 200] as [number, number]),
    );
    // Source: 3 pages widths 500..502.
    const source = await makePdfWithSizes([0, 1, 2].map((i) => [500 + i, 200] as [number, number]));
    const res = await replacePages({
      targetBytes: target,
      sourceBytes: source,
      targetRange: { start: 1, end: 2 }, // replace target pages 1 and 2
      sourceRange: { start: 0, end: 2 }, // with source pages 0, 1, 2
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const reload = await PDFDocument.load(res.value.bytes);
      // Expected order: target0, source0, source1, source2, target3, target4
      expect(reload.getPageCount()).toBe(6);
      expect(reload.getPage(0).getWidth()).toBe(100);
      expect(reload.getPage(1).getWidth()).toBe(500);
      expect(reload.getPage(2).getWidth()).toBe(501);
      expect(reload.getPage(3).getWidth()).toBe(502);
      expect(reload.getPage(4).getWidth()).toBe(103);
      expect(reload.getPage(5).getWidth()).toBe(104);
      expect(res.value.pagesReplaced).toBe(2);
    }
  });

  it('rejects invalid target range', async () => {
    const target = await makePdfWithSizes([[100, 100]]);
    const source = await makePdfWithSizes([[200, 200]]);
    const res = await replacePages({
      targetBytes: target,
      sourceBytes: source,
      targetRange: { start: 5, end: 5 },
      sourceRange: { start: 0, end: 0 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('target_page_out_of_range');
  });

  it('rejects invalid source range', async () => {
    const target = await makePdfWithSizes([[100, 100]]);
    const source = await makePdfWithSizes([[200, 200]]);
    const res = await replacePages({
      targetBytes: target,
      sourceBytes: source,
      targetRange: { start: 0, end: 0 },
      sourceRange: { start: 5, end: 5 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('source_page_out_of_range');
  });

  it('rejects inverted target range', async () => {
    const target = await makePdfWithSizes([
      [100, 100],
      [110, 110],
    ]);
    const source = await makePdfWithSizes([[200, 200]]);
    const res = await replacePages({
      targetBytes: target,
      sourceBytes: source,
      targetRange: { start: 1, end: 0 },
      sourceRange: { start: 0, end: 0 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_target_range');
  });

  it('returns target_load_failed on corrupt target', async () => {
    const source = await makePdfWithSizes([[200, 200]]);
    const res = await replacePages({
      targetBytes: new Uint8Array([1, 2, 3]),
      sourceBytes: source,
      targetRange: { start: 0, end: 0 },
      sourceRange: { start: 0, end: 0 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('target_load_failed');
  });

  it('single-page replace works', async () => {
    const target = await makePdfWithSizes([
      [100, 100],
      [110, 110],
      [120, 120],
    ]);
    const source = await makePdfWithSizes([[999, 999]]);
    const res = await replacePages({
      targetBytes: target,
      sourceBytes: source,
      targetRange: { start: 1, end: 1 },
      sourceRange: { start: 0, end: 0 },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const reload = await PDFDocument.load(res.value.bytes);
      expect(reload.getPageCount()).toBe(3);
      expect(reload.getPage(0).getWidth()).toBe(100);
      expect(reload.getPage(1).getWidth()).toBe(999);
      expect(reload.getPage(2).getWidth()).toBe(120);
    }
  });
});
