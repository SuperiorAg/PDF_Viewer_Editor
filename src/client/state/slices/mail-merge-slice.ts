// Mail Merge slice — Phase 3 wizard state + progress.
// Per docs/ui-spec.md §12.6 and docs/architecture-phase-3.md §6.
//
// The runner BYPASSES the dirtyOps funnel (conventions §14.4). The renderer
// dispatches `runMailMergeThunk` which fires `forms:runMailMerge` and
// subscribes to `mail-merge:progress` events. NO EditOperations enter the
// dirtyOps stream during a run — the open document is unchanged.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { type MailMergeProgressEvent, type MailMergeProgressPhase } from '../../types/ipc-contract';

export type WizardStep = 'template' | 'data' | 'mapping' | 'output' | 'running' | 'done' | 'error';

export type TemplateSource =
  | { kind: 'current' }
  | { kind: 'saved'; templateId: number; name: string };

export interface ParsedDataPreview {
  fileName: string;
  fileKind: 'csv' | 'xlsx';
  /** Raw bytes; lives in slice only during the wizard. Cleared on close. */
  bytes: Uint8Array | null;
  headers: string[];
  /** First N rows for the preview table. */
  previewRows: Array<Record<string, string>>;
  totalRowCount: number;
  warnings: string[];
}

export type OutputMode =
  | { kind: 'folder'; outputFolder: string; filenameTemplate: string }
  | { kind: 'concat'; outputFile: string };

export interface MailMergeState {
  /** Whether the modal is currently open (separate from `ui.activeModal` so a
   *  long-running run can outlive other modal toggles if needed). */
  modalOpen: boolean;
  step: WizardStep;
  /** Step 1 — template choice. */
  templateSource: TemplateSource;
  /** Step 2 — parsed data preview. */
  data: ParsedDataPreview | null;
  /** Step 3 — column-to-field mapping; '' or undefined = unmapped (skipped). */
  columnMapping: Record<string, string>;
  /** Step 4 — output config. */
  outputMode: OutputMode;
  /** Whether to flatten in output. */
  flattenInOutput: boolean;
  /** In-flight job id; null when no run is active. */
  activeJobId: string | null;
  /** Progress state populated by mail-merge:progress events. */
  progress: {
    phase: MailMergeProgressPhase;
    currentRow: number;
    totalRows: number;
    percent: number;
    warnings: string[];
  };
  /** Result populated when the runner returns. */
  result: {
    rowsWritten: number;
    totalRows: number;
    outputPath: string | null;
    wasCancelled: boolean;
    warnings: string[];
  } | null;
  /** Set when the run resolves with !ok. */
  errorMessage: string | null;
}

const initialState: MailMergeState = {
  modalOpen: false,
  step: 'template',
  templateSource: { kind: 'current' },
  data: null,
  columnMapping: {},
  outputMode: { kind: 'folder', outputFolder: '', filenameTemplate: 'merged-{rowIndex:04}.pdf' },
  flattenInOutput: false,
  activeJobId: null,
  progress: {
    phase: 'parsing-data',
    currentRow: 0,
    totalRows: -1,
    percent: 0,
    warnings: [],
  },
  result: null,
  errorMessage: null,
};

export const mailMergeSlice = createSlice({
  name: 'mailMerge',
  initialState,
  reducers: {
    openWizard(state) {
      // Reset to a fresh wizard, but keep `outputMode.outputFolder` if it was
      // populated (e.g. via mailMerge.lastOutputFolder setting hydrated upstream).
      const lastFolder = state.outputMode.kind === 'folder' ? state.outputMode.outputFolder : '';
      Object.assign(state, initialState, {
        modalOpen: true,
        outputMode: { ...initialState.outputMode, outputFolder: lastFolder } as OutputMode,
      });
    },
    closeWizard(state) {
      // Closing does NOT cancel an in-flight job — that's the cancelMailMerge thunk's
      // responsibility. We just hide the UI; the modal can be re-opened to see progress.
      state.modalOpen = false;
    },
    setStep(state, action: PayloadAction<WizardStep>) {
      state.step = action.payload;
    },
    setTemplateSource(state, action: PayloadAction<TemplateSource>) {
      state.templateSource = action.payload;
    },
    setDataPreview(state, action: PayloadAction<ParsedDataPreview>) {
      state.data = action.payload;
      // Reset mapping when source changes.
      state.columnMapping = {};
    },
    clearDataPreview(state) {
      state.data = null;
      state.columnMapping = {};
    },
    setColumnMapping(state, action: PayloadAction<Record<string, string>>) {
      state.columnMapping = action.payload;
    },
    updateColumnMapping(state, action: PayloadAction<{ column: string; fieldName: string }>) {
      if (action.payload.fieldName === '' || action.payload.fieldName === '(skip)') {
        delete state.columnMapping[action.payload.column];
      } else {
        state.columnMapping[action.payload.column] = action.payload.fieldName;
      }
    },
    setOutputMode(state, action: PayloadAction<OutputMode>) {
      state.outputMode = action.payload;
    },
    setFlattenInOutput(state, action: PayloadAction<boolean>) {
      state.flattenInOutput = action.payload;
    },
    /** Mark the run as starting. */
    runStarted(state, action: PayloadAction<{ jobId: string }>) {
      state.activeJobId = action.payload.jobId;
      state.step = 'running';
      state.progress = {
        phase: 'parsing-data',
        currentRow: 0,
        totalRows: -1,
        percent: 0,
        warnings: [],
      };
      state.result = null;
      state.errorMessage = null;
    },
    /** Apply a progress event. The middleware/listener wires this to onMailMergeProgress. */
    progressTick(state, action: PayloadAction<MailMergeProgressEvent>) {
      if (action.payload.jobId !== state.activeJobId) return;
      state.progress.phase = action.payload.phase;
      state.progress.currentRow = action.payload.currentRow;
      state.progress.totalRows = action.payload.totalRows;
      state.progress.percent = action.payload.percent;
      if (action.payload.latestWarning) {
        state.progress.warnings.push(action.payload.latestWarning);
      }
    },
    runCompleted(
      state,
      action: PayloadAction<{
        rowsWritten: number;
        totalRows: number;
        outputPath: string | null;
        wasCancelled: boolean;
        warnings: string[];
      }>,
    ) {
      state.result = action.payload;
      state.step = action.payload.wasCancelled ? 'done' : 'done';
      state.activeJobId = null;
    },
    runFailed(state, action: PayloadAction<string>) {
      state.errorMessage = action.payload;
      state.step = 'error';
      state.activeJobId = null;
    },
    /** Reset on document close. */
    resetMailMerge() {
      return initialState;
    },
  },
});

export const {
  openWizard,
  closeWizard,
  setStep,
  setTemplateSource,
  setDataPreview,
  clearDataPreview,
  setColumnMapping,
  updateColumnMapping,
  setOutputMode,
  setFlattenInOutput,
  runStarted,
  progressTick,
  runCompleted,
  runFailed,
  resetMailMerge,
} = mailMergeSlice.actions;

export default mailMergeSlice.reducer;
