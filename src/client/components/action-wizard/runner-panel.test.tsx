// Runner Panel tests — Phase 7.5 Wave 6 (Riley).

import { configureStore } from '@reduxjs/toolkit';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ok } from '../../../shared/result';
import actionWizardReducer, {
  addRunnerTargets,
  openRunner,
  setRunnerFilenamePattern,
  setScripts,
} from '../../state/slices/action-wizard-slice';
import documentReducer from '../../state/slices/document-slice';
import uiReducer from '../../state/slices/ui-slice';

import { ActionWizardRunnerPanel } from './runner-panel';

function makeStore() {
  return configureStore({
    reducer: {
      actionWizard: actionWizardReducer,
      document: documentReducer,
      ui: uiReducer,
    },
  });
}

function stubPdfApi() {
  vi.stubGlobal('pdfApi', {
    actions: {
      runScript: () => Promise.resolve(ok({ results: [], ranAt: 1 })),
      listScripts: () => Promise.resolve(ok({ scripts: [] })),
      saveScript: vi.fn(),
      getScript: vi.fn(),
      deleteScript: vi.fn(),
      exportScript: vi.fn(),
      importScript: vi.fn(),
    },
    dialog: {
      pickPdfFiles: () => Promise.resolve(ok({ paths: ['/work/a.pdf', '/work/b.pdf'] })),
    },
    fs: {
      readPdf: vi.fn(),
    },
  });
}

describe('ActionWizardRunnerPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('returns null when closed', () => {
    stubPdfApi();
    const store = makeStore();
    const { container } = render(
      <Provider store={store}>
        <ActionWizardRunnerPanel />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders empty targets banner', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(
      setScripts([{ id: 's', name: 'S', savedAt: 1, usageCount: 0, opCount: 1, schemaVersion: 1 }]),
    );
    store.dispatch(openRunner('s'));
    render(
      <Provider store={store}>
        <ActionWizardRunnerPanel />
      </Provider>,
    );
    expect(screen.getByText(/Add at least one PDF/i)).toBeTruthy();
  });

  test('Run disabled when filename pattern is not .pdf', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(
      setScripts([{ id: 's', name: 'S', savedAt: 1, usageCount: 0, opCount: 1, schemaVersion: 1 }]),
    );
    store.dispatch(openRunner('s'));
    store.dispatch(addRunnerTargets([{ path: '/a.pdf', displayName: 'a.pdf' }]));
    store.dispatch(setRunnerFilenamePattern('{name}-acted.docx'));
    render(
      <Provider store={store}>
        <ActionWizardRunnerPanel />
      </Provider>,
    );
    const runButton = screen.getByRole('button', { name: 'Run' });
    expect((runButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Pattern must produce a .pdf filename/i)).toBeTruthy();
  });

  test('renders the destination open-question note honestly', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(
      setScripts([{ id: 's', name: 'S', savedAt: 1, usageCount: 0, opCount: 1, schemaVersion: 1 }]),
    );
    store.dispatch(openRunner('s'));
    render(
      <Provider store={store}>
        <ActionWizardRunnerPanel />
      </Provider>,
    );
    // Verbatim honesty note about pickFolder token deferral.
    expect(screen.getByText(/pickFolder returns a token, not a raw path/i)).toBeTruthy();
  });

  test('removing a target updates state', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(
      setScripts([{ id: 's', name: 'S', savedAt: 1, usageCount: 0, opCount: 1, schemaVersion: 1 }]),
    );
    store.dispatch(openRunner('s'));
    store.dispatch(addRunnerTargets([{ path: '/a.pdf', displayName: 'a.pdf' }]));
    render(
      <Provider store={store}>
        <ActionWizardRunnerPanel />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(store.getState().actionWizard.run.targets.length).toBe(0);
  });
});
