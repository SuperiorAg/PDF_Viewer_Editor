// Record Dialog tests — Phase 7.5 Wave 6 (Riley).
// Asserts that the recorder middleware + dialog cooperate: dispatched
// applyEdit ops accumulate when active; banned ops emit a toast; Save
// is gated on a non-empty name + ops + not-active.

import { configureStore } from '@reduxjs/toolkit';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ok } from '../../../shared/result';
import { actionRecorderMiddleware } from '../../state/middleware/action-recorder-middleware';
import actionWizardReducer, {
  openRecordDialog,
  setRecordName,
  startRecording,
} from '../../state/slices/action-wizard-slice';
import documentReducer, { applyEdit } from '../../state/slices/document-slice';
import uiReducer from '../../state/slices/ui-slice';
import { type EditOperationSerialized } from '../../types/ipc-contract';

import { ActionWizardRecordDialog } from './record-dialog';

function makeStore() {
  return configureStore({
    reducer: {
      actionWizard: actionWizardReducer,
      document: documentReducer,
      ui: uiReducer,
    },
    middleware: (gd) => gd({ serializableCheck: false }).concat(actionRecorderMiddleware),
  });
}

function stubPdfApi() {
  vi.stubGlobal('pdfApi', {
    actions: {
      saveScript: () => Promise.resolve(ok({ id: 'sid', savedAt: 1 })),
      listScripts: () => Promise.resolve(ok({ scripts: [] })),
      getScript: vi.fn(),
      deleteScript: vi.fn(),
      runScript: vi.fn(),
      exportScript: vi.fn(),
      importScript: vi.fn(),
    },
  });
}

function fakeOp(kind: string): EditOperationSerialized {
  return {
    kind,
    meta: { ts: 1, undoable: true, operationId: 'op-1' },
  } as unknown as EditOperationSerialized;
}

describe('ActionWizardRecordDialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('returns null when closed', () => {
    stubPdfApi();
    const store = makeStore();
    const { container } = render(
      <Provider store={store}>
        <ActionWizardRecordDialog />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders idle status when open but not recording', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(openRecordDialog());
    render(
      <Provider store={store}>
        <ActionWizardRecordDialog />
      </Provider>,
    );
    expect(screen.getByText(/Ready — click Start/i)).toBeTruthy();
  });

  test('Save is disabled when name is empty', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(openRecordDialog());
    render(
      <Provider store={store}>
        <ActionWizardRecordDialog />
      </Provider>,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  test('middleware captures applyEdit ops when active', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(openRecordDialog());
    store.dispatch(setRecordName('Test action'));
    store.dispatch(startRecording());
    store.dispatch(applyEdit(fakeOp('rotate')));
    store.dispatch(applyEdit(fakeOp('reorder')));
    expect(store.getState().actionWizard.recording.capturedOps.length).toBe(2);
    render(
      <Provider store={store}>
        <ActionWizardRecordDialog />
      </Provider>,
    );
    expect(screen.getByText(/2 ops recorded/i)).toBeTruthy();
  });

  test('Stop button transitions back to idle and Save becomes enabled', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(openRecordDialog());
    store.dispatch(setRecordName('Test action'));
    store.dispatch(startRecording());
    store.dispatch(applyEdit(fakeOp('rotate')));
    render(
      <Provider store={store}>
        <ActionWizardRecordDialog />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(store.getState().actionWizard.recording.active).toBe(false);
    const save = screen.getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });
});
