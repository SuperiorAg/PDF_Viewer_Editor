import { describe, expect, it } from 'vitest';

import { type PageModel } from '../types/ipc-contract';

import {
  pdfRectToScreen,
  rectToQuadPoints,
  screenPointToPdf,
  screenRectToPdf,
  type PageViewport,
} from './pdf-coords';

const page: PageModel = {
  pageIndex: 0,
  sourcePageRef: { kind: 'original', originalIndex: 0 },
  rotation: 0,
  width: 612, // 8.5"
  height: 792, // 11"
};

const viewport100: PageViewport = { width: 612, height: 792, scale: 1.0 };
const viewport200: PageViewport = { width: 1224, height: 1584, scale: 2.0 };

describe('pdfRectToScreen', () => {
  it('should y-flip a rect anchored at PDF origin to top-left screen', () => {
    // PDF rect of 100x50 at (0,0) — that's the bottom-left corner.
    // Screen y of its top-left corner should be height - 50 = 742.
    const result = pdfRectToScreen({ x: 0, y: 0, width: 100, height: 50 }, page, viewport100);
    expect(result).toEqual({ x: 0, y: 742, width: 100, height: 50 });
  });

  it('should y-flip a rect at PDF top-left to screen (0,0)', () => {
    // A rect at PDF (0, 742) with height 50 occupies y in [742, 792] — that's
    // the top of the page in PDF terms. Its top-left in screen coords is (0,0).
    const result = pdfRectToScreen({ x: 0, y: 742, width: 100, height: 50 }, page, viewport100);
    expect(result).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('should scale up at 2x zoom', () => {
    const result = pdfRectToScreen({ x: 0, y: 0, width: 100, height: 50 }, page, viewport200);
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
  });
});

describe('screenRectToPdf', () => {
  it('should be the inverse of pdfRectToScreen', () => {
    const original = { x: 50, y: 100, width: 200, height: 80 };
    const screen = pdfRectToScreen(original, page, viewport100);
    const round = screenRectToPdf(screen, page, viewport100);
    expect(round.x).toBeCloseTo(original.x);
    expect(round.y).toBeCloseTo(original.y);
    expect(round.width).toBeCloseTo(original.width);
    expect(round.height).toBeCloseTo(original.height);
  });
});

describe('screenPointToPdf', () => {
  it('should map top-left screen to top of page in PDF', () => {
    const result = screenPointToPdf({ x: 0, y: 0 }, page, viewport100);
    expect(result).toEqual({ x: 0, y: 792 });
  });
  it('should map bottom-left screen to PDF origin', () => {
    const result = screenPointToPdf({ x: 0, y: 792 }, page, viewport100);
    expect(result).toEqual({ x: 0, y: 0 });
  });
});

describe('rectToQuadPoints', () => {
  it('should return 8 numbers in top-left-first pdf-lib convention', () => {
    const result = rectToQuadPoints({ x: 10, y: 20, width: 30, height: 40 });
    // left=10, right=40, bottom=20, top=60
    // TL, TR, BL, BR
    expect(result).toEqual([10, 60, 40, 60, 10, 20, 40, 20]);
  });
});
