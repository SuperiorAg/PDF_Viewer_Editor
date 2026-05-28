// OCR selectors — Phase 5. Memoized derived data for the OCR run modal,
// language-pack manager, confidence overlay, and results panel.
//
// Selectors here read ONLY from state.ocr; cross-slice selectors live in
// document-parameterized-selectors.ts (Phase 5 has none yet).

import { createSelector } from '@reduxjs/toolkit';

import { type OcrPageResult, type OcrWord } from '../../types/ipc-contract';
import { type RootState } from '../store';

export const selectOcrOpenModal = (s: RootState) => s.ocr.openModal;
export const selectOcrRunStep = (s: RootState) => s.ocr.runStep;
export const selectOcrDraft = (s: RootState) => s.ocr.draft;
export const selectOcrJobProgress = (s: RootState) => s.ocr.jobProgress;
export const selectOcrCurrentSummary = (s: RootState) => s.ocr.currentSummary;
export const selectOcrInstalledPacks = (s: RootState) => s.ocr.installedPacks;
export const selectOcrDownloadablePacks = (s: RootState) => s.ocr.downloadablePacks;
export const selectOcrDownloadProgress = (s: RootState) => s.ocr.downloadProgress;
export const selectOcrDefaultLang = (s: RootState) => s.ocr.defaultLang;
export const selectOcrOverlayVisible = (s: RootState) => s.ocr.overlayVisible;
export const selectOcrLowConfidenceThreshold = (s: RootState) => s.ocr.lowConfidenceThreshold;
export const selectOcrLastError = (s: RootState) => s.ocr.lastError;
export const selectOcrPageResultsByPage = (s: RootState) => s.ocr.pageResultsByPage;
export const selectOcrResultsPanelSearch = (s: RootState) => s.ocr.resultsPanelSearch;

// Derived ---------------------------------------------------------------------

/**
 * Per-page OCR result for the current document at a given page index.
 * Returns null when no OCR has run (or no result is loaded for this page yet).
 * Per the sentinel-default lesson, consumers must handle the null case
 * explicitly — NOT treat it as "zero words".
 */
export const makeSelectOcrPageResult = (pageIndex: number) =>
  createSelector(selectOcrPageResultsByPage, (byPage): OcrPageResult | null => {
    return byPage[pageIndex] ?? null;
  });

/**
 * Low-confidence words for a given page, filtered by the current threshold.
 * Returns an empty array when:
 *   - no OCR result for this page yet, OR
 *   - all words are above threshold.
 * Pure derived data — does NOT mutate words; only filters.
 */
export const makeSelectLowConfidenceWords = (pageIndex: number) =>
  createSelector(
    [makeSelectOcrPageResult(pageIndex), selectOcrLowConfidenceThreshold],
    (result, threshold): OcrWord[] => {
      if (result === null) return [];
      return result.words.filter((w) => w.confidence < threshold);
    },
  );

/**
 * All recognized words across the document, flattened with their page index.
 * Used by the results panel for search + per-page jump.
 */
export const selectAllRecognizedWords = createSelector(
  selectOcrPageResultsByPage,
  (byPage): Array<OcrWord & { pageIndex: number }> => {
    const out: Array<OcrWord & { pageIndex: number }> = [];
    // Iterate page indices in numeric order so the panel scrolls in reading order.
    const keys = Object.keys(byPage)
      .map((k) => Number(k))
      .sort((a, b) => a - b);
    for (const pi of keys) {
      const r = byPage[pi];
      if (!r) continue;
      for (const w of r.words) out.push({ ...w, pageIndex: pi });
    }
    return out;
  },
);

/**
 * Filtered recognized words for the results panel — applies the panel's
 * search-text filter (case-insensitive substring match against the word's
 * recognized text).
 */
export const selectFilteredRecognizedWords = createSelector(
  [selectAllRecognizedWords, selectOcrResultsPanelSearch],
  (words, search): Array<OcrWord & { pageIndex: number }> => {
    if (search.trim().length === 0) return words;
    const needle = search.toLowerCase();
    return words.filter((w) => w.text.toLowerCase().includes(needle));
  },
);

/**
 * Whether a non-bundled language pack has been installed.
 * Used by the run modal to disable the "Download more…" button while a
 * download is in flight.
 */
export const selectIsAnyDownloadInFlight = createSelector(
  selectOcrDownloadProgress,
  (progress): boolean => {
    return Object.values(progress).some(
      (p) => p.phase === 'starting' || p.phase === 'downloading' || p.phase === 'verifying',
    );
  },
);
