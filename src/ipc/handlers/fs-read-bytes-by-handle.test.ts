// @vitest-environment node
//
// Phase 4.1 (David) — fs:readBytesByHandle handler unit tests.
//
// Contract pins:
//   - happy path: round-trips the exact bytes the document-store holds
//   - unknown_handle: arbitrary integer that was never registered
//   - released handle: register, release, then read → unknown_handle
//   - invalid payload (non-integer, negative, missing): unknown_handle
//   - empty bytes (defensive): document_evicted

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { documentStore } from '../../main/pdf-ops/document-store.js';

import { handleFsReadBytesByHandle } from './fs-read-bytes-by-handle.js';

const FIXTURE_BYTES = new Uint8Array([
  0x25,
  0x50,
  0x44,
  0x46,
  0x2d,
  0x31,
  0x2e,
  0x37, // %PDF-1.7
  0xff,
  0xee,
  0xdd,
  0xcc,
  0xbb,
  0xaa, // sentinel bytes
]);

beforeEach(() => {
  documentStore._resetForTests();
});

afterEach(() => {
  documentStore._resetForTests();
});

describe('handleFsReadBytesByHandle', () => {
  it('round-trips bytes for a registered handle', async () => {
    const rec = documentStore.register({
      path: '/tmp/fake.pdf',
      displayName: 'fake.pdf',
      fileHash: 'a'.repeat(64),
      bytes: FIXTURE_BYTES,
      pageCount: 1,
      pdflibLoadWarnings: [],
    });

    const r = await handleFsReadBytesByHandle(
      { handle: rec.handle },
      { getBytes: (h) => documentStore.getBytes(h) },
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(r.value.bytes)).toEqual(Array.from(FIXTURE_BYTES));
    }
  });

  it('returns unknown_handle for a never-registered handle', async () => {
    const r = await handleFsReadBytesByHandle(
      { handle: 999 },
      { getBytes: (h) => documentStore.getBytes(h) },
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unknown_handle');
  });

  it('returns unknown_handle after the handle is released', async () => {
    const rec = documentStore.register({
      path: '/tmp/fake.pdf',
      displayName: 'fake.pdf',
      fileHash: 'b'.repeat(64),
      bytes: FIXTURE_BYTES,
      pageCount: 1,
      pdflibLoadWarnings: [],
    });
    documentStore.release(rec.handle);

    const r = await handleFsReadBytesByHandle(
      { handle: rec.handle },
      { getBytes: (h) => documentStore.getBytes(h) },
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unknown_handle');
  });

  it('rejects non-integer handles', async () => {
    const r = await handleFsReadBytesByHandle(
      { handle: 1.5 },
      { getBytes: (h) => documentStore.getBytes(h) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unknown_handle');
  });

  it('rejects negative handles', async () => {
    const r = await handleFsReadBytesByHandle(
      { handle: -5 },
      { getBytes: (h) => documentStore.getBytes(h) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unknown_handle');
  });

  it('rejects missing payload', async () => {
    const r = await handleFsReadBytesByHandle({}, { getBytes: (h) => documentStore.getBytes(h) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unknown_handle');
  });

  it('rejects payload with wrong shape', async () => {
    const r = await handleFsReadBytesByHandle(
      { handle: 'not-a-number' },
      { getBytes: (h) => documentStore.getBytes(h) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unknown_handle');
  });

  it('does NOT expose the document path or fileHash in the response', async () => {
    const rec = documentStore.register({
      path: '/secret/path/to/file.pdf',
      displayName: 'public-name.pdf',
      fileHash: 'c'.repeat(64),
      bytes: FIXTURE_BYTES,
      pageCount: 1,
      pdflibLoadWarnings: [],
    });
    const r = await handleFsReadBytesByHandle(
      { handle: rec.handle },
      { getBytes: (h) => documentStore.getBytes(h) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const keys = Object.keys(r.value);
      expect(keys).toEqual(['bytes']);
      // Belt-and-braces — JSON-serialize the response and assert the path
      // and hash are absent. (Uint8Array serializes to a numeric-keyed
      // object under JSON.stringify, but the path is a string and would
      // appear if accidentally leaked.)
      const json = JSON.stringify({
        ...r.value,
        bytes: Array.from(r.value.bytes),
      });
      expect(json).not.toContain('/secret/path');
      expect(json).not.toContain('c'.repeat(64));
    }
  });

  it('defensive: empty bytes returns document_evicted (sanity floor)', async () => {
    // documentStore.register normally enforces non-empty bytes through the
    // upstream open handlers; we force the edge case directly here to pin
    // the handler's defensive branch.
    const r = await handleFsReadBytesByHandle({ handle: 1 }, { getBytes: () => new Uint8Array(0) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('document_evicted');
  });
});
