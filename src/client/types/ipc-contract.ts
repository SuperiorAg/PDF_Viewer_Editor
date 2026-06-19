// =============================================================================
// IPC Contract — renderer re-export from David's canonical contracts module.
// =============================================================================
// CANONICAL OWNER (per docs/api-contracts.md §0.3 and project-plan §2.1):
//   David's `src/ipc/contracts.ts` is the source of truth. The renderer used
//   to mirror this file verbatim while David's wave was outstanding; David's
//   file landed in Wave 2, so this module now just re-exports from there.
//
// Why keep this file at all (not delete and rewrite every import):
//   1. Renderer code uses a single import path (`'../../types/ipc-contract'`)
//      that's local to `src/client/`. Phase-2+ may want to add renderer-only
//      derived types here without polluting David's contract module.
//   2. If David's file is ever renamed or relocated, the swap is one edit.
//   3. ESLint's `no-restricted-imports` rule (per conventions §4.3) keeps the
//      renderer away from `@main/*` and `@db/*`; routing everything through
//      this gatekeeper file is the cleanest way to enforce that boundary.
//
// IMPORTANT: do not declare types here that conflict with David's contract.
// If you need a renderer-only derived type, add it BELOW the re-exports with a
// clear `// Renderer-only — not part of the IPC contract.` comment.
// =============================================================================

export type {
  // §1. Document handles
  DocumentHandle,
  FileHash,
  // Phase 4 — Signature placement + appearance
  SignaturePlacement,
  SignaturePlacementMode,
  VisualAppearanceSource,
  VisualAppearanceSpec,
  PadesAppearanceSpec,
  SignaturePayload,
  // Phase 4 — Signatures channels
  SignaturesCertLoadRequest,
  SignaturesCertLoadError,
  SignaturesCertLoadValue,
  SignaturesCertLoadResponse,
  SignaturesCertReleaseRequest,
  SignaturesCertReleaseError,
  SignaturesCertReleaseValue,
  SignaturesCertReleaseResponse,
  SignaturesApplyVisualRequest,
  SignaturesApplyVisualError,
  SignaturesApplyVisualValue,
  SignaturesApplyVisualResponse,
  SignaturesApplyPadesRequest,
  SignaturesApplyPadesError,
  SignaturesApplyPadesValue,
  SignaturesApplyPadesResponse,
  SignaturesRequestTimestampRequest,
  SignaturesRequestTimestampError,
  SignaturesRequestTimestampValue,
  SignaturesRequestTimestampResponse,
  SignaturesVerifyRequest,
  SignaturesVerifyError,
  SignaturesVerifyValue,
  SignaturesVerifyResponse,
  SignaturesListAuditRequest,
  SignaturesListAuditError,
  SignaturesListAuditValue,
  SignaturesListAuditResponse,
  SignatureAuditItem,
  // Phase 4 — Annotations channels (extension)
  ShapeAnnotationSubtype,
  ShapeAnnotationModel,
  AnnotationsAddShapeRequest,
  AnnotationsAddShapeError,
  AnnotationsAddShapeValue,
  AnnotationsAddShapeResponse,
  MeasureUnit,
  MeasureCalibration,
  AnnotationsSetMeasureCalibrationRequest,
  AnnotationsSetMeasureCalibrationError,
  AnnotationsSetMeasureCalibrationResponse,
  AnnotationsGetMeasureCalibrationRequest,
  AnnotationsGetMeasureCalibrationError,
  AnnotationsGetMeasureCalibrationValue,
  AnnotationsGetMeasureCalibrationResponse,
  PadesEngineChoice,
  LineEndStyle,
  AnnotationDefaultLineEndStyle,
  // §2. Annotation + page + edit-operation types
  AnnotationSubtype,
  PdfRect,
  RgbColor,
  SourcePageRef,
  PageModel,
  AnnotationModel,
  EditMeta,
  EditOperation,
  EditOperationSerialized,
  AnnotationModelSerialized,
  PDFDocumentModel,
  // Phase 2 — image embed + content-hash references (data-models §7.2)
  ImageMimeType,
  PdfImage,
  ImagePlacement,
  ImageEmbedPayload,
  // §3. dialog
  DialogOpenPdfRequest,
  DialogOpenPdfError,
  DialogOpenPdfValue,
  DialogOpenPdfResponse,
  DialogSaveAsRequest,
  DialogSaveAsError,
  DialogSaveAsValue,
  DialogSaveAsResponse,
  // Wave-30 follow-up (H-30.1): path-only PDF picker for the Combine modal.
  DialogPickPdfFilesRequest,
  DialogPickPdfFilesError,
  DialogPickPdfFilesValue,
  DialogPickPdfFilesResponse,
  // §4. fs
  FsReadPdfRequest,
  FsReadPdfError,
  FsReadPdfResponse,
  FsWritePdfRequest,
  FsWritePdfError,
  FsWritePdfValue,
  FsWritePdfResponse,
  FsClosePdfRequest,
  FsClosePdfError,
  FsClosePdfResponse,
  // §5. recents
  RecentsListRequest,
  RecentsListItem,
  RecentsListError,
  RecentsListResponse,
  RecentsAddRequest,
  RecentsAddError,
  RecentsAddResponse,
  RecentsClearRequest,
  RecentsClearError,
  RecentsClearResponse,
  // §6. settings
  SettingKey,
  SettingValue,
  SettingsGetRequest,
  SettingsGetError,
  SettingsGetResponse,
  SettingsSetRequest,
  SettingsSetError,
  SettingsSetResponse,
  SettingsGetAllRequest,
  SettingsGetAllValue,
  SettingsGetAllError,
  SettingsGetAllResponse,
  // §7. bookmarks
  BookmarksListRequest,
  BookmarkRow,
  BookmarksListError,
  BookmarksListResponse,
  BookmarksUpsertRequest,
  BookmarksUpsertError,
  BookmarksUpsertResponse,
  BookmarksDeleteRequest,
  BookmarksDeleteError,
  BookmarksDeleteResponse,
  // §8. pdf
  PdfCombineRequest,
  PdfCombineError,
  PdfCombineValue,
  PdfCombineResponse,
  ExportEnginePreference,
  PdfExportRequest,
  PdfExportError,
  PdfExportValue,
  PdfExportResponse,
  PdfExportProgressEvent,
  PdfGetOutlineRequest,
  OutlineNode,
  PdfGetOutlineError,
  PdfGetOutlineResponse,
  // §9. app
  AppGetVersionRequest,
  AppGetVersionValue,
  AppGetVersionResponse,
  AppQuitRequest,
  AppQuitError,
  AppQuitResponse,
  AppSetDefaultPdfHandlerRequest,
  AppSetDefaultPdfHandlerError,
  AppSetDefaultPdfHandlerValue,
  AppSetDefaultPdfHandlerResponse,
  AppGetDefaultPdfHandlerStatusRequest,
  AppGetDefaultPdfHandlerStatusValue,
  AppGetDefaultPdfHandlerStatusResponse,
  AppOpenExternalRequest,
  AppOpenExternalError,
  AppOpenExternalResponse,
  // David 2026-06-01 — OCR runtime introspection (no UI surface yet).
  AppDiagnoseOcrRequest,
  AppDiagnoseOcrError,
  AppDiagnoseOcrValue,
  AppDiagnoseOcrResponse,
  // §10. window (David added per CLAUDE.md Wave 2 brief; not in api-contracts.md §1-§9)
  WindowMinimizeRequest,
  WindowMinimizeError,
  WindowMinimizeResponse,
  WindowMaximizeRequest,
  WindowMaximizeError,
  WindowMaximizeValue,
  WindowMaximizeResponse,
  WindowCloseRequest,
  WindowCloseError,
  WindowCloseResponse,
  WindowGetStateRequest,
  WindowGetStateValue,
  WindowGetStateError,
  WindowGetStateResponse,
  // Phase 2 — pdf channels (api-contracts.md §12.1-§12.4)
  PdfEmbedImageRequest,
  PdfEmbedImageError,
  PdfEmbedImageValue,
  PdfEmbedImageResponse,
  PdfReplaceTextRequest,
  PdfReplaceTextError,
  PdfReplaceTextValue,
  PdfReplaceTextResponse,
  PdfIdentifyTextSpanRequest,
  PdfIdentifyTextSpanError,
  PdfIdentifyTextSpanValue,
  PdfIdentifyTextSpanResponse,
  PdfPrintRequest,
  PdfPrintError,
  PdfPrintValue,
  PdfPrintResponse,
  // Phase 2 — fs replay-engine entry (api-contracts.md §12 — David added §2.5)
  FsApplyEditOpsRequest,
  FsApplyEditOpsError,
  FsApplyEditOpsValue,
  FsApplyEditOpsResponse,
  // Phase 4.1 — fs read-bytes-by-handle (api-contracts.md §15, David)
  // Renderer fetches validated document bytes for pdf.js rendering; no path
  // crosses the IPC boundary — lookup-by-handle against main's documentStore.
  FsReadBytesByHandleRequest,
  FsReadBytesByHandleError,
  FsReadBytesByHandleValue,
  FsReadBytesByHandleResponse,
  // Phase 2 — bookmarks channels (api-contracts.md §12.5-§12.7)
  BookmarksListTreeRequest,
  BookmarksListTreeError,
  BookmarksListTreeResponse,
  BookmarksMoveRequest,
  BookmarksMoveError,
  BookmarksMoveResponse,
  BookmarksRenameRequest,
  BookmarksRenameError,
  BookmarksRenameResponse,
  BookmarkNode,
  // Phase 3 — forms types (api-contracts §13, data-models §8)
  FormFieldType,
  FormFieldOption,
  FormFieldValue,
  FormFieldDefinition,
  FormsDetectRequest,
  FormsDetectError,
  FormsDetectValue,
  FormsDetectResponse,
  FormsFillRequest,
  FormsFillError,
  FormsFillValue,
  FormsFillResponse,
  FormsFlattenRequest,
  FormsFlattenError,
  FormsFlattenValue,
  FormsFlattenResponse,
  FormsDesignAddRequest,
  FormsDesignAddError,
  FormsDesignAddValue,
  FormsDesignAddResponse,
  FormsDesignRemoveRequest,
  FormsDesignRemoveError,
  FormsDesignRemoveValue,
  FormsDesignRemoveResponse,
  FormsListTemplatesRequest,
  FormTemplateListItem,
  FormsListTemplatesError,
  FormsListTemplatesValue,
  FormsListTemplatesResponse,
  FormsSaveTemplateRequest,
  FormsSaveTemplateError,
  FormsSaveTemplateValue,
  FormsSaveTemplateResponse,
  FormsLoadTemplateRequest,
  FormsLoadTemplateError,
  FormsLoadTemplateValue,
  FormsLoadTemplateResponse,
  MailMergeDataSource,
  MailMergeOutputMode,
  MailMergeJob,
  FormsRunMailMergeRequest,
  FormsRunMailMergeError,
  FormsRunMailMergeValue,
  FormsRunMailMergeResponse,
  MailMergeProgressPhase,
  MailMergeProgressEvent,
  FormsCancelMailMergeRequest,
  FormsCancelMailMergeError,
  FormsCancelMailMergeResponse,
  FormsParseDataSourceRequest,
  FormsParseDataSourceError,
  FormsParseDataSourceValue,
  FormsParseDataSourceResponse,
  // Phase 5 — OCR types (api-contracts.md §16)
  OcrLanguagePackSource,
  LanguagePack,
  LanguagePackCatalogEntry,
  PreprocessOptions,
  OcrWord,
  OcrPageResult,
  OcrJobStatus,
  OcrJobSummary,
  OcrJobRowDto,
  OcrListJobsFilters,
  // Phase 5 — channel request/response types
  OcrDetectLanguagesRequest,
  OcrDetectLanguagesError,
  OcrDetectLanguagesValue,
  OcrDetectLanguagesResponse,
  OcrRunOnPageRequest,
  OcrRunOnPageError,
  OcrRunOnPageValue,
  OcrRunOnPageResponse,
  OcrRunOnDocumentRequest,
  OcrRunOnDocumentError,
  OcrRunOnDocumentValue,
  OcrRunOnDocumentResponse,
  OcrProgressEvent,
  OcrCancelJobRequest,
  OcrCancelJobError,
  OcrCancelJobValue,
  OcrCancelJobResponse,
  OcrListJobsRequest,
  OcrListJobsError,
  OcrListJobsValue,
  OcrListJobsResponse,
  OcrLanguagePackDownloadRequest,
  OcrLanguagePackDownloadError,
  OcrLanguagePackDownloadValue,
  OcrLanguagePackDownloadResponse,
  OcrLanguagePackDownloadProgressEvent,
  OcrLanguagePackRemoveRequest,
  OcrLanguagePackRemoveError,
  OcrLanguagePackRemoveValue,
  OcrLanguagePackRemoveResponse,
  ScanListDevicesRequest,
  ScanListDevicesError,
  ScanListDevicesResponse,
  ScanAcquireRequest,
  ScanAcquireError,
  ScanAcquireResponse,
  // Phase 7 — update / telemetry / i18n types (Wave 28b, api-contracts.md §18).
  // RE-EXPORTED from David's canonical contracts (Wave-2 zero-drift discipline);
  // the renderer's Phase-7 surfaces import these from this gatekeeper.
  AppLocale,
  UpdateChannel,
  UpdateStatus,
  UpdateCheckRequest,
  UpdateCheckError,
  UpdateCheckValue,
  UpdateCheckResponse,
  UpdateDownloadRequest,
  UpdateDownloadError,
  UpdateDownloadValue,
  UpdateDownloadResponse,
  UpdateInstallRequest,
  UpdateInstallError,
  UpdateInstallValue,
  UpdateInstallResponse,
  UpdateProgressEvent,
  TelemetryEventName,
  TelemetryRecordEventRequest,
  TelemetryRecordEventError,
  TelemetryRecordEventValue,
  TelemetryRecordEventResponse,
  TelemetrySetOptInRequest,
  TelemetrySetOptInError,
  TelemetrySetOptInValue,
  TelemetrySetOptInResponse,
  TelemetryGetStatusRequest,
  TelemetryGetStatusError,
  TelemetryBufferEntry,
  TelemetryGetStatusValue,
  TelemetryGetStatusResponse,
  I18nSetLocaleRequest,
  I18nSetLocaleError,
  I18nSetLocaleValue,
  I18nSetLocaleResponse,
  I18nGetAvailableLocalesRequest,
  I18nGetAvailableLocalesError,
  LocaleDescriptor,
  I18nGetAvailableLocalesValue,
  I18nGetAvailableLocalesResponse,
  // Phase 7.5 Wave 3+4 — page-design (B4) + page-ops (B5/B10/B11) + stamps (B7)
  PdfPageDesignTarget,
  PdfWatermarkPosition,
  PdfWatermarkSource,
  PdfApplyWatermarkRequest,
  PdfApplyWatermarkError,
  PdfApplyWatermarkValue,
  PdfApplyWatermarkResponse,
  PdfHeaderFooterStrip,
  PdfApplyHeaderFooterRequest,
  PdfApplyHeaderFooterError,
  PdfApplyHeaderFooterValue,
  PdfApplyHeaderFooterResponse,
  PdfBackgroundSource,
  PdfApplyBackgroundRequest,
  PdfApplyBackgroundError,
  PdfApplyBackgroundValue,
  PdfApplyBackgroundResponse,
  // Phase 7.5 Wave 4 — B13 hyperlinks (canonical David shape).
  LinkTarget,
  LinkAction,
  PdfEditLinksRequest,
  PdfEditLinksError,
  PdfEditLinksValue,
  PdfEditLinksResponse,
  // Phase 7.5 Wave 5c — C4 Reading Order + C5 Alt Text (canonical David shape).
  // Wave 5d carry-over: previously typed locally in
  // `reading-order-contract-stub.ts` / `alt-text-contract-stub.ts`; now those
  // files are thin re-export wrappers over these canonical types.
  ReadingOrderEntry,
  PdfGetReadingOrderRequest,
  PdfGetReadingOrderError,
  PdfGetReadingOrderValue,
  PdfGetReadingOrderResponse,
  PdfSetReadingOrderRequest,
  PdfSetReadingOrderError,
  PdfSetReadingOrderValue,
  PdfSetReadingOrderResponse,
  PdfSetAltTextRequest,
  PdfSetAltTextError,
  PdfSetAltTextValue,
  PdfSetAltTextResponse,
  FigureWithoutAlt,
  PdfListFiguresWithoutAltTextRequest,
  PdfListFiguresWithoutAltTextError,
  PdfListFiguresWithoutAltTextValue,
  PdfListFiguresWithoutAltTextResponse,
  // Phase 7.5 Wave 5d — C6 Accessibility Checker (canonical David shape).
  AccessibilityRuleSeverity,
  AccessibilityRuleResult,
  AccessibilityCheckSummary,
  PdfRunAccessibilityCheckRequest,
  PdfRunAccessibilityCheckError,
  PdfRunAccessibilityCheckValue,
  PdfRunAccessibilityCheckResponse,
  // Phase 7.5 Wave 6 — B9 Action Wizard runner.
  ActionScriptSummary,
  ActionRunResult,
  ActionsSaveScriptRequest,
  ActionsSaveScriptError,
  ActionsSaveScriptValue,
  ActionsSaveScriptResponse,
  ActionsListScriptsRequest,
  ActionsListScriptsError,
  ActionsListScriptsValue,
  ActionsListScriptsResponse,
  ActionsGetScriptRequest,
  ActionsGetScriptError,
  ActionsGetScriptValue,
  ActionsGetScriptResponse,
  ActionsDeleteScriptRequest,
  ActionsDeleteScriptError,
  ActionsDeleteScriptValue,
  ActionsDeleteScriptResponse,
  ActionsRunScriptRequest,
  ActionsRunScriptError,
  ActionsRunScriptValue,
  ActionsRunScriptResponse,
  ActionsExportScriptRequest,
  ActionsExportScriptError,
  ActionsExportScriptValue,
  ActionsExportScriptResponse,
  ActionsImportScriptRequest,
  ActionsImportScriptError,
  ActionsImportScriptValue,
  ActionsImportScriptResponse,
  // Phase 7.5 Wave 6 — B14 Spell-check engine.
  SpellLocaleDescriptor,
  SpellMisspelling,
  SpellListLocalesRequest,
  SpellListLocalesError,
  SpellListLocalesValue,
  SpellListLocalesResponse,
  SpellCheckTextRequest,
  SpellCheckTextError,
  SpellCheckTextValue,
  SpellCheckTextResponse,
  SpellAddWordToDictionaryRequest,
  SpellAddWordToDictionaryError,
  SpellAddWordToDictionaryValue,
  SpellAddWordToDictionaryResponse,
  SpellRemoveWordFromDictionaryRequest,
  SpellRemoveWordFromDictionaryError,
  SpellRemoveWordFromDictionaryValue,
  SpellRemoveWordFromDictionaryResponse,
  SpellListUserDictionaryRequest,
  SpellListUserDictionaryError,
  SpellListUserDictionaryValue,
  SpellListUserDictionaryResponse,
  // Phase 7.5 Wave 6 — B18 font listing helper.
  EmbeddedFontInfo,
  PdfListEmbeddedFontsRequest,
  PdfListEmbeddedFontsError,
  PdfListEmbeddedFontsValue,
  PdfListEmbeddedFontsResponse,
  // Phase 7.5 Wave 5 — B18 font swap engine (re-exported here so Wave 6 UI
  // can name the canonical request/response shapes through the gatekeeper).
  StandardPdfFontName,
  PdfSwapEmbeddedFontRequest,
  PdfSwapEmbeddedFontError,
  PdfSwapEmbeddedFontValue,
  PdfSwapEmbeddedFontResponse,
  // §12. PdfApi aggregate
  PdfApi,
  ChannelName,
} from '../../ipc/contracts';

// Re-export the runtime Channels object (only non-type export from David's
// module). It's a `const` mapping of `'dialog:openPdf'` etc.; the renderer can
// use it for analytics in Phase 7.
export { Channels } from '../../ipc/contracts';

// =============================================================================
// Phase 6 — Export-to-Office types (Wave 24).
//
// David's `src/ipc/contracts.ts` carries the canonical §17 `export:*` channel
// types. Per the Wave-2 lesson, the gatekeeper RE-EXPORTS from David's module
// — no hand-mirroring.
// =============================================================================

export type {
  ExportFormat,
  ImageExportFormat,
  ExportQualityTier,
  ExportJobStatus,
  ExportFormatDescriptor,
  ExportJobRowDto,
  ExportJobSummary,
  ExportProgressEvent,
  ExportToDocxRequest,
  ExportToDocxError,
  ExportToDocxValue,
  ExportToDocxResponse,
  ExportToXlsxRequest,
  ExportToXlsxError,
  ExportToXlsxValue,
  ExportToXlsxResponse,
  ExportToPptxRequest,
  ExportToPptxError,
  ExportToPptxValue,
  ExportToPptxResponse,
  ExportToImagesRequest,
  ExportToImagesError,
  ExportToImagesValue,
  ExportToImagesResponse,
  ExportCancelJobRequest,
  ExportCancelJobError,
  ExportCancelJobValue,
  ExportCancelJobResponse,
  ExportListJobsRequest,
  ExportListJobsError,
  ExportListJobsValue,
  ExportListJobsResponse,
  ExportListFormatsRequest,
  ExportListFormatsError,
  ExportListFormatsValue,
  ExportListFormatsResponse,
  DialogPickExportOutputPathRequest,
  DialogPickExportOutputPathError,
  DialogPickExportOutputPathValue,
  DialogPickExportOutputPathResponse,
} from '../../ipc/contracts';

// Renderer-only namespace aliases + value-named imports — derived from David's
// canonical PdfApi shape for use in services/api.ts proxy declarations and the
// renderer-local helper types below. Consolidated into one import statement
// (Wave 28b) so the gatekeeper has a single value-import from the contracts
// module (import/no-duplicates clean).
import {
  type DocumentHandle,
  type EditOperationSerialized as _EditOp,
  type PdfApi,
  type PdfApi as _PdfApi,
  type PdfCombineRequest,
} from '../../ipc/contracts';

export type PdfApiExport = _PdfApi['export'];
export type PdfApiDialogPhase6 = Pick<_PdfApi['dialog'], 'pickExportOutputPath'>;

// -----------------------------------------------------------------------------
// Renderer-only — not part of the IPC contract.
// -----------------------------------------------------------------------------

/**
 * David's `PdfCombineRequest.sources` is an inline union — extracted here so
 * renderer code (thunks, combine-modal) can name a single type when building
 * the array piece by piece.
 *
 * Verified shape-equivalent to David's inline union as of contracts.ts 589
 * lines. If David adds a variant, ESLint's
 * `@typescript-eslint/switch-exhaustiveness-check` will catch any
 * downstream `switch (s.kind)` that doesn't cover it.
 */
export type PdfCombineSource = PdfCombineRequest['sources'][number];

// Sanity helpers — used by thunks.
export type PdfCombineSourceHandle = Extract<PdfCombineSource, { kind: 'handle' }>;
export type PdfCombineSourcePath = Extract<PdfCombineSource, { kind: 'path' }>;

// Re-export for code that wants the handle type as a value name.
export type { DocumentHandle as DocumentHandleAlias };

// Global augmentation: window.pdfApi exposed by David's preload bridge.
declare global {
  interface Window {
    pdfApi?: PdfApi;
  }
}

// =============================================================================
// Phase 4 — David's PdfApi already exposes `signatures` + extended
// `annotations` namespaces (src/ipc/contracts.ts:1862, :1881). The renderer
// uses those types via the re-exports above. Per the Wave 2 lesson, the
// gatekeeper file does NOT hand-mirror contract types; we re-export David's
// canonical shapes.
//
// The services/api.ts proxy reads the namespaces through `window.pdfApi`,
// which is `PdfApi`-typed by the declare global below. Tests stub
// `window.pdfApi = { signatures: {...}, annotations: {...} }` to feed mock
// implementations.
// =============================================================================

// =============================================================================
// Phase 2 — Renderer-local helpers (NOT contract types — those re-export above)
// =============================================================================

/**
 * Phase 2 image-bytes helper (data-models.md §7.1.4 + conventions §13.3).
 * When pushing an image-bearing EditOperation onto historySlice, the bytes
 * field is zeroed; only the contentHash is preserved on the COMPACTED form.
 * The raw form (with bytes intact) is stored alongside on the HistoryEntry
 * for on-the-wire dispatch — see history-middleware.ts module header for
 * the Wave 8.6 N-1 two-state rationale.
 *
 * Variants compacted (all image-bytes-bearing op shapes):
 *   - image-insert            — `op.image.bytes`
 *   - image-overlay           — `op.image.bytes`
 *   - image-overlay-delete    — `op.before.image.bytes`
 *   - delete{preservedSource: — `op.preservedSource.image.bytes`
 *      kind: 'image'}            (Wave 10 R-10.1; Riley Wave 8.6 observation #2)
 *
 * The `delete{preservedSource:image}` branch closes the asymmetry Riley
 * flagged in Wave 8.6: forward `image-insert` was compacted, but the
 * symmetric forward `delete-of-image-page` (which carries the full image
 * bytes inside `preservedSource`) leaked uncompacted into history storage.
 * Latent storage-footprint bug for users deleting many image pages.
 */
export function compactImageOpForHistory<T extends _EditOp>(op: T): T {
  if (op.kind === 'image-insert' || op.kind === 'image-overlay') {
    return {
      ...op,
      image: { ...op.image, bytes: new Uint8Array(0) },
    } as T;
  }
  if (op.kind === 'image-overlay-delete') {
    return {
      ...op,
      before: {
        ...op.before,
        image: { ...op.before.image, bytes: new Uint8Array(0) },
      },
    } as T;
  }
  // Wave 10 R-10.1: forward `delete` whose preservedSource is an image page
  // also carries image bytes — compact symmetrically with image-insert.
  if (op.kind === 'delete' && op.preservedSource.kind === 'image') {
    return {
      ...op,
      preservedSource: {
        ...op.preservedSource,
        image: { ...op.preservedSource.image, bytes: new Uint8Array(0) },
      },
    } as T;
  }
  return op;
}
