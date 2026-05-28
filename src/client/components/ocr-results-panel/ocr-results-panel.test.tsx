// OcrResultsPanel tests — Phase 5.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import documentReducer, { setDocument } from '../../state/slices/document-slice';
import ocrReducer, { setCurrentSummary, setResultsPanelSearch } from '../../state/slices/ocr-slice';
import uiReducer from '../../state/slices/ui-slice';
import viewportReducer from '../../state/slices/viewport-slice';
import { type OcrPageResult, type PDFDocumentModel } from '../../types/ipc-contract';

import { OcrResultsPanel } from './index';

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 't.pdf',
  fileHash: 'h',
  pageCount: 3,
  pages: Array.from({ length: 3 }, (_, i) => ({
    pageIndex: i,
    sourcePageRef: { kind: 'original' as const, originalIndex: i },
    rotation: 0 as const,
    width: 612,
    height: 792,
  })),
  annotations: [],
  dirtyOps: [],
  savedAtHandleVersion: 0,
  pdflibLoadWarnings: [],
};

const PAGE_RESULT: OcrPageResult = {
  pageIndex: 0,
  imgDimsPx: { widthPx: 1700, heightPx: 2200 },
  totalWords: 3,
  lowConfidenceWords: 1,
  meanConfidence: 70,
  words: [
    {
      text: 'hello',
      confidence: 92,
      imgRect: { x0: 0, y0: 0, x1: 30, y1: 12 },
      pdfRect: { x: 0, y: 780, width: 20, height: 8 },
    },
    {
      text: 'wor1d',
      confidence: 45,
      imgRect: { x0: 30, y0: 0, x1: 60, y1: 12 },
      pdfRect: { x: 30, y: 780, width: 20, height: 8 },
    },
    {
      text: 'again',
      confidence: 88,
      imgRect: { x0: 60, y0: 0, x1: 90, y1: 12 },
      pdfRect: { x: 60, y: 780, width: 20, height: 8 },
    },
  ],
  durationMs: 1000,
};

function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      ui: uiReducer,
      ocr: ocrReducer,
      viewport: viewportReducer,
    },
  });
}

describe('OcrResultsPanel', () => {
  it('renders an "open a PDF" empty state when no document is loaded', () => {
    const store = makeStore();
    render(
      <Provider store={store}>
        <OcrResultsPanel />
      </Provider>,
    );
    expect(screen.getByText(/Open a PDF to see OCR results/i)).toBeTruthy();
  });

  it('renders a "no OCR" empty state when no summary exists', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    render(
      <Provider store={store}>
        <OcrResultsPanel />
      </Provider>,
    );
    expect(screen.getByText(/No OCR has been run/i)).toBeTruthy();
    // The Run OCR + Manage packs buttons are always visible.
    expect(screen.getByRole('button', { name: /Run OCR/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Manage packs/i })).toBeTruthy();
  });

  it('shows the summary stats when OCR has been run', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setCurrentSummary({
        jobId: 1,
        pageRange: { start: 0, end: 2 },
        langs: ['eng'],
        status: 'completed',
        totalWords: 3,
        meanConfidence: 75,
        totalDurationMs: 1000,
        pageResults: [PAGE_RESULT],
      }),
    );
    render(
      <Provider store={store}>
        <OcrResultsPanel />
      </Provider>,
    );
    expect(screen.getByText('Words')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Mean confidence')).toBeTruthy();
    expect(screen.getByText('75.0')).toBeTruthy();
    // Word rows render with confidence values.
    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.getByText('wor1d')).toBeTruthy();
    expect(screen.getByText('again')).toBeTruthy();
  });

  it('filters words by search query', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setCurrentSummary({
        jobId: 1,
        pageRange: { start: 0, end: 2 },
        langs: ['eng'],
        status: 'completed',
        totalWords: 3,
        meanConfidence: 75,
        totalDurationMs: 1000,
        pageResults: [PAGE_RESULT],
      }),
    );
    store.dispatch(setResultsPanelSearch('hello'));
    render(
      <Provider store={store}>
        <OcrResultsPanel />
      </Provider>,
    );
    // Only "hello" should be visible; "wor1d" and "again" filter out.
    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.queryByText('wor1d')).toBeNull();
    expect(screen.queryByText('again')).toBeNull();
  });

  it('renders an empty-state when the search has no matches', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setCurrentSummary({
        jobId: 1,
        pageRange: { start: 0, end: 2 },
        langs: ['eng'],
        status: 'completed',
        totalWords: 3,
        meanConfidence: 75,
        totalDurationMs: 1000,
        pageResults: [PAGE_RESULT],
      }),
    );
    store.dispatch(setResultsPanelSearch('zzzzzz'));
    render(
      <Provider store={store}>
        <OcrResultsPanel />
      </Provider>,
    );
    expect(screen.getByText(/No words match/i)).toBeTruthy();
  });

  it('opens the run modal when the Run OCR button is clicked', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    render(
      <Provider store={store}>
        <OcrResultsPanel />
      </Provider>,
    );
    const btn = screen.getByRole('button', { name: 'Run OCR' });
    fireEvent.click(btn);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((store.getState() as any).ocr.openModal).toBe('run');
  });
});
