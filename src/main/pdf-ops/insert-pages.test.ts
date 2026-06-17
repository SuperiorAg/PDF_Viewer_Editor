// Unit tests for the B11 Insert Pages From File engine.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { insertPagesFromFile } from './insert-pages.js';

async function makePdfWithSizes(sizes: Array<[number, number]>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h] of sizes) doc.addPage([w, h]);
  return doc.save();
}

describe('insertPagesFromFile', () => {
  it('inserts source pages after the given target index', async () => {
    // Target: 3 pages [100x200, 110x210, 120x220].
    const target = await makePdfWithSizes([
      [100, 200],
      [110, 210],
      [120, 220],
    ]);
    // Source: 2 pages [300x400, 310x410].
    const source = await makePdfWithSizes([
      [300, 400],
      [310, 410],
    ]);
    const res = await insertPagesFromFile({
      targetBytes: target,
      sourceBytes: source,
      sourcePages: { kind: 'all' },
      insertAfterPageIndex: 0, // after the first target page
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const reload = await PDFDocument.load(res.value.bytes);
      // expected order: target0, source0, source1, target1, target2
      expect(reload.getPageCount()).toBe(5);
      expect(reload.getPage(0).getWidth()).toBe(100);
      expect(reload.getPage(1).getWidth()).toBe(300);
      expect(reload.getPage(2).getWidth()).toBe(310);
      expect(reload.getPage(3).getWidth()).toBe(110);
      expect(reload.getPage(4).getWidth()).toBe(120);
      expect(res.value.pagesInserted).toBe(2);
      expect(res.value.newPageCount).toBe(5);
    }
  });

  it('insertAfterPageIndex=-1 inserts at the very start', async () => {
    const target = await makePdfWithSizes([[100, 200]]);
    const source = await makePdfWithSizes([[300, 400]]);
    const res = await insertPagesFromFile({
      targetBytes: target,
      sourceBytes: source,
      sourcePages: { kind: 'all' },
      insertAfterPageIndex: -1,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const reload = await PDFDocument.load(res.value.bytes);
      expect(reload.getPage(0).getWidth()).toBe(300);
      expect(reload.getPage(1).getWidth()).toBe(100);
    }
  });

  it('rejects insertAfterPageIndex beyond the last target page', async () => {
    const target = await makePdfWithSizes([[100, 200]]);
    const source = await makePdfWithSizes([[300, 400]]);
    const res = await insertPagesFromFile({
      targetBytes: target,
      sourceBytes: source,
      sourcePages: { kind: 'all' },
      insertAfterPageIndex: 5,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_insertion_index');
  });

  it('rejects out-of-range source pages', async () => {
    const target = await makePdfWithSizes([[100, 200]]);
    const source = await makePdfWithSizes([[300, 400]]);
    const res = await insertPagesFromFile({
      targetBytes: target,
      sourceBytes: source,
      sourcePages: { kind: 'list', indices: [5] },
      insertAfterPageIndex: 0,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('source_page_out_of_range');
  });

  it('returns source_load_failed on corrupt source', async () => {
    const target = await makePdfWithSizes([[100, 200]]);
    const res = await insertPagesFromFile({
      targetBytes: target,
      sourceBytes: new Uint8Array([0, 0, 0, 0]),
      sourcePages: { kind: 'all' },
      insertAfterPageIndex: 0,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('source_load_failed');
  });

  it('preserves source order when sourcePages is a list', async () => {
    const target = await makePdfWithSizes([[100, 100]]);
    const source = await makePdfWithSizes([
      [200, 200],
      [201, 201],
      [202, 202],
    ]);
    const res = await insertPagesFromFile({
      targetBytes: target,
      sourceBytes: source,
      sourcePages: { kind: 'list', indices: [2, 0] }, // source page 2 then source page 0
      insertAfterPageIndex: 0,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const reload = await PDFDocument.load(res.value.bytes);
      expect(reload.getPage(1).getWidth()).toBe(202);
      expect(reload.getPage(2).getWidth()).toBe(200);
    }
  });
});
