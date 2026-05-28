// ExportStatusBarWidget component tests — Phase 6.
// Per docs/ui-spec.md §15.5.

import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import documentReducer from '../../state/slices/document-slice';
import exportReducer, {
  applyExportProgressEvent,
  startJobProgress,
} from '../../state/slices/export-slice';
import uiReducer from '../../state/slices/ui-slice';

import { ExportStatusBarWidget } from './export-progress';

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
      cancelJob: vi.fn(),
      onProgress: vi.fn(() => () => undefined),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderWidget(prep?: (s: AnyStore) => void): AnyStore {
  const store = makeStore();
  prep?.(store);
  render(
    <Provider store={store}>
      <ExportStatusBarWidget />
    </Provider>,
  );
  return store;
}

describe('ExportStatusBarWidget', () => {
  it('renders nothing when no job is in flight', () => {
    const { container } = render(
      <Provider store={makeStore()}>
        <ExportStatusBarWidget />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the running indicator + Cancel button while extracting', () => {
    renderWidget((store) => {
      store.dispatch(startJobProgress({ jobId: 1, format: 'docx', totalPages: 10 }));
      store.dispatch(
        applyExportProgressEvent({
          jobId: 1,
          format: 'docx',
          phase: 'extracting-text',
          pageIndex: 3,
          totalPages: 10,
        }),
      );
    });
    expect(screen.getByTestId('export-status-widget-running')).toBeInTheDocument();
    expect(screen.getByText(/page 4 of 10/i)).toBeInTheDocument();
    expect(screen.getByTestId('export-status-widget-cancel')).toBeInTheDocument();
  });

  it('renders the completed indicator with View + Dismiss buttons', () => {
    renderWidget((store) => {
      store.dispatch(startJobProgress({ jobId: 2, format: 'xlsx', totalPages: 1 }));
      store.dispatch(
        applyExportProgressEvent({
          jobId: 2,
          format: 'xlsx',
          phase: 'completed',
          summary: {
            jobId: 2,
            format: 'xlsx',
            qualityTier: 'text-only',
            pageCount: 1,
            durationMs: 500,
            outputBasename: 'foo.xlsx',
            outputDirHint: 'Downloads',
            outputSizeBytes: 1234,
            contentStats: null,
            perPageProgress: null,
          },
        }),
      );
    });
    expect(screen.getByTestId('export-status-widget-completed')).toBeInTheDocument();
    expect(screen.getByText(/Export complete/i)).toBeInTheDocument();
  });

  it('renders the failed indicator with the error', () => {
    renderWidget((store) => {
      store.dispatch(startJobProgress({ jobId: 3, format: 'pptx', totalPages: 4 }));
      store.dispatch(
        applyExportProgressEvent({
          jobId: 3,
          format: 'pptx',
          phase: 'failed',
          pagesCompleted: 1,
          totalPages: 4,
          error: 'extraction_failed',
        }),
      );
    });
    expect(screen.getByTestId('export-status-widget-failed')).toBeInTheDocument();
    expect(screen.getByText(/extraction_failed/)).toBeInTheDocument();
  });
});
