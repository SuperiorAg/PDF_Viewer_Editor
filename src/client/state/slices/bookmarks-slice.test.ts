// Bookmarks slice — Vitest spec. Phase 2 / Wave 7.
//
// Asserts the tree CRUD reducers + cycle detection helpers.

import { describe, expect, it } from 'vitest';

import { type BookmarkNode } from '../../types/ipc-contract';

import {
  addBookmarkNode,
  bookmarksSlice,
  clearBookmarks,
  deleteBookmark,
  flattenTree,
  moveBookmark,
  renameBookmark,
  setBookmarksTree,
  wouldCreateCycle,
} from './bookmarks-slice';

function node(
  id: number,
  title: string,
  parentId: number | null,
  sortOrder: number,
  children: BookmarkNode[] = [],
): BookmarkNode {
  return {
    id,
    fileHash: 'a'.repeat(64),
    pageIndex: 0,
    title,
    createdAt: 0,
    parentId,
    sortOrder,
    children,
  };
}

const reducer = bookmarksSlice.reducer;

describe('bookmarks-slice — Phase 2 tree CRUD', () => {
  it('setBookmarksTree replaces the tree and flattens for back-compat', () => {
    const state = reducer(
      undefined,
      setBookmarksTree([
        node(1, 'Root', null, 0, [node(2, 'Child', 1, 0)]),
        node(3, 'Sibling', null, 1),
      ]),
    );
    expect(state.tree.length).toBe(2);
    expect(state.tree[0]?.children.length).toBe(1);
    expect(state.userBookmarks.length).toBe(3);
    expect(state.loaded).toBe(true);
  });

  it('addBookmarkNode inserts at top-level when parentId is null', () => {
    const initial = reducer(undefined, setBookmarksTree([]));
    const after = reducer(initial, addBookmarkNode(node(10, 'Hello', null, 0)));
    expect(after.tree.length).toBe(1);
    expect(after.tree[0]?.title).toBe('Hello');
  });

  it('addBookmarkNode inserts as child when parentId matches a node', () => {
    const initial = reducer(undefined, setBookmarksTree([node(1, 'Root', null, 0)]));
    const after = reducer(initial, addBookmarkNode(node(2, 'Child', 1, 0)));
    expect(after.tree[0]?.children.length).toBe(1);
    expect(after.tree[0]?.children[0]?.title).toBe('Child');
  });

  it('renameBookmark updates title for the node', () => {
    const initial = reducer(undefined, setBookmarksTree([node(1, 'Old', null, 0)]));
    const after = reducer(initial, renameBookmark({ id: 1, title: 'New' }));
    expect(after.tree[0]?.title).toBe('New');
  });

  it('deleteBookmark removes the node and its subtree', () => {
    const initial = reducer(
      undefined,
      setBookmarksTree([node(1, 'Root', null, 0, [node(2, 'Child', 1, 0)])]),
    );
    const after = reducer(initial, deleteBookmark(1));
    expect(after.tree.length).toBe(0);
    expect(after.userBookmarks.length).toBe(0);
  });

  it('moveBookmark re-parents to a new parent', () => {
    const initial = reducer(
      undefined,
      setBookmarksTree([node(1, 'A', null, 0), node(2, 'B', null, 1)]),
    );
    const after = reducer(initial, moveBookmark({ id: 1, newParentId: 2, newSortOrder: 0 }));
    expect(after.tree.length).toBe(1);
    expect(after.tree[0]?.id).toBe(2);
    expect(after.tree[0]?.children[0]?.id).toBe(1);
  });

  it('moveBookmark rejects cycle creation (parent into descendant)', () => {
    // Root (1) -> Child (2). Try to move 1 under 2 (would create cycle).
    const initial = reducer(
      undefined,
      setBookmarksTree([node(1, 'Root', null, 0, [node(2, 'Child', 1, 0)])]),
    );
    const after = reducer(initial, moveBookmark({ id: 1, newParentId: 2, newSortOrder: 0 }));
    // Tree should be unchanged.
    expect(after.tree[0]?.id).toBe(1);
    expect(after.tree[0]?.children[0]?.id).toBe(2);
  });

  it('clearBookmarks resets state', () => {
    const initial = reducer(undefined, setBookmarksTree([node(1, 'A', null, 0)]));
    const after = reducer(initial, clearBookmarks());
    expect(after.tree.length).toBe(0);
    expect(after.userBookmarks.length).toBe(0);
    expect(after.loaded).toBe(false);
  });
});

describe('bookmarks-slice — helpers', () => {
  it('flattenTree DFS-orders nodes', () => {
    const tree: BookmarkNode[] = [
      node(1, 'Root', null, 0, [node(2, 'Child', 1, 0, [node(3, 'Grand', 2, 0)])]),
      node(4, 'Sibling', null, 1),
    ];
    const flat = flattenTree(tree);
    expect(flat.map((b) => b.id)).toEqual([1, 2, 3, 4]);
  });

  it('wouldCreateCycle detects self-parent', () => {
    const tree = [node(1, 'A', null, 0)];
    expect(wouldCreateCycle(tree, 1, 1)).toBe(true);
  });

  it('wouldCreateCycle detects descendant-as-new-parent', () => {
    const tree = [node(1, 'A', null, 0, [node(2, 'B', 1, 0)])];
    expect(wouldCreateCycle(tree, 1, 2)).toBe(true);
  });

  it('wouldCreateCycle returns false for non-descendant moves', () => {
    const tree = [node(1, 'A', null, 0), node(2, 'B', null, 1)];
    expect(wouldCreateCycle(tree, 1, 2)).toBe(false);
  });

  it('wouldCreateCycle returns false for null (top-level)', () => {
    const tree = [node(1, 'A', null, 0, [node(2, 'B', 1, 0)])];
    expect(wouldCreateCycle(tree, 2, null)).toBe(false);
  });
});
