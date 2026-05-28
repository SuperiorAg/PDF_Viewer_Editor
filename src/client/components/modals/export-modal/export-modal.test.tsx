// ExportModal component tests — Phase 6.
// Per docs/ui-spec.md §15.3.
//
// Validates the 4-step wizard:
//   1. Format picker — clicking docx advances Next.
//   2. Quality + options + per-format limitations panel mounted.
//   3. Confirm summary with explicit qualityTier + path.
//   4. Running view shows progress when currentJob is set.
//
// Trust-floor honesty surface: assertions that the PerFormatLimitationsPanel
// is rendered with all expected obligation IDs in Step 2 + Step 3.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import documentReducer, { setDocument } from '../../../state/slices/document-slice';
import exportReducer, {
  openExportModal,
  setDraftOutputPath,
  setModalStep,
  startJobProgress,
} from '../../../state/slices/export-slice';
import uiReducer from '../../../state/slices/ui-slice';
import { type PDFDocumentModel } from '../../../types/ipc-contract';

import { ExportModal } from './index';

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 'my-doc.pdf',
  fileHash: 'doc-hash-abc',
  pageCount: 5,
  pages: Array.from({ length: 5 }, (_, i) => ({
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
  // Provide a no-op pdfApi so the api.ts proxies don't fall back to console
  // warnings. listFormats is called on mount.
  vi.stubGlobal('pdfApi', {
    export: {
      listFormats: vi.fn().mockResolvedValue({
        ok: true,
        value: { formats: [] },
      }),
      toDocx: vi.fn(),
      toXlsx: vi.fn(),
      toPptx: vi.fn(),
      toImages: vi.fn(),
      cancelJob: vi.fn(),
      listJobs: vi.fn().mockResolvedValue({ ok: true, value: { jobs: [], total: 0 } }),
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

function renderModal(prep?: (store: AnyStore) => void): AnyStore {
  const store = makeStore();
  store.dispatch(setDocument(DOC));
  store.dispatch(openExportModal(undefined));
  prep?.(store);
  render(
    <Provider store={store}>
      <ExportModal />
    </Provider>,
  );
  return store;
}

describe('ExportModal — Step 1 (format picker)', () => {
  it('renders four format cards (Word/Excel/PowerPoint/Image)', () => {
    renderModal();
    expect(screen.getByText(/^Word$/)).toBeInTheDocument();
    expect(screen.getByText(/^Excel$/)).toBeInTheDocument();
    expect(screen.getByText(/^PowerPoint$/)).toBeInTheDocument();
    expect(screen.getByText(/^Image$/)).toBeInTheDocument();
  });

  it('Next is disabled until a format is picked', () => {
    renderModal();
    const next = screen.getByTestId('format-next-button');
    expect(next).toBeDisabled();
  });

  it('clicking a format card enables Next', () => {
    renderModal();
    fireEvent.click(screen.getByText(/^Word$/));
    expect(screen.getByTestId('format-next-button')).not.toBeDisabled();
  });

  it('picking Image reveals the image-variant sub-picker', () => {
    renderModal();
    fireEvent.click(screen.getByText(/^Image$/));
    expect(screen.getByTestId('image-variant-png')).toBeInTheDocument();
    expect(screen.getByTestId('image-variant-jpeg')).toBeInTheDocument();
    expect(screen.getByTestId('image-variant-tiff')).toBeInTheDocument();
  });
});

describe('ExportModal — Step 2 (quality + options + limitations panel)', () => {
  function openOptions(format: 'docx' | 'xlsx' | 'png' = 'docx'): AnyStore {
    return renderModal((store) => {
      store.dispatch({ type: 'export/setDraftFormat', payload: format });
      store.dispatch(setModalStep('options'));
    });
  }

  it('renders the per-format limitations panel with the docx obligations', () => {
    openOptions('docx');
    const panel = screen.getByTestId('per-format-limitations-panel');
    expect(panel).toBeInTheDocument();
    // The five obligations all surface for docx — assert presence of a
    // sentinel keyword from each bullet.
    expect(panel.textContent).toMatch(/best-effort/i);
    expect(panel.textContent).toMatch(/borderless/i);
    expect(panel.textContent).toMatch(/XFA/);
    expect(panel.textContent).toMatch(/signed/i);
    expect(panel.textContent).toMatch(/OCR/);
  });

  it('xlsx limitations panel omits the OCR obligation #5', () => {
    openOptions('xlsx');
    const panel = screen.getByTestId('per-format-limitations-panel');
    expect(panel).toBeInTheDocument();
    // Excel excludes #5 per ui-spec §15.3.1 (cells are data, not visual).
    // We assert by counting obligation-data-attributes.
    const items = panel.querySelectorAll('[data-obligation]');
    const ids = Array.from(items).map((el) => el.getAttribute('data-obligation'));
    expect(ids).toContain('1');
    expect(ids).toContain('2');
    expect(ids).toContain('3');
    expect(ids).toContain('4');
    expect(ids).not.toContain('5');
  });

  it('image-format limitations omit the office-only obligations #1-#3', () => {
    openOptions('png');
    const panel = screen.getByTestId('per-format-limitations-panel');
    const items = panel.querySelectorAll('[data-obligation]');
    const ids = Array.from(items).map((el) => el.getAttribute('data-obligation'));
    // Image surfaces #4 (signed source) + duration only — no layout-preserving
    // / borderless-table / XFA bullets (irrelevant for raster output).
    expect(ids).toContain('4');
    expect(ids).toContain('duration');
    expect(ids).not.toContain('1');
    expect(ids).not.toContain('2');
    expect(ids).not.toContain('3');
  });

  it('quality-tier picker is HIDDEN for image formats', () => {
    openOptions('png');
    expect(screen.queryByTestId('quality-tier-picker')).toBeNull();
  });

  it('quality-tier picker IS shown for office formats', () => {
    openOptions('docx');
    expect(screen.getByTestId('quality-tier-picker')).toBeInTheDocument();
    expect(screen.getByTestId('quality-tier-layout-preserving')).toBeInTheDocument();
    expect(screen.getByTestId('quality-tier-text-only')).toBeInTheDocument();
  });

  it('per-format options block is rendered with page range + include-annotations', () => {
    openOptions('docx');
    expect(screen.getByTestId('per-format-options')).toBeInTheDocument();
    expect(screen.getByTestId('include-annotations')).toBeInTheDocument();
    expect(screen.getByTestId('page-range-all')).toBeInTheDocument();
  });

  it('Next is disabled until an output path is picked', () => {
    openOptions('docx');
    expect(screen.getByTestId('options-next-button')).toBeDisabled();
  });
});

describe('ExportModal — Step 3 (confirm)', () => {
  it('renders the confirm summary AND re-surfaces the limitations panel', () => {
    renderModal((store) => {
      store.dispatch({ type: 'export/setDraftFormat', payload: 'docx' });
      store.dispatch(setDraftOutputPath('C:\\out\\my-doc.docx'));
      store.dispatch(setModalStep('confirm'));
    });
    expect(screen.getByTestId('export-confirm-summary')).toBeInTheDocument();
    // Confirm step ALSO mounts the limitations panel (Wave 24 bonus
    // placement — fifth-instance honesty surface).
    expect(screen.getByTestId('per-format-limitations-panel')).toBeInTheDocument();
    expect(screen.getByTestId('export-start-button')).not.toBeDisabled();
  });
});

describe('ExportModal — Step 4 (running)', () => {
  it('renders the running step when a job is in-flight + step=running', () => {
    renderModal((store) => {
      store.dispatch(startJobProgress({ jobId: 7, format: 'docx', totalPages: 10 }));
      store.dispatch(setModalStep('running'));
    });
    expect(screen.getByTestId('export-running-step')).toBeInTheDocument();
    expect(screen.getByTestId('export-cancel-button')).toBeInTheDocument();
  });
});
