// Structure-tree contract stub — Phase 7.5 C3 (Riley Wave 5b).
//
// David's parallel Wave 5b commit lands `pdf:getStructTree`,
// `pdf:setStructTree`, and `pdf:autoTagPages` in `src/ipc/contracts.ts`.
// Until those types are re-exported through the renderer gatekeeper
// (`./ipc-contract`), the renderer types the surface LOCALLY here against
// the EXACT shape in `docs/api-contracts.md §19.7` +
// `docs/accessibility-authoring-spec.md §1.1`. When David's commit lands and
// `./ipc-contract` re-exports the canonical types, this file becomes a thin
// re-export wrapper (same promotion path the Wave 5 stubs followed:
// `links-contract-stub.ts`, `sanitize-contract-stub.ts`,
// `preflight-contract-stub.ts`, `tts-contract-stub.ts`).
//
// HONESTY CLAUSE: the `hasExistingTags` field is load-bearing for the
// save-as-copy-by-default disclosure (P7.5-L-5, R12 mitigation). The
// Tag-PDF panel surfaces a permanent, non-dismissible disclosure in its
// header whenever this field is true on the loaded tree:
// "Save-as-copy by default when an existing /StructTreeRoot is detected"
// — see `docs/ui-spec-phase-7.5.md §24.2` and
// `docs/accessibility-authoring-spec.md §1.4`.
//
// No `as any` here — the runtime feature-detect lives in
// `state/thunks-phase7-5-wave5b.ts` and uses `window.pdfApi` narrowing,
// mirroring the Wave 5a tts/preflight pattern.

import type { DocumentHandle } from './ipc-contract';

/** Marked-content reference — a single mcid+page pair OR an object-number
 *  reference into a page's content stream. Matches
 *  accessibility-authoring-spec.md §1.1.
 *  Forward-compat: discriminated union; renderer only consumes 'mcid' for
 *  rendering / the auto-tag heuristic round-trip in v0.8.0. */
export type MarkedContentRef =
  | { kind: 'mcid'; pageIndex: number; mcid: number }
  | { kind: 'object'; pageIndex: number; sourceObjectNumber: number };

/** Recognised PDF-spec structure types — open string for forward compat
 *  with PDF/UA-1 extensions that may surface in real-world inputs. */
export type StructTreeNodeType =
  | 'Document'
  | 'Part'
  | 'Art'
  | 'Sect'
  | 'Div'
  | 'BlockQuote'
  | 'Caption'
  | 'TOC'
  | 'TOCI'
  | 'Index'
  | 'P'
  | 'H1'
  | 'H2'
  | 'H3'
  | 'H4'
  | 'H5'
  | 'H6'
  | 'L'
  | 'LI'
  | 'Lbl'
  | 'LBody'
  | 'Figure'
  | 'Formula'
  | 'Form'
  | 'Table'
  | 'TR'
  | 'TD'
  | 'TH'
  | 'THead'
  | 'TBody'
  | 'TFoot'
  | 'Link'
  | 'Annot'
  | 'Span'
  | 'Quote'
  | 'Note'
  | 'Reference'
  | 'BibEntry'
  | 'Code'
  // Open string for forward-compat with /StructTreeRoot/RoleMap extensions
  // and PDF-spec amendments. The auto-tag heuristic + UI only EMIT the
  // enumerated set, but READ accepts whatever is in the doc.
  | string;

/** A single node in the structure tree. `id` is a renderer-stable uuid
 *  the engine assigns at read time; the materializer drops it on write
 *  (PDF object numbers replace it). See accessibility-authoring-spec.md
 *  §1.1 + §2.4 (sort children by id for deterministic merge). */
export interface StructTreeNode {
  /** Stable client-side id (uuid v4 or short slug). NOT the PDF object number. */
  id: string;
  type: StructTreeNodeType;
  /** /Alt — alt text. */
  altText?: string;
  /** /ActualText — literal text equivalent. */
  actualText?: string;
  /** /Lang — BCP-47 language tag. */
  language?: string;
  /** Optional human-friendly title surfaced in the tree row label (e.g. the
   *  first ~40 chars of the first run of text under this node). Engine may
   *  emit; renderer falls back to type alone when omitted. */
  title?: string;
  /** Marked-content references this element wraps. */
  contentRefs: MarkedContentRef[];
  children: StructTreeNode[];
  /** Source PDF object number, if known. -1 for newly-authored elements
   *  that haven't been materialized yet. */
  sourceObjectNumber?: number;
}

// ---------------------------------------------------------------------------
// pdf:getStructTree
// ---------------------------------------------------------------------------

export interface PdfGetStructTreeRequest {
  handle: DocumentHandle;
  /** true ⇒ engine merges side-table edits (accessibility_edit_session) on
   *  top of the in-PDF /StructTreeRoot before returning. The renderer
   *  passes true so resume-after-crash works without renderer-side merge. */
  mergeWithEditSession: boolean;
}

export type PdfGetStructTreeError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'side_table_corrupt'
  | 'engine_failed';

export interface PdfGetStructTreeValue {
  /** null when the doc has no /StructTreeRoot — renderer surfaces the
   *  "Auto-tag from content" empty-state entry point. */
  root: StructTreeNode | null;
  /** Load-bearing for save-as-copy-by-default (P7.5-L-5 / R12 mitigation).
   *  Even when the user mutates the tree, the original tag presence flag
   *  survives so the Save dispatcher defaults to Save-As-Copy. */
  hasExistingTags: boolean;
  /** Engine-emitted warnings — e.g. "tree truncated at 10000 nodes".
   *  Matches David's canonical `PdfGetStructTreeValue.warnings`. */
  warnings: string[];
}

export type PdfGetStructTreeResponse =
  | { ok: true; value: PdfGetStructTreeValue }
  | {
      ok: false;
      error: PdfGetStructTreeError | 'bridge_unavailable';
      message: string;
    };

// ---------------------------------------------------------------------------
// pdf:setStructTree — persists edits to the SQLite side-table.
//   The engine does NOT touch the in-PDF /StructTreeRoot until Save.
// ---------------------------------------------------------------------------

export interface PdfSetStructTreeRequest {
  handle: DocumentHandle;
  /** Full tree replacement. CRDT-style ops are out of scope for v0.8.0. */
  root: StructTreeNode;
}

export type PdfSetStructTreeError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'side_table_corrupt'
  | 'overwrites_existing_tree'
  | 'engine_failed';

export interface PdfSetStructTreeValue {
  /** Side-table row id — opaque to the renderer; useful for engine logs. */
  sessionId: number;
  /** Surfaced when the input doc had a pre-existing /StructTreeRoot the
   *  write overwrites. Matches David's canonical surface. */
  warnings: string[];
}

export type PdfSetStructTreeResponse =
  | { ok: true; value: PdfSetStructTreeValue }
  | {
      ok: false;
      error: PdfSetStructTreeError | 'bridge_unavailable';
      message: string;
    };

// ---------------------------------------------------------------------------
// pdf:autoTagPages — heuristic. Renderer surfaces a confirm modal before
//   dispatch (P7.5-L-10 honesty obligation #3) and a yellow "unreviewed"
//   border around each unreviewed node until the user touches it.
// ---------------------------------------------------------------------------

export type AutoTagPageRange = 'all' | { start: number; end: number };

export type AutoTagHeuristic = 'font-size-cluster';

export interface PdfAutoTagPagesRequest {
  handle: DocumentHandle;
  pages: AutoTagPageRange;
  heuristic: AutoTagHeuristic;
}

export type PdfAutoTagPagesError = 'invalid_payload' | 'handle_not_found' | 'engine_failed';

export interface PdfAutoTagPagesValue {
  /** Renderer reviews + applies via pdf:setStructTree. */
  proposedRoot: StructTreeNode;
  /** Honest engine output — e.g. "Page 14: single font size — no headings detected".
   *  Renderer surfaces these in a collapsible warning section below the tree. */
  warnings: string[];
}

export type PdfAutoTagPagesResponse =
  | { ok: true; value: PdfAutoTagPagesValue }
  | {
      ok: false;
      error: PdfAutoTagPagesError | 'bridge_unavailable';
      message: string;
    };

// ---------------------------------------------------------------------------
// Renderer-only helpers (no IPC parallel; pure UI).
// ---------------------------------------------------------------------------

/** Walk a tree and apply a mutator to every node. Pure; returns a new tree.
 *  Returning `null` from the mutator deletes the node (and its descendants).
 *  Returning the same reference is a no-op short-circuit so unchanged
 *  subtrees keep referential equality and React reconciliation stays cheap. */
export function mapTree(
  node: StructTreeNode,
  mutate: (n: StructTreeNode) => StructTreeNode | null,
): StructTreeNode | null {
  const mutated = mutate(node);
  if (mutated === null) return null;
  const newChildren: StructTreeNode[] = [];
  let changed = mutated !== node;
  for (const child of mutated.children) {
    const mappedChild = mapTree(child, mutate);
    if (mappedChild === null) {
      changed = true;
      continue;
    }
    if (mappedChild !== child) changed = true;
    newChildren.push(mappedChild);
  }
  if (!changed) return node;
  return { ...mutated, children: newChildren };
}

/** Find a node by id. Returns null when absent. O(N). */
export function findNode(root: StructTreeNode, id: string): StructTreeNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findNode(c, id);
    if (hit !== null) return hit;
  }
  return null;
}

/** Return the chain of ancestors from `root` down to (but not including) the
 *  node with id `id`. Empty array means the id IS the root. Returns null
 *  when the id is absent. Useful for breadcrumb display + move-up/down. */
export function findPath(root: StructTreeNode, id: string): StructTreeNode[] | null {
  if (root.id === id) return [];
  for (const c of root.children) {
    const sub = findPath(c, id);
    if (sub !== null) return [root, ...sub];
  }
  return null;
}

/** Replace a subtree rooted at `id`. Returns the new root, or the original
 *  reference when the id is absent (no-op). */
export function replaceSubtree(
  root: StructTreeNode,
  id: string,
  replacement: StructTreeNode,
): StructTreeNode {
  if (root.id === id) return replacement;
  let changed = false;
  const newChildren = root.children.map((c) => {
    const next = replaceSubtree(c, id, replacement);
    if (next !== c) changed = true;
    return next;
  });
  if (!changed) return root;
  return { ...root, children: newChildren };
}

/** Remove the node with id `id`. Returns the new root (or original ref if
 *  absent). Removing the root itself returns the root unchanged — the caller
 *  decides what an emptied document means (renderer never offers it). */
export function removeNode(root: StructTreeNode, id: string): StructTreeNode {
  if (root.id === id) return root;
  let changed = false;
  const newChildren: StructTreeNode[] = [];
  for (const c of root.children) {
    if (c.id === id) {
      changed = true;
      continue;
    }
    const next = removeNode(c, id);
    if (next !== c) changed = true;
    newChildren.push(next);
  }
  if (!changed) return root;
  return { ...root, children: newChildren };
}

/** Insert a child under the parent id at the given index (clamped to the
 *  child array's length). Returns the new root, or the original reference
 *  if the parent is absent. */
export function insertChild(
  root: StructTreeNode,
  parentId: string,
  child: StructTreeNode,
  index: number,
): StructTreeNode {
  if (root.id === parentId) {
    const clamped = Math.max(0, Math.min(index, root.children.length));
    const newChildren = [
      ...root.children.slice(0, clamped),
      child,
      ...root.children.slice(clamped),
    ];
    return { ...root, children: newChildren };
  }
  let changed = false;
  const newChildren = root.children.map((c) => {
    const next = insertChild(c, parentId, child, index);
    if (next !== c) changed = true;
    return next;
  });
  if (!changed) return root;
  return { ...root, children: newChildren };
}

/** Detect basic structural warnings the panel surfaces with a ⚠ icon.
 *  Returns the count of: figures without alt text + heading-nesting jumps
 *  (H1→H3 with no H2). Used by the panel header summary. */
export interface TreeWarnings {
  figuresMissingAlt: number;
  headingNestingJumps: number;
}

export function summarizeWarnings(root: StructTreeNode): TreeWarnings {
  let figuresMissingAlt = 0;
  let headingNestingJumps = 0;
  // Walk in DFS pre-order tracking the most recent heading level seen.
  function walk(node: StructTreeNode, currentHeadingLevel: number): void {
    if (node.type === 'Figure' && (node.altText === undefined || node.altText.trim() === '')) {
      figuresMissingAlt += 1;
    }
    let nextHeadingLevel = currentHeadingLevel;
    const headingMatch = /^H([1-6])$/.exec(node.type);
    if (headingMatch !== null) {
      const level = Number(headingMatch[1]);
      if (currentHeadingLevel > 0 && level - currentHeadingLevel > 1) {
        headingNestingJumps += 1;
      }
      nextHeadingLevel = level;
    }
    for (const c of node.children) walk(c, nextHeadingLevel);
  }
  walk(root, 0);
  return { figuresMissingAlt, headingNestingJumps };
}

/** Default child type the "Add child" dispatch creates. P is the
 *  semantically-safest "I don't know yet" tag — user re-types via the
 *  type picker. */
export const DEFAULT_NEW_CHILD_TYPE: StructTreeNodeType = 'P';

/** The (curated) list of types the type picker offers. Open-string is
 *  honored at the data layer for forward-compat, but the picker only
 *  surfaces the curated set so the dropdown is usable. */
export const PICKABLE_TYPES: readonly StructTreeNodeType[] = [
  'Document',
  'Part',
  'Sect',
  'Div',
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'L',
  'LI',
  'Lbl',
  'LBody',
  'Figure',
  'Caption',
  'Table',
  'TR',
  'TD',
  'TH',
  'THead',
  'TBody',
  'TFoot',
  'Link',
  'Span',
  'BlockQuote',
  'Quote',
  'Note',
  'Code',
];
