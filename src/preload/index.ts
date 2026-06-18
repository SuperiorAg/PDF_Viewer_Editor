// Preload — context-isolated bridge that exposes the typed PdfApi to the renderer.
//
// Per ARCHITECTURE §1.2.2: "Preload is a shim, not a library." This file
// re-exports `ipcRenderer.invoke('channel', payload)` typed against
// src/ipc/contracts.ts. NO transformation, NO validation — validation lives
// in main-process handlers.

import { contextBridge, ipcRenderer } from 'electron';

import { Channels } from '../ipc/contracts.js';
import type {
  AppDiagnoseOcrRequest,
  AppDiagnoseOcrResponse,
  AppGetDefaultPdfHandlerStatusResponse,
  AppGetVersionResponse,
  AppOpenExternalRequest,
  AppOpenExternalResponse,
  AppQuitRequest,
  AppQuitResponse,
  AppSetDefaultPdfHandlerRequest,
  AppSetDefaultPdfHandlerResponse,
  BookmarksDeleteRequest,
  BookmarksDeleteResponse,
  BookmarksListRequest,
  BookmarksListResponse,
  BookmarksListTreeRequest,
  BookmarksListTreeResponse,
  BookmarksMoveRequest,
  BookmarksMoveResponse,
  BookmarksRenameRequest,
  BookmarksRenameResponse,
  BookmarksUpsertRequest,
  BookmarksUpsertResponse,
  DialogOpenPdfResponse,
  // Wave-30 follow-up (H-30.1, David 2026-06-01): path-only PDF picker.
  DialogPickPdfFilesRequest,
  DialogPickPdfFilesResponse,
  // Phase 7.5 Wave 3 (David, 2026-06-17): directory picker.
  DialogPickFolderRequest,
  DialogPickFolderResponse,
  // David 2026-06-04: shell-launched PDF event (Explorer double-click etc).
  FileOpenFromShellEvent,
  DialogSaveAsRequest,
  DialogSaveAsResponse,
  FsApplyEditOpsRequest,
  FsApplyEditOpsResponse,
  FsClosePdfRequest,
  FsClosePdfResponse,
  FsReadBytesByHandleRequest,
  FsReadBytesByHandleResponse,
  FsReadPdfRequest,
  FsReadPdfResponse,
  FsWritePdfRequest,
  FsWritePdfResponse,
  PdfApi,
  PdfCombineRequest,
  PdfCombineResponse,
  PdfEmbedImageRequest,
  PdfEmbedImageResponse,
  PdfExportProgressEvent,
  PdfExportRequest,
  PdfExportResponse,
  PdfGetOutlineRequest,
  PdfGetOutlineResponse,
  PdfIdentifyTextSpanRequest,
  PdfIdentifyTextSpanResponse,
  PdfPrintRequest,
  PdfPrintResponse,
  PdfApplyRedactionsRequest,
  PdfApplyRedactionsResponse,
  // Phase 7.5 Wave 2 (David, 2026-06-17) — B5 / B10 / B11 page operations.
  PdfCropPagesRequest,
  PdfCropPagesResponse,
  PdfExtractPagesRequest,
  PdfExtractPagesResponse,
  PdfSplitDocumentRequest,
  PdfSplitDocumentResponse,
  PdfReplacePagesRequest,
  PdfReplacePagesResponse,
  PdfInsertPagesFromFileRequest,
  PdfInsertPagesFromFileResponse,
  // Phase 7.5 Wave 3 (David, 2026-06-17) — B4 page-design + B7 Stamps.
  PdfApplyWatermarkRequest,
  PdfApplyWatermarkResponse,
  PdfApplyHeaderFooterRequest,
  PdfApplyHeaderFooterResponse,
  PdfApplyBackgroundRequest,
  PdfApplyBackgroundResponse,
  PdfApplyStampRequest,
  PdfApplyStampResponse,
  StampsListRequest,
  StampsListResponse,
  StampsCreateRequest,
  StampsCreateResponse,
  StampsDeleteRequest,
  StampsDeleteResponse,
  // Phase 7.5 Wave 4 (David, 2026-06-17) — B6 / B13 / B19.
  PdfCompressDocumentRequest,
  PdfCompressDocumentResponse,
  PdfAutoBookmarkFromHeadingsRequest,
  PdfAutoBookmarkFromHeadingsResponse,
  PdfEditLinksRequest,
  PdfEditLinksResponse,
  // Phase 7.5 Wave 5 (David, 2026-06-17) — B8 / B18 / B20 / B21.
  PdfSetPasswordProtectionRequest,
  PdfSetPasswordProtectionResponse,
  PdfRemoveHiddenInfoRequest,
  PdfRemoveHiddenInfoResponse,
  PdfGetDocumentPropertiesRequest,
  PdfGetDocumentPropertiesResponse,
  PdfSetDocumentPropertiesRequest,
  PdfSetDocumentPropertiesResponse,
  PdfSwapEmbeddedFontRequest,
  PdfSwapEmbeddedFontResponse,
  PdfReplaceTextRequest,
  PdfReplaceTextResponse,
  // Phase 7.5 Wave 5a (David, 2026-06-17) — C1 Read Aloud + C2 Preflight.
  PdfRunPreflightRequest,
  PdfRunPreflightResponse,
  // Phase 7.5 Wave 5b (David, 2026-06-17) — C3 Tag PDF (structure tree).
  PdfGetStructTreeRequest,
  PdfGetStructTreeResponse,
  PdfSetStructTreeRequest,
  PdfSetStructTreeResponse,
  PdfAutoTagPagesRequest,
  PdfAutoTagPagesResponse,
  // Phase 7.5 Wave 5c (David, 2026-06-17) — C4 Reading Order + C5 Alt Text.
  PdfGetReadingOrderRequest,
  PdfGetReadingOrderResponse,
  PdfSetReadingOrderRequest,
  PdfSetReadingOrderResponse,
  PdfSetAltTextRequest,
  PdfSetAltTextResponse,
  PdfListFiguresWithoutAltTextRequest,
  PdfListFiguresWithoutAltTextResponse,
  TtsListVoicesRequest,
  TtsListVoicesResponse,
  TtsSpeakTextRequest,
  TtsSpeakTextResponse,
  TtsControlRequest,
  TtsControlResponse,
  TtsBoundaryEvent,
  RecentsAddRequest,
  RecentsAddResponse,
  RecentsClearResponse,
  RecentsListRequest,
  RecentsListResponse,
  SettingKey,
  SettingsGetAllResponse,
  SettingsGetRequest,
  SettingsGetResponse,
  SettingsSetRequest,
  SettingsSetResponse,
  WindowCloseResponse,
  WindowGetStateResponse,
  WindowMaximizeResponse,
  WindowMinimizeResponse,
  // Phase 3 (api-contracts.md §13)
  FormsDetectRequest,
  FormsDetectResponse,
  FormsFillRequest,
  FormsFillResponse,
  FormsFlattenRequest,
  FormsFlattenResponse,
  FormsDesignAddRequest,
  FormsDesignAddResponse,
  FormsDesignRemoveRequest,
  FormsDesignRemoveResponse,
  FormsListTemplatesRequest,
  FormsListTemplatesResponse,
  FormsSaveTemplateRequest,
  FormsSaveTemplateResponse,
  FormsLoadTemplateRequest,
  FormsLoadTemplateResponse,
  FormsRunMailMergeRequest,
  FormsRunMailMergeResponse,
  FormsCancelMailMergeRequest,
  FormsCancelMailMergeResponse,
  FormsParseDataSourceRequest,
  FormsParseDataSourceResponse,
  MailMergeProgressEvent,
  // Phase 4 (api-contracts.md §14)
  SignaturesCertLoadRequest,
  SignaturesCertLoadResponse,
  SignaturesCertReleaseRequest,
  SignaturesCertReleaseResponse,
  SignaturesApplyVisualRequest,
  SignaturesApplyVisualResponse,
  SignaturesApplyPadesRequest,
  SignaturesApplyPadesResponse,
  SignaturesRequestTimestampRequest,
  SignaturesRequestTimestampResponse,
  SignaturesVerifyRequest,
  SignaturesVerifyResponse,
  SignaturesListAuditRequest,
  SignaturesListAuditResponse,
  AnnotationsAddShapeRequest,
  AnnotationsAddShapeResponse,
  AnnotationsSetMeasureCalibrationRequest,
  AnnotationsSetMeasureCalibrationResponse,
  AnnotationsGetMeasureCalibrationRequest,
  AnnotationsGetMeasureCalibrationResponse,
  // Phase 5 (api-contracts.md §16)
  OcrDetectLanguagesRequest,
  OcrDetectLanguagesResponse,
  OcrRunOnPageRequest,
  OcrRunOnPageResponse,
  OcrRunOnDocumentRequest,
  OcrRunOnDocumentResponse,
  OcrCancelJobRequest,
  OcrCancelJobResponse,
  OcrListJobsRequest,
  OcrListJobsResponse,
  OcrListResultsByJobRequest,
  OcrListResultsByJobResponse,
  OcrLanguagePackDownloadRequest,
  OcrLanguagePackDownloadResponse,
  OcrLanguagePackRemoveRequest,
  OcrLanguagePackRemoveResponse,
  OcrProgressEvent,
  OcrLanguagePackDownloadProgressEvent,
  ScanListDevicesRequest,
  ScanListDevicesResponse,
  ScanAcquireRequest,
  ScanAcquireResponse,
  // Phase 6 (api-contracts.md §17)
  ExportToDocxRequest,
  ExportToDocxResponse,
  ExportToXlsxRequest,
  ExportToXlsxResponse,
  ExportToPptxRequest,
  ExportToPptxResponse,
  ExportToImagesRequest,
  ExportToImagesResponse,
  ExportCancelJobRequest,
  ExportCancelJobResponse,
  ExportListJobsRequest,
  ExportListJobsResponse,
  ExportListFormatsRequest,
  ExportListFormatsResponse,
  ExportProgressEvent,
  DialogPickExportOutputPathRequest,
  DialogPickExportOutputPathResponse,
  // Phase 7 (api-contracts.md §18)
  UpdateCheckRequest,
  UpdateCheckResponse,
  UpdateDownloadRequest,
  UpdateDownloadResponse,
  UpdateInstallRequest,
  UpdateInstallResponse,
  UpdateProgressEvent,
  TelemetryRecordEventRequest,
  TelemetryRecordEventResponse,
  TelemetrySetOptInRequest,
  TelemetrySetOptInResponse,
  TelemetryGetStatusRequest,
  TelemetryGetStatusResponse,
  I18nSetLocaleRequest,
  I18nSetLocaleResponse,
  I18nGetAvailableLocalesRequest,
  I18nGetAvailableLocalesResponse,
  // Phase 7.1 (David, 2026-06-05) — test-only seed channel.
  TestSeedOcrJobRequest,
  TestSeedOcrJobResponse,
  TestWhichBridgeRequest,
  TestWhichBridgeResponse,
  // Phase 7.2 7.2.4 (Diego, 2026-06-10) — test-only signature_audit_log
  // seed + readback channels for the signed-PDF + OCR invalidation e2e.
  TestSeedSignatureAuditRequest,
  TestSeedSignatureAuditResponse,
  TestListSignatureAuditRequest,
  TestListSignatureAuditResponse,
} from '../ipc/contracts.js';

const pdfApi: PdfApi = {
  dialog: {
    openPdf: () => ipcRenderer.invoke(Channels.DialogOpenPdf, {}) as Promise<DialogOpenPdfResponse>,
    saveAs: (req: DialogSaveAsRequest) =>
      ipcRenderer.invoke(Channels.DialogSaveAs, req) as Promise<DialogSaveAsResponse>,
    // Phase 6 (api-contracts.md §17.9)
    pickExportOutputPath: (req: DialogPickExportOutputPathRequest) =>
      ipcRenderer.invoke(
        Channels.DialogPickExportOutputPath,
        req,
      ) as Promise<DialogPickExportOutputPathResponse>,
    // Wave-30 follow-up (H-30.1, David 2026-06-01): path-only PDF picker.
    pickPdfFiles: (req: DialogPickPdfFilesRequest) =>
      ipcRenderer.invoke(Channels.DialogPickPdfFiles, req) as Promise<DialogPickPdfFilesResponse>,
    // Phase 7.5 Wave 3 (David, 2026-06-17) — directory picker (60s token).
    pickFolder: (req: DialogPickFolderRequest) =>
      ipcRenderer.invoke(Channels.DialogPickFolder, req) as Promise<DialogPickFolderResponse>,
  },
  fs: {
    readPdf: (req: FsReadPdfRequest) =>
      ipcRenderer.invoke(Channels.FsReadPdf, req) as Promise<FsReadPdfResponse>,
    writePdf: (req: FsWritePdfRequest) =>
      ipcRenderer.invoke(Channels.FsWritePdf, req) as Promise<FsWritePdfResponse>,
    closePdf: (req: FsClosePdfRequest) =>
      ipcRenderer.invoke(Channels.FsClosePdf, req) as Promise<FsClosePdfResponse>,
    applyEditOps: (req: FsApplyEditOpsRequest) =>
      ipcRenderer.invoke(Channels.FsApplyEditOps, req) as Promise<FsApplyEditOpsResponse>,
    // Phase 4.1 (api-contracts.md §15): renderer fetches doc bytes for pdf.js.
    readBytesByHandle: (req: FsReadBytesByHandleRequest) =>
      ipcRenderer.invoke(Channels.FsReadBytesByHandle, req) as Promise<FsReadBytesByHandleResponse>,
  },
  recents: {
    list: (req: RecentsListRequest) =>
      ipcRenderer.invoke(Channels.RecentsList, req) as Promise<RecentsListResponse>,
    add: (req: RecentsAddRequest) =>
      ipcRenderer.invoke(Channels.RecentsAdd, req) as Promise<RecentsAddResponse>,
    clear: () => ipcRenderer.invoke(Channels.RecentsClear, {}) as Promise<RecentsClearResponse>,
  },
  settings: {
    get: <K extends SettingKey>(req: SettingsGetRequest<K>) =>
      ipcRenderer.invoke(Channels.SettingsGet, req) as Promise<SettingsGetResponse<K>>,
    set: <K extends SettingKey>(req: SettingsSetRequest<K>) =>
      ipcRenderer.invoke(Channels.SettingsSet, req) as Promise<SettingsSetResponse>,
    getAll: () =>
      ipcRenderer.invoke(Channels.SettingsGetAll, {}) as Promise<SettingsGetAllResponse>,
  },
  bookmarks: {
    list: (req: BookmarksListRequest) =>
      ipcRenderer.invoke(Channels.BookmarksList, req) as Promise<BookmarksListResponse>,
    upsert: (req: BookmarksUpsertRequest) =>
      ipcRenderer.invoke(Channels.BookmarksUpsert, req) as Promise<BookmarksUpsertResponse>,
    delete: (req: BookmarksDeleteRequest) =>
      ipcRenderer.invoke(Channels.BookmarksDelete, req) as Promise<BookmarksDeleteResponse>,
    listTree: (req: BookmarksListTreeRequest) =>
      ipcRenderer.invoke(Channels.BookmarksListTree, req) as Promise<BookmarksListTreeResponse>,
    move: (req: BookmarksMoveRequest) =>
      ipcRenderer.invoke(Channels.BookmarksMove, req) as Promise<BookmarksMoveResponse>,
    rename: (req: BookmarksRenameRequest) =>
      ipcRenderer.invoke(Channels.BookmarksRename, req) as Promise<BookmarksRenameResponse>,
  },
  pdf: {
    combine: (req: PdfCombineRequest) =>
      ipcRenderer.invoke(Channels.PdfCombine, req) as Promise<PdfCombineResponse>,
    export: (req: PdfExportRequest) =>
      ipcRenderer.invoke(Channels.PdfExport, req) as Promise<PdfExportResponse>,
    getOutline: (req: PdfGetOutlineRequest) =>
      ipcRenderer.invoke(Channels.PdfGetOutline, req) as Promise<PdfGetOutlineResponse>,
    embedImage: (req: PdfEmbedImageRequest) =>
      ipcRenderer.invoke(Channels.PdfEmbedImage, req) as Promise<PdfEmbedImageResponse>,
    replaceText: (req: PdfReplaceTextRequest) =>
      ipcRenderer.invoke(Channels.PdfReplaceText, req) as Promise<PdfReplaceTextResponse>,
    identifyTextSpan: (req: PdfIdentifyTextSpanRequest) =>
      ipcRenderer.invoke(Channels.PdfIdentifyTextSpan, req) as Promise<PdfIdentifyTextSpanResponse>,
    print: (req: PdfPrintRequest) =>
      ipcRenderer.invoke(Channels.PdfPrint, req) as Promise<PdfPrintResponse>,
    // Phase 7.4 B1 (Riley design §3.1) — R1 rasterize-redact + sanitize.
    applyRedactions: (req: PdfApplyRedactionsRequest) =>
      ipcRenderer.invoke(Channels.PdfApplyRedactions, req) as Promise<PdfApplyRedactionsResponse>,
    // Phase 7.5 Wave 2 (David, 2026-06-17) — B5 / B10 / B11 page operations.
    cropPages: (req: PdfCropPagesRequest) =>
      ipcRenderer.invoke(Channels.PdfCropPages, req) as Promise<PdfCropPagesResponse>,
    extractPages: (req: PdfExtractPagesRequest) =>
      ipcRenderer.invoke(Channels.PdfExtractPages, req) as Promise<PdfExtractPagesResponse>,
    splitDocument: (req: PdfSplitDocumentRequest) =>
      ipcRenderer.invoke(Channels.PdfSplitDocument, req) as Promise<PdfSplitDocumentResponse>,
    replacePages: (req: PdfReplacePagesRequest) =>
      ipcRenderer.invoke(Channels.PdfReplacePages, req) as Promise<PdfReplacePagesResponse>,
    insertPagesFromFile: (req: PdfInsertPagesFromFileRequest) =>
      ipcRenderer.invoke(
        Channels.PdfInsertPagesFromFile,
        req,
      ) as Promise<PdfInsertPagesFromFileResponse>,
    // Phase 7.5 Wave 3 (David, 2026-06-17) — B4 page-design + B7 stamp apply.
    applyWatermark: (req: PdfApplyWatermarkRequest) =>
      ipcRenderer.invoke(Channels.PdfApplyWatermark, req) as Promise<PdfApplyWatermarkResponse>,
    applyHeaderFooter: (req: PdfApplyHeaderFooterRequest) =>
      ipcRenderer.invoke(
        Channels.PdfApplyHeaderFooter,
        req,
      ) as Promise<PdfApplyHeaderFooterResponse>,
    applyBackground: (req: PdfApplyBackgroundRequest) =>
      ipcRenderer.invoke(Channels.PdfApplyBackground, req) as Promise<PdfApplyBackgroundResponse>,
    applyStamp: (req: PdfApplyStampRequest) =>
      ipcRenderer.invoke(Channels.PdfApplyStamp, req) as Promise<PdfApplyStampResponse>,
    // Phase 7.5 Wave 4 (David, 2026-06-17) — B6 + B13 + B19.
    compressDocument: (req: PdfCompressDocumentRequest) =>
      ipcRenderer.invoke(Channels.PdfCompressDocument, req) as Promise<PdfCompressDocumentResponse>,
    autoBookmarkFromHeadings: (req: PdfAutoBookmarkFromHeadingsRequest) =>
      ipcRenderer.invoke(
        Channels.PdfAutoBookmarkFromHeadings,
        req,
      ) as Promise<PdfAutoBookmarkFromHeadingsResponse>,
    editLinks: (req: PdfEditLinksRequest) =>
      ipcRenderer.invoke(Channels.PdfEditLinks, req) as Promise<PdfEditLinksResponse>,
    // Phase 7.5 Wave 5 (David, 2026-06-17) — B8 / B18 / B20 / B21.
    setPasswordProtection: (req: PdfSetPasswordProtectionRequest) =>
      ipcRenderer.invoke(
        Channels.PdfSetPasswordProtection,
        req,
      ) as Promise<PdfSetPasswordProtectionResponse>,
    removeHiddenInfo: (req: PdfRemoveHiddenInfoRequest) =>
      ipcRenderer.invoke(Channels.PdfRemoveHiddenInfo, req) as Promise<PdfRemoveHiddenInfoResponse>,
    getDocumentProperties: (req: PdfGetDocumentPropertiesRequest) =>
      ipcRenderer.invoke(
        Channels.PdfGetDocumentProperties,
        req,
      ) as Promise<PdfGetDocumentPropertiesResponse>,
    setDocumentProperties: (req: PdfSetDocumentPropertiesRequest) =>
      ipcRenderer.invoke(
        Channels.PdfSetDocumentProperties,
        req,
      ) as Promise<PdfSetDocumentPropertiesResponse>,
    swapEmbeddedFont: (req: PdfSwapEmbeddedFontRequest) =>
      ipcRenderer.invoke(Channels.PdfSwapEmbeddedFont, req) as Promise<PdfSwapEmbeddedFontResponse>,
    // Phase 7.5 Wave 5a (David, 2026-06-17) — C2 Preflight.
    runPreflight: (req: PdfRunPreflightRequest) =>
      ipcRenderer.invoke(Channels.PdfRunPreflight, req) as Promise<PdfRunPreflightResponse>,
    // Phase 7.5 Wave 5b (David, 2026-06-17) — C3 Tag PDF (structure tree).
    getStructTree: (req: PdfGetStructTreeRequest) =>
      ipcRenderer.invoke(Channels.PdfGetStructTree, req) as Promise<PdfGetStructTreeResponse>,
    setStructTree: (req: PdfSetStructTreeRequest) =>
      ipcRenderer.invoke(Channels.PdfSetStructTree, req) as Promise<PdfSetStructTreeResponse>,
    autoTagPages: (req: PdfAutoTagPagesRequest) =>
      ipcRenderer.invoke(Channels.PdfAutoTagPages, req) as Promise<PdfAutoTagPagesResponse>,
    // Phase 7.5 Wave 5c (David, 2026-06-17) — C4 Reading Order + C5 Alt Text.
    getReadingOrder: (req: PdfGetReadingOrderRequest) =>
      ipcRenderer.invoke(Channels.PdfGetReadingOrder, req) as Promise<PdfGetReadingOrderResponse>,
    setReadingOrder: (req: PdfSetReadingOrderRequest) =>
      ipcRenderer.invoke(Channels.PdfSetReadingOrder, req) as Promise<PdfSetReadingOrderResponse>,
    setAltText: (req: PdfSetAltTextRequest) =>
      ipcRenderer.invoke(Channels.PdfSetAltText, req) as Promise<PdfSetAltTextResponse>,
    listFiguresWithoutAltText: (req: PdfListFiguresWithoutAltTextRequest) =>
      ipcRenderer.invoke(
        Channels.PdfListFiguresWithoutAltText,
        req,
      ) as Promise<PdfListFiguresWithoutAltTextResponse>,
  },
  // Phase 7.5 Wave 5a (David, 2026-06-17) — C1 Read Aloud (TTS).
  tts: {
    listVoices: (req: TtsListVoicesRequest) =>
      ipcRenderer.invoke(Channels.TtsListVoices, req) as Promise<TtsListVoicesResponse>,
    speakText: (req: TtsSpeakTextRequest) =>
      ipcRenderer.invoke(Channels.TtsSpeakText, req) as Promise<TtsSpeakTextResponse>,
    pause: (req: TtsControlRequest) =>
      ipcRenderer.invoke(Channels.TtsPause, req) as Promise<TtsControlResponse>,
    resume: (req: TtsControlRequest) =>
      ipcRenderer.invoke(Channels.TtsResume, req) as Promise<TtsControlResponse>,
    stop: (req: TtsControlRequest) =>
      ipcRenderer.invoke(Channels.TtsStop, req) as Promise<TtsControlResponse>,
    onBoundary: (handler: (event: TtsBoundaryEvent) => void) => {
      const wrapped = (_e: unknown, event: TtsBoundaryEvent): void => handler(event);
      ipcRenderer.on(Channels.TtsBoundary, wrapped);
      return () => {
        ipcRenderer.removeListener(Channels.TtsBoundary, wrapped);
      };
    },
  },
  // Phase 7.5 Wave 3 (David, 2026-06-17) — stamps_library CRUD.
  stamps: {
    list: (req: StampsListRequest) =>
      ipcRenderer.invoke(Channels.StampsList, req) as Promise<StampsListResponse>,
    create: (req: StampsCreateRequest) =>
      ipcRenderer.invoke(Channels.StampsCreate, req) as Promise<StampsCreateResponse>,
    delete: (req: StampsDeleteRequest) =>
      ipcRenderer.invoke(Channels.StampsDelete, req) as Promise<StampsDeleteResponse>,
  },
  app: {
    getVersion: () =>
      ipcRenderer.invoke(Channels.AppGetVersion, {}) as Promise<AppGetVersionResponse>,
    quit: (req: AppQuitRequest) =>
      ipcRenderer.invoke(Channels.AppQuit, req) as Promise<AppQuitResponse>,
    setDefaultPdfHandler: (req: AppSetDefaultPdfHandlerRequest) =>
      ipcRenderer.invoke(
        Channels.AppSetDefaultPdfHandler,
        req,
      ) as Promise<AppSetDefaultPdfHandlerResponse>,
    getDefaultPdfHandlerStatus: () =>
      ipcRenderer.invoke(
        Channels.AppGetDefaultPdfHandlerStatus,
        {},
      ) as Promise<AppGetDefaultPdfHandlerStatusResponse>,
    openExternal: (req: AppOpenExternalRequest) =>
      ipcRenderer.invoke(Channels.AppOpenExternal, req) as Promise<AppOpenExternalResponse>,
    // David 2026-06-01: OCR runtime introspection (no UI surface yet).
    diagnoseOcr: (req: AppDiagnoseOcrRequest) =>
      ipcRenderer.invoke(Channels.AppDiagnoseOcr, req) as Promise<AppDiagnoseOcrResponse>,
    // David 2026-06-04: shell-launched PDF event listener. Mirrors the
    // existing on(...)/removeListener pattern used by OCR/export/update.
    onFileOpenFromShell: (cb: (event: FileOpenFromShellEvent) => void) => {
      const wrapped = (_e: unknown, event: FileOpenFromShellEvent): void => cb(event);
      ipcRenderer.on(Channels.FileOpenFromShell, wrapped);
      return () => {
        ipcRenderer.removeListener(Channels.FileOpenFromShell, wrapped);
      };
    },
  },
  window: {
    minimize: () =>
      ipcRenderer.invoke(Channels.WindowMinimize, {}) as Promise<WindowMinimizeResponse>,
    maximize: () =>
      ipcRenderer.invoke(Channels.WindowMaximize, {}) as Promise<WindowMaximizeResponse>,
    close: () => ipcRenderer.invoke(Channels.WindowClose, {}) as Promise<WindowCloseResponse>,
    getState: () =>
      ipcRenderer.invoke(Channels.WindowGetState, {}) as Promise<WindowGetStateResponse>,
  },
  // Phase 3 (api-contracts.md §13.13)
  forms: {
    detect: (req: FormsDetectRequest) =>
      ipcRenderer.invoke(Channels.FormsDetect, req) as Promise<FormsDetectResponse>,
    fill: (req: FormsFillRequest) =>
      ipcRenderer.invoke(Channels.FormsFill, req) as Promise<FormsFillResponse>,
    flatten: (req: FormsFlattenRequest) =>
      ipcRenderer.invoke(Channels.FormsFlatten, req) as Promise<FormsFlattenResponse>,
    designAdd: (req: FormsDesignAddRequest) =>
      ipcRenderer.invoke(Channels.FormsDesignAdd, req) as Promise<FormsDesignAddResponse>,
    designRemove: (req: FormsDesignRemoveRequest) =>
      ipcRenderer.invoke(Channels.FormsDesignRemove, req) as Promise<FormsDesignRemoveResponse>,
    listTemplates: (req: FormsListTemplatesRequest) =>
      ipcRenderer.invoke(Channels.FormsListTemplates, req) as Promise<FormsListTemplatesResponse>,
    saveTemplate: (req: FormsSaveTemplateRequest) =>
      ipcRenderer.invoke(Channels.FormsSaveTemplate, req) as Promise<FormsSaveTemplateResponse>,
    loadTemplate: (req: FormsLoadTemplateRequest) =>
      ipcRenderer.invoke(Channels.FormsLoadTemplate, req) as Promise<FormsLoadTemplateResponse>,
    runMailMerge: (req: FormsRunMailMergeRequest) =>
      ipcRenderer.invoke(Channels.FormsRunMailMerge, req) as Promise<FormsRunMailMergeResponse>,
    cancelMailMerge: (req: FormsCancelMailMergeRequest) =>
      ipcRenderer.invoke(
        Channels.FormsCancelMailMerge,
        req,
      ) as Promise<FormsCancelMailMergeResponse>,
    parseDataSource: (req: FormsParseDataSourceRequest) =>
      ipcRenderer.invoke(
        Channels.FormsParseDataSource,
        req,
      ) as Promise<FormsParseDataSourceResponse>,
  },
  // Phase 4 (api-contracts.md §14.11)
  signatures: {
    certLoad: (req: SignaturesCertLoadRequest) =>
      ipcRenderer.invoke(Channels.SignaturesCertLoad, req) as Promise<SignaturesCertLoadResponse>,
    certRelease: (req: SignaturesCertReleaseRequest) =>
      ipcRenderer.invoke(
        Channels.SignaturesCertRelease,
        req,
      ) as Promise<SignaturesCertReleaseResponse>,
    applyVisual: (req: SignaturesApplyVisualRequest) =>
      ipcRenderer.invoke(
        Channels.SignaturesApplyVisual,
        req,
      ) as Promise<SignaturesApplyVisualResponse>,
    applyPades: (req: SignaturesApplyPadesRequest) =>
      ipcRenderer.invoke(
        Channels.SignaturesApplyPades,
        req,
      ) as Promise<SignaturesApplyPadesResponse>,
    requestTimestamp: (req: SignaturesRequestTimestampRequest) =>
      ipcRenderer.invoke(
        Channels.SignaturesRequestTimestamp,
        req,
      ) as Promise<SignaturesRequestTimestampResponse>,
    verify: (req: SignaturesVerifyRequest) =>
      ipcRenderer.invoke(Channels.SignaturesVerify, req) as Promise<SignaturesVerifyResponse>,
    listAudit: (req: SignaturesListAuditRequest) =>
      ipcRenderer.invoke(Channels.SignaturesListAudit, req) as Promise<SignaturesListAuditResponse>,
  },
  annotations: {
    addShape: (req: AnnotationsAddShapeRequest) =>
      ipcRenderer.invoke(Channels.AnnotationsAddShape, req) as Promise<AnnotationsAddShapeResponse>,
    setMeasureCalibration: (req: AnnotationsSetMeasureCalibrationRequest) =>
      ipcRenderer.invoke(
        Channels.AnnotationsSetMeasureCalibration,
        req,
      ) as Promise<AnnotationsSetMeasureCalibrationResponse>,
    getMeasureCalibration: (req: AnnotationsGetMeasureCalibrationRequest) =>
      ipcRenderer.invoke(
        Channels.AnnotationsGetMeasureCalibration,
        req,
      ) as Promise<AnnotationsGetMeasureCalibrationResponse>,
  },
  // Phase 5 (api-contracts.md §16.12)
  ocr: {
    detectLanguages: (req: OcrDetectLanguagesRequest) =>
      ipcRenderer.invoke(Channels.OcrDetectLanguages, req) as Promise<OcrDetectLanguagesResponse>,
    runOnPage: (req: OcrRunOnPageRequest) =>
      ipcRenderer.invoke(Channels.OcrRunOnPage, req) as Promise<OcrRunOnPageResponse>,
    runOnDocument: (req: OcrRunOnDocumentRequest) =>
      ipcRenderer.invoke(Channels.OcrRunOnDocument, req) as Promise<OcrRunOnDocumentResponse>,
    cancelJob: (req: OcrCancelJobRequest) =>
      ipcRenderer.invoke(Channels.OcrCancelJob, req) as Promise<OcrCancelJobResponse>,
    listJobs: (req: OcrListJobsRequest) =>
      ipcRenderer.invoke(Channels.OcrListJobs, req) as Promise<OcrListJobsResponse>,
    // Phase 5.2 (Marcus, 2026-06-04): per-job word-level result retrieval.
    listResultsByJob: (req: OcrListResultsByJobRequest) =>
      ipcRenderer.invoke(Channels.OcrListResultsByJob, req) as Promise<OcrListResultsByJobResponse>,
    languagePackDownload: (req: OcrLanguagePackDownloadRequest) =>
      ipcRenderer.invoke(
        Channels.OcrLanguagePackDownload,
        req,
      ) as Promise<OcrLanguagePackDownloadResponse>,
    languagePackRemove: (req: OcrLanguagePackRemoveRequest) =>
      ipcRenderer.invoke(
        Channels.OcrLanguagePackRemove,
        req,
      ) as Promise<OcrLanguagePackRemoveResponse>,
    onProgress: (handler: (event: OcrProgressEvent) => void) => {
      const wrapped = (_e: unknown, event: OcrProgressEvent): void => handler(event);
      ipcRenderer.on(Channels.OcrProgress, wrapped);
      return () => {
        ipcRenderer.removeListener(Channels.OcrProgress, wrapped);
      };
    },
    onLanguagePackDownloadProgress: (
      handler: (event: OcrLanguagePackDownloadProgressEvent) => void,
    ) => {
      const wrapped = (_e: unknown, event: OcrLanguagePackDownloadProgressEvent): void =>
        handler(event);
      ipcRenderer.on(Channels.OcrLanguagePackDownloadProgress, wrapped);
      return () => {
        ipcRenderer.removeListener(Channels.OcrLanguagePackDownloadProgress, wrapped);
      };
    },
  },
  scan: {
    listDevices: (req: ScanListDevicesRequest) =>
      ipcRenderer.invoke(Channels.ScanListDevices, req) as Promise<ScanListDevicesResponse>,
    acquire: (req: ScanAcquireRequest) =>
      ipcRenderer.invoke(Channels.ScanAcquire, req) as Promise<ScanAcquireResponse>,
  },
  // Phase 6 (api-contracts.md §17.10)
  export: {
    toDocx: (req: ExportToDocxRequest) =>
      ipcRenderer.invoke(Channels.ExportToDocx, req) as Promise<ExportToDocxResponse>,
    toXlsx: (req: ExportToXlsxRequest) =>
      ipcRenderer.invoke(Channels.ExportToXlsx, req) as Promise<ExportToXlsxResponse>,
    toPptx: (req: ExportToPptxRequest) =>
      ipcRenderer.invoke(Channels.ExportToPptx, req) as Promise<ExportToPptxResponse>,
    toImages: (req: ExportToImagesRequest) =>
      ipcRenderer.invoke(Channels.ExportToImages, req) as Promise<ExportToImagesResponse>,
    cancelJob: (req: ExportCancelJobRequest) =>
      ipcRenderer.invoke(Channels.ExportCancelJob, req) as Promise<ExportCancelJobResponse>,
    listJobs: (req: ExportListJobsRequest) =>
      ipcRenderer.invoke(Channels.ExportListJobs, req) as Promise<ExportListJobsResponse>,
    listFormats: (req: ExportListFormatsRequest) =>
      ipcRenderer.invoke(Channels.ExportListFormats, req) as Promise<ExportListFormatsResponse>,
    onProgress: (handler: (event: ExportProgressEvent) => void) => {
      const wrapped = (_e: unknown, event: ExportProgressEvent): void => handler(event);
      ipcRenderer.on(Channels.ExportProgress, wrapped);
      return () => {
        ipcRenderer.removeListener(Channels.ExportProgress, wrapped);
      };
    },
  },
  events: {
    onExportProgress: (handler: (evt: PdfExportProgressEvent) => void) => {
      const wrapped = (_e: unknown, evt: PdfExportProgressEvent): void => handler(evt);
      ipcRenderer.on(Channels.PdfExportProgress, wrapped);
      return () => {
        ipcRenderer.removeListener(Channels.PdfExportProgress, wrapped);
      };
    },
    onMailMergeProgress: (handler: (evt: MailMergeProgressEvent) => void) => {
      const wrapped = (_e: unknown, evt: MailMergeProgressEvent): void => handler(evt);
      ipcRenderer.on(Channels.MailMergeProgress, wrapped);
      return () => {
        ipcRenderer.removeListener(Channels.MailMergeProgress, wrapped);
      };
    },
  },
  // Phase 7 (api-contracts.md §18.9)
  update: {
    check: (req: UpdateCheckRequest) =>
      ipcRenderer.invoke(Channels.UpdateCheck, req) as Promise<UpdateCheckResponse>,
    download: (req: UpdateDownloadRequest) =>
      ipcRenderer.invoke(Channels.UpdateDownload, req) as Promise<UpdateDownloadResponse>,
    install: (req: UpdateInstallRequest) =>
      ipcRenderer.invoke(Channels.UpdateInstall, req) as Promise<UpdateInstallResponse>,
    onProgress: (handler: (event: UpdateProgressEvent) => void) => {
      const wrapped = (_e: unknown, event: UpdateProgressEvent): void => handler(event);
      ipcRenderer.on(Channels.UpdateProgress, wrapped);
      return () => {
        ipcRenderer.removeListener(Channels.UpdateProgress, wrapped);
      };
    },
  },
  telemetry: {
    recordEvent: (req: TelemetryRecordEventRequest) =>
      ipcRenderer.invoke(
        Channels.TelemetryRecordEvent,
        req,
      ) as Promise<TelemetryRecordEventResponse>,
    setOptIn: (req: TelemetrySetOptInRequest) =>
      ipcRenderer.invoke(Channels.TelemetrySetOptIn, req) as Promise<TelemetrySetOptInResponse>,
    getStatus: (req: TelemetryGetStatusRequest) =>
      ipcRenderer.invoke(Channels.TelemetryGetStatus, req) as Promise<TelemetryGetStatusResponse>,
  },
  i18n: {
    setLocale: (req: I18nSetLocaleRequest) =>
      ipcRenderer.invoke(Channels.I18nSetLocale, req) as Promise<I18nSetLocaleResponse>,
    getAvailableLocales: (req: I18nGetAvailableLocalesRequest) =>
      ipcRenderer.invoke(
        Channels.I18nGetAvailableLocales,
        req,
      ) as Promise<I18nGetAvailableLocalesResponse>,
  },
  // Phase 7.1 (David, 2026-06-05) — test-only seed channel.
  //
  // Mounted ONLY when `process.env.NODE_ENV === 'test'`. In any other build
  // `pdfApi.__test` is `undefined`, and a renderer call like
  // `pdfApi.__test?.seedOcrJob(...)` short-circuits to `undefined` before any
  // IPC roundtrip. Defense-in-depth alongside the registration-time gate in
  // `src/ipc/handlers/test-seed-ocr-job.ts`. The handler is the gate of
  // record — this is a courtesy not a security boundary.
  // Dot syntax (not bracket) is load-bearing: Vite's `define` config in
  // `electron.vite.config.ts` folds `process.env.NODE_ENV` -> `"production"`
  // ONLY for the dot form. With the dot form, prod preload builds collapse
  // this conditional to a static `false` branch and Rollup DCEs the entire
  // `__test` namespace (including channel-name string references and
  // ipcRenderer.invoke closures). The bracket form would leave the strings
  // in `dist/preload/index.js`. See Julian's re-review §8 and the
  // prodNodeEnvDefine comment at the top of `electron.vite.config.ts`.
  ...(process.env.NODE_ENV === 'test'
    ? {
        __test: {
          seedOcrJob: (req: TestSeedOcrJobRequest) =>
            ipcRenderer.invoke(Channels.TestSeedOcrJob, req) as Promise<TestSeedOcrJobResponse>,
          // Phase 7.2 (David, 2026-06-10) — bridge-introspection probe.
          // Same NODE_ENV==='test' gate as `seedOcrJob`; `pdfApi.__test` is
          // `undefined` in any other build. See
          // `src/ipc/handlers/test-which-bridge.ts` for the structural gate.
          whichBridge: (req?: TestWhichBridgeRequest) =>
            ipcRenderer.invoke(
              Channels.TestWhichBridge,
              req ?? {},
            ) as Promise<TestWhichBridgeResponse>,
          // Phase 7.2 7.2.4 (Diego, 2026-06-10) — seed + readback for the
          // signed-PDF + OCR invalidation e2e. Same NODE_ENV==='test' gate;
          // pdfApi.__test stays `undefined` in any non-test build. See
          // `src/ipc/handlers/test-seed-signature-audit.ts` and
          // `src/ipc/handlers/test-list-signature-audit.ts` for the
          // structural gates on the main side.
          seedSignatureAudit: (req: TestSeedSignatureAuditRequest) =>
            ipcRenderer.invoke(
              Channels.TestSeedSignatureAudit,
              req,
            ) as Promise<TestSeedSignatureAuditResponse>,
          listSignatureAudit: (req: TestListSignatureAuditRequest) =>
            ipcRenderer.invoke(
              Channels.TestListSignatureAudit,
              req,
            ) as Promise<TestListSignatureAuditResponse>,
        },
      }
    : {}),
};

contextBridge.exposeInMainWorld('pdfApi', pdfApi);
