// Tests for the compare-session store (Phase 7.5 Wave 7).

import { describe, expect, it } from 'vitest';

import { CompareSessionStore, renderCacheKey } from './compare-session-store.js';

function defaultPairs(): { leftPageIndex: number | null; rightPageIndex: number | null }[] {
  return [
    { leftPageIndex: 0, rightPageIndex: 0 },
    { leftPageIndex: 1, rightPageIndex: 1 },
  ];
}

describe('CompareSessionStore', () => {
  it('open returns a session with a fresh uuid id, caches initialized', () => {
    const store = new CompareSessionStore();
    const session = store.open({
      leftHandle: 11,
      rightHandle: 22,
      pageCountLeft: 2,
      pageCountRight: 2,
      pagePairs: defaultPairs(),
    });
    expect(typeof session.id).toBe('string');
    expect(session.id.length).toBeGreaterThan(8);
    expect(session.left.handle).toBe(11);
    expect(session.right.handle).toBe(22);
    expect(session.pageCountLeft).toBe(2);
    expect(session.pageCountRight).toBe(2);
    expect(session.left.pdfJsDoc).toBeNull();
    expect(session.right.pdfJsDoc).toBeNull();
    expect(session.left.textCache.size).toBe(0);
    expect(session.right.textCache.size).toBe(0);
    expect(session.left.renderCache.size).toBe(0);
    expect(session.right.renderCache.size).toBe(0);
  });

  it('get returns the session by id; null for unknown', () => {
    const store = new CompareSessionStore();
    const session = store.open({
      leftHandle: 1,
      rightHandle: 2,
      pageCountLeft: 1,
      pageCountRight: 1,
      pagePairs: [{ leftPageIndex: 0, rightPageIndex: 0 }],
    });
    expect(store.get(session.id)).toBe(session);
    expect(store.get('not-a-real-id')).toBeNull();
  });

  it('open with mismatched page counts produces correct stored counts', () => {
    const store = new CompareSessionStore();
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
    expect(session.pageCountLeft).toBe(3);
    expect(session.pageCountRight).toBe(5);
    expect(session.pagePairs).toHaveLength(5);
  });

  it('close returns true on first call, false on second (idempotent)', () => {
    const store = new CompareSessionStore();
    const session = store.open({
      leftHandle: 1,
      rightHandle: 2,
      pageCountLeft: 1,
      pageCountRight: 1,
      pagePairs: [{ leftPageIndex: 0, rightPageIndex: 0 }],
    });
    expect(store.close(session.id)).toBe(true);
    expect(store.close(session.id)).toBe(false);
    expect(store.get(session.id)).toBeNull();
  });

  it('close returns false for an unknown id', () => {
    const store = new CompareSessionStore();
    expect(store.close('never-existed')).toBe(false);
  });

  it('close drops cached pdf.js doc + clears caches', () => {
    const store = new CompareSessionStore();
    const session = store.open({
      leftHandle: 1,
      rightHandle: 2,
      pageCountLeft: 1,
      pageCountRight: 1,
      pagePairs: [{ leftPageIndex: 0, rightPageIndex: 0 }],
    });
    let destroyed = 0;
    const fakeDoc = {
      destroy: (): void => {
        destroyed += 1;
      },
    };
    session.left.pdfJsDoc = fakeDoc;
    session.right.pdfJsDoc = fakeDoc;
    session.left.textCache.set(0, 'cached');
    session.right.renderCache.set(renderCacheKey(0, 800), {
      width: 800,
      height: 1000,
      pngBytes: new Uint8Array([1, 2, 3]),
    });
    store.close(session.id);
    expect(destroyed).toBe(2);
  });

  it('close tolerates a pdf.js doc whose destroy throws', () => {
    const store = new CompareSessionStore();
    const session = store.open({
      leftHandle: 1,
      rightHandle: 2,
      pageCountLeft: 1,
      pageCountRight: 1,
      pagePairs: [{ leftPageIndex: 0, rightPageIndex: 0 }],
    });
    session.left.pdfJsDoc = {
      destroy: (): void => {
        throw new Error('boom');
      },
    };
    expect(() => store.close(session.id)).not.toThrow();
    expect(store.size()).toBe(0);
  });

  it('close tolerates a pdf.js doc whose destroy rejects (Promise)', () => {
    const store = new CompareSessionStore();
    const session = store.open({
      leftHandle: 1,
      rightHandle: 2,
      pageCountLeft: 1,
      pageCountRight: 1,
      pagePairs: [{ leftPageIndex: 0, rightPageIndex: 0 }],
    });
    session.left.pdfJsDoc = {
      destroy: (): Promise<void> => Promise.reject(new Error('async boom')),
    };
    expect(() => store.close(session.id)).not.toThrow();
    expect(store.size()).toBe(0);
  });

  it('size reflects open sessions', () => {
    const store = new CompareSessionStore();
    expect(store.size()).toBe(0);
    const s1 = store.open({
      leftHandle: 1,
      rightHandle: 2,
      pageCountLeft: 1,
      pageCountRight: 1,
      pagePairs: [{ leftPageIndex: 0, rightPageIndex: 0 }],
    });
    expect(store.size()).toBe(1);
    const s2 = store.open({
      leftHandle: 3,
      rightHandle: 4,
      pageCountLeft: 1,
      pageCountRight: 1,
      pagePairs: [{ leftPageIndex: 0, rightPageIndex: 0 }],
    });
    expect(store.size()).toBe(2);
    store.close(s1.id);
    expect(store.size()).toBe(1);
    store.close(s2.id);
    expect(store.size()).toBe(0);
  });

  it('_resetForTests drops every session', () => {
    const store = new CompareSessionStore();
    store.open({
      leftHandle: 1,
      rightHandle: 2,
      pageCountLeft: 1,
      pageCountRight: 1,
      pagePairs: [{ leftPageIndex: 0, rightPageIndex: 0 }],
    });
    store.open({
      leftHandle: 3,
      rightHandle: 4,
      pageCountLeft: 1,
      pageCountRight: 1,
      pagePairs: [{ leftPageIndex: 0, rightPageIndex: 0 }],
    });
    expect(store.size()).toBe(2);
    store._resetForTests();
    expect(store.size()).toBe(0);
  });

  it('renderCacheKey produces a stable string per (page,width)', () => {
    expect(renderCacheKey(0, 800)).toBe('0@800');
    expect(renderCacheKey(7, 1600)).toBe('7@1600');
    expect(renderCacheKey(0, 800)).toBe(renderCacheKey(0, 800));
  });
});
