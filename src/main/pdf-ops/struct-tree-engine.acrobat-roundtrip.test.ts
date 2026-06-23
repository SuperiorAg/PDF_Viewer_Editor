// R12 mitigation regression test — Phase 7.5 post-v0.8.0 follow-up (Diego,
// 2026-06-18; closes Julian §11.1 HIGH).
//
// HONESTY HEADER — read this before adjusting the test:
//
//   The fixture this test loads (`tests/fixtures/tagged-acrobat/sample.pdf`)
//   is **NOT** an externally-authored Adobe Acrobat tagged PDF. It is a
//   hand-crafted pdf-lib fixture that EMULATES Acrobat's typical tagged-PDF
//   output shape — see `tests/fixtures/tagged-acrobat/generate-fixture.mjs`
//   for the full provenance + a listing of what the fixture carries vs what
//   a true Acrobat-authored fixture would carry. The synthesis was authorized
//   by the post-v0.8.0 dispatch brief on the grounds that (a) Adobe Acrobat
//   is not installed on this build machine and (b) the W3C tagged-PDF corpus
//   adds a licensing line-item not justified for a single smoke test.
//
//   The Acrobat-emulation shape (RoleMap dict, ParentTree, /P back-refs,
//   multi-page mcid distribution, deep nesting H1 > [P, P, H2 > [P]] + a
//   Figure with /Alt) is what the engine's read path MIGHT mishandle if it
//   strips entries it doesn't understand — the test catches that class of
//   regression even with a synthesised fixture. When a true Acrobat-authored
//   fixture becomes available, drop the new sample.pdf in
//   `tests/fixtures/tagged-acrobat/` and update the SourceProvenance check
//   below; this test will then exercise the real-Acrobat round-trip.
//
// What this test asserts (R12 mitigation criteria from project-plan.md):
//
//   1. The fixture loads cleanly via `getStructTree` (no engine_failed).
//   2. `hasExistingTree === true` (the runtime data-loss-mitigation flag
//      that triggers save-as-copy-by-default in the renderer).
//   3. The tree shape is structurally as expected (Document > [H1 > [P, P,
//      H2 > [P]], Figure]). 6 struct elements total below the Document root.
//   4. /S types, /Alt, /ActualText, /Lang strings round-trip without
//      paraphrasing or loss.
//   5. /Pg page-index references round-trip (page 0 / page 1 / page 2).
//   6. /K mcid content refs round-trip with the same (pageIndex, mcid)
//      pairs.
//   7. setStructTree(loaded_tree) writes a new tree that re-loads
//      structurally identical — i.e. the rebuild-from-scratch discipline
//      (P7.5-L-12) preserves the tree structure even though object numbers
//      may differ. This is the load-bearing R12 mitigation: data
//      preservation under write-then-read.
//   8. NO data loss across the round-trip: every node's /S type, /Alt,
//      /ActualText, /Lang, /Pg, and /K mcid set survives a write + re-read.
//   9. The /StructTreeRoot is replaced (not merged) — overwroteExistingTree
//      is true, matching the engine's documented contract.
//
// What this test does NOT (yet) assert — honest deferrals:
//
//   - /RoleMap preservation. The Wave 5b engine rebuilds /StructTreeRoot
//     from scratch and currently does NOT copy /RoleMap across; the test
//     exposes this as a non-blocking gap (we assert that the rebuilt tree
//     remains structurally readable even without the RoleMap — readers
//     that need RoleMap fall back to bare /S names).
//   - /ParentTree preservation. Same gap — Wave 5b engine drops it on
//     rebuild; the test asserts the post-rebuild tree is still walkable
//     (the renderer can rebuild /ParentTree on demand).
//   - /P parent back-ref preservation. Wave 5b's tree shape is
//     parent-implicit (children live inside their parent's `children`
//     array); on rebuild the engine writes fresh /P refs pointing at the
//     newly-allocated parent dicts, so the back-ref is restored to the
//     CORRECT logical parent even though the object number changes.
//
// References:
//   - docs/code-review.md §11.1 (Julian's R12 finding)
//   - docs/project-plan.md R12 (mitigation criteria)
//   - .learnings/locked-instructions.md L-007 (not directly applicable —
//     this is a main-process test, not a tool-registry concern)
//   - tests/fixtures/tagged-acrobat/generate-fixture.mjs (fixture
//     provenance + emulation choices)

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { MarkedContentRef, StructTreeNode } from '../../ipc/contracts.js';

import { getStructTree, setStructTree } from './struct-tree-engine.js';

const FIXTURE_PATH = resolvePath(
  __dirname,
  '..',
  '..',
  '..',
  'tests',
  'fixtures',
  'tagged-acrobat',
  'sample.pdf',
);

/** Walk the tree depth-first and produce a structural fingerprint that is
 *  invariant under (a) different uuid `id` values per run and (b) different
 *  pdf-lib object numbers across writes. The fingerprint captures every
 *  load-bearing dimension R12 was filed to protect.
 *
 *  Shape:
 *    {
 *      type, altText?, actualText?, language?,
 *      contentRefs: [{kind, pageIndex, mcid|sourceObjectNumber}, ...],
 *      children: [<recursive fingerprint>, ...]
 *    }
 *
 *  We deliberately DROP `id` and `sourceObjectNumber` from the fingerprint
 *  because both are expected to change across the rebuild (id is a fresh
 *  uuid per read; sourceObjectNumber is -1 by engine convention since the
 *  rebuild allocates fresh object numbers). Everything else MUST match.
 */
interface StructFingerprint {
  type: string;
  altText?: string;
  actualText?: string;
  language?: string;
  contentRefs: MarkedContentRef[];
  children: StructFingerprint[];
}

function fingerprint(node: StructTreeNode): StructFingerprint {
  const out: StructFingerprint = {
    type: node.type,
    contentRefs: node.contentRefs.map((r) => ({ ...r })),
    children: node.children.map(fingerprint),
  };
  if (node.altText !== undefined) out.altText = node.altText;
  if (node.actualText !== undefined) out.actualText = node.actualText;
  if (node.language !== undefined) out.language = node.language;
  return out;
}

/** Count every struct elem in the tree (excluding the Document wrapper). */
function countNodes(node: StructTreeNode): number {
  let n = node.type === 'Document' ? 0 : 1;
  for (const c of node.children) n += countNodes(c);
  return n;
}

/** Depth of the tree, counting the Document root as depth 0. */
function depth(node: StructTreeNode): number {
  if (node.children.length === 0) return 0;
  let d = 0;
  for (const c of node.children) {
    const cd = depth(c);
    if (cd > d) d = cd;
  }
  return d + 1;
}

describe('R12 — Acrobat-fixture round-trip (struct-tree-engine)', () => {
  it('loads the (synthesised-Acrobat-shape) fixture with hasExistingTree=true', async () => {
    const bytes = await readFile(FIXTURE_PATH);
    const res = await getStructTree(new Uint8Array(bytes));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.hasExistingTree).toBe(true);
    expect(res.value.tree).not.toBeNull();
  });

  it('decodes the expected tree shape (Document > [H1 > [P, P, H2 > [P]], Figure])', async () => {
    const bytes = await readFile(FIXTURE_PATH);
    const res = await getStructTree(new Uint8Array(bytes));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const root = res.value.tree!;
    expect(root.type).toBe('Document');
    expect(root.children).toHaveLength(2);
    // Top-level children: H1 + Figure.
    const [h1, figure] = root.children;
    expect(h1!.type).toBe('H1');
    expect(figure!.type).toBe('Figure');
    // H1's children: P "intro", P "more intro", H2 "Section".
    expect(h1!.children).toHaveLength(3);
    expect(h1!.children.map((c) => c.type)).toEqual(['P', 'P', 'H2']);
    // H2's child: one P.
    const h2 = h1!.children[2]!;
    expect(h2.children).toHaveLength(1);
    expect(h2.children[0]!.type).toBe('P');
    // Total struct-elem count below the Document = 6.
    expect(countNodes(root)).toBe(6);
    // Tree depth (Document=0, H1=1, H2=2, leaf P=3).
    expect(depth(root)).toBe(3);
  });

  it('preserves /Alt /ActualText /Lang strings byte-for-byte', async () => {
    const bytes = await readFile(FIXTURE_PATH);
    const res = await getStructTree(new Uint8Array(bytes));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const root = res.value.tree!;
    const h1 = root.children[0]!;
    const figure = root.children[1]!;
    // H1 carries /ActualText "Title".
    expect(h1.actualText).toBe('Title');
    // Paragraph actualText strings.
    expect(h1.children[0]!.actualText).toBe('intro');
    expect(h1.children[1]!.actualText).toBe('more intro');
    // H2 carries /ActualText "Section".
    expect(h1.children[2]!.actualText).toBe('Section');
    expect(h1.children[2]!.children[0]!.actualText).toBe('section body');
    // Figure carries /Alt "company logo" + /Lang "en-US".
    expect(figure.altText).toBe('company logo');
    expect(figure.language).toBe('en-US');
  });

  it('preserves mcid content refs with correct (pageIndex, mcid) tuples', async () => {
    const bytes = await readFile(FIXTURE_PATH);
    const res = await getStructTree(new Uint8Array(bytes));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const root = res.value.tree!;
    const h1 = root.children[0]!;
    const figure = root.children[1]!;
    // H1 — page 0, mcid 0 (the heading text).
    expect(h1.contentRefs).toEqual([{ kind: 'mcid', pageIndex: 0, mcid: 0 }]);
    // H1's children:
    //   intro P — page 0, mcid 1.
    //   more-intro P — page 1, mcid 2.
    //   H2 — page 1, mcid 3.
    expect(h1.children[0]!.contentRefs).toEqual([{ kind: 'mcid', pageIndex: 0, mcid: 1 }]);
    expect(h1.children[1]!.contentRefs).toEqual([{ kind: 'mcid', pageIndex: 1, mcid: 2 }]);
    expect(h1.children[2]!.contentRefs).toEqual([{ kind: 'mcid', pageIndex: 1, mcid: 3 }]);
    // H2's section-body P — page 1, mcid 4.
    expect(h1.children[2]!.children[0]!.contentRefs).toEqual([
      { kind: 'mcid', pageIndex: 1, mcid: 4 },
    ]);
    // Figure — page 2, mcid 5.
    expect(figure.contentRefs).toEqual([{ kind: 'mcid', pageIndex: 2, mcid: 5 }]);
  });

  it('round-trips through setStructTree without structural loss (the R12 mitigation criterion)', async () => {
    const bytes = await readFile(FIXTURE_PATH);

    // Step 1 — read the loaded tree.
    const read1 = await getStructTree(new Uint8Array(bytes));
    expect(read1.ok).toBe(true);
    if (!read1.ok) return;
    const tree1 = read1.value.tree!;
    const fingerprint1 = fingerprint(tree1);

    // Step 2 — write the loaded tree back (rebuild-from-scratch discipline).
    // No edits applied; pure round-trip.
    const write = await setStructTree(new Uint8Array(bytes), tree1);
    expect(write.ok).toBe(true);
    if (!write.ok) return;
    // overwroteExistingTree must be TRUE — the input had a tree and we
    // replaced it. This is the engine's documented contract.
    expect(write.value.overwroteExistingTree).toBe(true);
    expect(write.value.warnings.some((w) => /Overwriting existing/.test(w))).toBe(true);

    // Step 3 — re-read the freshly-written bytes and confirm structural
    // equality with the originally-read tree.
    const read2 = await getStructTree(write.value.bytes);
    expect(read2.ok).toBe(true);
    if (!read2.ok) return;
    const tree2 = read2.value.tree!;
    const fingerprint2 = fingerprint(tree2);

    // Structural fingerprints must match. This catches data loss across:
    //   - /S type stripping (every node.type must survive)
    //   - /Alt /ActualText /Lang stripping
    //   - /Pg page-index reattachment (preserved via the same page refs)
    //   - /K mcid reattachment (preserved via the same pageIndex+mcid tuples)
    //   - /K child nesting (preserved via the same children array shape)
    expect(fingerprint2).toEqual(fingerprint1);

    // Sanity floor — both reads must report the same node count + depth.
    expect(countNodes(tree2)).toBe(countNodes(tree1));
    expect(depth(tree2)).toBe(depth(tree1));
  });

  it('round-trip preserves /MarkInfo /Marked true (the tagged-PDF marker)', async () => {
    const bytes = await readFile(FIXTURE_PATH);
    const read1 = await getStructTree(new Uint8Array(bytes));
    expect(read1.ok).toBe(true);
    if (!read1.ok) return;
    const write = await setStructTree(new Uint8Array(bytes), read1.value.tree!);
    expect(write.ok).toBe(true);
    if (!write.ok) return;
    // Re-read; hasExistingTree must STILL be true (i.e. the rebuilt PDF is
    // a tagged PDF, not a plain one). This indirectly asserts /MarkInfo
    // was preserved/re-set by the engine.
    const read2 = await getStructTree(write.value.bytes);
    expect(read2.ok).toBe(true);
    if (!read2.ok) return;
    expect(read2.value.hasExistingTree).toBe(true);
  });

  it('round-trip is idempotent — a second write of the re-read tree matches fingerprint', async () => {
    // Two-cycle round-trip: write1 -> read1 -> write2 -> read2.
    // If the engine has any non-idempotent state in its rebuild path (e.g.
    // accumulating warnings, drifting struct-elem types), the second
    // fingerprint will differ from the first. The test guards against that
    // class of regression.
    const bytes = await readFile(FIXTURE_PATH);
    const read1 = await getStructTree(new Uint8Array(bytes));
    expect(read1.ok).toBe(true);
    if (!read1.ok) return;
    const fpInitial = fingerprint(read1.value.tree!);

    const write1 = await setStructTree(new Uint8Array(bytes), read1.value.tree!);
    expect(write1.ok).toBe(true);
    if (!write1.ok) return;

    const read2 = await getStructTree(write1.value.bytes);
    expect(read2.ok).toBe(true);
    if (!read2.ok) return;
    const fpAfter1 = fingerprint(read2.value.tree!);
    expect(fpAfter1).toEqual(fpInitial);

    const write2 = await setStructTree(write1.value.bytes, read2.value.tree!);
    expect(write2.ok).toBe(true);
    if (!write2.ok) return;

    const read3 = await getStructTree(write2.value.bytes);
    expect(read3.ok).toBe(true);
    if (!read3.ok) return;
    const fpAfter2 = fingerprint(read3.value.tree!);
    expect(fpAfter2).toEqual(fpInitial);
  });
});

/** Fixture provenance / honesty marker — pinned by a unit test so the
 *  fixture's synthesised-not-Acrobat status cannot be forgotten when a
 *  future maintainer reads the round-trip pass and concludes the
 *  externally-authored fixture has landed.
 *
 *  When a real Acrobat-authored fixture lands, REPLACE the marker below
 *  with `provenance: 'authored-by-adobe-acrobat'` and update the file
 *  header comment. The marker is enforced by a separate test below to
 *  prevent silent drift.
 */
const FIXTURE_PROVENANCE = {
  source: 'hand-crafted via pdf-lib, EMULATING Adobe Acrobat output shape',
  authored: false,
  generator: 'tests/fixtures/tagged-acrobat/generate-fixture.mjs',
} as const;

describe('R12 fixture provenance pin', () => {
  it('documents the fixture as synthesised (not externally-authored)', () => {
    // If this assertion ever needs to flip to `true`, that flip MUST be
    // accompanied by replacing the fixture file with an actual external
    // Acrobat-authored PDF AND updating the file-header honesty notice.
    // Do not flip this without doing both.
    expect(FIXTURE_PROVENANCE.authored).toBe(false);
    expect(FIXTURE_PROVENANCE.generator).toMatch(/generate-fixture\.mjs$/);
  });
});
