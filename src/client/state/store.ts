import { configureStore } from '@reduxjs/toolkit';

import { formCommitMiddleware } from './middleware/form-commit-middleware';
import { historyMiddleware } from './middleware/history-middleware';
// Phase 7.5 Wave 5d (Riley) — C6 Accessibility Checker panel slice.
import accessibilityCheckReducer from './slices/accessibility-check-slice';
// Phase 7.5 Wave 5c (Riley) — C5 Alt Text inspector modal slice.
import altTextReducer from './slices/alt-text-slice';
import annotationsReducer from './slices/annotations-slice';
// Phase 7.5 Wave 5 (Riley) — B19 Auto-bookmark UI modal slice.
import autoBookmarkReducer from './slices/auto-bookmark-slice';
import bookmarksReducer from './slices/bookmarks-slice';
// Phase 7.5 Wave 5 (Riley) — B21 Document Properties dialog (+ B8 Security tab).
import documentPropertiesReducer from './slices/document-properties-slice';
import documentReducer from './slices/document-slice';
import exportReducer from './slices/export-slice';
import formsReducer from './slices/forms-slice';
import formsTemplatesReducer from './slices/forms-templates-slice';
import historyReducer from './slices/history-slice';
import i18nReducer from './slices/i18n-slice';
import linksReducer from './slices/links-slice';
import mailMergeReducer from './slices/mail-merge-slice';
// Phase 5
import ocrReducer from './slices/ocr-slice';
import pageDesignReducer from './slices/page-design-slice';
// Phase 7.5 Wave 5a (Riley) — C2 Preflight panel.
import preflightReducer from './slices/preflight-slice';
// Phase 7.5 Wave 5c (Riley) — C4 Reading Order overlay slice.
import readingOrderReducer from './slices/reading-order-slice';
import recentsReducer from './slices/recents-slice';
// Phase 7.4 B1
import redactionsReducer from './slices/redactions-slice';
// Phase 7.5 B12 (Riley Wave 3) — region clipboard.
import regionClipboardReducer from './slices/region-clipboard-slice';
// Phase 7.5 Wave 5 (Riley) — B20 Sanitize (Remove Hidden Information) modal.
import sanitizeReducer from './slices/sanitize-slice';
import scanReducer from './slices/scan-slice';
import selectionReducer from './slices/selection-slice';
// Phase 7
// Phase 4
import shapesReducer from './slices/shapes-slice';
import signatureAuditReducer from './slices/signature-audit-slice';
import signaturesReducer from './slices/signatures-slice';
// Phase 7.5 B7 (Riley Wave 3) — Stamps library.
import stampsReducer from './slices/stamps-slice';
// Phase 7.5 Wave 5b (Riley) — C3 Tag PDF structure-tree editor.
import structTreeReducer from './slices/struct-tree-slice';
// Phase 7.5 B4 / B13 (Riley Wave 4) — Page Design modal + hyperlinks.
import telemetryReducer from './slices/telemetry-slice';
// Phase 7.5 Wave 5a (Riley) — C1 Read Aloud floating bar.
import ttsReducer from './slices/tts-slice';
import uiReducer from './slices/ui-slice';
import updateReducer from './slices/update-slice';
import viewportReducer from './slices/viewport-slice';

export const store = configureStore({
  reducer: {
    document: documentReducer,
    viewport: viewportReducer,
    annotations: annotationsReducer,
    selection: selectionReducer,
    ui: uiReducer,
    recents: recentsReducer,
    bookmarks: bookmarksReducer,
    export: exportReducer,
    history: historyReducer,
    // Phase 3
    forms: formsReducer,
    mailMerge: mailMergeReducer,
    formsTemplates: formsTemplatesReducer,
    // Phase 4
    signatures: signaturesReducer,
    shapes: shapesReducer,
    signatureAudit: signatureAuditReducer,
    // Phase 5
    ocr: ocrReducer,
    scan: scanReducer,
    // Phase 7.4 B1
    redactions: redactionsReducer,
    // Phase 7.5 B7 / B12 (Riley Wave 3)
    stamps: stampsReducer,
    regionClipboard: regionClipboardReducer,
    // Phase 7.5 B4 / B13 (Riley Wave 4)
    pageDesign: pageDesignReducer,
    links: linksReducer,
    // Phase 7.5 Wave 5 (Riley) — B19 / B20 / B21+B8.
    autoBookmark: autoBookmarkReducer,
    sanitize: sanitizeReducer,
    documentProperties: documentPropertiesReducer,
    // Phase 7.5 Wave 5a (Riley) — C1 Read Aloud + C2 Preflight.
    tts: ttsReducer,
    preflight: preflightReducer,
    // Phase 7.5 Wave 5b (Riley) — C3 Tag PDF structure-tree editor.
    structTree: structTreeReducer,
    // Phase 7.5 Wave 5c (Riley) — C4 Reading Order overlay + C5 Alt Text inspector.
    readingOrder: readingOrderReducer,
    altText: altTextReducer,
    // Phase 7.5 Wave 5d (Riley) — C6 Accessibility Checker panel.
    accessibilityCheck: accessibilityCheckReducer,
    // Phase 7
    update: updateReducer,
    telemetry: telemetryReducer,
    i18n: i18nReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // We may temporarily hold non-serializable Uint8Array on payloads when
      // bridging save flows; per conventions §10 we don't keep them in store.
      // Phase 3: data-source bytes for the mail-merge wizard transit through
      // payload.bytes too (see mail-merge-slice.ts setDataPreview).
      serializableCheck: {
        ignoredActionPaths: [
          'payload.bytes',
          'payload.outputBytes',
          // Phase 3 mail-merge wizard sets ParsedDataPreview.bytes
          'payload.data.bytes',
          // Phase 4: signature capture payloads carry Uint8Array pngBytes/bytes
          'payload.source.pngBytes',
          'payload.source.bytes',
          'payload.captured.source.pngBytes',
          'payload.captured.source.bytes',
          // Phase 7.5 B4 (Riley Wave 4) — page-design watermark/background
          // image bytes transit through the slice form-state while the
          // modal is open; cleared on close.
          'payload.imageBytes',
        ],
        ignoredPaths: [
          // Phase 3: the mail-merge slice transiently holds the data-source bytes.
          'mailMerge.data.bytes',
          // Phase 4: captured signature carries pngBytes/bytes for placement
          // until applyVisual/applyPades ships them across IPC.
          'signatures.captured.source.pngBytes',
          'signatures.captured.source.bytes',
          // Phase 7.5 B4 (Riley Wave 4) — page-design form-state holds
          // user-picked watermark/background image bytes until Apply or Cancel.
          'pageDesign.watermark.imageBytes',
          'pageDesign.background.imageBytes',
        ],
      },
    }).concat(historyMiddleware, formCommitMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
