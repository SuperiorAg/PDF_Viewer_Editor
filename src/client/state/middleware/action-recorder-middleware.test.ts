// Action recorder middleware tests — Phase 7.5 Wave 6 (Riley).

import { configureStore, type Middleware } from '@reduxjs/toolkit';
import { describe, expect, test } from 'vitest';

import { type EditOperationSerialized } from '../../types/ipc-contract';
import actionWizardReducer, {
  openRecordDialog,
  pauseRecording,
  startRecording,
  stopRecording,
} from '../slices/action-wizard-slice';
import { applyEdit } from '../slices/document-slice';

import { actionRecorderMiddleware } from './action-recorder-middleware';

function makeStore() {
  return configureStore({
    reducer: {
      actionWizard: actionWizardReducer,
    },
    middleware: (getDefault) =>
      // Disable serializableCheck — we dispatch a synthetic `applyEdit`
      // action.payload that doesn't carry image bytes; serialization is
      // immaterial to the recorder logic under test.
      getDefault({ serializableCheck: false }).concat(actionRecorderMiddleware as Middleware),
  });
}

function allowedOp(kind: string): EditOperationSerialized {
  // Cast at the boundary — the discriminated union has too many shapes for a
  // single test fixture. The recorder only reads `.kind`.
  return {
    kind,
    meta: { ts: 1, undoable: true, operationId: 'op-1' },
  } as unknown as EditOperationSerialized;
}

describe('action recorder middleware', () => {
  test('no-op when recording.active is false', () => {
    const store = makeStore();
    // Recording NOT started.
    store.dispatch(applyEdit(allowedOp('rotate')));
    expect(store.getState().actionWizard.recording.capturedOps.length).toBe(0);
    expect(store.getState().actionWizard.recording.bannedCount).toBe(0);
  });

  test('captures allowed ops when active', () => {
    const store = makeStore();
    store.dispatch(openRecordDialog());
    store.dispatch(startRecording());
    store.dispatch(applyEdit(allowedOp('rotate')));
    store.dispatch(applyEdit(allowedOp('reorder')));
    store.dispatch(applyEdit(allowedOp('annot-add')));
    expect(store.getState().actionWizard.recording.capturedOps.length).toBe(3);
    expect(store.getState().actionWizard.recording.bannedCount).toBe(0);
  });

  test('drops banned ops + records lastBannedKind', () => {
    const store = makeStore();
    store.dispatch(openRecordDialog());
    store.dispatch(startRecording());
    store.dispatch(applyEdit(allowedOp('signature-add')));
    expect(store.getState().actionWizard.recording.capturedOps.length).toBe(0);
    expect(store.getState().actionWizard.recording.bannedCount).toBe(1);
    expect(store.getState().actionWizard.recording.lastBannedKind).toBe('signature-add');
  });

  test('does NOT capture while paused', () => {
    const store = makeStore();
    store.dispatch(openRecordDialog());
    store.dispatch(startRecording());
    store.dispatch(pauseRecording());
    store.dispatch(applyEdit(allowedOp('rotate')));
    expect(store.getState().actionWizard.recording.capturedOps.length).toBe(0);
    // While paused, banned counting also halts (slice-level invariant).
    expect(store.getState().actionWizard.recording.bannedCount).toBe(0);
  });

  test('does NOT capture after stop', () => {
    const store = makeStore();
    store.dispatch(openRecordDialog());
    store.dispatch(startRecording());
    store.dispatch(applyEdit(allowedOp('rotate')));
    expect(store.getState().actionWizard.recording.capturedOps.length).toBe(1);
    store.dispatch(stopRecording());
    store.dispatch(applyEdit(allowedOp('rotate')));
    expect(store.getState().actionWizard.recording.capturedOps.length).toBe(1);
  });

  test('passes non-edit actions through untouched', () => {
    const store = makeStore();
    store.dispatch(openRecordDialog());
    store.dispatch(startRecording());
    // openRecordDialog itself is NOT an applyEdit — must be untouched.
    expect(store.getState().actionWizard.recording.capturedOps.length).toBe(0);
  });

  test('handles ill-shaped payloads as banned', () => {
    const store = makeStore();
    store.dispatch(openRecordDialog());
    store.dispatch(startRecording());
    // Direct dispatch bypassing the typed action creator so we can simulate
    // a malformed payload that nevertheless matches applyEdit.type. Cast at
    // the boundary; the middleware MUST tolerate this.
    store.dispatch({ type: applyEdit.type, payload: null } as ReturnType<typeof applyEdit>);
    expect(store.getState().actionWizard.recording.bannedCount).toBe(1);
    expect(store.getState().actionWizard.recording.lastBannedKind).toBe('<unknown-shape>');
  });
});
