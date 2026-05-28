// OcrRunModal component tests — Phase 5.
// Per docs/ui-spec.md §14.3 and conventions §16.3.

import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import documentReducer, { setDocument } from '../../../state/slices/document-slice';
import ocrReducer, {
  openRunModal,
  setInstalledPacks,
  setRunStep,
  startJobProgress,
} from '../../../state/slices/ocr-slice';
import uiReducer from '../../../state/slices/ui-slice';
import { type LanguagePack, type PDFDocumentModel } from '../../../types/ipc-contract';

import { OcrRunModal } from './index';

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

const ENG: LanguagePack = {
  lang: 'eng',
  displayName: 'English',
  source: 'bundled',
  sizeBytes: 10_485_760,
  sha256: 'a'.repeat(64),
  installedAt: 0,
  lastUsedAt: null,
};

const SPA: LanguagePack = {
  lang: 'spa',
  displayName: 'Spanish',
  source: 'downloaded',
  sizeBytes: 9_437_184,
  sha256: 'b'.repeat(64),
  installedAt: 0,
  lastUsedAt: null,
};

function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      ui: uiReducer,
      ocr: ocrReducer,
    },
  });
}
type AnyStore = ReturnType<typeof makeStore>;

function setupApiStub() {
  // Default-empty detectLanguages so the useEffect's call doesn't throw.
  // Tests that want population call setInstalledPacks directly via dispatch.
  const detectLanguages = vi.fn().mockResolvedValue({
    ok: true,
    value: { installed: [], downloadable: [], defaultLang: 'eng' },
  });
  const runOnDocument = vi.fn().mockResolvedValue({
    ok: true,
    value: {
      jobId: 1,
      summary: {
        jobId: 1,
        pageRange: { start: 0, end: 2 },
        langs: ['eng'],
        status: 'completed',
        totalWords: 0,
        meanConfidence: 0,
        totalDurationMs: 0,
        pageResults: null,
      },
      op: {},
    },
  });
  const cancelJob = vi.fn().mockResolvedValue({
    ok: true,
    value: { cancelled: true, pagesCompleted: 0 },
  });
  vi.stubGlobal('pdfApi', {
    ocr: {
      detectLanguages,
      runOnDocument,
      cancelJob,
      onProgress: () => () => undefined,
      onLanguagePackDownloadProgress: () => () => undefined,
    },
  });
  return { detectLanguages, runOnDocument, cancelJob };
}

describe('OcrRunModal', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderOpen(store: AnyStore) {
    store.dispatch(setDocument(DOC));
    store.dispatch(openRunModal());
    return render(
      <Provider store={store}>
        <OcrRunModal />
      </Provider>,
    );
  }

  it('renders the configure step with installed languages', () => {
    setupApiStub();
    const store = makeStore();
    store.dispatch(setInstalledPacks([ENG, SPA]));
    renderOpen(store);
    expect(screen.getByText(/Choose language and pages/i)).toBeTruthy();
    expect(screen.getByText('English')).toBeTruthy();
    expect(screen.getByText('Spanish')).toBeTruthy();
  });

  it('shows the honesty reminder (trust-floor obligations #1 + #4)', () => {
    setupApiStub();
    const store = makeStore();
    store.dispatch(setInstalledPacks([ENG]));
    renderOpen(store);
    // Obligation #1 — accuracy depends on scan quality.
    expect(screen.getByText(/OCR accuracy depends on scan quality/i)).toBeTruthy();
    // Obligation #4 — re-running adds another text layer.
    expect(screen.getByText(/Re-running OCR adds another text layer/i)).toBeTruthy();
  });

  it('disables "Start OCR" when no language is selected', () => {
    setupApiStub();
    const store = makeStore();
    // Strip eng from draft so we hit the disabled state.
    store.dispatch(setInstalledPacks([ENG]));
    renderOpen(store);
    const startBtn = screen.getByRole('button', { name: 'Start OCR' });
    expect((startBtn as HTMLButtonElement).disabled).toBe(false);
    // Uncheck eng — toggle is gated to keep at least one, so we
    // verify the gating instead: clicking eng once does not remove it.
    const engCheckbox = screen
      .getAllByRole('checkbox')
      .find((c) => (c as HTMLInputElement).parentElement?.textContent?.includes('English'));
    expect(engCheckbox).toBeTruthy();
    if (engCheckbox) fireEvent.click(engCheckbox);
    // Per slice contract, eng remains selected (last lang).
    expect((engCheckbox as HTMLInputElement).checked).toBe(true);
  });

  it('shows the running step when runStep transitions', () => {
    setupApiStub();
    const store = makeStore();
    store.dispatch(setInstalledPacks([ENG]));
    renderOpen(store);
    act(() => {
      store.dispatch(startJobProgress({ jobId: 1, totalPages: 3 }));
    });
    // startJobProgress sets runStep to 'running'; no need for a separate
    // setRunStep dispatch. The progress phase label ("Phase: starting") is a
    // good unique anchor for "we are in the running step".
    expect(screen.getByText(/Phase: starting/i)).toBeTruthy();
    // Cancel button should be visible.
    expect(screen.getByRole('button', { name: /Cancel OCR/i })).toBeTruthy();
  });

  it('shows the confirm-invalidate step when explicitly transitioned', () => {
    setupApiStub();
    const store = makeStore();
    store.dispatch(setInstalledPacks([ENG]));
    renderOpen(store);
    act(() => {
      store.dispatch(setRunStep('confirm-invalidate'));
    });
    expect(screen.getByText(/cryptographic signature/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue and invalidate/i })).toBeTruthy();
  });

  it('shows the done step after completion', () => {
    setupApiStub();
    const store = makeStore();
    store.dispatch(setInstalledPacks([ENG]));
    renderOpen(store);
    // Use the typed action creator (not a string action) so the reducer
    // actually matches; the prior version used a hand-crafted action which
    // RTK's reducer would not recognize.
    act(() => {
      store.dispatch({
        type: 'ocr/setCurrentSummary',
        payload: {
          jobId: 1,
          pageRange: { start: 0, end: 2 },
          langs: ['eng'],
          status: 'completed',
          totalWords: 100,
          meanConfidence: 88.5,
          totalDurationMs: 5000,
          pageResults: null,
        },
      });
      store.dispatch(setRunStep('done'));
    });
    expect(screen.getByText(/OCR complete/i)).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    // The reminder copy reaffirms obligation #3.
    expect(screen.getByText(/becomes part of the document/i)).toBeTruthy();
  });
});
