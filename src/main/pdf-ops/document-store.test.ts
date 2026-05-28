import { describe, expect, it, beforeEach } from 'vitest';

import { DocumentStore } from './document-store.js';

describe('DocumentStore', () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
  });

  it('should assign monotonic handles', () => {
    const a = store.register({
      path: 'C:/a.pdf',
      displayName: 'a.pdf',
      fileHash: 'h1',
      bytes: new Uint8Array([1]),
      pageCount: 1,
      pdflibLoadWarnings: [],
    });
    const b = store.register({
      path: 'C:/b.pdf',
      displayName: 'b.pdf',
      fileHash: 'h2',
      bytes: new Uint8Array([2]),
      pageCount: 1,
      pdflibLoadWarnings: [],
    });
    expect(b.handle).toBe(a.handle + 1);
    expect(store.size()).toBe(2);
  });

  it('should return null for unknown handle', () => {
    expect(store.get(9999)).toBeNull();
  });

  it('release removes the doc', () => {
    const a = store.register({
      path: null,
      displayName: 'mem.pdf',
      fileHash: 'h',
      bytes: new Uint8Array([]),
      pageCount: 0,
      pdflibLoadWarnings: [],
    });
    expect(store.release(a.handle)).toBe(true);
    expect(store.release(a.handle)).toBe(false);
    expect(store.get(a.handle)).toBeNull();
  });

  it('issueDestinationToken creates a one-shot token', () => {
    const dest = store.issueDestinationToken('C:/out.pdf', 'out.pdf');
    expect(dest.token).toBeTruthy();
    const consumed = store.consumeDestinationToken(dest.token);
    expect(consumed?.path).toBe('C:/out.pdf');
    expect(store.consumeDestinationToken(dest.token)).toBeNull();
  });

  it('consumeDestinationToken returns null for unknown tokens', () => {
    expect(store.consumeDestinationToken('does-not-exist')).toBeNull();
  });

  // ----------------------------------------------------------------------------
  // Phase 2 (architecture-phase-2.md §3.2 lynchpin) — bytes accessors.
  // ----------------------------------------------------------------------------

  it('getBytes returns the registered bytes', () => {
    const rec = store.register({
      path: 'C:/a.pdf',
      displayName: 'a.pdf',
      fileHash: 'h1',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      pageCount: 1,
      pdflibLoadWarnings: [],
    });
    const out = store.getBytes(rec.handle);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out?.byteLength).toBe(4);
  });

  it('getBytes returns null for unknown handle', () => {
    expect(store.getBytes(9999)).toBeNull();
  });

  it('setBytes refreshes the stored bytes', () => {
    const rec = store.register({
      path: 'C:/a.pdf',
      displayName: 'a.pdf',
      fileHash: 'h1',
      bytes: new Uint8Array([1, 2, 3]),
      pageCount: 1,
      pdflibLoadWarnings: [],
    });
    store.setBytes(rec.handle, new Uint8Array([9, 9, 9, 9]));
    const out = store.getBytes(rec.handle);
    expect(out?.byteLength).toBe(4);
    expect(out?.[0]).toBe(9);
  });

  it('setBytes silently no-ops for unknown handle (does not throw)', () => {
    expect(() => store.setBytes(9999, new Uint8Array([1]))).not.toThrow();
  });

  it('release also frees the bytes slot (getBytes returns null after)', () => {
    const rec = store.register({
      path: null,
      displayName: 'mem.pdf',
      fileHash: 'h',
      bytes: new Uint8Array([1, 2, 3]),
      pageCount: 1,
      pdflibLoadWarnings: [],
    });
    expect(store.getBytes(rec.handle)?.byteLength).toBe(3);
    store.release(rec.handle);
    expect(store.getBytes(rec.handle)).toBeNull();
  });

  it('getOpenDocCount + getTotalBytesHeld report accurate Phase-2 memory accounting', () => {
    const a = store.register({
      path: null,
      displayName: 'a.pdf',
      fileHash: 'h1',
      bytes: new Uint8Array(100),
      pageCount: 1,
      pdflibLoadWarnings: [],
    });
    const b = store.register({
      path: null,
      displayName: 'b.pdf',
      fileHash: 'h2',
      bytes: new Uint8Array(250),
      pageCount: 1,
      pdflibLoadWarnings: [],
    });
    expect(store.getOpenDocCount()).toBe(2);
    expect(store.getTotalBytesHeld()).toBe(350);
    store.release(a.handle);
    expect(store.getOpenDocCount()).toBe(1);
    expect(store.getTotalBytesHeld()).toBe(250);
    store.release(b.handle);
    expect(store.getTotalBytesHeld()).toBe(0);
  });
});
