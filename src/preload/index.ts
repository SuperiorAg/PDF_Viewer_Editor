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
  PdfReplaceTextRequest,
  PdfReplaceTextResponse,
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
};

contextBridge.exposeInMainWorld('pdfApi', pdfApi);
