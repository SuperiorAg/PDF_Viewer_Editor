// Unit tests for the Phase 7.5 Wave 5b C3 auto-tag heuristic.

import { describe, expect, it } from 'vitest';

import type { StructTreeNode } from '../../ipc/contracts.js';

import { autoTagPages, type AutoTagPageInput } from './auto-tag-heuristic.js';

const PAGE_SIZE = { widthPt: 612, heightPt: 792 };

function buildPage(
  pageIndex: number,
  textItems: AutoTagPageInput['textItems'],
  imageItems: AutoTagPageInput['imageItems'] = [],
): AutoTagPageInput {
  return { pageIndex, pageSize: PAGE_SIZE, textItems, imageItems };
}

/** Recursively collect node types in pre-order for shape assertions. */
function preorderTypes(node: StructTreeNode): string[] {
  const out: string[] = [node.type as string];
  for (const c of node.children) out.push(...preorderTypes(c));
  return out;
}

describe('autoTagPages — validation', () => {
  it('rejects non-object opts', () => {
    const res = autoTagPages(null as unknown as { pages: never[] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects non-array pages', () => {
    const res = autoTagPages({ pages: 'wat' as unknown as ReadonlyArray<AutoTagPageInput> });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects a page with bad pageSize', () => {
    const res = autoTagPages({
      pages: [
        {
          pageIndex: 0,
          pageSize: { widthPt: 0, heightPt: 100 },
          textItems: [],
          imageItems: [],
        },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });
});

describe('autoTagPages — heuristic', () => {
  it('returns an empty Document with a warning when there is no content at all', () => {
    const res = autoTagPages({ pages: [buildPage(0, [], [])] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.tree.type).toBe('Document');
    expect(res.value.tree.children).toHaveLength(0);
    expect(res.value.warnings.length).toBeGreaterThan(0);
  });

  it('emits all P (no headings) when only one font size is present', () => {
    const res = autoTagPages({
      pages: [
        buildPage(0, [
          { text: 'body line 1', fontSize: 12, readingIndex: 0 },
          { text: 'body line 2', fontSize: 12, readingIndex: 1 },
          { text: 'body line 3', fontSize: 12, readingIndex: 2 },
        ]),
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const types = preorderTypes(res.value.tree);
    expect(types[0]).toBe('Document');
    expect(types.slice(1)).toEqual(['P', 'P', 'P']);
    // The "no headings detected" warning is informational — present on
    // pages with a single font size and at least one paragraph leaf.
    expect(res.value.warnings.some((w) => /no headings detected/.test(w))).toBe(true);
  });

  it('clusters H1 + H2 + P from font sizes and nests P under the nearest heading', () => {
    // 12pt = body, 24pt = H1, 16pt = H2.
    const res = autoTagPages({
      pages: [
        buildPage(0, [
          { text: 'Chapter 1', fontSize: 24, readingIndex: 0 },
          { text: 'body paragraph A', fontSize: 12, readingIndex: 1 },
          { text: 'Section 1.1', fontSize: 16, readingIndex: 2 },
          { text: 'body paragraph B', fontSize: 12, readingIndex: 3 },
        ]),
        buildPage(1, [
          { text: 'Chapter 2', fontSize: 24, readingIndex: 0 },
          { text: 'body paragraph C', fontSize: 12, readingIndex: 1 },
        ]),
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const root = res.value.tree;
    expect(root.type).toBe('Document');
    // Top-level children: H1 "Chapter 1", H1 "Chapter 2".
    expect(root.children).toHaveLength(2);
    const ch1 = root.children[0]!;
    expect(ch1.type).toBe('H1');
    expect(ch1.actualText).toBe('Chapter 1');
    // Underneath Chapter 1: P "body paragraph A", H2 "Section 1.1".
    // Underneath Section 1.1: P "body paragraph B".
    expect(ch1.children).toHaveLength(2);
    expect(ch1.children[0]!.type).toBe('P');
    const sec = ch1.children[1]!;
    expect(sec.type).toBe('H2');
    expect(sec.actualText).toBe('Section 1.1');
    expect(sec.children).toHaveLength(1);
    expect(sec.children[0]!.type).toBe('P');
    // Chapter 2 starts fresh.
    const ch2 = root.children[1]!;
    expect(ch2.type).toBe('H1');
    expect(ch2.children).toHaveLength(1);
    expect(ch2.children[0]!.type).toBe('P');
  });

  it('demotes a stray H3 to H1 when no H1 has preceded it (no level skips)', () => {
    // Body is clearly dominant (many 12pt body items); a single 14pt
    // item is the only heading cluster — should land at H1 (depth 0)
    // because there is only one heading level.
    const body12 = (i: number) => ({
      text: `body line ${i}`,
      fontSize: 12,
      readingIndex: i,
    });
    const res = autoTagPages({
      pages: [
        buildPage(0, [
          body12(0),
          body12(1),
          body12(2),
          { text: 'small heading', fontSize: 14, readingIndex: 3 },
          body12(4),
          body12(5),
        ]),
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const root = res.value.tree;
    // The single heading-cluster size becomes depth 0 (H1) regardless of
    // its absolute font size — there's only one heading cluster.
    const headings = preorderTypes(root).filter((t) => /^H[1-6]$/.test(t));
    expect(headings).toEqual(['H1']);
    // Find the heading node and confirm its actualText.
    const findHeading = (n: StructTreeNode): StructTreeNode | null => {
      if (/^H[1-6]$/.test(n.type as string)) return n;
      for (const c of n.children) {
        const hit = findHeading(c);
        if (hit) return hit;
      }
      return null;
    };
    const h = findHeading(root);
    expect(h?.actualText).toBe('small heading');
  });

  it('emits Figure nodes for image items and threads alt text through', () => {
    const res = autoTagPages({
      pages: [
        buildPage(
          0,
          [{ text: 'caption', fontSize: 12, readingIndex: 1 }],
          [{ readingIndex: 0, bbox: [50, 600, 250, 700], altText: 'logo' }],
        ),
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const figures = res.value.tree.children.filter((c) => c.type === 'Figure');
    expect(figures).toHaveLength(1);
    expect(figures[0]!.altText).toBe('logo');
  });

  it('threads mcid through into contentRefs so the tree round-trips', () => {
    // Body-dominant page so the 24pt run is unambiguously a heading.
    const res = autoTagPages({
      pages: [
        buildPage(
          0,
          [
            { text: 'Heading', fontSize: 24, readingIndex: 0, mcid: 5 },
            { text: 'body 1', fontSize: 12, readingIndex: 1, mcid: 6 },
            { text: 'body 2', fontSize: 12, readingIndex: 2, mcid: 7 },
            { text: 'body 3', fontSize: 12, readingIndex: 3, mcid: 8 },
          ],
          [],
        ),
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const root = res.value.tree;
    const h1 = root.children[0]!;
    expect(h1.type).toBe('H1');
    expect(h1.contentRefs).toEqual([{ kind: 'mcid', pageIndex: 0, mcid: 5 }]);
    const p = h1.children[0]!;
    expect(p.type).toBe('P');
    expect(p.contentRefs).toEqual([{ kind: 'mcid', pageIndex: 0, mcid: 6 }]);
  });

  it('clamps maxHeadingDepth into [1, 6]', () => {
    // Three heading clusters but maxHeadingDepth=1 → all become H1.
    const res = autoTagPages({
      pages: [
        buildPage(0, [
          { text: 'biggest', fontSize: 32, readingIndex: 0 },
          { text: 'middle', fontSize: 20, readingIndex: 1 },
          { text: 'small heading', fontSize: 14, readingIndex: 2 },
          { text: 'body', fontSize: 10, readingIndex: 3 },
        ]),
      ],
      maxHeadingDepth: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // With maxHeadingDepth=1, only one heading level is allowed; everything
    // collapses to H1.
    const headings = preorderTypes(res.value.tree).filter((t) => /^H[1-6]$/.test(t));
    expect(headings.every((t) => t === 'H1')).toBe(true);
  });
});
