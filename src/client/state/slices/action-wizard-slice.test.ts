// Action Wizard slice tests — Phase 7.5 Wave 6 (Riley).

import { describe, expect, test } from 'vitest';

import { type EditOperationSerialized } from '../../types/ipc-contract';

import actionWizardReducer, {
  DEFAULT_FILENAME_PATTERN,
  addRunnerTargets,
  clearLastBanned,
  closeActionWizardList,
  closeRecordDialog,
  closeRunner,
  openActionWizardList,
  openRecordDialog,
  openRunner,
  pauseRecording,
  recordBannedOp,
  recordOp,
  removeRunnerTarget,
  removeScriptLocal,
  resetActionWizard,
  resumeRecording,
  selectRecording,
  selectRecordingActive,
  selectRunState,
  selectScriptById,
  selectScriptsState,
  setListError,
  setListing,
  setRecordName,
  setRunError,
  setRunnerFilenamePattern,
  setRunResults,
  setRunning,
  setSaveError,
  setSaving,
  setScripts,
  startRecording,
  stopRecording,
  type ActionWizardState,
} from './action-wizard-slice';

function initial(): ActionWizardState {
  return actionWizardReducer(undefined, { type: '__init' });
}

const op: EditOperationSerialized = {
  kind: 'rotate',
  meta: { ts: 1, undoable: true, operationId: 'op-1' },
  pageIndex: 0,
  fromRotation: 0,
  toRotation: 90,
};

describe('action-wizard slice', () => {
  describe('list launcher', () => {
    test('open + close toggles listOpen', () => {
      const s1 = actionWizardReducer(initial(), openActionWizardList());
      expect(s1.listOpen).toBe(true);
      const s2 = actionWizardReducer(s1, closeActionWizardList());
      expect(s2.listOpen).toBe(false);
    });
  });

  describe('recording lifecycle', () => {
    test('openRecordDialog resets and opens', () => {
      const s = actionWizardReducer(initial(), openRecordDialog());
      expect(s.recording.open).toBe(true);
      expect(s.recording.capturedOps).toEqual([]);
    });

    test('setRecordName updates name', () => {
      const s = actionWizardReducer(initial(), setRecordName('My Action'));
      expect(s.recording.name).toBe('My Action');
    });

    test('start -> recordOp appends + recordBannedOp counts', () => {
      let s = actionWizardReducer(initial(), openRecordDialog());
      s = actionWizardReducer(s, startRecording());
      expect(s.recording.active).toBe(true);
      s = actionWizardReducer(s, recordOp(op));
      s = actionWizardReducer(s, recordOp(op));
      expect(s.recording.capturedOps.length).toBe(2);
      s = actionWizardReducer(s, recordBannedOp('signature-add'));
      expect(s.recording.bannedCount).toBe(1);
      expect(s.recording.lastBannedKind).toBe('signature-add');
    });

    test('clearLastBanned nulls out lastBannedKind', () => {
      let s = actionWizardReducer(initial(), openRecordDialog());
      s = actionWizardReducer(s, recordBannedOp('xx'));
      s = actionWizardReducer(s, clearLastBanned());
      expect(s.recording.lastBannedKind).toBeNull();
    });

    test('pause / resume only mutate when active', () => {
      let s = actionWizardReducer(initial(), openRecordDialog());
      s = actionWizardReducer(s, pauseRecording());
      expect(s.recording.paused).toBe(false); // no-op because not active
      s = actionWizardReducer(s, startRecording());
      s = actionWizardReducer(s, pauseRecording());
      expect(s.recording.paused).toBe(true);
      s = actionWizardReducer(s, resumeRecording());
      expect(s.recording.paused).toBe(false);
    });

    test('stopRecording clears active flag', () => {
      let s = actionWizardReducer(initial(), startRecording());
      s = actionWizardReducer(s, stopRecording());
      expect(s.recording.active).toBe(false);
    });

    test('saving lifecycle: setSaving(true) clears prior error', () => {
      let s = actionWizardReducer(initial(), setSaveError('boom'));
      expect(s.recording.lastSaveError).toBe('boom');
      s = actionWizardReducer(s, setSaving(true));
      expect(s.recording.lastSaveError).toBeNull();
      expect(s.recording.saving).toBe(true);
    });

    test('closeRecordDialog wipes state', () => {
      let s = actionWizardReducer(initial(), startRecording());
      s = actionWizardReducer(s, recordOp(op));
      s = actionWizardReducer(s, closeRecordDialog());
      expect(s.recording.capturedOps).toEqual([]);
      expect(s.recording.active).toBe(false);
    });
  });

  describe('scripts listing', () => {
    test('setListing(true) clears lastListError', () => {
      let s = actionWizardReducer(initial(), setListError('boom'));
      expect(s.scripts.lastListError).toBe('boom');
      s = actionWizardReducer(s, setListing(true));
      expect(s.scripts.lastListError).toBeNull();
    });

    test('setScripts replaces list + clears listing', () => {
      const list = [
        { id: 'a', name: 'A', savedAt: 1, usageCount: 0, opCount: 2, schemaVersion: 1 },
      ];
      const s = actionWizardReducer(initial(), setScripts(list));
      expect(s.scripts.list).toEqual(list);
      expect(s.scripts.listing).toBe(false);
    });

    test('removeScriptLocal removes by id, tolerant of unknown id', () => {
      let s = actionWizardReducer(
        initial(),
        setScripts([
          { id: 'a', name: 'A', savedAt: 1, usageCount: 0, opCount: 0, schemaVersion: 1 },
          { id: 'b', name: 'B', savedAt: 1, usageCount: 0, opCount: 0, schemaVersion: 1 },
        ]),
      );
      s = actionWizardReducer(s, removeScriptLocal('a'));
      expect(s.scripts.list?.map((x) => x.id)).toEqual(['b']);
      s = actionWizardReducer(s, removeScriptLocal('ghost'));
      expect(s.scripts.list?.map((x) => x.id)).toEqual(['b']);
    });
  });

  describe('runner', () => {
    test('openRunner sets id + clears prior results', () => {
      let s = actionWizardReducer(initial(), setRunResults([{ handleIndex: 0, success: true }]));
      s = actionWizardReducer(s, openRunner('script-1'));
      expect(s.run.open).toBe(true);
      expect(s.run.selectedScriptId).toBe('script-1');
      expect(s.run.results).toEqual([]);
      expect(s.run.filenamePattern).toBe(DEFAULT_FILENAME_PATTERN);
    });

    test('addRunnerTargets dedups by path', () => {
      let s = actionWizardReducer(initial(), openRunner('s'));
      s = actionWizardReducer(s, addRunnerTargets([{ path: '/a.pdf', displayName: 'a.pdf' }]));
      s = actionWizardReducer(s, addRunnerTargets([{ path: '/a.pdf', displayName: 'a.pdf' }]));
      s = actionWizardReducer(s, addRunnerTargets([{ path: '/b.pdf', displayName: 'b.pdf' }]));
      expect(s.run.targets.map((t) => t.path)).toEqual(['/a.pdf', '/b.pdf']);
    });

    test('removeRunnerTarget removes by path', () => {
      let s = actionWizardReducer(initial(), openRunner('s'));
      s = actionWizardReducer(
        s,
        addRunnerTargets([
          { path: '/a.pdf', displayName: 'a.pdf' },
          { path: '/b.pdf', displayName: 'b.pdf' },
        ]),
      );
      s = actionWizardReducer(s, removeRunnerTarget('/a.pdf'));
      expect(s.run.targets.map((t) => t.path)).toEqual(['/b.pdf']);
    });

    test('setRunning(true) clears prior error + results', () => {
      let s = actionWizardReducer(initial(), openRunner('s'));
      s = actionWizardReducer(s, setRunError('boom'));
      s = actionWizardReducer(s, setRunResults([{ handleIndex: 0, success: true }]));
      s = actionWizardReducer(s, setRunning(true));
      expect(s.run.running).toBe(true);
      expect(s.run.lastRunError).toBeNull();
      expect(s.run.results).toEqual([]);
    });

    test('setRunResults populates results and clears running', () => {
      let s = actionWizardReducer(initial(), openRunner('s'));
      s = actionWizardReducer(s, setRunning(true));
      s = actionWizardReducer(
        s,
        setRunResults([
          { handleIndex: 0, success: true, outputPath: '/out/a.pdf' },
          { handleIndex: 1, success: false, error: 'boom' },
        ]),
      );
      expect(s.run.running).toBe(false);
      expect(s.run.results.length).toBe(2);
    });

    test('setRunnerFilenamePattern updates pattern', () => {
      let s = actionWizardReducer(initial(), openRunner('s'));
      s = actionWizardReducer(s, setRunnerFilenamePattern('{name}-batched.pdf'));
      expect(s.run.filenamePattern).toBe('{name}-batched.pdf');
    });

    test('closeRunner clears state', () => {
      let s = actionWizardReducer(initial(), openRunner('s'));
      s = actionWizardReducer(s, closeRunner());
      expect(s.run.open).toBe(false);
      expect(s.run.selectedScriptId).toBeNull();
    });
  });

  describe('selectors', () => {
    test('selectRecording / selectRecordingActive', () => {
      let s = actionWizardReducer(initial(), startRecording());
      const state = { actionWizard: s };
      expect(selectRecording(state).active).toBe(true);
      expect(selectRecordingActive(state)).toBe(true);
      s = actionWizardReducer(s, pauseRecording());
      expect(selectRecordingActive({ actionWizard: s })).toBe(false);
    });

    test('selectScriptsState / selectScriptById', () => {
      const list = [
        { id: 'a', name: 'A', savedAt: 1, usageCount: 0, opCount: 2, schemaVersion: 1 },
      ];
      const s = actionWizardReducer(initial(), setScripts(list));
      const state = { actionWizard: s };
      expect(selectScriptsState(state).list).toEqual(list);
      expect(selectScriptById(state, 'a')?.name).toBe('A');
      expect(selectScriptById(state, 'missing')).toBeNull();
    });

    test('selectRunState', () => {
      const s = actionWizardReducer(initial(), openRunner('xyz'));
      expect(selectRunState({ actionWizard: s }).selectedScriptId).toBe('xyz');
    });
  });

  test('resetActionWizard returns to initial', () => {
    let s = actionWizardReducer(initial(), openRecordDialog());
    s = actionWizardReducer(s, openActionWizardList());
    s = actionWizardReducer(s, openRunner('x'));
    s = actionWizardReducer(s, resetActionWizard());
    expect(s).toEqual(initial());
  });
});
