// OCR slice unit tests — Phase 5.
// Validates reducer behavior, late-init discipline, and the "no sentinel
// default" contract from conventions §16.3.

import { describe, expect, it } from 'vitest';

import {
  type LanguagePack,
  type LanguagePackCatalogEntry,
  type OcrJobSummary,
  type OcrPageResult,
  type OcrProgressEvent,
} from '../../types/ipc-contract';

import ocrReducer, {
  acknowledgeInvalidateSignatures,
  applyDownloadProgressEvent,
  applyProgressEvent,
  clearJobProgress,
  closeOcrModal,
  openLanguagePackManagerModal,
  openRunModal,
  openScanPlaceholderModal,
  setCurrentSummary,
  setDefaultLang,
  setDownloadablePacks,
  setDraftLangs,
  setDraftPageRange,
  setDraftPreprocess,
  setInstalledPacks,
  setLowConfidenceThreshold,
  setOcrError,
  setOverlayVisible,
  setResultsPanelSearch,
  setRunStep,
  startJobProgress,
  toggleDraftLang,
  toggleOverlay,
  resetOcrState,
} from './ocr-slice';

const ENG_PACK: LanguagePack = {
  lang: 'eng',
  displayName: 'English',
  source: 'bundled',
  sizeBytes: 10_485_760,
  sha256: 'a'.repeat(64),
  installedAt: 0,
  lastUsedAt: null,
};

const SPA_CATALOG: LanguagePackCatalogEntry = {
  lang: 'spa',
  displayName: 'Spanish',
  sizeBytes: 9_437_184,
  sha256: 'b'.repeat(64),
};

const SAMPLE_PAGE_RESULT: OcrPageResult = {
  pageIndex: 0,
  imgDimsPx: { widthPx: 1700, heightPx: 2200 },
  totalWords: 250,
  lowConfidenceWords: 12,
  meanConfidence: 86.4,
  words: [
    {
      text: 'hello',
      confidence: 92,
      imgRect: { x0: 0, y0: 0, x1: 50, y1: 12 },
      pdfRect: { x: 0, y: 780, width: 30, height: 8 },
    },
    {
      text: 'wor1d',
      confidence: 45,
      imgRect: { x0: 60, y0: 0, x1: 110, y1: 12 },
      pdfRect: { x: 35, y: 780, width: 30, height: 8 },
    },
  ],
  durationMs: 4200,
};

describe('ocr-slice', () => {
  describe('initial state', () => {
    it('initializes with nullable late-init fields, NOT sentinel defaults', () => {
      const s = ocrReducer(undefined, { type: 'ocr/_init' } as never);
      // Per conventions §16.3.2: pageResults is null at init, not [].
      // The slice's currentSummary uses the same pattern; here we verify
      // both the summary slot and the per-page cache start empty.
      expect(s.currentSummary).toBeNull();
      expect(s.pageResultsByPage).toEqual({});
      expect(s.jobProgress).toBeNull();
      expect(s.lastError).toBeNull();
      // The threshold default IS a sentinel (60 per P5-L-6) — but it's an
      // intentional UI cutoff, not data that pretends to be missing.
      expect(s.lowConfidenceThreshold).toBe(60);
      expect(s.draft.langs).toEqual(['eng']);
      expect(s.draft.pageRange).toBeNull();
      expect(s.draft.preprocess).toEqual({
        deskew: true,
        denoise: false,
        contrastBoost: false,
      });
    });
  });

  describe('modal lifecycle', () => {
    it('opens the run modal and resets the draft step + error', () => {
      let s = ocrReducer(undefined, { type: 'ocr/_init' } as never);
      s = ocrReducer(s, setOcrError('boom'));
      s = ocrReducer(s, setRunStep('done'));
      s = ocrReducer(s, openRunModal());
      expect(s.openModal).toBe('run');
      expect(s.runStep).toBe('configure');
      expect(s.lastError).toBeNull();
    });

    it('opens the language pack manager modal', () => {
      const s = ocrReducer(undefined, openLanguagePackManagerModal());
      expect(s.openModal).toBe('language-pack-manager');
    });

    it('opens the scan placeholder modal', () => {
      const s = ocrReducer(undefined, openScanPlaceholderModal());
      expect(s.openModal).toBe('scan-placeholder');
    });

    it('closes the modal and resets the run step', () => {
      let s = ocrReducer(undefined, openRunModal());
      s = ocrReducer(s, setRunStep('done'));
      s = ocrReducer(s, closeOcrModal());
      expect(s.openModal).toBe('none');
      expect(s.runStep).toBe('configure');
    });
  });

  describe('draft mutations', () => {
    it('sets the langs array directly', () => {
      const s = ocrReducer(undefined, setDraftLangs(['eng', 'spa']));
      expect(s.draft.langs).toEqual(['eng', 'spa']);
    });

    it('toggles a lang on and off', () => {
      let s = ocrReducer(undefined, toggleDraftLang('spa'));
      expect(s.draft.langs).toContain('spa');
      expect(s.draft.langs).toContain('eng');
      s = ocrReducer(s, toggleDraftLang('spa'));
      expect(s.draft.langs).not.toContain('spa');
    });

    it('refuses to remove the LAST lang via toggle (must keep at least one)', () => {
      // Initial state has ['eng']; toggling eng off would leave [].
      const s = ocrReducer(undefined, toggleDraftLang('eng'));
      // After toggle, eng is still present because it's the last lang.
      expect(s.draft.langs).toEqual(['eng']);
    });

    it('sets the page range and clears it via null', () => {
      let s = ocrReducer(undefined, setDraftPageRange({ start: 2, end: 5 }));
      expect(s.draft.pageRange).toEqual({ start: 2, end: 5 });
      s = ocrReducer(s, setDraftPageRange(null));
      expect(s.draft.pageRange).toBeNull();
    });

    it('merges partial preprocess updates', () => {
      let s = ocrReducer(undefined, setDraftPreprocess({ denoise: true }));
      expect(s.draft.preprocess.denoise).toBe(true);
      // deskew stays at its initial true value.
      expect(s.draft.preprocess.deskew).toBe(true);
      s = ocrReducer(s, setDraftPreprocess({ contrastBoost: true }));
      expect(s.draft.preprocess).toEqual({
        deskew: true,
        denoise: true,
        contrastBoost: true,
      });
    });

    it('records the invalidate-signatures acknowledgement', () => {
      const s = ocrReducer(undefined, acknowledgeInvalidateSignatures(true));
      expect(s.draft.invalidateSignaturesAcknowledged).toBe(true);
    });
  });

  describe('catalog hydration', () => {
    it('sets installed packs', () => {
      const s = ocrReducer(undefined, setInstalledPacks([ENG_PACK]));
      expect(s.installedPacks).toHaveLength(1);
      expect(s.installedPacks[0]?.lang).toBe('eng');
    });

    it('sets downloadable packs', () => {
      const s = ocrReducer(undefined, setDownloadablePacks([SPA_CATALOG]));
      expect(s.downloadablePacks[0]?.lang).toBe('spa');
    });

    it('sets the default lang from detectLanguages', () => {
      const s = ocrReducer(undefined, setDefaultLang('spa'));
      expect(s.defaultLang).toBe('spa');
    });
  });

  describe('job progress', () => {
    it('starts a job and transitions to running', () => {
      const s = ocrReducer(undefined, startJobProgress({ jobId: 42, totalPages: 5 }));
      expect(s.jobProgress).not.toBeNull();
      expect(s.jobProgress?.jobId).toBe(42);
      expect(s.jobProgress?.totalPages).toBe(5);
      expect(s.jobProgress?.pageIndex).toBe(-1);
      expect(s.runStep).toBe('running');
    });

    it('applies a recognizing progress event', () => {
      let s = ocrReducer(undefined, startJobProgress({ jobId: 1, totalPages: 3 }));
      const evt: OcrProgressEvent = {
        jobId: 1,
        phase: 'recognizing',
        pageIndex: 1,
        totalPages: 3,
        confidenceSoFar: 87.5,
      };
      s = ocrReducer(s, applyProgressEvent(evt));
      expect(s.jobProgress?.phase).toBe('recognizing');
      expect(s.jobProgress?.pageIndex).toBe(1);
      expect(s.jobProgress?.confidenceSoFar).toBe(87.5);
    });

    it('drops stale-jobId progress events silently', () => {
      let s = ocrReducer(undefined, startJobProgress({ jobId: 1, totalPages: 3 }));
      const evt: OcrProgressEvent = {
        jobId: 999,
        phase: 'recognizing',
        pageIndex: 5,
        totalPages: 10,
        confidenceSoFar: 50,
      };
      s = ocrReducer(s, applyProgressEvent(evt));
      // The stale event is ignored; pageIndex stays at -1.
      expect(s.jobProgress?.pageIndex).toBe(-1);
    });

    it('completes a job, populates the summary, and transitions to done', () => {
      let s = ocrReducer(undefined, startJobProgress({ jobId: 7, totalPages: 1 }));
      const summary: OcrJobSummary = {
        jobId: 7,
        pageRange: { start: 0, end: 0 },
        langs: ['eng'],
        status: 'completed',
        totalWords: 250,
        meanConfidence: 86.4,
        totalDurationMs: 4200,
        pageResults: [SAMPLE_PAGE_RESULT],
      };
      s = ocrReducer(s, applyProgressEvent({ jobId: 7, phase: 'completed', summary }));
      expect(s.currentSummary).toEqual(summary);
      expect(s.runStep).toBe('done');
      // Page results are indexed by pageIndex for fast lookup.
      expect(s.pageResultsByPage[0]).toEqual(SAMPLE_PAGE_RESULT);
    });

    it('clears job progress on demand', () => {
      let s = ocrReducer(undefined, startJobProgress({ jobId: 1, totalPages: 3 }));
      s = ocrReducer(s, clearJobProgress());
      expect(s.jobProgress).toBeNull();
    });

    it('records the failure reason from a failed progress event', () => {
      let s = ocrReducer(undefined, startJobProgress({ jobId: 9, totalPages: 1 }));
      s = ocrReducer(
        s,
        applyProgressEvent({
          jobId: 9,
          phase: 'failed',
          pagesCompleted: 0,
          totalPages: 1,
          error: 'OCR engine crash',
        }),
      );
      expect(s.lastError).toBe('OCR engine crash');
      expect(s.runStep).toBe('done');
    });
  });

  describe('current summary', () => {
    it('sets a summary and indexes its pageResults', () => {
      const summary: OcrJobSummary = {
        jobId: 5,
        pageRange: { start: 0, end: 0 },
        langs: ['eng'],
        status: 'completed',
        totalWords: 250,
        meanConfidence: 86.4,
        totalDurationMs: 4200,
        pageResults: [SAMPLE_PAGE_RESULT],
      };
      const s = ocrReducer(undefined, setCurrentSummary(summary));
      expect(s.currentSummary).toEqual(summary);
      expect(s.pageResultsByPage[0]).toEqual(SAMPLE_PAGE_RESULT);
    });

    it('clears the page cache when summary becomes null', () => {
      let s = ocrReducer(
        undefined,
        setCurrentSummary({
          jobId: 5,
          pageRange: { start: 0, end: 0 },
          langs: ['eng'],
          status: 'completed',
          totalWords: 250,
          meanConfidence: 86.4,
          totalDurationMs: 4200,
          pageResults: [SAMPLE_PAGE_RESULT],
        }),
      );
      expect(s.pageResultsByPage[0]).toBeDefined();
      s = ocrReducer(s, setCurrentSummary(null));
      expect(s.currentSummary).toBeNull();
      expect(s.pageResultsByPage).toEqual({});
    });

    it('handles a summary with null pageResults (the late-init contract)', () => {
      // listJobs returns DTOs without per-page words. The summary slot accepts
      // that nullable form per conventions §16.3.2 — null != empty array.
      const s = ocrReducer(
        undefined,
        setCurrentSummary({
          jobId: 5,
          pageRange: { start: 0, end: 9 },
          langs: ['eng'],
          status: 'completed',
          totalWords: 0,
          meanConfidence: 0,
          totalDurationMs: 0,
          pageResults: null,
        }),
      );
      expect(s.currentSummary?.pageResults).toBeNull();
      // The page cache should stay empty (we didn't have words to index).
      expect(s.pageResultsByPage).toEqual({});
    });
  });

  describe('download progress', () => {
    it('applies a starting event', () => {
      const s = ocrReducer(
        undefined,
        applyDownloadProgressEvent({
          lang: 'spa',
          phase: 'starting',
          totalBytes: 9_437_184,
        }),
      );
      expect(s.downloadProgress['spa']?.phase).toBe('starting');
      expect(s.downloadProgress['spa']?.totalBytes).toBe(9_437_184);
    });

    it('updates bytes during downloading', () => {
      let s = ocrReducer(
        undefined,
        applyDownloadProgressEvent({
          lang: 'spa',
          phase: 'starting',
          totalBytes: 100,
        }),
      );
      s = ocrReducer(
        s,
        applyDownloadProgressEvent({
          lang: 'spa',
          phase: 'downloading',
          bytesDownloaded: 50,
          totalBytes: 100,
        }),
      );
      expect(s.downloadProgress['spa']?.phase).toBe('downloading');
      expect(s.downloadProgress['spa']?.bytesDownloaded).toBe(50);
    });

    it('records failure reason', () => {
      const s = ocrReducer(
        undefined,
        applyDownloadProgressEvent({
          lang: 'spa',
          phase: 'failed',
          error: 'integrity check failed',
        }),
      );
      expect(s.downloadProgress['spa']?.error).toBe('integrity check failed');
    });
  });

  describe('overlay + threshold', () => {
    it('toggles overlay visibility', () => {
      let s = ocrReducer(undefined, toggleOverlay());
      expect(s.overlayVisible).toBe(true);
      s = ocrReducer(s, toggleOverlay());
      expect(s.overlayVisible).toBe(false);
    });

    it('sets overlay visibility explicitly', () => {
      const s = ocrReducer(undefined, setOverlayVisible(true));
      expect(s.overlayVisible).toBe(true);
    });

    it('clamps threshold to 0..100', () => {
      let s = ocrReducer(undefined, setLowConfidenceThreshold(-10));
      expect(s.lowConfidenceThreshold).toBe(0);
      s = ocrReducer(s, setLowConfidenceThreshold(200));
      expect(s.lowConfidenceThreshold).toBe(100);
      s = ocrReducer(s, setLowConfidenceThreshold(45));
      expect(s.lowConfidenceThreshold).toBe(45);
    });
  });

  describe('panel search', () => {
    it('records the search filter', () => {
      const s = ocrReducer(undefined, setResultsPanelSearch('hello'));
      expect(s.resultsPanelSearch).toBe('hello');
    });
  });

  describe('reset', () => {
    it('returns to initial state', () => {
      let s = ocrReducer(undefined, openRunModal());
      s = ocrReducer(s, setDraftLangs(['eng', 'spa']));
      s = ocrReducer(s, setOverlayVisible(true));
      s = ocrReducer(s, resetOcrState());
      expect(s.openModal).toBe('none');
      expect(s.draft.langs).toEqual(['eng']);
      expect(s.overlayVisible).toBe(false);
    });
  });
});
