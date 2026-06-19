// Handler tests for pdf:openComparePair (Phase 7.5 Wave 7).

import { describe, expect, it, vi } from 'vitest';

import { CompareSessionStore } from '../../main/compare/compare-session-store.js';

import { handlePdfOpenComparePair, type PdfCompareOpenDeps } from './pdf-compare-open.js';

function defaultDeps(overrides: Partial<PdfCompareOpenDeps> = {}): PdfCompareOpenDeps {
  return {
    getPageCount: (h) => (h === 1 ? 5 : h === 2 ? 5 : null),
    store: new CompareSessionStore(),
    ...overrides,
  };
}

describe('handlePdfOpenComparePair', () => {
  it('rejects invalid payloads', async () => {
    const res = await handlePdfOpenComparePair(
      { leftHandle: 'oops', rightHandle: 1 },
      defaultDeps(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects when leftHandle is missing', async () => {
    const res = await handlePdfOpenComparePair({}, defaultDeps());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects non-positive integer handles', async () => {
    const res = await handlePdfOpenComparePair({ leftHandle: 0, rightHandle: -1 }, defaultDeps());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns handle_not_found when left handle is unknown', async () => {
    const res = await handlePdfOpenComparePair({ leftHandle: 99, rightHandle: 2 }, defaultDeps());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('handle_not_found');
      expect(res.message).toContain('99');
    }
  });

  it('returns handle_not_found when right handle is unknown', async () => {
    const res = await handlePdfOpenComparePair({ leftHandle: 1, rightHandle: 99 }, defaultDeps());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('handle_not_found');
      expect(res.message).toContain('99');
    }
  });

  it('opens a session with sequential pairs for equal-length docs', async () => {
    const store = new CompareSessionStore();
    const res = await handlePdfOpenComparePair(
      { leftHandle: 1, rightHandle: 2 },
      defaultDeps({ store }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.pageCountLeft).toBe(5);
    expect(res.value.pageCountRight).toBe(5);
    expect(res.value.pagePairs).toHaveLength(5);
    expect(res.value.pagePairs[0]).toEqual({ leftPageIndex: 0, rightPageIndex: 0 });
    expect(res.value.pagePairs[4]).toEqual({ leftPageIndex: 4, rightPageIndex: 4 });
    // Session was registered.
    expect(store.get(res.value.compareSessionId)).not.toBeNull();
  });

  it('returns orphan trailing pairs when documents differ in length', async () => {
    const res = await handlePdfOpenComparePair(
      { leftHandle: 1, rightHandle: 2 },
      defaultDeps({
        getPageCount: (h) => (h === 1 ? 3 : 5),
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.pageCountLeft).toBe(3);
    expect(res.value.pageCountRight).toBe(5);
    expect(res.value.pagePairs).toHaveLength(5);
    expect(res.value.pagePairs[3]).toEqual({ leftPageIndex: null, rightPageIndex: 3 });
    expect(res.value.pagePairs[4]).toEqual({ leftPageIndex: null, rightPageIndex: 4 });
  });

  it('does NOT eagerly parse documents (no pdf.js work)', async () => {
    // Performance contract: opening the session must not call pdf.js.
    // We verify this by injecting a getPageCount that records calls
    // and confirming the handler only uses it (no other dep is needed).
    const calls: number[] = [];
    const res = await handlePdfOpenComparePair(
      { leftHandle: 1, rightHandle: 2 },
      defaultDeps({
        getPageCount: (h) => {
          calls.push(h);
          return 1000; // 1000-page doc — would be expensive to eagerly parse
        },
      }),
    );
    expect(res.ok).toBe(true);
    // Exactly TWO probes (once per side). If the handler had eagerly
    // parsed it'd hit pdf.js too.
    expect(calls).toEqual([1, 2]);
  });

  it('returns compare_engine_unavailable when the store throws on open', async () => {
    const fakeStore = {
      open: vi.fn(() => {
        throw new Error('store boom');
      }),
    } as unknown as CompareSessionStore;
    const res = await handlePdfOpenComparePair(
      { leftHandle: 1, rightHandle: 2 },
      defaultDeps({ store: fakeStore }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('compare_engine_unavailable');
  });
});
