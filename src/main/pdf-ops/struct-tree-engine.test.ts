// Unit tests for the Phase 7.5 Wave 5b C3 struct-tree IO engine.

import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { StructTreeNode } from '../../ipc/contracts.js';

import { getStructTree, setStructTree, MAX_NODES_EAGER } from './struct-tree-engine.js';

/** Build a fresh PDF with N pages and no /StructTreeRoot. */
async function makePlainPdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([612, 792]);
  return doc.save();
}

/** Build a PDF with an explicit /StructTreeRoot containing the supplied
 *  in-memory tree, by re-using the engine's own setStructTree. This is the
 *  honest test fixture for round-trip — we don't try to hand-author /K
 *  arrays in raw pdf-lib because that's exactly what the engine does. */
async function makeTaggedPdf(tree: StructTreeNode, pages = 3): Promise<Uint8Array> {
  const base = await makePlainPdf(pages);
  const res = await setStructTree(base, tree);
  if (!res.ok) throw new Error(`fixture setStructTree failed: ${res.message}`);
  return res.value.bytes;
}

function makeNode(
  type: string,
  children: StructTreeNode[] = [],
  extras: Partial<StructTreeNode> = {},
): StructTreeNode {
  return {
    id: `id-${type}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    contentRefs: [],
    children,
    ...extras,
  };
}

describe('getStructTree', () => {
  it('rejects empty bytes', async () => {
    const res = await getStructTree(new Uint8Array(0));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns null + hasExistingTree=false for a plain (untagged) PDF', async () => {
    const bytes = await makePlainPdf();
    const res = await getStructTree(bytes);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.tree).toBeNull();
    expect(res.value.hasExistingTree).toBe(false);
    expect(res.value.warnings).toEqual([]);
  });

  it('returns the Document root + hasExistingTree=true after a setStructTree round-trip', async () => {
    const tree = makeNode('Document', [
      makeNode('H1', [], { actualText: 'Chapter 1' }),
      makeNode('P', [], { actualText: 'paragraph one' }),
      makeNode('H2', [makeNode('P', [], { actualText: 'sub-paragraph' })], {
        actualText: 'Section 1.1',
      }),
    ]);
    const tagged = await makeTaggedPdf(tree);

    const res = await getStructTree(tagged);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.hasExistingTree).toBe(true);
    expect(res.value.tree).not.toBeNull();
    const root = res.value.tree!;
    expect(root.type).toBe('Document');
    expect(root.children).toHaveLength(3);
    expect(root.children[0]!.type).toBe('H1');
    expect(root.children[0]!.actualText).toBe('Chapter 1');
    expect(root.children[1]!.type).toBe('P');
    expect(root.children[1]!.actualText).toBe('paragraph one');
    expect(root.children[2]!.type).toBe('H2');
    expect(root.children[2]!.children).toHaveLength(1);
    expect(root.children[2]!.children[0]!.type).toBe('P');
    expect(root.children[2]!.children[0]!.actualText).toBe('sub-paragraph');
  });

  it('decodes /Alt /ActualText /Lang on Figure-style nodes', async () => {
    const tree = makeNode('Document', [
      makeNode('Figure', [], {
        altText: 'logo image',
        language: 'en-US',
      }),
    ]);
    const tagged = await makeTaggedPdf(tree);
    const res = await getStructTree(tagged);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const fig = res.value.tree!.children[0]!;
    expect(fig.type).toBe('Figure');
    expect(fig.altText).toBe('logo image');
    expect(fig.language).toBe('en-US');
  });

  it('preserves mcid content refs round-tripping through setStructTree', async () => {
    const tree = makeNode('Document', [
      makeNode('P', [], { contentRefs: [{ kind: 'mcid', pageIndex: 0, mcid: 7 }] }),
      makeNode('Figure', [], {
        contentRefs: [{ kind: 'mcid', pageIndex: 1, mcid: 12 }],
      }),
    ]);
    const tagged = await makeTaggedPdf(tree);
    const res = await getStructTree(tagged);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const root = res.value.tree!;
    expect(root.children[0]!.contentRefs).toEqual([{ kind: 'mcid', pageIndex: 0, mcid: 7 }]);
    expect(root.children[1]!.contentRefs).toEqual([{ kind: 'mcid', pageIndex: 1, mcid: 12 }]);
  });

  it('returns a hand-authored /StructTreeRoot when present (pdf-lib direct write)', async () => {
    // Hand-author the dict to confirm we don't depend on setStructTree.
    const base = await makePlainPdf(2);
    const doc = await PDFDocument.load(base);
    const ctx = doc.context;

    const childDict = PDFDict.withContext(ctx);
    childDict.set(PDFName.of('Type'), PDFName.of('StructElem'));
    childDict.set(PDFName.of('S'), PDFName.of('H1'));
    childDict.set(PDFName.of('ActualText'), PDFString.of('Hand-Authored H1'));
    childDict.set(PDFName.of('Pg'), doc.getPage(0).ref);
    childDict.set(PDFName.of('K'), PDFNumber.of(3));
    const childRef = ctx.register(childDict);

    const rootDict = PDFDict.withContext(ctx);
    rootDict.set(PDFName.of('Type'), PDFName.of('StructTreeRoot'));
    rootDict.set(PDFName.of('K'), childRef);
    const rootRef = ctx.register(rootDict);
    doc.catalog.set(PDFName.of('StructTreeRoot'), rootRef);

    const out = await doc.save({ useObjectStreams: false });

    const res = await getStructTree(out);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.hasExistingTree).toBe(true);
    const root = res.value.tree!;
    expect(root.children).toHaveLength(1);
    const h1 = root.children[0]!;
    expect(h1.type).toBe('H1');
    expect(h1.actualText).toBe('Hand-Authored H1');
    expect(h1.contentRefs).toEqual([{ kind: 'mcid', pageIndex: 0, mcid: 3 }]);
  });
});

describe('setStructTree', () => {
  it('rejects empty bytes', async () => {
    const res = await setStructTree(new Uint8Array(0), makeNode('Document'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects an invalid tree (missing children array)', async () => {
    const bytes = await makePlainPdf();
    const bad = { id: 'x', type: 'Document', contentRefs: [] } as unknown as StructTreeNode;
    const res = await setStructTree(bytes, bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('writes a fresh /StructTreeRoot when none existed and reports overwroteExistingTree=false', async () => {
    const bytes = await makePlainPdf();
    const tree = makeNode('Document', [makeNode('P', [], { actualText: 'hello' })]);
    const res = await setStructTree(bytes, tree);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.overwroteExistingTree).toBe(false);
    expect(res.value.warnings).toEqual([]);

    // /MarkInfo /Marked true must be set so readers know this is a tagged PDF.
    const doc = await PDFDocument.load(res.value.bytes);
    const markInfo = doc.catalog.lookupMaybe(PDFName.of('MarkInfo'), PDFDict);
    expect(markInfo).toBeDefined();
    // pdf-lib exposes booleans as PDFBool; just confirm presence + truthy.
    expect(markInfo!.get(PDFName.of('Marked'))).toBeDefined();
  });

  it('emits an overwroteExistingTree warning when /StructTreeRoot already existed', async () => {
    const baseTree = makeNode('Document', [makeNode('P', [], { actualText: 'original' })]);
    const tagged = await makeTaggedPdf(baseTree);

    const newTree = makeNode('Document', [makeNode('H1', [], { actualText: 'new heading' })]);
    const res = await setStructTree(tagged, newTree);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.overwroteExistingTree).toBe(true);
    expect(res.value.warnings.some((w) => /Overwriting existing/.test(w))).toBe(true);
  });

  it('round-trips a multi-level tree without data loss', async () => {
    const tree = makeNode('Document', [
      makeNode('H1', [], { actualText: 'Chapter 1', language: 'en-US' }),
      makeNode(
        'H2',
        [
          makeNode('P', [], { actualText: 'first paragraph' }),
          makeNode('Figure', [], { altText: 'a diagram' }),
          makeNode('P', [], { actualText: 'second paragraph' }),
        ],
        { actualText: 'Section 1.1' },
      ),
    ]);
    const out = await setStructTree(await makePlainPdf(), tree);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const read = await getStructTree(out.value.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const root = read.value.tree!;
    expect(root.type).toBe('Document');
    expect(root.children.map((c) => c.type)).toEqual(['H1', 'H2']);
    expect(root.children[0]!.actualText).toBe('Chapter 1');
    expect(root.children[0]!.language).toBe('en-US');
    const sec = root.children[1]!;
    expect(sec.actualText).toBe('Section 1.1');
    expect(sec.children).toHaveLength(3);
    expect(sec.children.map((c) => c.type)).toEqual(['P', 'Figure', 'P']);
    expect(sec.children[1]!.altText).toBe('a diagram');
  });
});

describe('large-tree guardrail', () => {
  it('truncation cap is exposed for tests + documented', () => {
    expect(MAX_NODES_EAGER).toBe(10_000);
  });
});
