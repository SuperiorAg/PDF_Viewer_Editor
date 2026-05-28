// Tests for the Phase-2 bookmarks handlers: listTree, move, rename.

import { describe, expect, it, vi } from 'vitest';

import type { MoveBookmarkResult } from '../../main/db-bridge.js';
import type { BookmarkNode } from '../contracts.js';

import {
  handleBookmarksListTree,
  handleBookmarksMove,
  handleBookmarksRename,
} from './bookmarks-phase2.js';
import { expectErr, expectOk } from './test-support.js';

const HASH = 'a'.repeat(64);

function makeRepo(overrides: Partial<Parameters<typeof handleBookmarksListTree>[1]['repo']> = {}) {
  return {
    listTree: () => [] as BookmarkNode[],
    move: (): MoveBookmarkResult => ({ ok: true }),
    rename: () => true,
    ...overrides,
  };
}

describe('bookmarks:listTree', () => {
  it('rejects bad fileHash', () => {
    const r = handleBookmarksListTree({ fileHash: 'short' }, { repo: makeRepo() });
    expectErr(r, 'db_unavailable');
  });

  it('returns the tree from the repo', () => {
    const tree: BookmarkNode[] = [
      {
        id: 1,
        fileHash: HASH,
        pageIndex: 0,
        title: 'A',
        createdAt: 1,
        parentId: null,
        sortOrder: 0,
        children: [],
      },
    ];
    const repo = makeRepo({ listTree: () => tree });
    const r = handleBookmarksListTree({ fileHash: HASH }, { repo });
    const value = expectOk(r);
    expect(value.tree.length).toBe(1);
    expect(value.tree[0]?.title).toBe('A');
  });

  it('maps repo throw to db_unavailable', () => {
    const repo = makeRepo({
      listTree: () => {
        throw new Error('boom');
      },
    });
    const r = handleBookmarksListTree({ fileHash: HASH }, { repo });
    expectErr(r, 'db_unavailable');
  });
});

describe('bookmarks:move', () => {
  it('rejects negative id', () => {
    const r = handleBookmarksMove(
      { id: -1, newParentId: null, newSortOrder: 0 },
      { repo: makeRepo() },
    );
    expectErr(r, 'invalid_payload');
  });

  it('rejects negative sortOrder', () => {
    const r = handleBookmarksMove(
      { id: 1, newParentId: null, newSortOrder: -5 },
      { repo: makeRepo() },
    );
    expectErr(r, 'invalid_payload');
  });

  it('rejects negative newParentId', () => {
    const r = handleBookmarksMove(
      { id: 1, newParentId: -2, newSortOrder: 0 },
      { repo: makeRepo() },
    );
    expectErr(r, 'invalid_payload');
  });

  it('returns ok on success', () => {
    const r = handleBookmarksMove(
      { id: 1, newParentId: null, newSortOrder: 0 },
      { repo: makeRepo({ move: (): MoveBookmarkResult => ({ ok: true }) }) },
    );
    expectOk(r);
  });

  // Wave 8.5 (H-1): the Wave-7 heuristic that mapped repo `false` to
  // `cycle_detected` whenever the request had a non-null parent (and to
  // `not_found` for null parents) is gone. Each variant from the repo's
  // MoveBookmarkResult union must flow through unchanged. The three cases
  // below replace the prior two heuristic-encoding tests — bookmark-not-
  // found-with-non-null-parent used to mis-classify as cycle_detected, and
  // invalid_parent was completely unreachable.

  it('repo not_found + null newParentId -> not_found', () => {
    const r = handleBookmarksMove(
      { id: 1, newParentId: null, newSortOrder: 0 },
      {
        repo: makeRepo({
          move: (): MoveBookmarkResult => ({ ok: false, error: 'not_found' }),
        }),
      },
    );
    expectErr(r, 'not_found');
  });

  it('repo not_found + non-null newParentId -> not_found (not cycle_detected)', () => {
    // Wave-7 heuristic mapped this to cycle_detected. Real cause was the
    // bookmark id doesn't exist; the parent reference is irrelevant.
    const r = handleBookmarksMove(
      { id: 99, newParentId: 5, newSortOrder: 0 },
      {
        repo: makeRepo({
          move: (): MoveBookmarkResult => ({ ok: false, error: 'not_found' }),
        }),
      },
    );
    expectErr(r, 'not_found');
  });

  it('repo cycle_detected -> cycle_detected', () => {
    const r = handleBookmarksMove(
      { id: 1, newParentId: 5, newSortOrder: 0 },
      {
        repo: makeRepo({
          move: (): MoveBookmarkResult => ({ ok: false, error: 'cycle_detected' }),
        }),
      },
    );
    expectErr(r, 'cycle_detected');
  });

  it('repo invalid_parent -> invalid_parent (wire variant, post-Wave-10)', () => {
    // Wave 10 / Phase 2.5 (D-10.1): `docs/api-contracts.md §12.6` was
    // amended to add `'invalid_parent'` to `BookmarksMoveError`, retiring
    // the Wave-8.5 `invalid_parent → invalid_payload` wire translation.
    // The handler now passes the repo variant through verbatim; the
    // renderer surfaces "Cannot move bookmark to that location" (Riley's
    // R-10.3) rather than the older "Invalid payload" toast. The Wave-7
    // bug rendered this variant completely unreachable; Wave 8.5 restored
    // the repo→bridge→handler flow but reshaped to `invalid_payload` at
    // the wire; Wave 10 closes the loop end-to-end.
    const r = handleBookmarksMove(
      { id: 1, newParentId: 999, newSortOrder: 0 },
      {
        repo: makeRepo({
          move: (): MoveBookmarkResult => ({ ok: false, error: 'invalid_parent' }),
        }),
      },
    );
    expectErr(r, 'invalid_parent');
  });

  it('repo throw -> db_unavailable', () => {
    const r = handleBookmarksMove(
      { id: 1, newParentId: null, newSortOrder: 0 },
      {
        repo: makeRepo({
          move: () => {
            throw new Error('boom');
          },
        }),
      },
    );
    expectErr(r, 'db_unavailable');
  });
});

describe('bookmarks:rename', () => {
  it('rejects empty title', () => {
    const r = handleBookmarksRename({ id: 1, title: '' }, { repo: makeRepo() });
    expectErr(r, 'invalid_payload');
  });

  it('rejects too-long title', () => {
    const r = handleBookmarksRename({ id: 1, title: 'x'.repeat(300) }, { repo: makeRepo() });
    expectErr(r, 'invalid_payload');
  });

  it('returns not_found when repo returns false', () => {
    const r = handleBookmarksRename(
      { id: 1, title: 'good' },
      { repo: makeRepo({ rename: () => false }) },
    );
    expectErr(r, 'not_found');
  });

  it('returns ok on success', () => {
    const r = handleBookmarksRename(
      { id: 1, title: 'good' },
      { repo: makeRepo({ rename: () => true }) },
    );
    expectOk(r);
  });

  it('repo throw -> db_unavailable', () => {
    const repo = makeRepo({
      rename: () => {
        throw new Error('boom');
      },
    });
    const r = handleBookmarksRename({ id: 1, title: 'x' }, { repo });
    expectErr(r, 'db_unavailable');
  });
});

// Wire up vi.mock-free test — we use a plain repo object instead of vi.fn
// because we don't need spy assertions here.
describe('bookmarks-phase2 — repo spying', () => {
  it('passes through fileHash', () => {
    const spy = vi.fn(() => [] as BookmarkNode[]);
    handleBookmarksListTree({ fileHash: HASH }, { repo: makeRepo({ listTree: spy }) });
    expect(spy).toHaveBeenCalledWith(HASH);
  });
});
