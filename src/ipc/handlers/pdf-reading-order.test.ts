// Handler tests for pdf:getReadingOrder + pdf:setReadingOrder.

import { describe, expect, it, vi } from 'vitest';

import type {
  GetReadingOrderValue,
  SetReadingOrderValue,
} from '../../main/pdf-ops/reading-order-engine.js';
import { ok } from '../../shared/result.js';

import {
  handlePdfGetReadingOrder,
  handlePdfSetReadingOrder,
  type PdfReadingOrderDeps,
} from './pdf-reading-order.js';

const FAKE_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

describe('handlePdfGetReadingOrder', () => {
  it('rejects invalid payloads', async () => {
    const res = await handlePdfGetReadingOrder({ handle: 'wat' }, { getBytes: () => FAKE_BYTES });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns handle_not_found when the handle is unknown', async () => {
    const res = await handlePdfGetReadingOrder({ handle: 99 }, { getBytes: () => null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('handle_not_found');
  });

  it('returns engine results on the happy path', async () => {
    const engineGet = vi.fn().mockResolvedValue(
      ok<GetReadingOrderValue>({
        blocks: [
          {
            structNodeId: 'struct:1',
            order: 0,
            pageIndex: 0,
            bbox: [0, 0, 0, 0],
            snippet: 'A',
            type: 'H1',
          },
        ],
        warnings: [],
      }),
    );
    const deps: PdfReadingOrderDeps = {
      getBytes: () => FAKE_BYTES,
      engineGet,
    };
    const res = await handlePdfGetReadingOrder({ handle: 1 }, deps);
    expect(engineGet).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.order.length).toBe(1);
    expect(res.value.order[0]!.structNodeId).toBe('struct:1');
  });

  it('refines bboxes via the optional bboxLookup', async () => {
    const engineGet = vi.fn().mockResolvedValue(
      ok<GetReadingOrderValue>({
        blocks: [
          {
            structNodeId: 'struct:1',
            order: 0,
            pageIndex: 0,
            bbox: [0, 0, 0, 0],
            snippet: 'A',
            type: 'P',
          },
        ],
        warnings: [],
      }),
    );
    const bboxLookup = vi
      .fn()
      .mockResolvedValue(
        new Map<string, [number, number, number, number]>([['struct:1', [10, 20, 30, 40]]]),
      );
    const deps: PdfReadingOrderDeps = {
      getBytes: () => FAKE_BYTES,
      engineGet,
      bboxLookup,
    };
    const res = await handlePdfGetReadingOrder({ handle: 1 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.order[0]!.bbox).toEqual([10, 20, 30, 40]);
  });

  it('degrades honestly when bboxLookup throws', async () => {
    const engineGet = vi.fn().mockResolvedValue(
      ok<GetReadingOrderValue>({
        blocks: [
          {
            structNodeId: 'struct:1',
            order: 0,
            pageIndex: 0,
            bbox: [0, 0, 0, 0],
            snippet: 'A',
            type: 'P',
          },
        ],
        warnings: [],
      }),
    );
    const bboxLookup = vi.fn().mockRejectedValue(new Error('pdf.js died'));
    const deps: PdfReadingOrderDeps = {
      getBytes: () => FAKE_BYTES,
      engineGet,
      bboxLookup,
    };
    const res = await handlePdfGetReadingOrder({ handle: 1 }, deps);
    expect(res.ok).toBe(true); // honest degrade — engine zero-bboxes survive
    if (!res.ok) return;
    expect(res.value.order[0]!.bbox).toEqual([0, 0, 0, 0]);
  });
});

describe('handlePdfSetReadingOrder', () => {
  it('rejects invalid payloads', async () => {
    const res = await handlePdfSetReadingOrder(
      { handle: 1 }, // missing `order`
      { getBytes: () => FAKE_BYTES },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns handle_not_found when the handle is unknown', async () => {
    const res = await handlePdfSetReadingOrder({ handle: 99, order: [] }, { getBytes: () => null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('handle_not_found');
  });

  it('calls setBytes on the happy path and returns applied=true', async () => {
    const engineSet = vi.fn().mockResolvedValue(
      ok<SetReadingOrderValue>({
        bytes: new Uint8Array([1, 2, 3]),
        warnings: [],
      }),
    );
    const setBytes = vi.fn();
    const deps: PdfReadingOrderDeps = {
      getBytes: () => FAKE_BYTES,
      setBytes,
      engineSet,
    };
    const res = await handlePdfSetReadingOrder(
      {
        handle: 1,
        order: [{ structNodeId: 'struct:1', pageIndex: 0, order: 0, bbox: [0, 0, 0, 0] }],
      },
      deps,
    );
    expect(engineSet).toHaveBeenCalled();
    expect(setBytes).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.applied).toBe(true);
  });
});
