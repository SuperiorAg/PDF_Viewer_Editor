// Export Report dialog — RTL tests.
// Phase 7.5 C6 §27.3 (Riley Wave 5e).

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import accessibilityCheckReducer, {
  exportDialogOpened,
  runSucceeded,
} from '../../../state/slices/accessibility-check-slice';
import altTextReducer from '../../../state/slices/alt-text-slice';
import documentPropertiesReducer from '../../../state/slices/document-properties-slice';
import documentReducer, { setDocument } from '../../../state/slices/document-slice';
import readingOrderReducer from '../../../state/slices/reading-order-slice';
import structTreeReducer from '../../../state/slices/struct-tree-slice';
import uiReducer from '../../../state/slices/ui-slice';
import viewportReducer from '../../../state/slices/viewport-slice';
import type { PdfRunAccessibilityCheckValue } from '../../../types/accessibility-check-contract-stub';
import type { PDFDocumentModel } from '../../../types/ipc-contract';
import { AccessibilityCheckPanel } from '../index';

import { defaultFilenameForExport } from './index';

const VERBATIM_DISCLOSURE = 'Subset of WCAG 2.1 + PDF/UA-1 — see Help for the shipped rule set.';

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 'sample.pdf',
  fileHash: 'h',
  pageCount: 5,
  pages: [],
  annotations: [],
  dirtyOps: [],
  savedAtHandleVersion: 0,
  pdflibLoadWarnings: [],
};

function fixtureValue(): PdfRunAccessibilityCheckValue {
  return {
    results: [
      {
        ruleId: 'a11y.document.title-present',
        severity: 'error',
        status: 'fail',
        passed: false,
        message: 'a11y.documentTitlePresent.fail',
        locations: [],
      },
    ],
    summary: { pass: 0, warn: 0, fail: 1, unevaluated: 0 },
    ranAt: 1750000000000,
    shippedRuleCount: 12,
    subsetDisclosure: VERBATIM_DISCLOSURE,
  };
}

function makeStore() {
  return configureStore({
    reducer: {
      accessibilityCheck: accessibilityCheckReducer,
      altText: altTextReducer,
      document: documentReducer,
      documentProperties: documentPropertiesReducer,
      readingOrder: readingOrderReducer,
      structTree: structTreeReducer,
      ui: uiReducer,
      viewport: viewportReducer,
    },
  });
}

function setupOpenDialog() {
  const store = makeStore();
  store.dispatch(setDocument(DOC));
  store.dispatch(runSucceeded(fixtureValue()));
  store.dispatch(exportDialogOpened());
  const utils = render(
    <Provider store={store}>
      <AccessibilityCheckPanel />
    </Provider>,
  );
  return { store, ...utils };
}

describe('defaultFilenameForExport — naming convention', () => {
  it('produces accessibility-report-<stem>-<YYYY-MM-DD>.{ext}', () => {
    const name = defaultFilenameForExport('contract.pdf', 'html');
    expect(name).toMatch(/^accessibility-report-contract-\d{4}-\d{2}-\d{2}\.html$/);
  });

  it('respects the format choice for the extension', () => {
    expect(defaultFilenameForExport('contract.pdf', 'json')).toMatch(/\.json$/);
    expect(defaultFilenameForExport('contract.pdf', 'html')).toMatch(/\.html$/);
  });

  it('strips the .pdf source extension before composing', () => {
    expect(defaultFilenameForExport('Q4-Report.pdf', 'html')).toMatch(/Q4-Report-/);
    expect(defaultFilenameForExport('Q4-Report.pdf', 'html')).not.toMatch(/\.pdf-/);
  });
});

describe('ExportReportDialog — render + close', () => {
  it('renders the format radio (HTML default selected)', () => {
    setupOpenDialog();
    const htmlRadio = screen.getByTestId('export-format-html') as HTMLInputElement;
    const jsonRadio = screen.getByTestId('export-format-json') as HTMLInputElement;
    expect(htmlRadio.checked).toBe(true);
    expect(jsonRadio.checked).toBe(false);
  });

  it('renders the verbatim subsetDisclosure (locked) inside the dialog', () => {
    setupOpenDialog();
    const locked = screen.getByTestId('export-locked-disclosure');
    expect(locked.textContent).toBe(VERBATIM_DISCLOSURE);
  });

  it('renders both gate checkboxes checked by default', () => {
    setupOpenDialog();
    const passed = screen.getByTestId('export-include-passed') as HTMLInputElement;
    const unevaluated = screen.getByTestId('export-include-unevaluated') as HTMLInputElement;
    expect(passed.checked).toBe(true);
    expect(unevaluated.checked).toBe(true);
  });

  it('pre-fills the filename with the expected pattern', () => {
    setupOpenDialog();
    const input = screen.getByTestId('export-filename-input') as HTMLInputElement;
    expect(input.value).toMatch(/^accessibility-report-sample-\d{4}-\d{2}-\d{2}\.html$/);
  });

  it('closes when Cancel is clicked', () => {
    const { store } = setupOpenDialog();
    expect(store.getState().accessibilityCheck.exportDialogOpen).toBe(true);
    fireEvent.click(screen.getByTestId('export-cancel'));
    expect(store.getState().accessibilityCheck.exportDialogOpen).toBe(false);
  });

  it('closes when Escape is pressed', () => {
    const { store } = setupOpenDialog();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(store.getState().accessibilityCheck.exportDialogOpen).toBe(false);
  });
});

describe('ExportReportDialog — format ↔ filename interaction', () => {
  it('toggling format swaps the filename extension', () => {
    setupOpenDialog();
    const input = screen.getByTestId('export-filename-input') as HTMLInputElement;
    expect(input.value).toMatch(/\.html$/);
    fireEvent.click(screen.getByTestId('export-format-json'));
    expect(input.value).toMatch(/\.json$/);
  });

  it('preserves a user-edited stem when the format toggles', () => {
    setupOpenDialog();
    const input = screen.getByTestId('export-filename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'my-custom-name.html' } });
    fireEvent.click(screen.getByTestId('export-format-json'));
    expect(input.value).toBe('my-custom-name.json');
  });
});

describe('ExportReportDialog — filename validation', () => {
  it('disables Export when the filename is empty', () => {
    setupOpenDialog();
    const input = screen.getByTestId('export-filename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByTestId('export-confirm')).toBeDisabled();
    expect(screen.getByTestId('export-filename-error')).toBeTruthy();
  });

  it('disables Export when the filename has illegal characters', () => {
    setupOpenDialog();
    const input = screen.getByTestId('export-filename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'bad/name?.html' } });
    expect(screen.getByTestId('export-confirm')).toBeDisabled();
    expect(screen.getByTestId('export-filename-error')).toBeTruthy();
  });

  it('keeps Export enabled for a clean filename', () => {
    setupOpenDialog();
    const input = screen.getByTestId('export-filename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'good-name.html' } });
    expect(screen.getByTestId('export-confirm')).not.toBeDisabled();
  });
});

describe('ExportReportDialog — export confirmation', () => {
  it('clicking Export closes the dialog and pushes a success toast', () => {
    // jsdom does NOT implement URL.createObjectURL / revokeObjectURL —
    // they are undefined on the URL prototype, so vi.spyOn() throws.
    // Install runtime stubs (and restore in finally) so the
    // blob-download helper's URL plumbing is exercised without warning.
    const url = 'blob:test-stub';
    const origCreate = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    const origRevoke = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => url;
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
    try {
      const { store } = setupOpenDialog();
      fireEvent.click(screen.getByTestId('export-confirm'));
      expect(store.getState().accessibilityCheck.exportDialogOpen).toBe(false);
      const toasts = store.getState().ui.toasts;
      expect(toasts.length).toBe(1);
      expect(toasts[0]?.kind).toBe('success');
    } finally {
      (URL as unknown as { createObjectURL: unknown }).createObjectURL = origCreate;
      (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = origRevoke;
    }
  });
});
