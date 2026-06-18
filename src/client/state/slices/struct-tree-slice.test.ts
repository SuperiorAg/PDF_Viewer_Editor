// Structure-tree slice tests — Phase 7.5 C3 (Riley Wave 5b).
// Covers reducer + tree-helper contract from
// `docs/accessibility-authoring-spec.md §1.1`.

import { describe, expect, it } from 'vitest';

import {
  findNode,
  findPath,
  insertChild,
  mapTree,
  removeNode,
  replaceSubtree,
  summarizeWarnings,
  type StructTreeNode,
} from '../../types/struct-tree-contract-stub';

import structTreeReducer, {
  acceptAutoTagPreview,
  addChild,
  appliedTree,
  autoTagPreviewReady,
  deleteNode,
  dismissAutoTagPreview,
  loadedTree,
  makeNode,
  moveNode,
  reorderSibling,
  replaceNode,
  resetStructTree,
  selectNode,
  selectSelectedStructNode,
  selectStructTreeDirty,
  selectStructTreeHasExistingTags,
  selectStructTreeRoot,
  selectStructTreeWarnings,
  setAddModalOpen,
  setAutoTagConfirmOpen,
  setStructTreeApplying,
  setStructTreeLastError,
  setStructTreeLoading,
} from './struct-tree-slice';

const INITIAL = structTreeReducer(undefined, { type: '@@INIT' });

function n(
  id: string,
  type: StructTreeNode['type'],
  children: StructTreeNode[] = [],
  altText?: string,
): StructTreeNode {
  return {
    id,
    type,
    contentRefs: [],
    children,
    ...(altText !== undefined ? { altText } : {}),
  };
}

function sampleTree(): StructTreeNode {
  return n('root', 'Document', [
    n('h1-1', 'H1', [n('p-1', 'P'), n('fig-1', 'Figure'), n('h2-1', 'H2', [n('p-2', 'P')])]),
    n('h1-2', 'H1'),
  ]);
}

describe('struct-tree slice — reducer contract', () => {
  it('initial state has no doc loaded', () => {
    expect(INITIAL.docHash).toBeNull();
    expect(INITIAL.currentRoot).toBeNull();
    expect(INITIAL.hasExistingTags).toBe(false);
    expect(INITIAL.dirty).toBe(false);
    expect(INITIAL.loading).toBe(false);
    expect(INITIAL.applying).toBe(false);
    expect(INITIAL.autoTagRunning).toBe(false);
    expect(INITIAL.autoTagPreview).toBeNull();
    expect(INITIAL.loaded).toBe(false);
    expect(INITIAL.lastErrorMessage).toBeNull();
  });

  it('loadedTree populates the tree and marks loaded', () => {
    const tree = sampleTree();
    const s = structTreeReducer(
      INITIAL,
      loadedTree({ docHash: 'h1', root: tree, hasExistingTags: true }),
    );
    expect(s.docHash).toBe('h1');
    expect(s.currentRoot).toBe(tree);
    expect(s.hasExistingTags).toBe(true);
    expect(s.loaded).toBe(true);
    expect(s.dirty).toBe(false);
  });

  it('hasExistingTags survives edits — load-bearing for save-as-copy', () => {
    const tree = sampleTree();
    let s = structTreeReducer(
      INITIAL,
      loadedTree({ docHash: 'h1', root: tree, hasExistingTags: true }),
    );
    const renamed = { ...n('h1-1', 'H1', []), title: 'renamed' };
    s = structTreeReducer(s, replaceNode({ id: 'h1-1', replacement: renamed }));
    expect(s.hasExistingTags).toBe(true);
    expect(s.dirty).toBe(true);
  });

  it('replaceNode swaps a subtree and marks dirty + reviewed', () => {
    const tree = sampleTree();
    let s = structTreeReducer(
      INITIAL,
      loadedTree({ docHash: 'h1', root: tree, hasExistingTags: false }),
    );
    const replacement = n('p-1', 'H3');
    s = structTreeReducer(s, replaceNode({ id: 'p-1', replacement }));
    expect(findNode(s.currentRoot!, 'p-1')?.type).toBe('H3');
    expect(s.dirty).toBe(true);
  });

  it('addChild inserts under a parent and selects it', () => {
    const tree = sampleTree();
    let s = structTreeReducer(
      INITIAL,
      loadedTree({ docHash: 'h1', root: tree, hasExistingTags: false }),
    );
    const child = makeNode({ id: 'new-1', type: 'P' });
    s = structTreeReducer(s, addChild({ parentId: 'h1-1', node: child }));
    expect(findNode(s.currentRoot!, 'new-1')?.type).toBe('P');
    expect(s.selectedNodeId).toBe('new-1');
    expect(s.dirty).toBe(true);
  });

  it('deleteNode removes a subtree but never the root', () => {
    const tree = sampleTree();
    let s = structTreeReducer(
      INITIAL,
      loadedTree({ docHash: 'h1', root: tree, hasExistingTags: false }),
    );
    s = structTreeReducer(s, deleteNode({ id: 'p-1' }));
    expect(findNode(s.currentRoot!, 'p-1')).toBeNull();
    expect(s.dirty).toBe(true);
    // try to delete root — no-op
    const before = s.currentRoot;
    s = structTreeReducer(s, deleteNode({ id: 'root' }));
    expect(s.currentRoot).toBe(before);
  });

  it('moveNode reparents and rejects self-parent / descendant-parent', () => {
    const tree = sampleTree();
    let s = structTreeReducer(
      INITIAL,
      loadedTree({ docHash: 'h1', root: tree, hasExistingTags: false }),
    );
    // Move p-1 under h1-2
    s = structTreeReducer(s, moveNode({ nodeId: 'p-1', newParentId: 'h1-2', newIndex: 0 }));
    expect(findNode(s.currentRoot!, 'h1-2')?.children[0]?.id).toBe('p-1');
    expect(findNode(findNode(s.currentRoot!, 'h1-1')!, 'p-1')).toBeNull();
    // Can't move a node into one of its descendants.
    const before = s.currentRoot;
    s = structTreeReducer(s, moveNode({ nodeId: 'h1-1', newParentId: 'h2-1', newIndex: 0 }));
    expect(s.currentRoot).toBe(before);
    // Can't move root.
    s = structTreeReducer(s, moveNode({ nodeId: 'root', newParentId: 'h1-2', newIndex: 0 }));
    expect(s.currentRoot).toBe(before);
  });

  it('reorderSibling moves a child up or down', () => {
    const tree = sampleTree();
    let s = structTreeReducer(
      INITIAL,
      loadedTree({ docHash: 'h1', root: tree, hasExistingTags: false }),
    );
    s = structTreeReducer(s, reorderSibling({ nodeId: 'fig-1', direction: 'up' }));
    expect(findNode(s.currentRoot!, 'h1-1')?.children.map((c) => c.id)).toEqual([
      'fig-1',
      'p-1',
      'h2-1',
    ]);
    // edge: move at start is a no-op
    const before = s.currentRoot;
    s = structTreeReducer(s, reorderSibling({ nodeId: 'fig-1', direction: 'up' }));
    expect(s.currentRoot).toBe(before);
  });

  it('appliedTree clears dirty + preview', () => {
    let s = structTreeReducer(
      INITIAL,
      loadedTree({ docHash: 'h1', root: sampleTree(), hasExistingTags: false }),
    );
    s = structTreeReducer(s, replaceNode({ id: 'p-1', replacement: n('p-1', 'H4') }));
    expect(s.dirty).toBe(true);
    s = structTreeReducer(s, appliedTree());
    expect(s.dirty).toBe(false);
    expect(s.autoTagPreview).toBeNull();
  });

  it('autoTagPreviewReady + acceptAutoTagPreview promotes proposed tree', () => {
    const proposed = sampleTree();
    let s = structTreeReducer(
      INITIAL,
      loadedTree({ docHash: 'h1', root: null, hasExistingTags: false }),
    );
    s = structTreeReducer(s, setAutoTagConfirmOpen(true));
    expect(s.autoTagConfirmOpen).toBe(true);
    s = structTreeReducer(
      s,
      autoTagPreviewReady({ proposedRoot: proposed, warnings: ['p14 alone'] }),
    );
    expect(s.autoTagPreview).toBe(proposed);
    expect(s.autoTagWarnings).toEqual(['p14 alone']);
    expect(s.autoTagConfirmOpen).toBe(false);
    s = structTreeReducer(s, acceptAutoTagPreview());
    expect(s.currentRoot).toBe(proposed);
    expect(s.dirty).toBe(true);
    expect(s.autoTagPreview).toBeNull();
  });

  it('dismissAutoTagPreview discards the proposal', () => {
    let s = structTreeReducer(
      INITIAL,
      loadedTree({ docHash: 'h1', root: sampleTree(), hasExistingTags: false }),
    );
    s = structTreeReducer(s, autoTagPreviewReady({ proposedRoot: sampleTree(), warnings: [] }));
    s = structTreeReducer(s, dismissAutoTagPreview());
    expect(s.autoTagPreview).toBeNull();
    expect(s.autoTagWarnings).toEqual([]);
  });

  it('setStructTreeLastError clears running flags', () => {
    let s = structTreeReducer(INITIAL, setStructTreeLoading(true));
    s = structTreeReducer(s, setStructTreeLastError('boom'));
    expect(s.loading).toBe(false);
    expect(s.lastErrorMessage).toBe('boom');
  });

  it('setStructTreeApplying flips applying and clears prior error', () => {
    let s = structTreeReducer(INITIAL, setStructTreeLastError('prev'));
    s = structTreeReducer(s, setStructTreeApplying(true));
    expect(s.applying).toBe(true);
    expect(s.lastErrorMessage).toBeNull();
  });

  it('resetStructTree returns to initial', () => {
    let s = structTreeReducer(
      INITIAL,
      loadedTree({ docHash: 'h1', root: sampleTree(), hasExistingTags: true }),
    );
    s = structTreeReducer(s, resetStructTree());
    expect(s).toEqual(INITIAL);
  });

  it('selectNode + add modal toggles', () => {
    let s = structTreeReducer(INITIAL, selectNode('x'));
    expect(s.selectedNodeId).toBe('x');
    s = structTreeReducer(s, setAddModalOpen(true));
    expect(s.addModalOpen).toBe(true);
    s = structTreeReducer(s, setAddModalOpen(false));
    expect(s.addModalOpen).toBe(false);
  });
});

describe('struct-tree slice — selectors', () => {
  it('selectStructTreeRoot / hasExistingTags / dirty / warnings', () => {
    const s = structTreeReducer(
      INITIAL,
      loadedTree({ docHash: 'h1', root: sampleTree(), hasExistingTags: true }),
    );
    expect(selectStructTreeRoot({ structTree: s })).toBe(s.currentRoot);
    expect(selectStructTreeHasExistingTags({ structTree: s })).toBe(true);
    expect(selectStructTreeDirty({ structTree: s })).toBe(false);
    // Warning: fig-1 has no alt; H2 directly under H1 = no jump (level diff
    // is 1). Adding a Figure with no altText -> 1.
    const w = selectStructTreeWarnings({ structTree: s });
    expect(w.figuresMissingAlt).toBe(1);
    expect(w.headingNestingJumps).toBe(0);
  });

  it('selectSelectedStructNode resolves selected id against current tree', () => {
    let s = structTreeReducer(
      INITIAL,
      loadedTree({ docHash: 'h1', root: sampleTree(), hasExistingTags: false }),
    );
    s = structTreeReducer(s, selectNode('p-2'));
    expect(selectSelectedStructNode({ structTree: s })?.id).toBe('p-2');
  });

  it('summarizeWarnings detects H1 → H3 jump', () => {
    const tree = n('root', 'Document', [n('h1', 'H1', [n('h3', 'H3')])]);
    const w = summarizeWarnings(tree);
    expect(w.headingNestingJumps).toBe(1);
  });
});

describe('struct-tree helpers — pure functions', () => {
  it('mapTree returns same ref when no mutation', () => {
    const tree = sampleTree();
    const out = mapTree(tree, (n_) => n_);
    expect(out).toBe(tree);
  });

  it('mapTree drops nodes returning null', () => {
    const tree = sampleTree();
    const out = mapTree(tree, (node) => (node.id === 'fig-1' ? null : node));
    expect(out).not.toBe(tree);
    expect(findNode(out!, 'fig-1')).toBeNull();
  });

  it('findPath walks down to id and returns ancestor chain', () => {
    const tree = sampleTree();
    const path = findPath(tree, 'p-2');
    expect(path?.map((p) => p.id)).toEqual(['root', 'h1-1', 'h2-1']);
  });

  it('insertChild clamps index', () => {
    const tree = sampleTree();
    const child = makeNode({ id: 'x', type: 'P' });
    const out = insertChild(tree, 'h1-2', child, 999);
    expect(findNode(out, 'h1-2')?.children[0]?.id).toBe('x');
  });

  it('replaceSubtree returns same ref for missing id', () => {
    const tree = sampleTree();
    const out = replaceSubtree(tree, 'no-such-id', n('y', 'P'));
    expect(out).toBe(tree);
  });

  it('removeNode returns same ref for missing id', () => {
    const tree = sampleTree();
    const out = removeNode(tree, 'no-such-id');
    expect(out).toBe(tree);
  });
});
