// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createLayoutExtractor } from './layout-extract.js';
import type { PdfTextContent, PageSize } from './types.js';

const PAGE: PageSize = { widthPt: 612, heightPt: 792 };

/** Build a synthetic pdf.js text item. */
function item(
  str: string,
  x: number,
  y: number,
  width: number,
  height = 12,
  fontName = 'Helvetica',
): PdfTextContent['items'][number] {
  return {
    str,
    transform: [height, 0, 0, height, x, y],
    width,
    height,
    fontName,
  };
}

describe('layout-extract (export-engine.md §3.4)', () => {
  const extract = createLayoutExtractor();

  it('returns null for empty page (anti-sentinel — NOT empty ExtractedText)', () => {
    const r = extract.extract({ items: [] }, PAGE);
    expect(r).toBeNull();
  });

  it('extracts a single paragraph from one line of text', () => {
    const tc: PdfTextContent = {
      items: [item('Hello', 72, 720, 40), item(' ', 113, 720, 4), item('world', 118, 720, 40)],
    };
    const r = extract.extract(tc, PAGE);
    expect(r).not.toBeNull();
    expect(r!.paragraphs).toHaveLength(1);
    expect(r!.paragraphs[0]!.text).toContain('Hello');
    expect(r!.paragraphs[0]!.text).toContain('world');
    expect(r!.paragraphs[0]!.rect).not.toBeNull();
    expect(r!.paragraphs[0]!.heading).toBeNull();
  });

  it('separates paragraphs by large vertical gap', () => {
    const tc: PdfTextContent = {
      items: [
        item('First paragraph.', 72, 720, 100),
        item('Second paragraph.', 72, 660, 100), // gap = 60 pt > 1.5 * 12
      ],
    };
    const r = extract.extract(tc, PAGE);
    expect(r).not.toBeNull();
    expect(r!.paragraphs).toHaveLength(2);
  });

  it('merges adjacent lines into one paragraph when gap is small', () => {
    const tc: PdfTextContent = {
      items: [
        item('Line one of paragraph', 72, 720, 120),
        item('Line two of paragraph', 72, 706, 120), // gap = 2 pt < 1.5 * 12
      ],
    };
    const r = extract.extract(tc, PAGE);
    expect(r).not.toBeNull();
    expect(r!.paragraphs).toHaveLength(1);
    expect(r!.paragraphs[0]!.text).toMatch(/Line one.*Line two/);
  });

  it('classifies H1 from font-size delta (>= 1.8x body)', () => {
    const tc: PdfTextContent = {
      items: [
        item('Heading', 72, 740, 100, 24), // 24 / 0.7 = ~34.3 pt
        // body lines (large gap to force new paragraph)
        item('Body paragraph one', 72, 680, 150),
        item('Body paragraph two', 72, 660, 150),
        item('Body paragraph three', 72, 640, 150),
      ],
    };
    const r = extract.extract(tc, PAGE);
    expect(r).not.toBeNull();
    const headings = r!.paragraphs.filter((p) => p.heading !== null);
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0]!.heading).toBe('H1');
  });

  it('detects multi-column layout via X-cluster gap > columnGapPt', () => {
    const tc: PdfTextContent = {
      items: [
        // Left column
        item('Left column line 1', 72, 720, 150),
        item('Left column line 2', 72, 700, 150),
        // Right column (X = 350 — 278pt gap)
        item('Right column line 1', 350, 720, 150),
        item('Right column line 2', 350, 700, 150),
      ],
    };
    const r = extract.extract(tc, PAGE);
    expect(r).not.toBeNull();
    expect(r!.columnsDetected).toBe(2);
  });

  it('falls back to single column when X-gap is below threshold', () => {
    const tc: PdfTextContent = {
      items: [item('Indented one', 100, 720, 150), item('Indented two', 90, 700, 150)],
    };
    const r = extract.extract(tc, PAGE);
    expect(r).not.toBeNull();
    expect(r!.columnsDetected).toBe(1);
  });

  it('detects bold font via font-name regex', () => {
    const tc: PdfTextContent = {
      items: [item('Bold text', 72, 720, 80, 12, 'Helvetica-Bold')],
    };
    const r = extract.extract(tc, PAGE);
    expect(r).not.toBeNull();
    expect(r!.paragraphs[0]!.fontHints.bold).toBe(true);
  });

  it('detects italic font via font-name regex', () => {
    const tc: PdfTextContent = {
      items: [item('Italic text', 72, 720, 80, 12, 'Times-Italic')],
    };
    const r = extract.extract(tc, PAGE);
    expect(r).not.toBeNull();
    expect(r!.paragraphs[0]!.fontHints.italic).toBe(true);
  });

  it('uses configurable thresholds from settings', () => {
    const tc: PdfTextContent = {
      items: [
        item('Line one', 72, 720, 80),
        item('Line two', 72, 700, 80), // gap = 8pt = 0.67x line-height
      ],
    };
    // Default ratio 1.5 — same paragraph
    const r1 = extract.extract(tc, PAGE);
    expect(r1!.paragraphs).toHaveLength(1);
    // Tighter ratio 0.5 — separate paragraphs
    const r2 = extract.extract(tc, PAGE, { paragraphBreakRatio: 0.5 });
    expect(r2!.paragraphs).toHaveLength(2);
  });

  it('LayoutRect is non-null for extracted paragraphs', () => {
    const tc: PdfTextContent = {
      items: [item('Has a rect', 72, 720, 100)],
    };
    const r = extract.extract(tc, PAGE);
    expect(r).not.toBeNull();
    expect(r!.paragraphs[0]!.rect).not.toBeNull();
    expect(r!.paragraphs[0]!.rect!.w).toBeGreaterThan(0);
    expect(r!.paragraphs[0]!.rect!.h).toBeGreaterThan(0);
  });

  it('classifies alignment center for narrow centered paragraph', () => {
    // Paragraph centered: starts at x=256, width=100, page width=612.
    // center x = 306 ≈ pageWidth/2 = 306 (perfect center).
    const tc: PdfTextContent = {
      items: [item('Centered', 256, 720, 100)],
    };
    const r = extract.extract(tc, PAGE);
    expect(r).not.toBeNull();
    expect(r!.paragraphs[0]!.alignment).toBe('center');
  });

  it('handles single-column inline column-X variance gracefully', () => {
    const tc: PdfTextContent = {
      items: [
        item('Para A', 72, 720, 80),
        item('Para B', 80, 690, 80),
        item('Para C', 76, 660, 80),
      ],
    };
    const r = extract.extract(tc, PAGE);
    expect(r).not.toBeNull();
    expect(r!.columnsDetected).toBe(1);
  });
});
