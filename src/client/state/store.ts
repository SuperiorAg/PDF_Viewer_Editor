import { configureStore } from '@reduxjs/toolkit';

import { formCommitMiddleware } from './middleware/form-commit-middleware';
import { historyMiddleware } from './middleware/history-middleware';
import annotationsReducer from './slices/annotations-slice';
import bookmarksReducer from './slices/bookmarks-slice';
import documentReducer from './slices/document-slice';
import exportReducer from './slices/export-slice';
import formsReducer from './slices/forms-slice';
import formsTemplatesReducer from './slices/forms-templates-slice';
import historyReducer from './slices/history-slice';
import i18nReducer from './slices/i18n-slice';
import mailMergeReducer from './slices/mail-merge-slice';
// Phase 5
import ocrReducer from './slices/ocr-slice';
import recentsReducer from './slices/recents-slice';
// Phase 7.4 B1
import redactionsReducer from './slices/redactions-slice';
// Phase 7.5 B12 (Riley Wave 3) — region clipboard.
import regionClipboardReducer from './slices/region-clipboard-slice';
import scanReducer from './slices/scan-slice';
import selectionReducer from './slices/selection-slice';
// Phase 7
// Phase 4
import shapesReducer from './slices/shapes-slice';
import signatureAuditReducer from './slices/signature-audit-slice';
import signaturesReducer from './slices/signatures-slice';
// Phase 7.5 B7 (Riley Wave 3) — Stamps library.
import stampsReducer from './slices/stamps-slice';
import telemetryReducer from './slices/telemetry-slice';
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
        ],
        ignoredPaths: [
          // Phase 3: the mail-merge slice transiently holds the data-source bytes.
          'mailMerge.data.bytes',
          // Phase 4: captured signature carries pngBytes/bytes for placement
          // until applyVisual/applyPades ships them across IPC.
          'signatures.captured.source.pngBytes',
          'signatures.captured.source.bytes',
        ],
      },
    }).concat(historyMiddleware, formCommitMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
