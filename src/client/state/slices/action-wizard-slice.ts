// Action Wizard slice — Phase 7.5 B9 UI (Riley Wave 6).
//
// Drives three surfaces (docs/ui-spec-phase-7.5.md §9):
//   1. Record dialog — modal that captures dispatched edit ops while the user
//      drives the document. Live name input + ops-recorded counter +
//      pause/resume/stop.
//   2. Saved Actions list — list view of previously-saved scripts (from
//      David's `actions:listScripts`). Each row shows usage count, op count,
//      and offers Run / Edit (rename only — v0.8.0 honest deferral) / Export /
//      Delete actions.
//   3. Runner panel — modal that lets the user pick target files +
//      destination folder + filename pattern and fires
//      `actions:runScript` for batched per-file replay.
//
// HONESTY (P7.5-L-10):
//   - Banned ops dropped during recording emit a toast naming the kind.
//   - Edit on saved scripts is RENAME-ONLY in v0.8.0; the modal explicitly
//     labels the ops list as read-only so the user is not misled.
//   - Destination-folder UX is restricted to "next to source" in v0.8.0;
//     `dialog:pickFolder` returns a token, not a raw path that
//     actions:runScript can consume directly. Tracked as an open question
//     for Marcus — see brief.
//
// State partitions:
//   * recording — name + paused + recorded-op buffer + bannedCount + open flag
//   * scripts   — fetched summaries + lastListError + listing flag
//   * run       — selected script id + per-target results + in-flight flag

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  type ActionScriptSummary,
  type ActionRunResult,
  type EditOperationSerialized,
} from '../../types/ipc-contract';

/** Runner picks pdf paths to run the script against. Each entry is a
 *  sanitized absolute path the renderer captured from David's
 *  `dialog:pickPdfFiles` channel — same shape the Combine modal uses. */
export interface RunnerTarget {
  path: string;
  /** Best-effort basename for the rows table; derived from `path`. */
  displayName: string;
}

export interface RecordingState {
  /** Record dialog open. */
  open: boolean;
  /** Recording session active — middleware captures ops when true.
   *  Independent of `open` so the dialog can show "ready" before Start. */
  active: boolean;
  /** True when Pause is pressed; ops are dropped while paused. */
  paused: boolean;
  /** Editable script name. */
  name: string;
  /** Captured ops (serialized form per David's allowlist filter). */
  capturedOps: EditOperationSerialized[];
  /** Count of ops we silently dropped because they were not in the
   *  allowlist. Surfaced honestly in the dialog ("3 ops not recorded"). */
  bannedCount: number;
  /** Last banned op kind — used by the toast text. Cleared by clearLastBanned. */
  lastBannedKind: string | null;
  /** Save in flight. */
  saving: boolean;
  /** Last save error message (engine-facing). */
  lastSaveError: string | null;
}

export interface ScriptsState {
  /** List of summaries; null when not yet fetched. */
  list: ActionScriptSummary[] | null;
  /** Listing in flight (initial mount or refresh). */
  listing: boolean;
  /** Last list error message (engine-facing). */
  lastListError: string | null;
}

export interface RunState {
  /** Runner modal open. */
  open: boolean;
  /** Selected script id. Null until the user picks one from the list. */
  selectedScriptId: string | null;
  /** Target files chosen via dialog:pickPdfFiles. */
  targets: RunnerTarget[];
  /** Filename pattern. Default '{name}-acted.pdf'. */
  filenamePattern: string;
  /** Destination folder display label (from pickFolder.displayName). v0.8.0
   *  passes destinationFolder UNSET to David's engine because pickFolder
   *  returns a token rather than a raw path. The label is shown so the user
   *  knows where the output lands ("next to each source"). */
  destinationLabel: string | null;
  /** Run in flight. */
  running: boolean;
  /** Per-target results after the run resolves. */
  results: ActionRunResult[];
  /** Last run error message. */
  lastRunError: string | null;
}

export interface ActionWizardState {
  recording: RecordingState;
  scripts: ScriptsState;
  run: RunState;
  /** Saved Actions list / launcher open flag. Separate from recorder + runner. */
  listOpen: boolean;
}

export const DEFAULT_FILENAME_PATTERN = '{name}-acted.pdf' as const;

const initialRecording: RecordingState = {
  open: false,
  active: false,
  paused: false,
  name: '',
  capturedOps: [],
  bannedCount: 0,
  lastBannedKind: null,
  saving: false,
  lastSaveError: null,
};

const initialScripts: ScriptsState = {
  list: null,
  listing: false,
  lastListError: null,
};

const initialRun: RunState = {
  open: false,
  selectedScriptId: null,
  targets: [],
  filenamePattern: DEFAULT_FILENAME_PATTERN,
  destinationLabel: null,
  running: false,
  results: [],
  lastRunError: null,
};

const initialState: ActionWizardState = {
  recording: initialRecording,
  scripts: initialScripts,
  run: initialRun,
  listOpen: false,
};

export const actionWizardSlice = createSlice({
  name: 'actionWizard',
  initialState,
  reducers: {
    // ------------------------------------------------------------------
    // List + launcher
    // ------------------------------------------------------------------
    openActionWizardList(state) {
      state.listOpen = true;
    },
    closeActionWizardList(state) {
      state.listOpen = false;
    },

    // ------------------------------------------------------------------
    // Recording lifecycle
    // ------------------------------------------------------------------
    openRecordDialog(state) {
      state.recording = { ...initialRecording, open: true };
    },
    closeRecordDialog(state) {
      state.recording = initialRecording;
    },
    setRecordName(state, action: PayloadAction<string>) {
      state.recording.name = action.payload;
    },
    startRecording(state) {
      state.recording.active = true;
      state.recording.paused = false;
      state.recording.capturedOps = [];
      state.recording.bannedCount = 0;
      state.recording.lastBannedKind = null;
      state.recording.lastSaveError = null;
    },
    pauseRecording(state) {
      if (state.recording.active) state.recording.paused = true;
    },
    resumeRecording(state) {
      if (state.recording.active) state.recording.paused = false;
    },
    stopRecording(state) {
      state.recording.active = false;
      state.recording.paused = false;
    },
    /** Middleware-driven: append an allowed op to the buffer. */
    recordOp(state, action: PayloadAction<EditOperationSerialized>) {
      state.recording.capturedOps.push(action.payload);
    },
    /** Middleware-driven: account for a banned op + remember its kind for the toast. */
    recordBannedOp(state, action: PayloadAction<string>) {
      state.recording.bannedCount += 1;
      state.recording.lastBannedKind = action.payload;
    },
    clearLastBanned(state) {
      state.recording.lastBannedKind = null;
    },
    setSaving(state, action: PayloadAction<boolean>) {
      state.recording.saving = action.payload;
      if (action.payload) state.recording.lastSaveError = null;
    },
    setSaveError(state, action: PayloadAction<string>) {
      state.recording.lastSaveError = action.payload;
      state.recording.saving = false;
    },

    // ------------------------------------------------------------------
    // Scripts listing
    // ------------------------------------------------------------------
    setListing(state, action: PayloadAction<boolean>) {
      state.scripts.listing = action.payload;
      if (action.payload) state.scripts.lastListError = null;
    },
    setScripts(state, action: PayloadAction<ActionScriptSummary[]>) {
      state.scripts.list = action.payload;
      state.scripts.listing = false;
      state.scripts.lastListError = null;
    },
    setListError(state, action: PayloadAction<string>) {
      state.scripts.lastListError = action.payload;
      state.scripts.listing = false;
    },
    /** Optimistic remove + idempotent (no-op if id is unknown). */
    removeScriptLocal(state, action: PayloadAction<string>) {
      if (state.scripts.list === null) return;
      state.scripts.list = state.scripts.list.filter((s) => s.id !== action.payload);
    },

    // ------------------------------------------------------------------
    // Runner
    // ------------------------------------------------------------------
    openRunner(state, action: PayloadAction<string>) {
      state.run = { ...initialRun, open: true, selectedScriptId: action.payload };
    },
    closeRunner(state) {
      state.run = initialRun;
    },
    setRunnerTargets(state, action: PayloadAction<RunnerTarget[]>) {
      state.run.targets = action.payload;
    },
    addRunnerTargets(state, action: PayloadAction<RunnerTarget[]>) {
      // Dedup by path.
      const seen = new Set(state.run.targets.map((t) => t.path));
      for (const t of action.payload) {
        if (!seen.has(t.path)) {
          state.run.targets.push(t);
          seen.add(t.path);
        }
      }
    },
    removeRunnerTarget(state, action: PayloadAction<string>) {
      state.run.targets = state.run.targets.filter((t) => t.path !== action.payload);
    },
    setRunnerFilenamePattern(state, action: PayloadAction<string>) {
      state.run.filenamePattern = action.payload;
    },
    setRunnerDestinationLabel(state, action: PayloadAction<string | null>) {
      state.run.destinationLabel = action.payload;
    },
    setRunning(state, action: PayloadAction<boolean>) {
      state.run.running = action.payload;
      if (action.payload) {
        state.run.lastRunError = null;
        state.run.results = [];
      }
    },
    setRunResults(state, action: PayloadAction<ActionRunResult[]>) {
      state.run.results = action.payload;
      state.run.running = false;
    },
    setRunError(state, action: PayloadAction<string>) {
      state.run.lastRunError = action.payload;
      state.run.running = false;
    },

    resetActionWizard() {
      return initialState;
    },
  },
});

export const {
  openActionWizardList,
  closeActionWizardList,
  openRecordDialog,
  closeRecordDialog,
  setRecordName,
  startRecording,
  pauseRecording,
  resumeRecording,
  stopRecording,
  recordOp,
  recordBannedOp,
  clearLastBanned,
  setSaving,
  setSaveError,
  setListing,
  setScripts,
  setListError,
  removeScriptLocal,
  openRunner,
  closeRunner,
  setRunnerTargets,
  addRunnerTargets,
  removeRunnerTarget,
  setRunnerFilenamePattern,
  setRunnerDestinationLabel,
  setRunning,
  setRunResults,
  setRunError,
  resetActionWizard,
} = actionWizardSlice.actions;

export default actionWizardSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors — used by components + thunks. Keep these in this file (no
// dedicated selector module yet) until a second slice consumer materializes.
// ---------------------------------------------------------------------------

export const selectActionWizardListOpen = (state: { actionWizard: ActionWizardState }): boolean =>
  state.actionWizard.listOpen;

export const selectRecording = (state: { actionWizard: ActionWizardState }): RecordingState =>
  state.actionWizard.recording;

export const selectRecordingActive = (state: { actionWizard: ActionWizardState }): boolean =>
  state.actionWizard.recording.active && !state.actionWizard.recording.paused;

export const selectScriptsState = (state: { actionWizard: ActionWizardState }): ScriptsState =>
  state.actionWizard.scripts;

export const selectRunState = (state: { actionWizard: ActionWizardState }): RunState =>
  state.actionWizard.run;

export const selectScriptById = (
  state: { actionWizard: ActionWizardState },
  id: string,
): ActionScriptSummary | null => state.actionWizard.scripts.list?.find((s) => s.id === id) ?? null;
