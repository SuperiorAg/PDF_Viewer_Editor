// OcrConfidenceOverlay tests — Phase 5.
// Validates threshold filtering, the null-pdfRect skip (sentinel-default
// lesson), and pointer-events discipline.

import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import ocrReducer, {
  setCurrentSummary,
  setLowConfidenceThreshold,
  setOverlayVisible,
} from '../../state/slices/ocr-slice';
import { type OcrJobSummary, type OcrPageResult } from '../../types/ipc-contract';

import { OcrConfidenceOverlay, projectRectToCss } from './index';

const PAGE_WIDTH_PTS = 612;
const PAGE_HEIGHT_PTS = 792;

function makeStore() {
  return configureStore({
    reducer: { ocr: ocrReducer },
  });
}

function makeSummary(pageResults: OcrPageResult[]): OcrJobSummary {
  return {
    jobId: 1,
    pageRange: { start: 0, end: pageResults.length - 1 },
    langs: ['eng'],
    status: 'completed',
    totalWords: pageResults.reduce((a, p) => a + p.totalWords, 0),
    meanConfidence: 85,
    totalDurationMs: 1000,
    pageResults,
  };
}

describe('OcrConfidenceOverlay', () => {
  it('renders nothing when overlay is disabled', () => {
    const store = makeStore();
    const { container } = render(
      <Provider store={store}>
        <OcrConfidenceOverlay
          pageIndex={0}
          pageWidthPts={PAGE_WIDTH_PTS}
          pageHeightPts={PAGE_HEIGHT_PTS}
          scale={1}
        />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders ONLY words below the threshold', () => {
    const store = makeStore();
    store.dispatch(setOverlayVisible(true));
    store.dispatch(setLowConfidenceThreshold(60));
    store.dispatch(
      setCurrentSummary(
        makeSummary([
          {
            pageIndex: 0,
            imgDimsPx: { widthPx: 1700, heightPx: 2200 },
            totalWords: 3,
            lowConfidenceWords: 1,
            meanConfidence: 70,
            words: [
              {
                text: 'good',
                confidence: 95,
                imgRect: { x0: 0, y0: 0, x1: 30, y1: 12 },
                pdfRect: { x: 0, y: 780, width: 20, height: 8 },
              },
              {
                text: 'qu1ck',
                confidence: 45,
                imgRect: { x0: 0, y0: 0, x1: 30, y1: 12 },
                pdfRect: { x: 50, y: 780, width: 20, height: 8 },
              },
              {
                text: 'br0wn',
                confidence: 30,
                imgRect: { x0: 0, y0: 0, x1: 30, y1: 12 },
                pdfRect: { x: 100, y: 780, width: 20, height: 8 },
              },
            ],
            durationMs: 1000,
          },
        ]),
      ),
    );
    const { container } = render(
      <Provider store={store}>
        <OcrConfidenceOverlay
          pageIndex={0}
          pageWidthPts={PAGE_WIDTH_PTS}
          pageHeightPts={PAGE_HEIGHT_PTS}
          scale={1}
        />
      </Provider>,
    );
    // 2 boxes should render: qu1ck (45) and br0wn (30). good (95) is above
    // the threshold and is NOT rendered.
    const boxes = container.querySelectorAll('[role="note"]');
    expect(boxes.length).toBe(2);
    // Banner reports the count.
    expect(screen.getByText(/2/)).toBeTruthy();
    expect(screen.getByText(/low-confidence/i)).toBeTruthy();
  });

  it('skips words with null pdfRect (sentinel-default lesson)', () => {
    const store = makeStore();
    store.dispatch(setOverlayVisible(true));
    store.dispatch(setLowConfidenceThreshold(60));
    store.dispatch(
      setCurrentSummary(
        makeSummary([
          {
            pageIndex: 0,
            imgDimsPx: { widthPx: 1700, heightPx: 2200 },
            totalWords: 2,
            lowConfidenceWords: 2,
            meanConfidence: 30,
            words: [
              {
                text: 'qu1ck',
                confidence: 45,
                imgRect: { x0: 0, y0: 0, x1: 30, y1: 12 },
                pdfRect: null,
              },
              {
                text: 'br0wn',
                confidence: 30,
                imgRect: { x0: 0, y0: 0, x1: 30, y1: 12 },
                pdfRect: { x: 100, y: 780, width: 20, height: 8 },
              },
            ],
            durationMs: 1000,
          },
        ]),
      ),
    );
    const { container } = render(
      <Provider store={store}>
        <OcrConfidenceOverlay
          pageIndex={0}
          pageWidthPts={PAGE_WIDTH_PTS}
          pageHeightPts={PAGE_HEIGHT_PTS}
          scale={1}
        />
      </Provider>,
    );
    // Only ONE box renders — the word with the null pdfRect is skipped.
    // The banner still shows count=2 (raw low-confidence words from the
    // filter); the renderer just doesn't paint a box for the unmappable one.
    const boxes = container.querySelectorAll('[role="note"]');
    expect(boxes.length).toBe(1);
  });

  it('re-filters when the threshold changes', () => {
    const store = makeStore();
    store.dispatch(setOverlayVisible(true));
    store.dispatch(setLowConfidenceThreshold(80));
    store.dispatch(
      setCurrentSummary(
        makeSummary([
          {
            pageIndex: 0,
            imgDimsPx: { widthPx: 1700, heightPx: 2200 },
            totalWords: 1,
            lowConfidenceWords: 1,
            meanConfidence: 70,
            words: [
              {
                text: 'mid',
                confidence: 70,
                imgRect: { x0: 0, y0: 0, x1: 30, y1: 12 },
                pdfRect: { x: 0, y: 780, width: 20, height: 8 },
              },
            ],
            durationMs: 1000,
          },
        ]),
      ),
    );
    const { container, rerender } = render(
      <Provider store={store}>
        <OcrConfidenceOverlay
          pageIndex={0}
          pageWidthPts={PAGE_WIDTH_PTS}
          pageHeightPts={PAGE_HEIGHT_PTS}
          scale={1}
        />
      </Provider>,
    );
    // Threshold 80 — "mid" (70) is below → 1 box.
    expect(container.querySelectorAll('[role="note"]').length).toBe(1);
    // Lower threshold to 50 — "mid" (70) is NOT below → 0 boxes.
    store.dispatch(setLowConfidenceThreshold(50));
    rerender(
      <Provider store={store}>
        <OcrConfidenceOverlay
          pageIndex={0}
          pageWidthPts={PAGE_WIDTH_PTS}
          pageHeightPts={PAGE_HEIGHT_PTS}
          scale={1}
        />
      </Provider>,
    );
    expect(container.querySelectorAll('[role="note"]').length).toBe(0);
  });

  it('returns null when no low-confidence words exist on this page', () => {
    const store = makeStore();
    store.dispatch(setOverlayVisible(true));
    store.dispatch(
      setCurrentSummary(
        makeSummary([
          {
            pageIndex: 0,
            imgDimsPx: { widthPx: 1700, heightPx: 2200 },
            totalWords: 1,
            lowConfidenceWords: 0,
            meanConfidence: 95,
            words: [
              {
                text: 'good',
                confidence: 95,
                imgRect: { x0: 0, y0: 0, x1: 30, y1: 12 },
                pdfRect: { x: 0, y: 780, width: 20, height: 8 },
              },
            ],
            durationMs: 1000,
          },
        ]),
      ),
    );
    const { container } = render(
      <Provider store={store}>
        <OcrConfidenceOverlay
          pageIndex={0}
          pageWidthPts={PAGE_WIDTH_PTS}
          pageHeightPts={PAGE_HEIGHT_PTS}
          scale={1}
        />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  // ============================================================================
  // Phase 5.2 Item C — rotated-page coordinate math (Riley, 2026-06-04)
  // ============================================================================

  describe('projectRectToCss (rotation math)', () => {
    // 612 x 792 = Letter portrait. Rect at bottom-left corner.
    const PAGE_W = 612;
    const PAGE_H = 792;
    const RECT = { x: 0, y: 0, width: 100, height: 20 };

    it('rotation=0 — pdf bottom-left becomes CSS bottom-left of an unrotated box', () => {
      const out = projectRectToCss(RECT, PAGE_W, PAGE_H, 1, 0);
      // PDF (0,0,100,20) → CSS top=(792-0-20)=772, left=0, w=100, h=20.
      expect(out).toEqual({ top: 772, left: 0, width: 100, height: 20 });
    });

    it('rotation=90 — pdf bottom-left becomes CSS top-left of the rotated box (w/h swap)', () => {
      const out = projectRectToCss(RECT, PAGE_W, PAGE_H, 1, 90);
      // PDF (0,0,100,20) → CSS top=0, left=0, w=20, h=100 (w/h swapped).
      expect(out).toEqual({ top: 0, left: 0, width: 20, height: 100 });
    });

    it('rotation=180 — pdf bottom-left becomes CSS top-right', () => {
      const out = projectRectToCss(RECT, PAGE_W, PAGE_H, 1, 180);
      // PDF (0,0,100,20) → CSS top=0, left=(612-0-100)=512, w=100, h=20.
      expect(out).toEqual({ top: 0, left: 512, width: 100, height: 20 });
    });

    it('rotation=270 — pdf bottom-left becomes CSS bottom-right (w/h swap)', () => {
      const out = projectRectToCss(RECT, PAGE_W, PAGE_H, 1, 270);
      // PDF (0,0,100,20) → CSS top=(612-0-100)=512, left=(792-0-20)=772, w=20, h=100.
      expect(out).toEqual({ top: 512, left: 772, width: 20, height: 100 });
    });

    it('scale=2 multiplies all coords/dims', () => {
      const out = projectRectToCss(RECT, PAGE_W, PAGE_H, 2, 0);
      expect(out).toEqual({ top: 1544, left: 0, width: 200, height: 40 });
    });
  });

  describe('rotated overlay (Phase 5.2 Item C)', () => {
    function makeRotatedSummary() {
      return makeSummary([
        {
          pageIndex: 0,
          imgDimsPx: { widthPx: 1700, heightPx: 2200 },
          totalWords: 1,
          lowConfidenceWords: 1,
          meanConfidence: 30,
          words: [
            {
              text: 'rot',
              confidence: 30,
              imgRect: { x0: 0, y0: 0, x1: 30, y1: 12 },
              // PDF (0, 0, 100, 20) — bottom-left of a 612x792 page.
              pdfRect: { x: 0, y: 0, width: 100, height: 20 },
            },
          ],
          durationMs: 1,
        },
      ]);
    }

    it('renders the box at the rotated coordinates when rotation=90', () => {
      const store = makeStore();
      store.dispatch(setOverlayVisible(true));
      store.dispatch(setLowConfidenceThreshold(60));
      store.dispatch(setCurrentSummary(makeRotatedSummary()));
      const { container } = render(
        <Provider store={store}>
          <OcrConfidenceOverlay
            pageIndex={0}
            pageWidthPts={612}
            pageHeightPts={792}
            scale={1}
            rotation={90}
          />
        </Provider>,
      );
      const boxes = container.querySelectorAll('[role="note"]');
      expect(boxes.length).toBe(1);
      const box = boxes[0] as HTMLElement;
      // 90° CW: top=0, left=0, w=20, h=100 — the rotated rect lives in the
      // top-left of the rotated CSS box (which is 792 wide x 612 tall).
      expect(box.style.top).toBe('0px');
      expect(box.style.left).toBe('0px');
      expect(box.style.width).toBe('20px');
      expect(box.style.height).toBe('100px');
    });

    it('renders the box at the rotated coordinates when rotation=270', () => {
      const store = makeStore();
      store.dispatch(setOverlayVisible(true));
      store.dispatch(setLowConfidenceThreshold(60));
      store.dispatch(setCurrentSummary(makeRotatedSummary()));
      const { container } = render(
        <Provider store={store}>
          <OcrConfidenceOverlay
            pageIndex={0}
            pageWidthPts={612}
            pageHeightPts={792}
            scale={1}
            rotation={270}
          />
        </Provider>,
      );
      const box = container.querySelector('[role="note"]') as HTMLElement;
      expect(box.style.top).toBe('512px');
      expect(box.style.left).toBe('772px');
      expect(box.style.width).toBe('20px');
      expect(box.style.height).toBe('100px');
    });

    it('defaults to rotation=0 when the prop is omitted (back-compat)', () => {
      const store = makeStore();
      store.dispatch(setOverlayVisible(true));
      store.dispatch(setLowConfidenceThreshold(60));
      store.dispatch(setCurrentSummary(makeRotatedSummary()));
      const { container } = render(
        <Provider store={store}>
          <OcrConfidenceOverlay pageIndex={0} pageWidthPts={612} pageHeightPts={792} scale={1} />
        </Provider>,
      );
      const box = container.querySelector('[role="note"]') as HTMLElement;
      // Unrotated bottom-left position.
      expect(box.style.top).toBe('772px');
      expect(box.style.left).toBe('0px');
      expect(box.style.width).toBe('100px');
      expect(box.style.height).toBe('20px');
    });
  });
});
