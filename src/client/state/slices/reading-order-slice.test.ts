// Reading-order slice tests — Phase 7.5 C4 (Riley Wave 5c).
// Covers reducer + helper contract from
// `docs/api-contracts.md §19.7.4` + Wave 5c brief.

import { describe, expect, it } from 'vitest';

import {
  entriesForPage,
  isOrderContiguous,
  moveOrderEntry,
  type ReadingOrderEntry,
} from '../../types/reading-order-contract-stub';

import readingOrderReducer, {
  appliedOrder,
  autoDetectedOrder,
  focusEntry,
  loadedOrder,
  moveEntry,
  resetReadingOrder,
  selectReadingOrder,
  selectReadingOrderActive,
  selectReadingOrderDirty,
  selectReadingOrderFocusedEntry,
  selectReadingOrderRecomputeNoExtractor,
  selectReadingOrderTruncationWarning,
  setReadingOrderActive,
  setReadingOrderApplying,
  setReadingOrderLastError,
  setReadingOrderLoading,
} from './reading-order-slice';

const INITIAL = readingOrderReducer(undefined, { type: '@@INIT' });

function e(id: string, page: number, order: number): ReadingOrderEntry {
  return { structNodeId: id, pageIndex: page, order, bbox: [0, 0, 100, 20] };
}

function sample(): ReadingOrderEntry[] {
  return [e('a', 0, 0), e('b', 0, 1), e('c', 1, 2), e('d', 1, 3)];
}

describe('reading-order slice — reducer contract', () => {
  it('initial state has no doc loaded + overlay inactive', () => {
    expect(INITIAL.docHash).toBeNull();
    expect(INITIAL.active).toBe(false);
    expect(INITIAL.order).toEqual([]);
    expect(INITIAL.originalOrder).toEqual([]);
    expect(INITIAL.loaded).toBe(false);
    expect(INITIAL.loading).toBe(false);
    expect(INITIAL.applying).toBe(false);
    expect(INITIAL.autoDetectRunning).toBe(false);
    expect(INITIAL.lastErrorMessage).toBeNull();
    expect(INITIAL.truncationWarning).toBeNull();
    expect(INITIAL.recomputeNoExtractorWarning).toBeNull();
  });

  it('setActive toggles the overlay flag', () => {
    let s = readingOrderReducer(INITIAL, setReadingOrderActive(true));
    expect(s.active).toBe(true);
    s = readingOrderReducer(s, setReadingOrderActive(false));
    expect(s.active).toBe(false);
  });

  it('loadedOrder populates order + originalOrder and clears loading', () => {
    const order = sample();
    const s = readingOrderReducer(
      { ...INITIAL, loading: true },
      loadedOrder({ docHash: 'doc-1', order, truncationWarning: null }),
    );
    expect(s.docHash).toBe('doc-1');
    expect(s.order).toHaveLength(4);
    expect(s.originalOrder).toHaveLength(4);
    expect(s.loaded).toBe(true);
    expect(s.loading).toBe(false);
    expect(selectReadingOrderDirty({ readingOrder: s })).toBe(false);
  });

  it('moveEntry reorders + flips dirty', () => {
    const order = sample();
    const loaded = readingOrderReducer(
      INITIAL,
      loadedOrder({ docHash: 'doc-1', order, truncationWarning: null }),
    );
    const moved = readingOrderReducer(loaded, moveEntry({ fromIndex: 0, toIndex: 2 }));
    const result = selectReadingOrder({ readingOrder: moved });
    expect(result[0]?.structNodeId).toBe('b');
    expect(result[1]?.structNodeId).toBe('c');
    expect(result[2]?.structNodeId).toBe('a');
    expect(result[3]?.structNodeId).toBe('d');
    // After move, order values must be contiguous 0..N-1.
    expect(result.map((r) => r.order)).toEqual([0, 1, 2, 3]);
    expect(selectReadingOrderDirty({ readingOrder: moved })).toBe(true);
  });

  it('moveEntry no-op when fromIndex === toIndex', () => {
    const order = sample();
    const loaded = readingOrderReducer(
      INITIAL,
      loadedOrder({ docHash: 'doc-1', order, truncationWarning: null }),
    );
    const moved = readingOrderReducer(loaded, moveEntry({ fromIndex: 1, toIndex: 1 }));
    expect(selectReadingOrderDirty({ readingOrder: moved })).toBe(false);
  });

  it('appliedOrder clears dirty (originalOrder ← order)', () => {
    const order = sample();
    let s = readingOrderReducer(
      INITIAL,
      loadedOrder({ docHash: 'doc-1', order, truncationWarning: null }),
    );
    s = readingOrderReducer(s, moveEntry({ fromIndex: 0, toIndex: 3 }));
    expect(selectReadingOrderDirty({ readingOrder: s })).toBe(true);
    s = readingOrderReducer(s, appliedOrder());
    expect(selectReadingOrderDirty({ readingOrder: s })).toBe(false);
  });

  it('autoDetectedOrder promotes the proposed order', () => {
    const order = sample();
    let s = readingOrderReducer(
      INITIAL,
      loadedOrder({ docHash: 'doc-1', order, truncationWarning: null }),
    );
    const proposed: ReadingOrderEntry[] = [e('d', 1, 0), e('c', 1, 1), e('b', 0, 2), e('a', 0, 3)];
    s = readingOrderReducer(s, autoDetectedOrder({ order: proposed }));
    expect(selectReadingOrder({ readingOrder: s })[0]?.structNodeId).toBe('d');
    expect(s.autoDetectRunning).toBe(false);
  });

  // Wave 5d — auto-detect honesty surface for the no-extractor case.
  it('autoDetectedOrder records the no-extractor-wired warning verbatim', () => {
    const s = readingOrderReducer(
      INITIAL,
      autoDetectedOrder({
        order: sample(),
        noExtractorWarning: 'reading-order.recompute.no-extractor-wired',
      }),
    );
    expect(selectReadingOrderRecomputeNoExtractor({ readingOrder: s })).toBe(
      'reading-order.recompute.no-extractor-wired',
    );
  });

  it('autoDetectedOrder clears the no-extractor warning when undefined/null', () => {
    let s = readingOrderReducer(
      INITIAL,
      autoDetectedOrder({
        order: sample(),
        noExtractorWarning: 'reading-order.recompute.no-extractor-wired',
      }),
    );
    expect(selectReadingOrderRecomputeNoExtractor({ readingOrder: s })).not.toBeNull();
    s = readingOrderReducer(s, autoDetectedOrder({ order: sample() }));
    expect(selectReadingOrderRecomputeNoExtractor({ readingOrder: s })).toBeNull();
  });

  it('loadedOrder (fresh load) clears any stale no-extractor warning', () => {
    let s = readingOrderReducer(
      INITIAL,
      autoDetectedOrder({
        order: sample(),
        noExtractorWarning: 'reading-order.recompute.no-extractor-wired',
      }),
    );
    expect(selectReadingOrderRecomputeNoExtractor({ readingOrder: s })).not.toBeNull();
    s = readingOrderReducer(
      s,
      loadedOrder({ docHash: 'doc-2', order: sample(), truncationWarning: null }),
    );
    expect(selectReadingOrderRecomputeNoExtractor({ readingOrder: s })).toBeNull();
  });

  // Wave 5d follow-up (Riley) — quick-fix focus action wiring.
  // Per Wave 5d follow-up brief Fix 1: the C6 accessibility-checker quick-fix
  // 'open-reading-order' carries a struct node id which the slice records
  // here, the overlay surfaces as a scrolled + outlined badge.
  it('focusEntry records the focused struct node id', () => {
    const s = readingOrderReducer(INITIAL, focusEntry('struct:42'));
    expect(selectReadingOrderFocusedEntry({ readingOrder: s })).toBe('struct:42');
  });

  it('focusEntry(null) clears a prior focus', () => {
    let s = readingOrderReducer(INITIAL, focusEntry('struct:42'));
    expect(selectReadingOrderFocusedEntry({ readingOrder: s })).not.toBeNull();
    s = readingOrderReducer(s, focusEntry(null));
    expect(selectReadingOrderFocusedEntry({ readingOrder: s })).toBeNull();
  });

  it('focusEntry is independent of active — focus survives the overlay being inactive', () => {
    let s = readingOrderReducer(INITIAL, focusEntry('struct:42'));
    s = readingOrderReducer(s, setReadingOrderActive(true));
    expect(selectReadingOrderFocusedEntry({ readingOrder: s })).toBe('struct:42');
    s = readingOrderReducer(s, setReadingOrderActive(false));
    expect(selectReadingOrderFocusedEntry({ readingOrder: s })).toBe('struct:42');
  });

  it('resetReadingOrder clears the focused entry id', () => {
    let s = readingOrderReducer(INITIAL, focusEntry('struct:42'));
    s = readingOrderReducer(s, resetReadingOrder());
    expect(selectReadingOrderFocusedEntry({ readingOrder: s })).toBeNull();
  });

  it('setReadingOrderLastError clears running flags', () => {
    let s = readingOrderReducer(INITIAL, setReadingOrderLoading(true));
    expect(s.loading).toBe(true);
    s = readingOrderReducer(s, setReadingOrderLastError('boom'));
    expect(s.lastErrorMessage).toBe('boom');
    expect(s.loading).toBe(false);
    expect(s.applying).toBe(false);
    expect(s.autoDetectRunning).toBe(false);
  });

  it('setReadingOrderApplying flips applying + clears prior error', () => {
    let s = readingOrderReducer(INITIAL, setReadingOrderLastError('prior'));
    s = readingOrderReducer(s, setReadingOrderApplying(true));
    expect(s.applying).toBe(true);
    expect(s.lastErrorMessage).toBeNull();
  });

  it('loadedOrder picks up the truncation warning', () => {
    const order = sample();
    const s = readingOrderReducer(
      INITIAL,
      loadedOrder({
        docHash: 'doc-1',
        order,
        truncationWarning: 'tree truncated at 10000 nodes',
      }),
    );
    expect(selectReadingOrderTruncationWarning({ readingOrder: s })).toBe(
      'tree truncated at 10000 nodes',
    );
  });

  it('resetReadingOrder returns to initial', () => {
    const order = sample();
    let s = readingOrderReducer(
      INITIAL,
      loadedOrder({ docHash: 'doc-1', order, truncationWarning: null }),
    );
    s = readingOrderReducer(s, setReadingOrderActive(true));
    s = readingOrderReducer(s, resetReadingOrder());
    expect(s).toEqual(INITIAL);
  });

  it('selectReadingOrderActive returns the flag', () => {
    const s = readingOrderReducer(INITIAL, setReadingOrderActive(true));
    expect(selectReadingOrderActive({ readingOrder: s })).toBe(true);
  });
});

describe('reading-order contract helpers', () => {
  it('moveOrderEntry produces a contiguous 0..N-1 order', () => {
    const next = moveOrderEntry(sample(), 0, 2);
    expect(next.map((e_) => e_.order)).toEqual([0, 1, 2, 3]);
    expect(next.map((e_) => e_.structNodeId)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moveOrderEntry no-op returns a fresh array but same identity per entry', () => {
    const before = sample();
    const after = moveOrderEntry(before, 1, 1);
    expect(after).not.toBe(before);
    expect(after.map((e_) => e_.structNodeId)).toEqual(before.map((e_) => e_.structNodeId));
  });

  it('entriesForPage filters + sorts by order', () => {
    const page0 = entriesForPage(sample(), 0);
    expect(page0.map((e_) => e_.structNodeId)).toEqual(['a', 'b']);
    const page1 = entriesForPage(sample(), 1);
    expect(page1.map((e_) => e_.structNodeId)).toEqual(['c', 'd']);
  });

  it('isOrderContiguous true for a fresh sample', () => {
    expect(isOrderContiguous(sample())).toBe(true);
  });

  it('isOrderContiguous false for a duplicated order value', () => {
    const broken: ReadingOrderEntry[] = [e('a', 0, 0), e('b', 0, 0), e('c', 1, 2), e('d', 1, 3)];
    expect(isOrderContiguous(broken)).toBe(false);
  });

  it('isOrderContiguous false when an order value sits outside 0..N-1', () => {
    const broken: ReadingOrderEntry[] = [e('a', 0, 0), e('b', 0, 1), e('c', 1, 2), e('d', 1, 9)];
    expect(isOrderContiguous(broken)).toBe(false);
  });
});
