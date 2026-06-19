// Handler tests for pdf:compareVisualOnPage (Phase 7.5 Wave 7).

import { PNG } from 'pngjs';
import { describe, expect, it, vi } from 'vitest';

import { CompareSessionStore } from '../../main/compare/compare-session-store.js';

import { handlePdfCompareVisualOnPage, type PdfCompareVisualDeps } from './pdf-compare-visual.js';

function makePng(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Uint8Array {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  const buf = PNG.sync.write(png);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function openSession(store: CompareSessionStore): string {
  const session = store.open({
    leftHandle: 1,
    rightHandle: 2,
    pageCountLeft: 3,
    pageCountRight: 5,
    pagePairs: [
      { leftPageIndex: 0, rightPageIndex: 0 },
      { leftPageIndex: 1, rightPageIndex: 1 },
      { leftPageIndex: 2, rightPageIndex: 2 },
      { leftPageIndex: null, rightPageIndex: 3 },
      { leftPageIndex: null, rightPageIndex: 4 },
    ],
  });
  return session.id;
}

describe('handlePdfCompareVisualOnPage', () => {
  it('rejects invalid payload (missing session id)', async () => {
    const res = await handlePdfCompareVisualOnPage({ leftPageIndex: 0, rightPageIndex: 0 }, {
      rasterizer: vi.fn(),
    } as unknown as PdfCompareVisualDeps);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects when both page indices are null', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const res = await handlePdfCompareVisualOnPage(
      { compareSessionId: id, leftPageIndex: null, rightPageIndex: null },
      { store, rasterizer: vi.fn() },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns session_not_found for unknown session', async () => {
    const res = await handlePdfCompareVisualOnPage(
      { compareSessionId: 'never-existed', leftPageIndex: 0, rightPageIndex: 0 },
      { store: new CompareSessionStore(), rasterizer: vi.fn() },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('session_not_found');
  });

  it('returns page_out_of_range when index too large', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const res = await handlePdfCompareVisualOnPage(
      { compareSessionId: id, leftPageIndex: 99, rightPageIndex: 0 },
      { store, rasterizer: vi.fn() },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('page_out_of_range');
  });

  it('returns rasterize_failed when the rasterizer throws', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const rasterizer = vi.fn().mockRejectedValue(new Error('canvas missing'));
    const res = await handlePdfCompareVisualOnPage(
      { compareSessionId: id, leftPageIndex: 0, rightPageIndex: 0 },
      { store, rasterizer },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('rasterize_failed');
  });

  it('happy path: rasterizes both sides, returns diff result + base64 payloads', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const leftBytes = makePng(8, 8, [255, 255, 255, 255]);
    const rightBytes = makePng(8, 8, [0, 0, 0, 255]);
    const rasterizer = vi.fn(async (handle: number) => ({
      pngBytes: handle === 1 ? leftBytes : rightBytes,
      width: 8,
      height: 8,
    }));
    const res = await handlePdfCompareVisualOnPage(
      { compareSessionId: id, leftPageIndex: 0, rightPageIndex: 0, renderWidth: 800 },
      { store, rasterizer },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(rasterizer).toHaveBeenCalledTimes(2);
    expect(rasterizer).toHaveBeenCalledWith(1, 0, 800);
    expect(rasterizer).toHaveBeenCalledWith(2, 0, 800);
    expect(res.value.pageNumber).toBe(1);
    expect(res.value.width).toBe(8);
    expect(res.value.height).toBe(8);
    expect(res.value.diffPercent).toBe(100);
    expect(res.value.diffMaskPng.length).toBeGreaterThan(0);
    expect(res.value.leftPagePng).not.toBeNull();
    expect(res.value.rightPagePng).not.toBeNull();
  });

  it('orphan left=null: skips left rasterize, returns full-coverage mask', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const rightBytes = makePng(8, 8, [255, 255, 255, 255]);
    const rasterizer = vi.fn(async () => ({
      pngBytes: rightBytes,
      width: 8,
      height: 8,
    }));
    const res = await handlePdfCompareVisualOnPage(
      { compareSessionId: id, leftPageIndex: null, rightPageIndex: 3 },
      { store, rasterizer },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(rasterizer).toHaveBeenCalledTimes(1);
    expect(rasterizer).toHaveBeenCalledWith(2, 3, expect.any(Number));
    expect(res.value.leftPagePng).toBeNull();
    expect(res.value.rightPagePng).not.toBeNull();
    expect(res.value.diffPercent).toBe(100);
  });

  it('caches rendered PNG per (page,width): second call skips rasterizer', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const png = makePng(8, 8, [128, 128, 128, 255]);
    const rasterizer = vi.fn(async () => ({ pngBytes: png, width: 8, height: 8 }));
    await handlePdfCompareVisualOnPage(
      { compareSessionId: id, leftPageIndex: 0, rightPageIndex: 0, renderWidth: 800 },
      { store, rasterizer },
    );
    expect(rasterizer).toHaveBeenCalledTimes(2);
    await handlePdfCompareVisualOnPage(
      { compareSessionId: id, leftPageIndex: 0, rightPageIndex: 0, renderWidth: 800 },
      { store, rasterizer },
    );
    expect(rasterizer).toHaveBeenCalledTimes(2);
  });

  it('clamps renderWidth above the max', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const png = makePng(4, 4, [255, 255, 255, 255]);
    const rasterizer = vi.fn(async () => ({ pngBytes: png, width: 4, height: 4 }));
    await handlePdfCompareVisualOnPage(
      { compareSessionId: id, leftPageIndex: 0, rightPageIndex: 0, renderWidth: 9999 },
      { store, rasterizer },
    );
    // Rasterizer called with clamped width (<= 1600).
    expect(rasterizer.mock.calls.length).toBeGreaterThan(0);
    for (const call of rasterizer.mock.calls) {
      const passedWidth = call[2] as number;
      expect(passedWidth).toBeLessThanOrEqual(1600);
      expect(passedWidth).toBeGreaterThanOrEqual(64);
    }
  });

  it('uses default renderWidth (800) when omitted', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const png = makePng(4, 4, [255, 255, 255, 255]);
    const rasterizer = vi.fn(async () => ({ pngBytes: png, width: 4, height: 4 }));
    await handlePdfCompareVisualOnPage(
      { compareSessionId: id, leftPageIndex: 0, rightPageIndex: 0 },
      { store, rasterizer },
    );
    expect(rasterizer).toHaveBeenCalledWith(expect.any(Number), 0, 800);
  });
});
