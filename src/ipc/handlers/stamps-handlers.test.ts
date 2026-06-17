// Handler tests for stamps:list / stamps:create / stamps:delete
// (Phase 7.5 Wave 3 B7 library CRUD).

import { describe, expect, it } from 'vitest';

import { MemoryStampsLibraryRepo } from '../../main/db-bridge.js';

import { handleStampsCreate, handleStampsDelete, handleStampsList } from './stamps-handlers.js';
import { expectErr, expectOk } from './test-support.js';

describe('handleStampsList', () => {
  it('returns db_unavailable when repo is null', async () => {
    const res = await handleStampsList({}, { repo: null });
    expectErr(res, 'db_unavailable');
  });

  it('returns all entries by default (includes the 10 built-ins)', async () => {
    const repo = new MemoryStampsLibraryRepo();
    const res = await handleStampsList({}, { repo });
    const v = expectOk(res);
    expect(v.entries.length).toBe(10);
    expect(v.entries.every((e) => e.builtinKey !== null)).toBe(true);
  });

  it('filters by kind=text', async () => {
    const repo = new MemoryStampsLibraryRepo();
    const res = await handleStampsList({ filter: 'text' }, { repo });
    const v = expectOk(res);
    expect(v.entries.every((e) => e.kind === 'text')).toBe(true);
  });

  it("returns only recent when filter='recent'", async () => {
    const repo = new MemoryStampsLibraryRepo();
    // Before any use, no entries should be "recent".
    const r1 = await handleStampsList({ filter: 'recent' }, { repo });
    expect(expectOk(r1).entries).toEqual([]);
    // Record use on one, then check.
    repo.recordUse(1);
    const r2 = await handleStampsList({ filter: 'recent', limit: 5 }, { repo });
    const v2 = expectOk(r2);
    expect(v2.entries.length).toBe(1);
    expect(v2.entries[0]!.id).toBe(1);
  });
});

describe('handleStampsCreate', () => {
  it('rejects an unknown kind', async () => {
    const repo = new MemoryStampsLibraryRepo();
    const res = await handleStampsCreate(
      { name: 'X', kind: 'bogus', widthPt: 100, heightPt: 30 },
      { repo },
    );
    expectErr(res, 'invalid_payload');
  });

  it('rejects text stamp with no textValue', async () => {
    const repo = new MemoryStampsLibraryRepo();
    const res = await handleStampsCreate(
      { name: 'X', kind: 'text', widthPt: 100, heightPt: 30 },
      { repo },
    );
    expectErr(res, 'invalid_payload');
  });

  it('creates a user text stamp and returns its id', async () => {
    const repo = new MemoryStampsLibraryRepo();
    const res = await handleStampsCreate(
      {
        name: 'My Stamp',
        kind: 'text',
        textValue: 'CUSTOM',
        widthPt: 100,
        heightPt: 30,
        color: '#000000',
      },
      { repo },
    );
    const v = expectOk(res);
    expect(v.id).toBeGreaterThan(10); // built-ins occupy 1..10
  });
});

describe('handleStampsDelete', () => {
  it('rejects deleting a built-in', async () => {
    const repo = new MemoryStampsLibraryRepo();
    const res = await handleStampsDelete({ id: 1 }, { repo });
    expectErr(res, 'forbidden_builtin');
  });

  it('returns not_found for unknown id', async () => {
    const repo = new MemoryStampsLibraryRepo();
    const res = await handleStampsDelete({ id: 9999 }, { repo });
    expectErr(res, 'not_found');
  });

  it('deletes a user stamp', async () => {
    const repo = new MemoryStampsLibraryRepo();
    const create = await handleStampsCreate(
      { name: 'X', kind: 'text', textValue: 'X', widthPt: 50, heightPt: 20 },
      { repo },
    );
    const { id } = expectOk(create);
    const del = await handleStampsDelete({ id }, { repo });
    const v = expectOk(del);
    expect(v.removed).toBe(1);
  });
});
