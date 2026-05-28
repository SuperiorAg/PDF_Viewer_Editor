// Phase 6 thunks tests — Riley Wave 24.
// Validates the renderer-side IPC choreography for Export-to-Office: thunks
// dispatch the right slice actions in response to apiExport.* return values.
//
// Same pattern as `thunks-phase5.test.ts` — we stub `window.pdfApi.export` and
// `window.pdfApi.dialog` so the Proxy-based `apiExport` + `apiDialogPhase6`
// proxies route through the mocks.

import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ExportFormatDescriptor,
  type ExportJobRowDto,
  type ExportProgressEvent,
} from '../types/ipc-contract';

import documentReducer from './slices/document-slice';
import exportReducer, { type ExportState, openExportModal } from './slices/export-slice';
import uiReducer from './slices/ui-slice';
import {
  cancelExportThunk,
  closeExportModalAndCleanup,
  listExportFormatsThunk,
  pickExportOutputPathThunk,
  refreshExportJobsThunk,
  startExportThunk,
  subscribeExportProgress,
} from './thunks-phase6';

function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      ui: uiReducer,
      export: exportReducer,
    },
  });
}

type AnyStore = ReturnType<typeof makeStore>;
function dispatchThunk(store: AnyStore, thunk: unknown): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (store.dispatch as any)(thunk);
}

function getExport(store: AnyStore): ExportState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (store.getState() as any).export as ExportState;
}

const SAMPLE_CATALOG: ExportFormatDescriptor[] = [
  {
    format: 'docx',
    displayName: 'Word document',
    defaultExtension: 'docx',
    category: 'office',
    supportsQualityTier: true,
    defaultQualityTier: 'layout-preserving',
    defaultIncludeAnnotations: true,
    settingKeys: ['export.docx.qualityTier'],
  },
  {
    format: 'xlsx',
    displayName: 'Excel workbook',
    defaultExtension: 'xlsx',
    category: 'office',
    supportsQualityTier: true,
    defaultQualityTier: 'text-only',
    defaultIncludeAnnotations: false,
    settingKeys: ['export.xlsx.qualityTier'],
  },
];

const COMPLETED_SUMMARY = {
  jobId: 7,
  format: 'docx' as const,
  qualityTier: 'layout-preserving' as const,
  pageCount: 3,
  durationMs: 800,
  outputBasename: 'my-doc.docx',
  outputDirHint: 'Downloads',
  outputSizeBytes: 12345,
  contentStats: {
    paragraphsExtracted: 12,
    tablesDetected: 1,
    imagesEmbedded: 0,
  },
  perPageProgress: null,
};

// ---------- mock factories ----------

type ExportApiMock = {
  toDocx: ReturnType<typeof vi.fn>;
  toXlsx: ReturnType<typeof vi.fn>;
  toPptx: ReturnType<typeof vi.fn>;
  toImages: ReturnType<typeof vi.fn>;
  cancelJob: ReturnType<typeof vi.fn>;
  listJobs: ReturnType<typeof vi.fn>;
  listFormats: ReturnType<typeof vi.fn>;
  onProgress: ReturnType<typeof vi.fn>;
};

function makeExportMock(): ExportApiMock {
  return {
    toDocx: vi.fn(),
    toXlsx: vi.fn(),
    toPptx: vi.fn(),
    toImages: vi.fn(),
    cancelJob: vi.fn(),
    listJobs: vi.fn(),
    listFormats: vi.fn(),
    onProgress: vi.fn(() => () => undefined),
  };
}

type DialogApiMock = {
  pickExportOutputPath: ReturnType<typeof vi.fn>;
  // The legacy Phase 1 dialog channels are required by the PdfApi shape;
  // stub them so the gatekeeper does not fall through to the fallback when
  // we install our window.pdfApi mock object.
  openPdf: ReturnType<typeof vi.fn>;
  saveAs: ReturnType<typeof vi.fn>;
};

function makeDialogMock(): DialogApiMock {
  return {
    pickExportOutputPath: vi.fn(),
    openPdf: vi.fn(),
    saveAs: vi.fn(),
  };
}

beforeEach(() => {
  const exportMock = makeExportMock();
  const dialogMock = makeDialogMock();
  // Minimal pdfApi shape — only the surfaces Phase 6 thunks touch. The api.ts
  // gatekeeper Proxy reads window.pdfApi.export / .dialog by namespace.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal('pdfApi', { export: exportMock, dialog: dialogMock } as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------- listExportFormatsThunk ----------

describe('listExportFormatsThunk', () => {
  it('stores the catalog on success', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.listFormats.mockResolvedValue({
      ok: true,
      value: { formats: SAMPLE_CATALOG },
    });
    await dispatchThunk(store, listExportFormatsThunk());
    expect(getExport(store).formatCatalog).toEqual(SAMPLE_CATALOG);
  });

  it('swallows bridge-unavailable failures silently', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.listFormats.mockResolvedValue({
      ok: false,
      error: 'bridge_unavailable',
      message: 'unavailable',
    });
    await dispatchThunk(store, listExportFormatsThunk());
    expect(getExport(store).formatCatalog).toBe(null);
  });
});

// ---------- pickExportOutputPathThunk ----------

describe('pickExportOutputPathThunk', () => {
  it('writes the picked path into the draft', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.dialog.pickExportOutputPath.mockResolvedValue({
      ok: true,
      value: { outputPath: 'C:\\Users\\foo\\bar.docx' },
    });
    await dispatchThunk(
      store,
      pickExportOutputPathThunk({
        defaultBasename: 'bar',
        format: 'docx',
      }),
    );
    expect(getExport(store).draft.outputPath).toBe('C:\\Users\\foo\\bar.docx');
  });

  it('stores null when the user cancels', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.dialog.pickExportOutputPath.mockResolvedValue({
      ok: true,
      value: { outputPath: null },
    });
    await dispatchThunk(
      store,
      pickExportOutputPathThunk({
        defaultBasename: 'bar',
        format: 'docx',
      }),
    );
    expect(getExport(store).draft.outputPath).toBe(null);
  });

  it('records the error on failure', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.dialog.pickExportOutputPath.mockResolvedValue({
      ok: false,
      error: 'invalid_payload',
      message: 'bad',
    });
    await dispatchThunk(
      store,
      pickExportOutputPathThunk({
        defaultBasename: 'bar',
        format: 'docx',
      }),
    );
    expect(getExport(store).phase6LastError).toBe('bad');
  });
});

// ---------- startExportThunk ----------

describe('startExportThunk', () => {
  const baseArg = {
    handle: 1 as number,
    pageRange: { start: 0, end: 5 },
    includeAnnotations: true,
    pageSize: 'auto' as const,
    outputPath: 'C:\\out.docx',
    imageOptions: {
      imageFormat: 'png' as const,
      dpi: 150,
      jpegQuality: 0.9,
      multiPageTiff: false,
    },
  };

  it('routes docx → apiExport.toDocx with explicit qualityTier', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.toDocx.mockResolvedValue({
      ok: true,
      value: { jobId: 7, summary: COMPLETED_SUMMARY },
    });
    await dispatchThunk(
      store,
      startExportThunk({
        ...baseArg,
        format: 'docx',
        qualityTier: 'layout-preserving',
      }),
    );
    expect(w.pdfApi.export.toDocx).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 1,
        qualityTier: 'layout-preserving',
        includeAnnotations: true,
        pageSize: 'auto',
        outputPath: 'C:\\out.docx',
      }),
    );
  });

  it('routes xlsx with explicit text-only tier', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.toXlsx.mockResolvedValue({
      ok: true,
      value: { jobId: 8, summary: { ...COMPLETED_SUMMARY, format: 'xlsx' } },
    });
    await dispatchThunk(
      store,
      startExportThunk({
        ...baseArg,
        format: 'xlsx',
        qualityTier: 'text-only',
      }),
    );
    expect(w.pdfApi.export.toXlsx).toHaveBeenCalledWith(
      expect.objectContaining({ qualityTier: 'text-only' }),
    );
  });

  it('coerces qualityTier="n/a" to layout-preserving for docx', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.toDocx.mockResolvedValue({
      ok: true,
      value: { jobId: 9, summary: COMPLETED_SUMMARY },
    });
    await dispatchThunk(
      store,
      startExportThunk({ ...baseArg, format: 'docx', qualityTier: 'n/a' }),
    );
    expect(w.pdfApi.export.toDocx).toHaveBeenCalledWith(
      expect.objectContaining({ qualityTier: 'layout-preserving' }),
    );
  });

  it('routes png → toImages without jpegQuality / multiPageTiff', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.toImages.mockResolvedValue({
      ok: true,
      value: {
        jobId: 11,
        summary: { ...COMPLETED_SUMMARY, format: 'png' },
        outputPaths: ['C:\\out-1.png'],
      },
    });
    await dispatchThunk(store, startExportThunk({ ...baseArg, format: 'png', qualityTier: 'n/a' }));
    expect(w.pdfApi.export.toImages).toHaveBeenCalledTimes(1);
    const call = w.pdfApi.export.toImages.mock.calls[0]?.[0];
    expect(call.format).toBe('png');
    expect(call.dpi).toBe(150);
    expect(call.jpegQuality).toBeUndefined();
    expect(call.multiPageTiff).toBeUndefined();
  });

  it('routes jpeg → toImages WITH jpegQuality but NO multiPageTiff', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.toImages.mockResolvedValue({
      ok: true,
      value: {
        jobId: 12,
        summary: { ...COMPLETED_SUMMARY, format: 'jpeg' },
        outputPaths: ['C:\\out-1.jpeg'],
      },
    });
    await dispatchThunk(
      store,
      startExportThunk({
        ...baseArg,
        format: 'jpeg',
        qualityTier: 'n/a',
        imageOptions: {
          imageFormat: 'jpeg',
          dpi: 200,
          jpegQuality: 0.7,
          multiPageTiff: false,
        },
      }),
    );
    const call = w.pdfApi.export.toImages.mock.calls[0]?.[0];
    expect(call.format).toBe('jpeg');
    expect(call.jpegQuality).toBe(0.7);
    expect(call.multiPageTiff).toBeUndefined();
  });

  it('routes tiff → toImages WITH multiPageTiff but NO jpegQuality', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.toImages.mockResolvedValue({
      ok: true,
      value: {
        jobId: 13,
        summary: { ...COMPLETED_SUMMARY, format: 'tiff' },
        outputPaths: ['C:\\out.tiff'],
      },
    });
    await dispatchThunk(
      store,
      startExportThunk({
        ...baseArg,
        format: 'tiff',
        qualityTier: 'n/a',
        imageOptions: {
          imageFormat: 'tiff',
          dpi: 300,
          jpegQuality: 0.9,
          multiPageTiff: true,
        },
      }),
    );
    const call = w.pdfApi.export.toImages.mock.calls[0]?.[0];
    expect(call.format).toBe('tiff');
    expect(call.multiPageTiff).toBe(true);
    expect(call.jpegQuality).toBeUndefined();
  });

  it('records the error on failure', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.toDocx.mockResolvedValue({
      ok: false,
      error: 'output_path_unwritable',
      message: 'locked',
    });
    await dispatchThunk(
      store,
      startExportThunk({
        ...baseArg,
        format: 'docx',
        qualityTier: 'layout-preserving',
      }),
    );
    expect(getExport(store).phase6LastError).toBe('locked');
  });
});

// ---------- cancelExportThunk ----------

describe('cancelExportThunk', () => {
  it('treats job_already_terminal as benign (no error toast)', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.cancelJob.mockResolvedValue({
      ok: false,
      error: 'job_already_terminal',
      message: 'gone',
    });
    await dispatchThunk(store, cancelExportThunk({ jobId: 7 }));
    expect(getExport(store).phase6LastError).toBe(null);
  });

  it('records other errors', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.cancelJob.mockResolvedValue({
      ok: false,
      error: 'job_not_found',
      message: 'nope',
    });
    await dispatchThunk(store, cancelExportThunk({ jobId: 999 }));
    expect(getExport(store).phase6LastError).toBe('nope');
  });

  it('calls cancelJob with the right jobId on success', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.cancelJob.mockResolvedValue({
      ok: true,
      value: { cancelled: true, pagesCompleted: 4 },
    });
    await dispatchThunk(store, cancelExportThunk({ jobId: 5 }));
    expect(w.pdfApi.export.cancelJob).toHaveBeenCalledWith({ jobId: 5 });
  });
});

// ---------- refreshExportJobsThunk ----------

describe('refreshExportJobsThunk', () => {
  const DTO: ExportJobRowDto = {
    id: 1,
    docHash: 'abc',
    format: 'docx',
    qualityTier: 'layout-preserving',
    pageRange: { start: 0, end: 0 },
    includeAnnotations: true,
    imageOptions: null,
    outputBasename: 'a.docx',
    outputDirHint: 'Downloads',
    outputSizeBytes: null,
    status: 'running',
    startedAt: 1,
    completedAt: null,
    durationMs: null,
    pagesProcessed: 0,
    contentStats: null,
    errorMessage: null,
    createdAt: 0,
  };

  it('populates recentJobs', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.listJobs.mockResolvedValue({
      ok: true,
      value: { jobs: [DTO], total: 1 },
    });
    await dispatchThunk(store, refreshExportJobsThunk());
    expect(getExport(store).recentJobs).toEqual([DTO]);
  });

  it('records errors', async () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.pdfApi.export.listJobs.mockResolvedValue({
      ok: false,
      error: 'invalid_payload',
      message: 'bad',
    });
    await dispatchThunk(store, refreshExportJobsThunk());
    expect(getExport(store).phase6LastError).toBe('bad');
  });
});

// ---------- closeExportModalAndCleanup ----------

describe('closeExportModalAndCleanup', () => {
  it('closes the modal without clearing the job', async () => {
    const store = makeStore();
    store.dispatch(openExportModal(undefined));
    expect(getExport(store).modalStep).toBe('format');
    await dispatchThunk(store, closeExportModalAndCleanup());
    expect(getExport(store).modalStep).toBe(null);
  });
});

// ---------- subscribeExportProgress (event bridge) ----------

describe('subscribeExportProgress', () => {
  it('dispatches startJobProgress on the first "starting" event', () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    let captured: ((evt: ExportProgressEvent) => void) | null = null;
    w.pdfApi.export.onProgress.mockImplementation((handler: (evt: ExportProgressEvent) => void) => {
      captured = handler;
      return () => undefined;
    });
    subscribeExportProgress(store.dispatch);
    expect(captured).not.toBe(null);
    captured?.({
      jobId: 42,
      format: 'docx',
      phase: 'starting',
      totalPages: 5,
    });
    const s = getExport(store);
    expect(s.currentJob?.jobId).toBe(42);
    expect(s.currentJob?.totalPages).toBe(5);
  });

  it('updates pageIndex on extracting-text events', () => {
    const store = makeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    let captured: ((evt: ExportProgressEvent) => void) | null = null;
    w.pdfApi.export.onProgress.mockImplementation((handler: (evt: ExportProgressEvent) => void) => {
      captured = handler;
      return () => undefined;
    });
    subscribeExportProgress(store.dispatch);
    captured?.({
      jobId: 1,
      format: 'docx',
      phase: 'starting',
      totalPages: 10,
    });
    captured?.({
      jobId: 1,
      format: 'docx',
      phase: 'extracting-text',
      pageIndex: 4,
      totalPages: 10,
    });
    expect(getExport(store).currentJob?.pageIndex).toBe(4);
  });
});
