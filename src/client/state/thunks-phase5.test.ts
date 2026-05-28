// Phase 5 thunks tests — Riley Wave 20.
// Validates the renderer-side IPC choreography: thunks dispatch the right
// slice actions in response to apiOcr.* return values, and progress events
// flow through the slice via subscribeOcrProgress.
//
// We mock `window.pdfApi.ocr` via vi.stubGlobal — same pattern as the Phase 4
// pades-sign-modal test. The thunks read `apiOcr` (a Proxy over window.pdfApi),
// so stubbing the global is sufficient to redirect IPC calls.

import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type LanguagePack,
  type OcrJobRowDto,
  type OcrJobSummary,
  type OcrPageResult,
  type OcrProgressEvent,
  type PDFDocumentModel,
} from '../types/ipc-contract';

import documentReducer, { setDocument } from './slices/document-slice';
import ocrReducer, { type OcrState } from './slices/ocr-slice';
import uiReducer from './slices/ui-slice';
import {
  cancelOcrJobThunk,
  detectLanguagesThunk,
  downloadLanguagePackThunk,
  loadOcrResultsThunk,
  removeLanguagePackThunk,
  runOcrOnDocumentThunk,
  runOcrOnPageThunk,
  subscribeOcrPackDownloadProgress,
  subscribeOcrProgress,
} from './thunks-phase5';

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
function dispatchThunk(store: AnyStore, thunk: unknown): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (store.dispatch as any)(thunk);
}

function getOcr(store: AnyStore): OcrState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (store.getState() as any).ocr as OcrState;
}

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 't.pdf',
  fileHash: 'doc-sha256',
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

const ENG_PACK: LanguagePack = {
  lang: 'eng',
  displayName: 'English',
  source: 'bundled',
  sizeBytes: 10_485_760,
  sha256: 'a'.repeat(64),
  installedAt: 0,
  lastUsedAt: null,
};

const PAGE_RESULT: OcrPageResult = {
  pageIndex: 0,
  imgDimsPx: { widthPx: 1700, heightPx: 2200 },
  totalWords: 100,
  lowConfidenceWords: 5,
  meanConfidence: 87,
  words: [],
  durationMs: 1200,
};

const COMPLETED_SUMMARY: OcrJobSummary = {
  jobId: 42,
  pageRange: { start: 0, end: 2 },
  langs: ['eng'],
  status: 'completed',
  totalWords: 300,
  meanConfidence: 87,
  totalDurationMs: 3600,
  pageResults: [PAGE_RESULT],
};

describe('thunks-phase5', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('detectLanguagesThunk', () => {
    it('populates installed + downloadable + defaultLang on success', async () => {
      const detectLanguages = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          installed: [ENG_PACK],
          downloadable: [
            {
              lang: 'spa',
              displayName: 'Spanish',
              sizeBytes: 1024,
              sha256: 'b'.repeat(64),
            },
          ],
          defaultLang: 'eng',
        },
      });
      vi.stubGlobal('pdfApi', { ocr: { detectLanguages } });
      const store = makeStore();
      await dispatchThunk(store, detectLanguagesThunk());
      const s = getOcr(store);
      expect(s.installedPacks).toHaveLength(1);
      expect(s.downloadablePacks).toHaveLength(1);
      expect(s.defaultLang).toBe('eng');
      expect(detectLanguages).toHaveBeenCalledTimes(1);
    });

    it('surfaces an error on catalog_load_failed', async () => {
      const detectLanguages = vi.fn().mockResolvedValue({
        ok: false,
        error: 'catalog_load_failed',
        message: 'catalog parse error',
      });
      vi.stubGlobal('pdfApi', { ocr: { detectLanguages } });
      const store = makeStore();
      await dispatchThunk(store, detectLanguagesThunk());
      expect(getOcr(store).lastError).toBe('catalog parse error');
    });
  });

  describe('runOcrOnPageThunk', () => {
    it('returns the page result on success', async () => {
      const runOnPage = vi.fn().mockResolvedValue({
        ok: true,
        value: { pageResult: PAGE_RESULT, durationMs: 1200 },
      });
      vi.stubGlobal('pdfApi', { ocr: { runOnPage } });
      const store = makeStore();
      const action = await dispatchThunk(
        store,
        runOcrOnPageThunk({
          handle: 1,
          pageIndex: 0,
          langs: ['eng'],
          preprocess: { deskew: true, denoise: false, contrastBoost: false },
        }),
      );
      // The thunk resolves with the action object; .payload carries the value.
      expect((action as { payload: { pageResult: OcrPageResult } }).payload.pageResult).toEqual(
        PAGE_RESULT,
      );
    });

    it('records the error message and resolves with null on failure', async () => {
      const runOnPage = vi.fn().mockResolvedValue({
        ok: false,
        error: 'language_pack_not_installed',
        message: 'pack missing',
      });
      vi.stubGlobal('pdfApi', { ocr: { runOnPage } });
      const store = makeStore();
      await dispatchThunk(
        store,
        runOcrOnPageThunk({
          handle: 1,
          pageIndex: 0,
          langs: ['eng'],
          preprocess: { deskew: true, denoise: false, contrastBoost: false },
        }),
      );
      expect(getOcr(store).lastError).toBe('pack missing');
    });
  });

  describe('runOcrOnDocumentThunk', () => {
    it('resolves "all pages" against the current document', async () => {
      const runOnDocument = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          jobId: 42,
          summary: COMPLETED_SUMMARY,
          op: { kind: 'ocr-text-behind-applied' } as unknown,
        },
      });
      vi.stubGlobal('pdfApi', { ocr: { runOnDocument } });
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      await dispatchThunk(
        store,
        runOcrOnDocumentThunk({
          handle: 1,
          pageRange: null,
          langs: ['eng'],
          preprocess: { deskew: true, denoise: false, contrastBoost: false },
        }),
      );
      // pageRange should have been resolved to the full doc range.
      const callArgs = runOnDocument.mock.calls[0][0] as {
        pageRange: { start: number; end: number };
      };
      expect(callArgs.pageRange).toEqual({ start: 0, end: 2 });
      expect(getOcr(store).currentSummary?.jobId).toBe(42);
      expect(getOcr(store).runStep).toBe('done');
    });

    it('bails out cleanly when no document is open', async () => {
      vi.stubGlobal('pdfApi', { ocr: {} });
      const store = makeStore();
      await dispatchThunk(
        store,
        runOcrOnDocumentThunk({
          handle: 1,
          pageRange: null,
          langs: ['eng'],
          preprocess: { deskew: true, denoise: false, contrastBoost: false },
        }),
      );
      expect(getOcr(store).lastError).toBe('No document open.');
    });

    it('routes "signed_pdf_requires_confirm" as a real error', async () => {
      const runOnDocument = vi.fn().mockResolvedValue({
        ok: false,
        error: 'signed_pdf_requires_confirm',
        message: 'doc has 1 PAdES signature',
      });
      vi.stubGlobal('pdfApi', { ocr: { runOnDocument } });
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      await dispatchThunk(
        store,
        runOcrOnDocumentThunk({
          handle: 1,
          pageRange: null,
          langs: ['eng'],
          preprocess: { deskew: true, denoise: false, contrastBoost: false },
        }),
      );
      expect(getOcr(store).lastError).toBe('doc has 1 PAdES signature');
      expect(getOcr(store).runStep).toBe('done');
    });

    it('treats explicit cancel as info-only (no error banner)', async () => {
      const runOnDocument = vi.fn().mockResolvedValue({
        ok: false,
        error: 'cancelled',
        message: 'user cancelled',
      });
      vi.stubGlobal('pdfApi', { ocr: { runOnDocument } });
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      await dispatchThunk(
        store,
        runOcrOnDocumentThunk({
          handle: 1,
          pageRange: null,
          langs: ['eng'],
          preprocess: { deskew: true, denoise: false, contrastBoost: false },
        }),
      );
      // Cancellation should NOT populate lastError.
      expect(getOcr(store).lastError).toBeNull();
      expect(getOcr(store).runStep).toBe('done');
    });
  });

  describe('cancelOcrJobThunk', () => {
    it('fires the IPC call with the right jobId', async () => {
      const cancelJob = vi.fn().mockResolvedValue({
        ok: true,
        value: { cancelled: true, pagesCompleted: 2 },
      });
      vi.stubGlobal('pdfApi', { ocr: { cancelJob } });
      const store = makeStore();
      await dispatchThunk(store, cancelOcrJobThunk({ jobId: 7 }));
      expect(cancelJob).toHaveBeenCalledWith({ jobId: 7 });
    });

    it('does NOT surface job_already_terminal as an error (idempotent cancel)', async () => {
      const cancelJob = vi.fn().mockResolvedValue({
        ok: false,
        error: 'job_already_terminal',
        message: 'too late',
      });
      vi.stubGlobal('pdfApi', { ocr: { cancelJob } });
      const store = makeStore();
      await dispatchThunk(store, cancelOcrJobThunk({ jobId: 7 }));
      expect(getOcr(store).lastError).toBeNull();
    });
  });

  describe('loadOcrResultsThunk', () => {
    it('clears the summary when no completed job exists for this doc', async () => {
      const listJobs = vi.fn().mockResolvedValue({
        ok: true,
        value: { jobs: [], total: 0 },
      });
      vi.stubGlobal('pdfApi', { ocr: { listJobs } });
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      await dispatchThunk(store, loadOcrResultsThunk());
      expect(getOcr(store).currentSummary).toBeNull();
      expect(listJobs.mock.calls[0][0]).toEqual({
        filters: { docHash: DOC.fileHash, status: 'completed' },
        limit: 1,
      });
    });

    it('hydrates a nullable-late-init summary from the latest job DTO', async () => {
      const jobDto: OcrJobRowDto = {
        id: 99,
        docHash: DOC.fileHash,
        pageRange: { start: 0, end: 2 },
        langs: ['eng'],
        preprocess: { deskew: true, denoise: false, contrastBoost: false },
        status: 'completed',
        startedAt: 0,
        completedAt: 1000,
        meanConfidence: 88,
        totalWords: 250,
        errorMessage: null,
        invalidatedSignatures: false,
        createdAt: 0,
      };
      const listJobs = vi.fn().mockResolvedValue({
        ok: true,
        value: { jobs: [jobDto], total: 1 },
      });
      vi.stubGlobal('pdfApi', { ocr: { listJobs } });
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      await dispatchThunk(store, loadOcrResultsThunk());
      const summary = getOcr(store).currentSummary;
      expect(summary).not.toBeNull();
      // The listJobs response is a SUMMARY dto, NOT the per-page words. Per
      // conventions §16.3.2, pageResults is null until a fresh runOnDocument
      // populates them. Critical: NOT a sentinel empty array.
      expect(summary?.pageResults).toBeNull();
      expect(summary?.totalWords).toBe(250);
    });
  });

  describe('downloadLanguagePackThunk', () => {
    it('refreshes the catalog after a successful download', async () => {
      const pack: LanguagePack = {
        ...ENG_PACK,
        lang: 'spa',
        displayName: 'Spanish',
        source: 'downloaded',
      };
      const languagePackDownload = vi.fn().mockResolvedValue({
        ok: true,
        value: { pack },
      });
      const detectLanguages = vi.fn().mockResolvedValue({
        ok: true,
        value: { installed: [ENG_PACK, pack], downloadable: [], defaultLang: 'eng' },
      });
      vi.stubGlobal('pdfApi', {
        ocr: { languagePackDownload, detectLanguages },
      });
      const store = makeStore();
      await dispatchThunk(store, downloadLanguagePackThunk({ lang: 'spa' }));
      expect(languagePackDownload).toHaveBeenCalledTimes(1);
      expect(detectLanguages).toHaveBeenCalledTimes(1);
      expect(getOcr(store).installedPacks).toHaveLength(2);
    });
  });

  describe('removeLanguagePackThunk', () => {
    it('refuses to remove the bundled pack (cannot_remove_bundled)', async () => {
      const languagePackRemove = vi.fn().mockResolvedValue({
        ok: false,
        error: 'cannot_remove_bundled',
        message: 'bundled packs cannot be removed',
      });
      vi.stubGlobal('pdfApi', { ocr: { languagePackRemove } });
      const store = makeStore();
      await dispatchThunk(store, removeLanguagePackThunk({ lang: 'eng' }));
      expect(getOcr(store).lastError).toBe('bundled packs cannot be removed');
    });
  });

  describe('subscribeOcrProgress', () => {
    it('dispatches startJobProgress on the first starting event', () => {
      const handlers: Array<(evt: OcrProgressEvent) => void> = [];
      const onProgress = vi.fn().mockImplementation((cb) => {
        handlers.push(cb);
        return () => {
          /* unsub */
        };
      });
      vi.stubGlobal('pdfApi', { ocr: { onProgress } });
      const store = makeStore();
      const unsub = subscribeOcrProgress(store.dispatch);
      expect(onProgress).toHaveBeenCalledTimes(1);
      const handler = handlers[0];
      expect(handler).toBeDefined();
      // Simulate main firing a starting event.
      handler?.({ jobId: 5, phase: 'starting', totalPages: 3 });
      const s = getOcr(store);
      expect(s.jobProgress?.jobId).toBe(5);
      expect(s.jobProgress?.totalPages).toBe(3);
      unsub();
    });
  });

  describe('subscribeOcrPackDownloadProgress', () => {
    it('dispatches applyDownloadProgressEvent for each event', () => {
      const handlers: Array<(evt: unknown) => void> = [];
      const onLanguagePackDownloadProgress = vi.fn().mockImplementation((cb) => {
        handlers.push(cb);
        return () => {
          /* unsub */
        };
      });
      vi.stubGlobal('pdfApi', { ocr: { onLanguagePackDownloadProgress } });
      const store = makeStore();
      const unsub = subscribeOcrPackDownloadProgress(store.dispatch);
      const handler = handlers[0];
      expect(handler).toBeDefined();
      handler?.({ lang: 'spa', phase: 'starting', totalBytes: 100 });
      handler?.({
        lang: 'spa',
        phase: 'downloading',
        bytesDownloaded: 50,
        totalBytes: 100,
      });
      const s = getOcr(store);
      expect(s.downloadProgress['spa']?.phase).toBe('downloading');
      expect(s.downloadProgress['spa']?.bytesDownloaded).toBe(50);
      unsub();
    });
  });
});
