// Tests for the sequential page-pairing helper (Phase 7.5 Wave 7).

import { describe, expect, it } from 'vitest';

import { computeSequentialPagePairs } from './page-pairing.js';

describe('computeSequentialPagePairs', () => {
  it('returns equal-length pairs when both docs have the same page count', () => {
    const res = computeSequentialPagePairs(3, 3);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual([
      { leftPageIndex: 0, rightPageIndex: 0 },
      { leftPageIndex: 1, rightPageIndex: 1 },
      { leftPageIndex: 2, rightPageIndex: 2 },
    ]);
  });

  it('puts null on the right when the left doc is longer', () => {
    const res = computeSequentialPagePairs(5, 2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(5);
    expect(res.value[0]).toEqual({ leftPageIndex: 0, rightPageIndex: 0 });
    expect(res.value[1]).toEqual({ leftPageIndex: 1, rightPageIndex: 1 });
    expect(res.value[2]).toEqual({ leftPageIndex: 2, rightPageIndex: null });
    expect(res.value[3]).toEqual({ leftPageIndex: 3, rightPageIndex: null });
    expect(res.value[4]).toEqual({ leftPageIndex: 4, rightPageIndex: null });
  });

  it('puts null on the left when the right doc is longer', () => {
    const res = computeSequentialPagePairs(1, 4);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual([
      { leftPageIndex: 0, rightPageIndex: 0 },
      { leftPageIndex: null, rightPageIndex: 1 },
      { leftPageIndex: null, rightPageIndex: 2 },
      { leftPageIndex: null, rightPageIndex: 3 },
    ]);
  });

  it('handles zero-page left doc', () => {
    const res = computeSequentialPagePairs(0, 2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual([
      { leftPageIndex: null, rightPageIndex: 0 },
      { leftPageIndex: null, rightPageIndex: 1 },
    ]);
  });

  it('handles zero-page right doc', () => {
    const res = computeSequentialPagePairs(2, 0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual([
      { leftPageIndex: 0, rightPageIndex: null },
      { leftPageIndex: 1, rightPageIndex: null },
    ]);
  });

  it('handles both-zero edge case', () => {
    const res = computeSequentialPagePairs(0, 0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual([]);
  });

  it('rejects negative page counts', () => {
    const r1 = computeSequentialPagePairs(-1, 5);
    expect(r1.ok).toBe(false);
    if (r1.ok) return;
    expect(r1.error).toBe('invalid_payload');

    const r2 = computeSequentialPagePairs(5, -3);
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error).toBe('invalid_payload');
  });

  it('rejects non-integer page counts', () => {
    const r1 = computeSequentialPagePairs(1.5, 3);
    expect(r1.ok).toBe(false);
    if (r1.ok) return;
    expect(r1.error).toBe('invalid_payload');

    const r2 = computeSequentialPagePairs(2, Number.NaN);
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error).toBe('invalid_payload');
  });
});
