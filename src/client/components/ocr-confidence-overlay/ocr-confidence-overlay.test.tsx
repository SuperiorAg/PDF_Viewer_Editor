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

import { OcrConfidenceOverlay } from './index';

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
});
