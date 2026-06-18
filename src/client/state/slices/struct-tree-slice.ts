// Structure-tree slice — Phase 7.5 C3 Tag PDF editor (Riley Wave 5b).
//
// Drives the Tag PDF sidebar panel. State owns:
//   - currentRoot: the live tree the user sees (null while loading or when
//     the doc has no /StructTreeRoot)
//   - hasExistingTags: survives across edits, drives the save-as-copy
//     disclosure in the panel header (P7.5-L-5 / R12)
//   - dirty: tracks whether the in-memory tree differs from what David's
//     side-table currently holds — Apply button gates on this
//   - selectedNodeId: row selection for the inspector pane
//   - autoTagConfirmOpen: gates the "Auto-tagging is a HEURISTIC" modal
//   - autoTagPreview: heuristic output the user reviews before Apply
//   - reviewedNodeIds: node ids the user has touched after an auto-tag
//     preview (yellow border drops once a node is reviewed)
//   - warnings: engine-emitted heuristic warnings (e.g. "Page 14: single font
//     size — no headings detected")
//   - loading / applying / autoTagRunning flags
//   - lastErrorMessage: honest engine error surface (never null-default).
//
// Pure reducer + small helpers. The async dispatchers live in
// `state/thunks-phase7-5-wave5b.ts`. Selectors at the bottom.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  DEFAULT_NEW_CHILD_TYPE,
  findNode,
  insertChild,
  mapTree,
  removeNode,
  replaceSubtree,
  summarizeWarnings,
  type StructTreeNode,
  type StructTreeNodeType,
  type TreeWarnings,
} from '../../types/struct-tree-contract-stub';

/** Build a new, empty node. ids are generated as short slugs that are
 *  deterministic enough for tests via an injection point. */
export function makeNode(opts: {
  id?: string;
  type?: StructTreeNodeType;
  title?: string;
}): StructTreeNode {
  const id = opts.id ?? `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    type: opts.type ?? DEFAULT_NEW_CHILD_TYPE,
    contentRefs: [],
    children: [],
    ...(opts.title !== undefined ? { title: opts.title } : {}),
  };
}

export interface StructTreeState {
  /** Active document hash the tree belongs to; null when no doc loaded. */
  docHash: string | null;
  /** The live tree. null = loading OR doc has no /StructTreeRoot. */
  currentRoot: StructTreeNode | null;
  /** Drives save-as-copy disclosure + Save dispatcher branch. */
  hasExistingTags: boolean;
  /** Tracks divergence from David's side-table. Apply gates on this. */
  dirty: boolean;
  /** Sidebar inspector pane selection. */
  selectedNodeId: string | null;
  /** Tag-add modal open state (the "+" button trigger). */
  addModalOpen: boolean;
  /** Auto-tag confirm modal open state ("Auto-tagging is a HEURISTIC"). */
  autoTagConfirmOpen: boolean;
  /** Heuristic-preview tree the user reviews before applying. */
  autoTagPreview: StructTreeNode | null;
  /** Engine warnings (read-only; cleared on next auto-tag). */
  autoTagWarnings: string[];
  /** Node ids the user has touched in the preview — review-mark drops. */
  reviewedNodeIds: Record<string, true>;
  loading: boolean;
  applying: boolean;
  autoTagRunning: boolean;
  /** Set when getStructTree / setStructTree / autoTagPages reports failure. */
  lastErrorMessage: string | null;
  /** True once getStructTree has run for the current doc — drives the
   *  "open a document" empty state vs the "no tags detected" empty state. */
  loaded: boolean;
}

const initialState: StructTreeState = {
  docHash: null,
  currentRoot: null,
  hasExistingTags: false,
  dirty: false,
  selectedNodeId: null,
  addModalOpen: false,
  autoTagConfirmOpen: false,
  autoTagPreview: null,
  autoTagWarnings: [],
  reviewedNodeIds: {},
  loading: false,
  applying: false,
  autoTagRunning: false,
  lastErrorMessage: null,
  loaded: false,
};

export const structTreeSlice = createSlice({
  name: 'structTree',
  initialState,
  reducers: {
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
      if (action.payload) state.lastErrorMessage = null;
    },
    setApplying(state, action: PayloadAction<boolean>) {
      state.applying = action.payload;
      if (action.payload) state.lastErrorMessage = null;
    },
    setAutoTagRunning(state, action: PayloadAction<boolean>) {
      state.autoTagRunning = action.payload;
      if (action.payload) state.lastErrorMessage = null;
    },
    setLastError(state, action: PayloadAction<string>) {
      state.lastErrorMessage = action.payload;
      state.loading = false;
      state.applying = false;
      state.autoTagRunning = false;
    },
    /** Engine returned a fresh load — clears dirty + clears preview. */
    loadedTree(
      state,
      action: PayloadAction<{
        docHash: string;
        root: StructTreeNode | null;
        hasExistingTags: boolean;
      }>,
    ) {
      state.docHash = action.payload.docHash;
      state.currentRoot = action.payload.root;
      state.hasExistingTags = action.payload.hasExistingTags;
      state.dirty = false;
      state.loading = false;
      state.loaded = true;
      state.lastErrorMessage = null;
      state.autoTagPreview = null;
      state.autoTagWarnings = [];
      state.reviewedNodeIds = {};
      // Keep selectedNodeId only if it still resolves in the new tree.
      if (state.selectedNodeId !== null && action.payload.root !== null) {
        if (findNode(action.payload.root, state.selectedNodeId) === null) {
          state.selectedNodeId = null;
        }
      } else {
        state.selectedNodeId = null;
      }
    },
    /** setStructTree returned ok — clear dirty + dismiss any preview. */
    appliedTree(state) {
      state.applying = false;
      state.dirty = false;
      state.autoTagPreview = null;
      state.autoTagWarnings = [];
      state.reviewedNodeIds = {};
    },
    /** Inspector-pane selection. */
    selectNode(state, action: PayloadAction<string | null>) {
      state.selectedNodeId = action.payload;
    },
    /** Replace a subtree (rename / re-type / set altText / etc.). */
    replaceNode(state, action: PayloadAction<{ id: string; replacement: StructTreeNode }>) {
      if (state.currentRoot === null) return;
      const next = replaceSubtree(state.currentRoot, action.payload.id, action.payload.replacement);
      if (next === state.currentRoot) return;
      state.currentRoot = next;
      state.dirty = true;
      state.reviewedNodeIds[action.payload.id] = true;
    },
    /** Add a new child node under the parent id. */
    addChild(
      state,
      action: PayloadAction<{
        parentId: string;
        node: StructTreeNode;
        index?: number;
      }>,
    ) {
      if (state.currentRoot === null) return;
      const idx = action.payload.index;
      const parent = findNode(state.currentRoot, action.payload.parentId);
      if (parent === null) return;
      const resolvedIndex = idx ?? parent.children.length;
      const next = insertChild(
        state.currentRoot,
        action.payload.parentId,
        action.payload.node,
        resolvedIndex,
      );
      if (next === state.currentRoot) return;
      state.currentRoot = next;
      state.dirty = true;
      state.selectedNodeId = action.payload.node.id;
      state.reviewedNodeIds[action.payload.parentId] = true;
      state.reviewedNodeIds[action.payload.node.id] = true;
    },
    /** Delete a node (and descendants). The root itself is undeletable. */
    deleteNode(state, action: PayloadAction<{ id: string }>) {
      if (state.currentRoot === null) return;
      if (state.currentRoot.id === action.payload.id) return;
      const next = removeNode(state.currentRoot, action.payload.id);
      if (next === state.currentRoot) return;
      state.currentRoot = next;
      state.dirty = true;
      if (state.selectedNodeId === action.payload.id) state.selectedNodeId = null;
      delete state.reviewedNodeIds[action.payload.id];
    },
    /** Move a subtree to a new parent at the given index. The renderer's
     *  drag-and-drop dispatches this; the reducer rejects no-op moves
     *  (same parent + adjacent index) so React reconciliation doesn't
     *  thrash on the picked-up node. */
    moveNode(
      state,
      action: PayloadAction<{ nodeId: string; newParentId: string; newIndex: number }>,
    ) {
      if (state.currentRoot === null) return;
      const { nodeId, newParentId, newIndex } = action.payload;
      if (nodeId === newParentId) return; // can't parent yourself
      if (state.currentRoot.id === nodeId) return; // can't move the root
      const subtree = findNode(state.currentRoot, nodeId);
      if (subtree === null) return;
      const newParent = findNode(state.currentRoot, newParentId);
      if (newParent === null) return;
      // Prevent moving a node into its own descendant — that would orphan
      // the rest of the tree.
      if (findNode(subtree, newParentId) !== null) return;
      // Remove first, then insert. Use the helpers so we get fresh refs
      // and structural sharing on unchanged branches.
      const withoutNode = removeNode(state.currentRoot, nodeId);
      const newRoot = insertChild(withoutNode, newParentId, subtree, newIndex);
      if (newRoot === state.currentRoot) return;
      state.currentRoot = newRoot;
      state.dirty = true;
      state.reviewedNodeIds[nodeId] = true;
      state.reviewedNodeIds[newParentId] = true;
    },
    /** "Move up" / "Move down" sibling reorder by 1. */
    reorderSibling(state, action: PayloadAction<{ nodeId: string; direction: 'up' | 'down' }>) {
      if (state.currentRoot === null) return;
      const targetId = action.payload.nodeId;
      const delta = action.payload.direction === 'up' ? -1 : 1;
      // Walk the tree to find the parent that holds this child.
      function reorderInParent(parent: StructTreeNode): StructTreeNode | null {
        const idx = parent.children.findIndex((c) => c.id === targetId);
        if (idx === -1) {
          let changed = false;
          const newChildren = parent.children.map((c) => {
            const next = reorderInParent(c);
            if (next === null) return c;
            changed = true;
            return next;
          });
          if (!changed) return null;
          return { ...parent, children: newChildren };
        }
        const newIdx = idx + delta;
        if (newIdx < 0 || newIdx >= parent.children.length) return null;
        const next = [...parent.children];
        const [picked] = next.splice(idx, 1);
        if (picked === undefined) return null;
        next.splice(newIdx, 0, picked);
        return { ...parent, children: next };
      }
      const newRoot = reorderInParent(state.currentRoot);
      if (newRoot === null) return;
      state.currentRoot = newRoot;
      state.dirty = true;
      state.reviewedNodeIds[targetId] = true;
    },
    setAddModalOpen(state, action: PayloadAction<boolean>) {
      state.addModalOpen = action.payload;
    },
    setAutoTagConfirmOpen(state, action: PayloadAction<boolean>) {
      state.autoTagConfirmOpen = action.payload;
    },
    autoTagPreviewReady(
      state,
      action: PayloadAction<{ proposedRoot: StructTreeNode; warnings: string[] }>,
    ) {
      state.autoTagPreview = action.payload.proposedRoot;
      state.autoTagWarnings = action.payload.warnings;
      state.autoTagRunning = false;
      state.reviewedNodeIds = {};
      state.autoTagConfirmOpen = false;
    },
    /** User confirms the preview — promote it into currentRoot. */
    acceptAutoTagPreview(state) {
      if (state.autoTagPreview === null) return;
      state.currentRoot = state.autoTagPreview;
      state.autoTagPreview = null;
      state.dirty = true;
      // Warnings stick around until the user touches the tree again.
      state.selectedNodeId = state.currentRoot.id;
    },
    /** User rejects the preview — drop it; current tree (if any) survives. */
    dismissAutoTagPreview(state) {
      state.autoTagPreview = null;
      state.autoTagWarnings = [];
      state.reviewedNodeIds = {};
    },
    /** Reset on document close. Caller dispatches on close. */
    resetStructTree() {
      return initialState;
    },
  },
});

export const {
  setLoading: setStructTreeLoading,
  setApplying: setStructTreeApplying,
  setAutoTagRunning,
  setLastError: setStructTreeLastError,
  loadedTree,
  appliedTree,
  selectNode,
  replaceNode,
  addChild,
  deleteNode,
  moveNode,
  reorderSibling,
  setAddModalOpen,
  setAutoTagConfirmOpen,
  autoTagPreviewReady,
  acceptAutoTagPreview,
  dismissAutoTagPreview,
  resetStructTree,
} = structTreeSlice.actions;

export default structTreeSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors — composed inside the panel via useAppSelector.
// ---------------------------------------------------------------------------

export function selectStructTreeRoot(state: {
  structTree: StructTreeState;
}): StructTreeNode | null {
  return state.structTree.currentRoot;
}

export function selectStructTreeHasExistingTags(state: { structTree: StructTreeState }): boolean {
  return state.structTree.hasExistingTags;
}

export function selectStructTreeDirty(state: { structTree: StructTreeState }): boolean {
  return state.structTree.dirty;
}

// Memoize by the currentRoot reference: as long as `currentRoot` is the same
// reference, return the same TreeWarnings object. This satisfies React-Redux's
// stable-identity contract for derived selectors without pulling in
// createSelector for a single one-shot computation.
const EMPTY_WARNINGS: TreeWarnings = Object.freeze({
  figuresMissingAlt: 0,
  headingNestingJumps: 0,
}) as TreeWarnings;
let lastWarningRoot: StructTreeNode | null = null;
let lastWarningResult: TreeWarnings = EMPTY_WARNINGS;
export function selectStructTreeWarnings(state: { structTree: StructTreeState }): TreeWarnings {
  const root = state.structTree.currentRoot;
  if (root === null) return EMPTY_WARNINGS;
  if (root === lastWarningRoot) return lastWarningResult;
  lastWarningRoot = root;
  lastWarningResult = summarizeWarnings(root);
  return lastWarningResult;
}

export function selectSelectedStructNode(state: {
  structTree: StructTreeState;
}): StructTreeNode | null {
  const id = state.structTree.selectedNodeId;
  const root = state.structTree.currentRoot;
  if (id === null || root === null) return null;
  return findNode(root, id);
}

/** Returns true when the node id has NOT yet been reviewed AND an
 *  auto-tag preview is active. Drives the yellow "unreviewed" border. */
export function selectIsUnreviewed(state: { structTree: StructTreeState }, id: string): boolean {
  // The unreviewed glow only applies when an auto-tag preview is being
  // shown. Outside of that the user is working on existing tags they
  // already author.
  if (
    state.structTree.autoTagPreview === null &&
    Object.keys(state.structTree.reviewedNodeIds).length === 0
  ) {
    return false;
  }
  return state.structTree.reviewedNodeIds[id] !== true;
}

// Exported for the panel to apply mapTree without re-importing.
export { mapTree };
