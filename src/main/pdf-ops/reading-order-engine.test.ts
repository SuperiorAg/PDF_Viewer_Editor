// @vitest-environment node
//
// Unit tests for the Phase 7.5 Wave 5c C4 reading-order engine.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { StructTreeNode } from '../../ipc/contracts.js';

import {
  autoDetectReadingOrderFromLayout,
  getReadingOrder,
  setReadingOrder,
  type LayoutBlock,
} from './reading-order-engine.js';
import { setStructTree } from './struct-tree-engine.js';

async function makePlainPdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([612, 792]);
  return doc.save();
}

function node(
  type: string,
  children: StructTreeNode[] = [],
  extras: Partial<StructTreeNode> = {},
): StructTreeNode {
  return {
    id: `id-${type}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    contentRefs: [],
    children,
    ...extras,
  };
}

async function makeTaggedPdf(tree: StructTreeNode, pages = 3): Promise<Uint8Array> {
  const base = await makePlainPdf(pages);
  const res = await setStructTree(base, tree);
  if (!res.ok) throw new Error(`fixture setStructTree failed: ${res.message}`);
  return res.value.bytes;
}

describe('getReadingOrder', () => {
  it('rejects empty bytes', async () => {
    const res = await getReadingOrder(new Uint8Array(0));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns no_struct_tree for a plain (untagged) PDF', async () => {
    const bytes = await makePlainPdf();
    const res = await getReadingOrder(bytes);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('no_struct_tree');
  });

  it('lists every top-level structure element with a stable id', async () => {
    const tree = node('Document', [
      node('H1', [], { actualText: 'Chapter 1' }),
      node('P', [], { actualText: 'paragraph one' }),
      node('H2', [], { actualText: 'Section 1.1' }),
      node('P', [], { actualText: 'paragraph two' }),
    ]);
    const tagged = await makeTaggedPdf(tree);
    const res = await getReadingOrder(tagged);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.blocks.length).toBe(4);
    // every block must carry a stable struct:N id
    for (const b of res.value.blocks) {
      expect(b.structNodeId.startsWith('struct:')).toBe(true);
    }
    // orders are 0..n-1
    const orders = res.value.blocks.map((b) => b.order);
    expect(orders).toEqual([0, 1, 2, 3]);
    // snippets surface actualText
    expect(res.value.blocks[0]!.snippet).toBe('Chapter 1');
    expect(res.value.blocks[2]!.snippet).toBe('Section 1.1');
  });

  it('filters by pageIndex when requested (perf gate)', async () => {
    const tree = node('Document', [
      node('H1', [], { actualText: 'A' }),
      node('P', [], { actualText: 'B' }),
    ]);
    const tagged = await makeTaggedPdf(tree);
    // Without /Pg on the elements the engine reports pageIndex=0. Filtering
    // to page 99 should yield an empty list (still ok=true).
    const res = await getReadingOrder(tagged, { pageIndex: 99 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.blocks).toEqual([]);
  });
});

describe('setReadingOrder', () => {
  it('rejects empty bytes', async () => {
    const res = await setReadingOrder(new Uint8Array(0), []);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('round-trips a get → reorder → set → re-get permutation', async () => {
    const tree = node('Document', [
      node('H1', [], { actualText: 'A' }),
      node('P', [], { actualText: 'B' }),
      node('P', [], { actualText: 'C' }),
    ]);
    const tagged = await makeTaggedPdf(tree);
    const before = await getReadingOrder(tagged);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    // Reverse order.
    const reversed = [...before.value.blocks].reverse();
    const newOrder = reversed.map((b, idx) => ({
      structNodeId: b.structNodeId,
      order: idx,
    }));
    const written = await setReadingOrder(tagged, newOrder);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    // Re-read.
    const after = await getReadingOrder(written.value.bytes);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.blocks.map((b) => b.snippet)).toEqual(['C', 'B', 'A']);
  });

  it('rejects a partial reordering as order_inconsistent', async () => {
    const tree = node('Document', [
      node('H1', [], { actualText: 'A' }),
      node('P', [], { actualText: 'B' }),
    ]);
    const tagged = await makeTaggedPdf(tree);
    const before = await getReadingOrder(tagged);
    if (!before.ok) throw new Error('precondition');
    // Drop one entry — missing.
    const partial = before.value.blocks
      .slice(0, 1)
      .map((b, idx) => ({ structNodeId: b.structNodeId, order: idx }));
    const res = await setReadingOrder(tagged, partial);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('order_inconsistent');
  });

  it('rejects an unknown structNodeId', async () => {
    const tree = node('Document', [node('H1'), node('P')]);
    const tagged = await makeTaggedPdf(tree);
    const res = await setReadingOrder(tagged, [
      { structNodeId: 'struct:99999', order: 0 },
      { structNodeId: 'struct:99998', order: 1 },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('order_inconsistent');
  });

  it('returns no_struct_tree on a plain (untagged) PDF', async () => {
    const bytes = await makePlainPdf();
    const res = await setReadingOrder(bytes, []);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('no_struct_tree');
  });
});

describe('autoDetectReadingOrderFromLayout', () => {
  it('sorts top-to-bottom, left-to-right within each page', () => {
    // Page 0: top-left (300,700), top-right (300,500), bottom (50,300)
    // PDF origin is bottom-left so larger y == higher on page.
    const blocks: LayoutBlock[] = [
      // out-of-order on purpose
      { structNodeId: 'struct:3', pageIndex: 0, bbox: [50, 280, 200, 320] },
      { structNodeId: 'struct:2', pageIndex: 0, bbox: [350, 480, 500, 520] },
      { structNodeId: 'struct:1', pageIndex: 0, bbox: [50, 680, 250, 720] },
    ];
    const order = autoDetectReadingOrderFromLayout(blocks);
    expect(order.map((o) => o.structNodeId)).toEqual(['struct:1', 'struct:2', 'struct:3']);
    expect(order.map((o) => o.order)).toEqual([0, 1, 2]);
  });

  it('preserves per-page sequencing across the doc', () => {
    const blocks: LayoutBlock[] = [
      { structNodeId: 'struct:p1-a', pageIndex: 1, bbox: [50, 700, 200, 720] },
      { structNodeId: 'struct:p0-a', pageIndex: 0, bbox: [50, 700, 200, 720] },
      { structNodeId: 'struct:p0-b', pageIndex: 0, bbox: [50, 400, 200, 420] },
    ];
    const order = autoDetectReadingOrderFromLayout(blocks);
    expect(order.map((o) => o.structNodeId)).toEqual(['struct:p0-a', 'struct:p0-b', 'struct:p1-a']);
  });

  it('treats blocks within the row epsilon as same-row (left-to-right)', () => {
    // Two blocks at y=700 and y=702 — within 6pt → same row. Sort by x.
    const blocks: LayoutBlock[] = [
      { structNodeId: 'right', pageIndex: 0, bbox: [400, 700, 500, 720] },
      { structNodeId: 'left', pageIndex: 0, bbox: [50, 702, 200, 720] },
    ];
    const order = autoDetectReadingOrderFromLayout(blocks);
    expect(order.map((o) => o.structNodeId)).toEqual(['left', 'right']);
  });
});
