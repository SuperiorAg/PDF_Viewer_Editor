// ExportsPanel component tests — Phase 6.
// Per docs/ui-spec.md §15.4.
//
// Validates:
//   - Empty state when no jobs.
//   - Honesty banner is always present (trust-floor #2 placement).
//   - JobRow renders with the right format / basename / status / actions.
//   - "older version" badge appears when job.docHash !== currentDocHash.

import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import documentReducer, { setDocument } from '../../../state/slices/document-slice';
import exportReducer, { setRecentJobs, startJobProgress } from '../../../state/slices/export-slice';
import uiReducer from '../../../state/slices/ui-slice';
import { type ExportJobRowDto, type PDFDocumentModel } from '../../../types/ipc-contract';

import { ExportsPanel } from './index';

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 'doc.pdf',
  fileHash: 'CURRENT_HASH',
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

const COMPLETED_JOB: ExportJobRowDto = {
  id: 1,
  docHash: 'CURRENT_HASH',
  format: 'docx',
  qualityTier: 'layout-preserving',
  pageRange: { start: 0, end: 2 },
  includeAnnotations: true,
  imageOptions: null,
  outputBasename: 'doc.docx',
  outputDirHint: 'Downloads',
  outputSizeBytes: 4096,
  status: 'completed',
  startedAt: Date.now() - 5 * 60 * 1000,
  completedAt: Date.now() - 5 * 60 * 1000,
  durationMs: 800,
  pagesProcessed: 3,
  contentStats: {
    paragraphsExtracted: 12,
    tablesDetected: 1,
    imagesEmbedded: 0,
  },
  errorMessage: null,
  createdAt: Date.now() - 6 * 60 * 1000,
};

const FAILED_JOB: ExportJobRowDto = {
  ...COMPLETED_JOB,
  id: 2,
  outputBasename: 'doc.xlsx',
  format: 'xlsx',
  status: 'failed',
  errorMessage: 'output_path_unwritable',
  completedAt: Date.now() - 2 * 60 * 1000,
};

const OLDER_VERSION_JOB: ExportJobRowDto = {
  ...COMPLETED_JOB,
  id: 3,
  docHash: 'OLD_HASH',
  outputBasename: 'doc-old.docx',
};

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

beforeEach(() => {
  vi.stubGlobal('pdfApi', {
    export: {
      listJobs: vi.fn().mockResolvedValue({ ok: true, value: { jobs: [], total: 0 } }),
      cancelJob: vi.fn(),
      listFormats: vi.fn().mockResolvedValue({ ok: true, value: { formats: [] } }),
      toDocx: vi.fn(),
      toXlsx: vi.fn(),
      toPptx: vi.fn(),
      toImages: vi.fn(),
      onProgress: vi.fn(() => () => undefined),
    },
    dialog: {
      pickExportOutputPath: vi.fn(),
      openPdf: vi.fn(),
      saveAs: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPanel(prep?: (s: AnyStore) => void): AnyStore {
  const store = makeStore();
  store.dispatch(setDocument(DOC));
  prep?.(store);
  render(
    <Provider store={store}>
      <ExportsPanel />
    </Provider>,
  );
  return store;
}

describe('ExportsPanel — empty state', () => {
  it('shows the honesty banner (trust-floor placement #2)', () => {
    renderPanel((store) => {
      store.dispatch(setRecentJobs([]));
    });
    expect(screen.getByTestId('exports-honesty-banner')).toBeInTheDocument();
    expect(screen.getByText(/About PDF → Office export/)).toBeInTheDocument();
  });

  it('shows the empty-state copy when no jobs exist', () => {
    renderPanel((store) => {
      store.dispatch(setRecentJobs([]));
    });
    expect(screen.getByText(/No exports yet/)).toBeInTheDocument();
  });
});

describe('ExportsPanel — job rows', () => {
  it('renders a completed job with stats + outputBasename', () => {
    renderPanel((store) => {
      store.dispatch(setRecentJobs([COMPLETED_JOB]));
    });
    expect(screen.getByTestId(`export-job-row-${COMPLETED_JOB.id}`)).toBeInTheDocument();
    expect(screen.getByText(/doc\.docx/)).toBeInTheDocument();
  });

  it('renders a failed job with the error message', () => {
    renderPanel((store) => {
      store.dispatch(setRecentJobs([FAILED_JOB]));
    });
    expect(screen.getByTestId(`export-job-row-${FAILED_JOB.id}`)).toBeInTheDocument();
    expect(screen.getByText(/output_path_unwritable/)).toBeInTheDocument();
  });

  it('shows "older version" badge when docHash diverges from current', () => {
    renderPanel((store) => {
      store.dispatch(setRecentJobs([OLDER_VERSION_JOB]));
    });
    expect(screen.getByText(/older version/i)).toBeInTheDocument();
  });

  it('shows the "+ New export" affordance', () => {
    renderPanel((store) => {
      store.dispatch(setRecentJobs([]));
    });
    expect(screen.getByTestId('open-export-modal-from-panel')).toBeInTheDocument();
  });
});

describe('ExportsPanel — in-flight job', () => {
  it('renders the Running section with the currentJob phase', () => {
    renderPanel((store) => {
      store.dispatch(setRecentJobs([]));
      store.dispatch(startJobProgress({ jobId: 99, format: 'docx', totalPages: 5 }));
    });
    expect(screen.getByText(/Running/)).toBeInTheDocument();
    expect(screen.getByText(/Phase: starting/i)).toBeInTheDocument();
  });
});
