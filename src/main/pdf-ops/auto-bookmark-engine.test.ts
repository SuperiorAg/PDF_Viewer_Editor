// Unit tests for the Phase 7.5 Wave 4 B19 Auto-bookmark heuristic engine.

import { describe, expect, it } from 'vitest';

import { autoBookmarkFromHeadings, type PageTextItem } from './auto-bookmark-engine.js';

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF" — engine
// validates non-empty bytes but never parses them; we feed the magic to keep
// the door open for future "load + extract pageCount" engine variants.

function makeExtractor(
  perPage: ReadonlyArray<ReadonlyArray<PageTextItem>>,
): (b: Uint8Array, p: number) => Promise<PageTextItem[]> {
  return async (_b, p) => [...(perPage[p] ?? [])];
}

describe('autoBookmarkFromHeadings', () => {
  it('rejects empty bytes', async () => {
    const res = await autoBookmarkFromHeadings({
      pdfBytes: new Uint8Array(0),
      extractPageTextItems: async () => [],
      pageCount: 1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns no_headings_detected when the doc has no extractable text', async () => {
    const res = await autoBookmarkFromHeadings({
      pdfBytes: PDF_HEADER,
      extractPageTextItems: async () => [],
      pageCount: 1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('no_headings_detected');
  });

  it('returns no_headings_detected when every text item is body-size', async () => {
    const body: PageTextItem = { text: 'body paragraph', fontSize: 12 };
    const res = await autoBookmarkFromHeadings({
      pdfBytes: PDF_HEADER,
      pageCount: 1,
      extractPageTextItems: makeExtractor([
        [body, body, body, body, body, body, body, body, body, body],
      ]),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('no_headings_detected');
  });

  it('detects H1 + H2 on a small fixture and nests correctly', async () => {
    // 12pt = body; 24pt = H1; 16pt = H2.
    const body: PageTextItem = { text: 'body paragraph filler', fontSize: 12 };
    const items: ReadonlyArray<ReadonlyArray<PageTextItem>> = [
      [
        { text: 'Chapter 1', fontSize: 24 },
        body,
        body,
        body,
        { text: 'Section 1.1', fontSize: 16 },
        body,
        body,
      ],
      [
        { text: 'Section 1.2', fontSize: 16 },
        body,
        body,
        { text: 'Chapter 2', fontSize: 24 },
        body,
        body,
      ],
    ];
    const res = await autoBookmarkFromHeadings({
      pdfBytes: PDF_HEADER,
      pageCount: 2,
      extractPageTextItems: makeExtractor(items),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.proposed).toHaveLength(4);
    // Order: Chapter 1 (depth 0, page 0), Section 1.1 (depth 1, page 0),
    //        Section 1.2 (depth 1, page 1), Chapter 2 (depth 0, page 1).
    expect(res.value.proposed[0]).toMatchObject({
      title: 'Chapter 1',
      pageIndex: 0,
      depth: 0,
    });
    expect(res.value.proposed[1]).toMatchObject({
      title: 'Section 1.1',
      pageIndex: 0,
      depth: 1,
    });
    expect(res.value.proposed[2]).toMatchObject({
      title: 'Section 1.2',
      pageIndex: 1,
      depth: 1,
    });
    expect(res.value.proposed[3]).toMatchObject({
      title: 'Chapter 2',
      pageIndex: 1,
      depth: 0,
    });
  });

  it('normalizes hierarchy when first heading is "H2"', async () => {
    // Only H2-size items present; engine should pin first to depth 0.
    const body: PageTextItem = { text: 'body', fontSize: 12 };
    const res = await autoBookmarkFromHeadings({
      pdfBytes: PDF_HEADER,
      pageCount: 1,
      extractPageTextItems: makeExtractor([
        [{ text: 'Lonely subheading', fontSize: 16 }, body, body, body, body],
      ]),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.proposed[0]!.depth).toBe(0);
  });

  it('trims long titles to 200 chars', async () => {
    const long = 'X'.repeat(500);
    const body: PageTextItem = { text: 'body', fontSize: 12 };
    const res = await autoBookmarkFromHeadings({
      pdfBytes: PDF_HEADER,
      pageCount: 1,
      extractPageTextItems: makeExtractor([[{ text: long, fontSize: 24 }, body, body, body, body]]),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.proposed[0]!.title.length).toBe(200);
  });

  it('dedupes adjacent identical headings', async () => {
    const body: PageTextItem = { text: 'body', fontSize: 12 };
    const res = await autoBookmarkFromHeadings({
      pdfBytes: PDF_HEADER,
      pageCount: 1,
      extractPageTextItems: makeExtractor([
        [
          { text: 'Header', fontSize: 24 },
          { text: 'Header', fontSize: 24 },
          body,
          body,
          body,
          body,
        ],
      ]),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.proposed).toHaveLength(1);
  });

  it('clamps maxDepth above 6 to 6', async () => {
    const body: PageTextItem = { text: 'body', fontSize: 12 };
    const res = await autoBookmarkFromHeadings({
      pdfBytes: PDF_HEADER,
      pageCount: 1,
      maxDepth: 99,
      extractPageTextItems: makeExtractor([
        [{ text: 'H1', fontSize: 30 }, body, body, body, body, body],
      ]),
    });
    expect(res.ok).toBe(true);
  });

  it('surfaces engine_failed when extractor throws', async () => {
    const res = await autoBookmarkFromHeadings({
      pdfBytes: PDF_HEADER,
      pageCount: 1,
      extractPageTextItems: async () => {
        throw new Error('boom');
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('engine_failed');
  });
});
