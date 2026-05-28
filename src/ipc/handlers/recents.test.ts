import { describe, expect, it, vi } from 'vitest';

import { handleRecentsAdd } from './recents-add.js';
import { handleRecentsClear } from './recents-clear.js';
import { handleRecentsList } from './recents-list.js';
import { expectErr, expectOk } from './test-support.js';

describe('recents:list', () => {
  it('returns items with fileStillExists flagged', () => {
    const items = [
      {
        path: 'C:/a.pdf',
        displayName: 'a.pdf',
        lastOpenedAt: 1,
        fileHash: 'h',
        fileStillExists: false,
      },
    ];
    const value = expectOk(
      handleRecentsList({}, { listRows: () => items, fileExists: () => true }),
    );
    expect(value.items[0]?.fileStillExists).toBe(true);
  });

  it('returns db_unavailable on throw', () => {
    const res = handleRecentsList(
      {},
      {
        listRows: () => {
          throw new Error('db down');
        },
        fileExists: () => true,
      },
    );
    expectErr(res, 'db_unavailable');
  });

  it('clamps limit to a max of 200', () => {
    const listRows = vi.fn().mockReturnValue([]);
    handleRecentsList({ limit: 9999 }, { listRows, fileExists: () => false });
    expect(listRows).toHaveBeenCalledWith(200);
  });
});

describe('recents:add', () => {
  it('rejects bad fileHash', () => {
    const res = handleRecentsAdd(
      { path: 'C:/x.pdf', displayName: 'x.pdf', fileHash: 'too-short' },
      { upsertRow: vi.fn(), sanitizePath: (s) => (typeof s === 'string' ? s : null) },
    );
    expectErr(res, 'invalid_payload');
  });

  it('rejects sanitization failure', () => {
    const res = handleRecentsAdd(
      { path: '../bad.pdf', displayName: 'x.pdf', fileHash: 'a'.repeat(64) },
      { upsertRow: vi.fn(), sanitizePath: () => null },
    );
    expectErr(res, 'invalid_payload');
  });

  it('upserts on success', () => {
    const upsertRow = vi.fn();
    const res = handleRecentsAdd(
      { path: 'C:/x.pdf', displayName: 'x.pdf', fileHash: 'a'.repeat(64) },
      { upsertRow, sanitizePath: (s) => (typeof s === 'string' ? s : null) },
    );
    expectOk(res);
    expect(upsertRow).toHaveBeenCalled();
  });
});

describe('recents:clear', () => {
  it('returns cleared count', () => {
    const value = expectOk(handleRecentsClear({}, { clearRows: () => 5 }));
    expect(value.cleared).toBe(5);
  });

  it('maps throw to db_unavailable', () => {
    const res = handleRecentsClear(
      {},
      {
        clearRows: () => {
          throw new Error('x');
        },
      },
    );
    expectErr(res, 'db_unavailable');
  });
});
