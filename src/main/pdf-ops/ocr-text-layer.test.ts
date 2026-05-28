// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { OcrPageResult } from '../../ipc/contracts.js';

import {
  composeSearchablePdf,
  escapePdfLiteralString,
  imageToPdfRect,
  isLatin1Safe,
  populatePdfRects,
  toPdfHexString,
} from './ocr-text-layer.js';

// ============================================================================
// Coordinate transformation
// ============================================================================

describe('imageToPdfRect', () => {
  it('US Letter portrait (612×792 pts, image 1224×1584 px = 2x scan)', () => {
    const r = imageToPdfRect(
      { x0: 100, y0: 100, x1: 200, y1: 150 },
      { widthPx: 1224, heightPx: 1584 },
      { widthPts: 612, heightPts: 792 },
    );
    // sx=sy=0.5 → x=50, y = 792 - 150*0.5 = 717, w=50, h=25
    expect(r.x).toBeCloseTo(50, 1);
    expect(r.y).toBeCloseTo(717, 1);
    expect(r.width).toBeCloseTo(50, 1);
    expect(r.height).toBeCloseTo(25, 1);
  });

  it('US Legal portrait (612×1008 pts, image 1836×3024 px = 3x scan)', () => {
    const r = imageToPdfRect(
      { x0: 600, y0: 300, x1: 900, y1: 360 },
      { widthPx: 1836, heightPx: 3024 },
      { widthPts: 612, heightPts: 1008 },
    );
    // sx = 612/1836 = 1/3; sy = 1008/3024 = 1/3
    // x = 600/3 = 200
    // y = 1008 - 360/3 = 1008 - 120 = 888
    expect(r.x).toBeCloseTo(200, 1);
    expect(r.y).toBeCloseTo(888, 1);
    expect(r.width).toBeCloseTo(100, 1);
    expect(r.height).toBeCloseTo(20, 1);
  });

  it('A4 portrait (595×842 pts, image 2480×3508 px ≈ 300 DPI)', () => {
    const r = imageToPdfRect(
      { x0: 0, y0: 0, x1: 248, y1: 70 },
      { widthPx: 2480, heightPx: 3508 },
      { widthPts: 595, heightPts: 842 },
    );
    // sx = 595/2480 = 0.24
    // sy = 842/3508 ≈ 0.24
    // x = 0
    // y = 842 - 70*0.24 ≈ 825.2
    expect(r.x).toBeCloseTo(0, 1);
    expect(r.y).toBeCloseTo(825.2, 1);
    expect(r.width).toBeCloseTo(59.5, 1);
    expect(r.height).toBeCloseTo(16.8, 1);
  });

  it('defensive: zero image dims yields zero-size rect (does NOT divide by zero)', () => {
    const r = imageToPdfRect(
      { x0: 100, y0: 100, x1: 200, y1: 200 },
      { widthPx: 0, heightPx: 0 },
      { widthPts: 612, heightPts: 792 },
    );
    expect(r).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('Y axis flip: top-left in image space lands NEAR top of page in PDF space', () => {
    const r = imageToPdfRect(
      { x0: 0, y0: 0, x1: 100, y1: 50 },
      { widthPx: 800, heightPx: 1000 },
      { widthPts: 612, heightPts: 792 },
    );
    // y1=50 in image space (near top); in PDF that's far from bottom.
    // y in PDF = 792 - 50*(792/1000) = 792 - 39.6 = 752.4
    expect(r.y).toBeCloseTo(752.4, 1);
  });
});

// ============================================================================
// String escaping / hex
// ============================================================================

describe('escapePdfLiteralString', () => {
  it('escapes parens and backslash', () => {
    expect(escapePdfLiteralString('hello (world)')).toBe('hello \\(world\\)');
    expect(escapePdfLiteralString('a\\b')).toBe('a\\\\b');
  });
  it('handles empty string', () => {
    expect(escapePdfLiteralString('')).toBe('');
  });
});

describe('isLatin1Safe', () => {
  it('returns true for ASCII', () => {
    expect(isLatin1Safe('hello world 123')).toBe(true);
  });
  it('returns false for non-ASCII', () => {
    expect(isLatin1Safe('café')).toBe(false);
    expect(isLatin1Safe('日本語')).toBe(false);
  });
});

describe('toPdfHexString', () => {
  it('encodes UTF-16 code units as 4-hex sequences', () => {
    expect(toPdfHexString('A')).toBe('0041');
    expect(toPdfHexString('AB')).toBe('00410042');
    expect(toPdfHexString('日')).toBe('65e5');
  });
});

// ============================================================================
// populatePdfRects
// ============================================================================

describe('populatePdfRects', () => {
  it('mutates pageResults so each word carries a non-null pdfRect', () => {
    const results: OcrPageResult[] = [
      {
        pageIndex: 0,
        imgDimsPx: { widthPx: 800, heightPx: 1000 },
        totalWords: 1,
        lowConfidenceWords: 0,
        meanConfidence: 90,
        words: [
          {
            text: 'hi',
            confidence: 90,
            imgRect: { x0: 100, y0: 100, x1: 150, y1: 130 },
            pdfRect: null,
          },
        ],
        durationMs: 1000,
      },
    ];
    populatePdfRects(results, () => ({ widthPts: 612, heightPts: 792 }));
    expect(results[0]!.words[0]!.pdfRect).not.toBeNull();
    expect(results[0]!.words[0]!.pdfRect!.x).toBeCloseTo(76.5, 0);
  });

  it('skips words that already have a non-null pdfRect (idempotent)', () => {
    const results: OcrPageResult[] = [
      {
        pageIndex: 0,
        imgDimsPx: { widthPx: 800, heightPx: 1000 },
        totalWords: 1,
        lowConfidenceWords: 0,
        meanConfidence: 90,
        words: [
          {
            text: 'hi',
            confidence: 90,
            imgRect: { x0: 100, y0: 100, x1: 150, y1: 130 },
            pdfRect: { x: 999, y: 999, width: 9, height: 9 }, // pre-set
          },
        ],
        durationMs: 1000,
      },
    ];
    populatePdfRects(results, () => ({ widthPts: 612, heightPts: 792 }));
    expect(results[0]!.words[0]!.pdfRect!.x).toBe(999);
  });
});

// ============================================================================
// composeSearchablePdf — round-trip
// ============================================================================

async function makeBlankPdf(width = 612, height = 792): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  return await doc.save();
}

describe('composeSearchablePdf', () => {
  it('round-trips a blank PDF with a single recognized word', async () => {
    const original = await makeBlankPdf();
    const results: OcrPageResult[] = [
      {
        pageIndex: 0,
        imgDimsPx: { widthPx: 800, heightPx: 1000 },
        totalWords: 1,
        lowConfidenceWords: 0,
        meanConfidence: 90,
        words: [
          {
            text: 'hello',
            confidence: 90,
            imgRect: { x0: 100, y0: 100, x1: 200, y1: 130 },
            pdfRect: null,
          },
        ],
        durationMs: 1000,
      },
    ];
    const r = await composeSearchablePdf(original, results);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Result is a real PDF — pdf-lib can re-parse it.
      const reparsed = await PDFDocument.load(r.value);
      expect(reparsed.getPageCount()).toBe(1);
      expect(reparsed.getPage(0).getWidth()).toBe(612);
      expect(reparsed.getPage(0).getHeight()).toBe(792);
      // pdfRect was populated as a side effect.
      expect(results[0]!.words[0]!.pdfRect).not.toBeNull();
    }
  });

  it('returns page_out_of_range when results reference a missing page', async () => {
    const original = await makeBlankPdf();
    const results: OcrPageResult[] = [
      {
        pageIndex: 5, // out of range; doc has 1 page
        imgDimsPx: { widthPx: 800, heightPx: 1000 },
        totalWords: 1,
        lowConfidenceWords: 0,
        meanConfidence: 90,
        words: [
          {
            text: 'x',
            confidence: 90,
            imgRect: { x0: 0, y0: 0, x1: 10, y1: 10 },
            pdfRect: null,
          },
        ],
        durationMs: 100,
      },
    ];
    const r = await composeSearchablePdf(original, results);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('page_out_of_range');
  });

  it('returns load_failed for non-PDF input', async () => {
    const r = await composeSearchablePdf(new Uint8Array([0xff, 0xff, 0xff]), []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('load_failed');
  });

  it('skips zero-text words without crashing', async () => {
    const original = await makeBlankPdf();
    const results: OcrPageResult[] = [
      {
        pageIndex: 0,
        imgDimsPx: { widthPx: 800, heightPx: 1000 },
        totalWords: 1,
        lowConfidenceWords: 0,
        meanConfidence: 0,
        words: [
          {
            text: '',
            confidence: 0,
            imgRect: { x0: 0, y0: 0, x1: 10, y1: 10 },
            pdfRect: null,
          },
        ],
        durationMs: 100,
      },
    ];
    const r = await composeSearchablePdf(original, results);
    expect(r.ok).toBe(true);
  });
});
