// Handler tests for pdf:listFiguresWithoutAltText + pdf:setAltText.

import { describe, expect, it, vi } from 'vitest';

import type { ListFiguresValue, SetAltTextValue } from '../../main/pdf-ops/alt-text-engine.js';
import { ok } from '../../shared/result.js';

import {
  handlePdfListFiguresWithoutAltText,
  handlePdfSetAltText,
  type PdfAltTextDeps,
} from './pdf-alt-text.js';

const FAKE_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

describe('handlePdfListFiguresWithoutAltText', () => {
  it('rejects invalid payloads', async () => {
    const res = await handlePdfListFiguresWithoutAltText(
      { handle: 'wat' },
      { getBytes: () => FAKE_BYTES },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns handle_not_found when the handle is unknown', async () => {
    const res = await handlePdfListFiguresWithoutAltText({ handle: 99 }, { getBytes: () => null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('handle_not_found');
  });

  it('returns engine results on the happy path', async () => {
    const engineList = vi.fn().mockResolvedValue(
      ok<ListFiguresValue>({
        figures: [
          { structNodeId: 'struct:1', pageIndex: 0, bbox: [0, 0, 0, 0] },
          { structNodeId: 'struct:2', pageIndex: 1, bbox: [0, 0, 0, 0] },
        ],
        warnings: [],
      }),
    );
    const deps: PdfAltTextDeps = {
      getBytes: () => FAKE_BYTES,
      engineList,
    };
    const res = await handlePdfListFiguresWithoutAltText({ handle: 1 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.figures.length).toBe(2);
  });

  it('refines bboxes via the optional bboxLookup', async () => {
    const engineList = vi.fn().mockResolvedValue(
      ok<ListFiguresValue>({
        figures: [{ structNodeId: 'struct:1', pageIndex: 0, bbox: [0, 0, 0, 0] }],
        warnings: [],
      }),
    );
    const bboxLookup = vi
      .fn()
      .mockResolvedValue(
        new Map<string, [number, number, number, number]>([['struct:1', [10, 20, 100, 80]]]),
      );
    const deps: PdfAltTextDeps = {
      getBytes: () => FAKE_BYTES,
      engineList,
      bboxLookup,
    };
    const res = await handlePdfListFiguresWithoutAltText({ handle: 1 }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.figures[0]!.bbox).toEqual([10, 20, 100, 80]);
  });
});

describe('handlePdfSetAltText', () => {
  it('rejects invalid payloads', async () => {
    const res = await handlePdfSetAltText(
      { handle: 1 }, // missing structNodeId and altText
      { getBytes: () => FAKE_BYTES },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns handle_not_found when the handle is unknown', async () => {
    const res = await handlePdfSetAltText(
      { handle: 99, structNodeId: 'struct:1', altText: 'x' },
      { getBytes: () => null },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('handle_not_found');
  });

  it('calls setBytes on the happy path and returns applied=true', async () => {
    const engineSet = vi.fn().mockResolvedValue(
      ok<SetAltTextValue>({
        bytes: new Uint8Array([1, 2, 3]),
        applied: 1,
        warnings: [],
      }),
    );
    const setBytes = vi.fn();
    const deps: PdfAltTextDeps = {
      getBytes: () => FAKE_BYTES,
      setBytes,
      engineSet,
    };
    const res = await handlePdfSetAltText(
      { handle: 1, structNodeId: 'struct:1', altText: 'a figure' },
      deps,
    );
    expect(engineSet).toHaveBeenCalled();
    expect(setBytes).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.applied).toBe(true);
  });

  it('threads actualText through when provided', async () => {
    const engineSet = vi.fn().mockResolvedValue(
      ok<SetAltTextValue>({
        bytes: new Uint8Array([1, 2, 3]),
        applied: 1,
        warnings: [],
      }),
    );
    const deps: PdfAltTextDeps = {
      getBytes: () => FAKE_BYTES,
      engineSet,
    };
    await handlePdfSetAltText(
      {
        handle: 1,
        structNodeId: 'struct:1',
        altText: 'alt',
        actualText: 'actual',
      },
      deps,
    );
    expect(engineSet).toHaveBeenCalledWith(FAKE_BYTES, [
      { structNodeId: 'struct:1', altText: 'alt', actualText: 'actual' },
    ]);
  });
});
