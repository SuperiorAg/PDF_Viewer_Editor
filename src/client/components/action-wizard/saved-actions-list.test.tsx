// Saved Actions list tests — Phase 7.5 Wave 6 (Riley).

import { configureStore } from '@reduxjs/toolkit';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ok } from '../../../shared/result';
import actionWizardReducer, {
  openActionWizardList,
  setScripts,
} from '../../state/slices/action-wizard-slice';
import uiReducer from '../../state/slices/ui-slice';

import { SavedActionsList } from './saved-actions-list';

function makeStore() {
  return configureStore({
    reducer: { actionWizard: actionWizardReducer, ui: uiReducer },
  });
}

function stubPdfApi(overrides?: { deleteScript?: ReturnType<typeof vi.fn> }) {
  const deleteScript =
    overrides?.deleteScript ?? vi.fn().mockResolvedValue(ok({ deleted: true as const }));
  vi.stubGlobal('pdfApi', {
    actions: {
      saveScript: vi.fn(),
      listScripts: () => Promise.resolve(ok({ scripts: [] })),
      getScript: vi.fn(),
      deleteScript,
      runScript: vi.fn(),
      exportScript: vi.fn().mockResolvedValue(ok({ json: '{}', schemaVersion: 1 })),
      importScript: vi.fn(),
    },
  });
  return { deleteScript };
}

describe('SavedActionsList', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('returns null when closed', () => {
    stubPdfApi();
    const store = makeStore();
    const { container } = render(
      <Provider store={store}>
        <SavedActionsList />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders empty-state when list is empty', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(openActionWizardList());
    store.dispatch(setScripts([]));
    render(
      <Provider store={store}>
        <SavedActionsList />
      </Provider>,
    );
    expect(screen.getByText(/No saved actions yet/i)).toBeTruthy();
  });

  test('renders rows from fixture + offers Run / Export / Delete', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(openActionWizardList());
    store.dispatch(
      setScripts([
        {
          id: 'a',
          name: 'Rotate All CCW',
          savedAt: 1,
          usageCount: 3,
          opCount: 5,
          schemaVersion: 1,
        },
      ]),
    );
    render(
      <Provider store={store}>
        <SavedActionsList />
      </Provider>,
    );
    expect(screen.getByText('Rotate All CCW')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Run/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Export/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Delete/i })).toBeTruthy();
  });

  test('Run dispatches openRunner with the script id', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(openActionWizardList());
    store.dispatch(
      setScripts([
        { id: 'sid-1', name: 'Test', savedAt: 1, usageCount: 0, opCount: 2, schemaVersion: 1 },
      ]),
    );
    render(
      <Provider store={store}>
        <SavedActionsList />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Run/i }));
    expect(store.getState().actionWizard.run.open).toBe(true);
    expect(store.getState().actionWizard.run.selectedScriptId).toBe('sid-1');
  });

  test('Delete with confirm dispatches the thunk', async () => {
    const { deleteScript } = stubPdfApi();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const store = makeStore();
    store.dispatch(openActionWizardList());
    store.dispatch(
      setScripts([
        { id: 'sid-2', name: 'Doomed', savedAt: 1, usageCount: 0, opCount: 1, schemaVersion: 1 },
      ]),
    );
    render(
      <Provider store={store}>
        <SavedActionsList />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Delete/i }));
    // Confirmation prompted.
    expect(confirmSpy).toHaveBeenCalled();
    // The thunk fires; resolve microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(deleteScript).toHaveBeenCalledWith({ id: 'sid-2' });
    confirmSpy.mockRestore();
  });
});
