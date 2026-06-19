// Handler tests for pdf:compareTextOnPage (Phase 7.5 Wave 7).

import { describe, expect, it, vi } from 'vitest';

import { CompareSessionStore } from '../../main/compare/compare-session-store.js';

import { handlePdfCompareTextOnPage } from './pdf-compare-text.js';

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

describe('handlePdfCompareTextOnPage', () => {
  it('rejects invalid payload (bad sessionId type)', async () => {
    const res = await handlePdfCompareTextOnPage(
      { compareSessionId: 42, leftPageIndex: 0, rightPageIndex: 0 },
      { extractor: vi.fn() },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects when both page indices are null', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const res = await handlePdfCompareTextOnPage(
      { compareSessionId: id, leftPageIndex: null, rightPageIndex: null },
      { store, extractor: vi.fn() },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns session_not_found for unknown session', async () => {
    const res = await handlePdfCompareTextOnPage(
      { compareSessionId: 'never-existed', leftPageIndex: 0, rightPageIndex: 0 },
      { store: new CompareSessionStore(), extractor: vi.fn() },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('session_not_found');
  });

  it('returns page_out_of_range for left index >= pageCountLeft', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const res = await handlePdfCompareTextOnPage(
      { compareSessionId: id, leftPageIndex: 3, rightPageIndex: 0 },
      { store, extractor: vi.fn() },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('page_out_of_range');
  });

  it('returns page_out_of_range for right index >= pageCountRight', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const res = await handlePdfCompareTextOnPage(
      { compareSessionId: id, leftPageIndex: 0, rightPageIndex: 5 },
      { store, extractor: vi.fn() },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('page_out_of_range');
  });

  it('returns extraction_failed when the extractor throws', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const extractor = vi.fn().mockRejectedValue(new Error('boom'));
    const res = await handlePdfCompareTextOnPage(
      { compareSessionId: id, leftPageIndex: 0, rightPageIndex: 0 },
      { store, extractor },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('extraction_failed');
  });

  it('happy path: extracts both sides and runs the engine', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const extractor = vi.fn(async (handle: number, _pageIndex: number) =>
      handle === 1 ? 'hello world' : 'hello sunny world',
    );
    const res = await handlePdfCompareTextOnPage(
      { compareSessionId: id, leftPageIndex: 0, rightPageIndex: 0 },
      { store, extractor },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(extractor).toHaveBeenCalledTimes(2);
    expect(extractor).toHaveBeenNthCalledWith(1, 1, 0);
    expect(extractor).toHaveBeenNthCalledWith(2, 2, 0);
    expect(res.value.pageNumber).toBe(1);
    expect(res.value.summary.changed).toBe(true);
    expect(res.value.summary.insertChars).toBeGreaterThan(0);
  });

  it('caches extracted text per side: second call skips the extractor', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const extractor = vi.fn(async () => 'same text');
    await handlePdfCompareTextOnPage(
      { compareSessionId: id, leftPageIndex: 0, rightPageIndex: 0 },
      { store, extractor },
    );
    expect(extractor).toHaveBeenCalledTimes(2);
    // Second call on the same page pair should hit the cache for both
    // sides.
    await handlePdfCompareTextOnPage(
      { compareSessionId: id, leftPageIndex: 0, rightPageIndex: 0 },
      { store, extractor },
    );
    expect(extractor).toHaveBeenCalledTimes(2);
  });

  it('orphan left=null: skips left extraction, passes null to engine', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const extractor = vi.fn(async () => 'modified-only content');
    const res = await handlePdfCompareTextOnPage(
      { compareSessionId: id, leftPageIndex: null, rightPageIndex: 3 },
      { store, extractor },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(extractor).toHaveBeenCalledWith(2, 3);
    expect(res.value.pageNumber).toBe(4);
    expect(res.value.leftPageIndex).toBeNull();
    expect(res.value.rightPageIndex).toBe(3);
    // Whole content shows up as an insert.
    expect(res.value.summary.insertChars).toBeGreaterThan(0);
    expect(res.value.summary.deleteChars).toBe(0);
  });

  it('orphan right=null: skips right extraction, passes null to engine', async () => {
    const store = new CompareSessionStore();
    const id = openSession(store);
    const extractor = vi.fn(async () => 'baseline-only content');
    const res = await handlePdfCompareTextOnPage(
      { compareSessionId: id, leftPageIndex: 2, rightPageIndex: null },
      { store, extractor },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(extractor).toHaveBeenCalledWith(1, 2);
    expect(res.value.pageNumber).toBe(3);
    expect(res.value.summary.deleteChars).toBeGreaterThan(0);
    expect(res.value.summary.insertChars).toBe(0);
  });
});
