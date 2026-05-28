// Bookmarks slice — Phase 2 rewrite for full CRUD + nested tree authoring.
// Per data-models.md §7.3 + §7.4 + §7.5 + ui-spec.md §11.6.
//
// Data shape: the renderer mirrors David/Ravi's tree shape (BookmarkNode) from
// the server. The tree is recomputed in the reducer on every bookmark
// add/move/rename/delete to avoid a separate "flat list of nodes" derived
// store. Tree depth is bounded in practice (<10 levels); the flatten cost is
// trivial.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { type BookmarkNode, type BookmarkRow, type OutlineNode } from '../../types/ipc-contract';

interface BookmarksState {
  /** Hierarchical tree (Phase 2). Server-canonical via bookmarks:listTree. */
  tree: BookmarkNode[];
  /** Flat list, retained for Phase 1 compatibility + the user-bookmarks selector
   *  that legacy components still consume. Derived from the tree. */
  userBookmarks: BookmarkRow[];
  /** Native PDF outline — read-only italic display at top of panel. */
  pdfOutline: OutlineNode[];
  loaded: boolean;
  /** Tree expansion state: nodeId -> expanded? Phase 2 default-expanded for top
   * two levels. */
  expandedIds: Record<number, boolean>;
}

const initialState: BookmarksState = {
  tree: [],
  userBookmarks: [],
  pdfOutline: [],
  loaded: false,
  expandedIds: {},
};

// =============================================================================
// Helpers (pure, exported for tests)
// =============================================================================

export function flattenTree(tree: BookmarkNode[]): BookmarkRow[] {
  const out: BookmarkRow[] = [];
  const walk = (nodes: BookmarkNode[]): void => {
    for (const n of nodes) {
      out.push({
        id: n.id,
        fileHash: n.fileHash,
        pageIndex: n.pageIndex,
        title: n.title,
        createdAt: n.createdAt,
      });
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export function findNodeById(
  tree: BookmarkNode[],
  id: number,
): { node: BookmarkNode; parent: BookmarkNode | null } | null {
  for (const n of tree) {
    if (n.id === id) return { node: n, parent: null };
  }
  // BFS through children with their parent tracked.
  const queue: Array<{ node: BookmarkNode; parent: BookmarkNode }> = [];
  for (const n of tree) {
    for (const c of n.children) queue.push({ node: c, parent: n });
  }
  while (queue.length > 0) {
    const { node, parent } = queue.shift()!;
    if (node.id === id) return { node, parent };
    for (const c of node.children) queue.push({ node: c, parent: node });
  }
  return null;
}

/** Cycle-detection: returns true if `candidateAncestor` is a descendant of
 *  `id` (so making id's new parent = candidateAncestor would create a loop). */
export function wouldCreateCycle(
  tree: BookmarkNode[],
  movingId: number,
  newParentId: number | null,
): boolean {
  if (newParentId === null) return false;
  if (movingId === newParentId) return true;
  const found = findNodeById(tree, movingId);
  if (!found) return false;
  // Collect all descendants of movingId.
  const descendants: Set<number> = new Set();
  const walk = (nodes: BookmarkNode[]): void => {
    for (const n of nodes) {
      descendants.add(n.id);
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(found.node.children);
  return descendants.has(newParentId);
}

function removeFromTree(tree: BookmarkNode[], id: number): BookmarkNode | null {
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i];
    if (node === undefined) continue;
    if (node.id === id) {
      tree.splice(i, 1);
      return node;
    }
    const removed = removeFromTree(node.children, id);
    if (removed) return removed;
  }
  return null;
}

function insertIntoTree(
  tree: BookmarkNode[],
  node: BookmarkNode,
  newParentId: number | null,
  newSortOrder: number,
): void {
  if (newParentId === null) {
    const idx = Math.max(0, Math.min(newSortOrder, tree.length));
    tree.splice(idx, 0, node);
    return;
  }
  const found = findNodeById(tree, newParentId);
  if (!found) {
    // Parent vanished — fall back to root.
    tree.push(node);
    return;
  }
  const idx = Math.max(0, Math.min(newSortOrder, found.node.children.length));
  found.node.children.splice(idx, 0, node);
}

function sortSiblings(tree: BookmarkNode[]): void {
  tree.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const n of tree) sortSiblings(n.children);
}

// =============================================================================
// Slice
// =============================================================================

export const bookmarksSlice = createSlice({
  name: 'bookmarks',
  initialState,
  reducers: {
    /** Replace the entire user-bookmark set (called after bookmarks:listTree). */
    setBookmarksTree(state, action: PayloadAction<BookmarkNode[]>) {
      state.tree = action.payload;
      sortSiblings(state.tree);
      state.userBookmarks = flattenTree(state.tree);
      state.loaded = true;
    },
    /** Phase 1 compatibility: replace flat user-bookmarks list. */
    setUserBookmarks(state, action: PayloadAction<BookmarkRow[]>) {
      state.userBookmarks = action.payload;
      // Reconstruct a flat-root tree from the rows (Phase 1 server had no
      // parent_id). Sibling order = original array order.
      state.tree = action.payload.map((r, i) => ({
        ...r,
        parentId: null,
        sortOrder: i,
        children: [],
      }));
      state.loaded = true;
    },
    setPdfOutline(state, action: PayloadAction<OutlineNode[]>) {
      state.pdfOutline = action.payload;
    },
    /** Phase 1: simple top-level add (no parent). */
    addUserBookmark(state, action: PayloadAction<BookmarkRow>) {
      state.userBookmarks.push(action.payload);
      state.tree.push({
        ...action.payload,
        parentId: null,
        sortOrder: state.tree.length,
        children: [],
      });
    },
    /** Phase 2: add with optional parent + sortOrder. */
    addBookmarkNode(state, action: PayloadAction<BookmarkNode>) {
      const node = { ...action.payload, children: action.payload.children ?? [] };
      insertIntoTree(state.tree, node, node.parentId, node.sortOrder);
      sortSiblings(state.tree);
      state.userBookmarks = flattenTree(state.tree);
    },
    /** Phase 2: rename. */
    renameBookmark(state, action: PayloadAction<{ id: number; title: string }>) {
      const found = findNodeById(state.tree, action.payload.id);
      if (!found) return;
      found.node.title = action.payload.title;
      state.userBookmarks = flattenTree(state.tree);
    },
    /** Phase 2: move within or across parents. The reducer enforces cycle
     *  detection; if the move would create a loop, it's a no-op. */
    moveBookmark(
      state,
      action: PayloadAction<{ id: number; newParentId: number | null; newSortOrder: number }>,
    ) {
      const { id, newParentId, newSortOrder } = action.payload;
      if (wouldCreateCycle(state.tree, id, newParentId)) return;
      const removed = removeFromTree(state.tree, id);
      if (!removed) return;
      removed.parentId = newParentId;
      removed.sortOrder = newSortOrder;
      insertIntoTree(state.tree, removed, newParentId, newSortOrder);
      // Re-number siblings at the destination to compact sortOrders.
      const renumber = (siblings: BookmarkNode[]): void => {
        siblings.forEach((n, i) => {
          n.sortOrder = i;
        });
      };
      if (newParentId === null) {
        renumber(state.tree);
      } else {
        const parent = findNodeById(state.tree, newParentId);
        if (parent) renumber(parent.node.children);
      }
      sortSiblings(state.tree);
      state.userBookmarks = flattenTree(state.tree);
    },
    /** Phase 2: delete + cascade (server-side enforces SQL ON DELETE CASCADE;
     *  renderer mirrors). */
    deleteBookmark(state, action: PayloadAction<number>) {
      removeFromTree(state.tree, action.payload);
      state.userBookmarks = flattenTree(state.tree);
    },
    /** Phase 1 compat: delete by id (alias for deleteBookmark). */
    removeUserBookmark(state, action: PayloadAction<number>) {
      removeFromTree(state.tree, action.payload);
      state.userBookmarks = flattenTree(state.tree);
    },
    /** Phase 2: tree expansion toggle (pure UI state, kept in this slice so
     *  the panel can derive it via a single selector). */
    toggleExpanded(state, action: PayloadAction<number>) {
      state.expandedIds[action.payload] = !state.expandedIds[action.payload];
    },
    setExpanded(state, action: PayloadAction<{ id: number; expanded: boolean }>) {
      state.expandedIds[action.payload.id] = action.payload.expanded;
    },
    clearBookmarks(state) {
      state.tree = [];
      state.userBookmarks = [];
      state.pdfOutline = [];
      state.loaded = false;
      state.expandedIds = {};
    },
  },
});

export const {
  setBookmarksTree,
  setUserBookmarks,
  setPdfOutline,
  addUserBookmark,
  addBookmarkNode,
  renameBookmark,
  moveBookmark,
  deleteBookmark,
  removeUserBookmark,
  toggleExpanded,
  setExpanded,
  clearBookmarks,
} = bookmarksSlice.actions;
export default bookmarksSlice.reducer;
