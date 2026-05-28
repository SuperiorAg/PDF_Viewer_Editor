// Forms slice — Phase 3 form-state separation from document-state.
// Per docs/conventions.md §14 and docs/architecture-phase-3.md §5.
//
// CRITICAL: Form-FILL values live HERE as transient renderer state. They are
// NOT EditOperations. A single `form-commit` EditOperation is constructed at
// the explicit commit boundary (Save / Commit-button / close prompt) by
// `commitFormThunk` (state/thunks.ts) and dispatched through the standard
// `applyEdit` funnel — the history middleware then captures it as ONE entry,
// preserving per-form-fill undo semantics without per-keystroke pollution.
//
// Form-DESIGN ops (add/remove/edit field) are dispatched through `applyEdit`
// per-op — they ARE EditOperations, NOT batched. Designer mode is many
// individual editorial acts, not one (per conventions §14.1 table).
//
// Mail merge BYPASSES this slice entirely — see mail-merge-slice.ts +
// conventions §14.4 anti-pattern. The runner produces output files, not
// EditOperations.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { type FormFieldDefinition, type FormFieldValue } from '../../types/ipc-contract';

/** Detection status reported by `forms:detect` (or 'unknown' before any call). */
export type DetectionStatus = 'unknown' | 'detecting' | 'none' | 'present' | 'error';

export interface FormsState {
  detectionStatus: DetectionStatus;
  /** Field defs as known to the renderer. Origin tagged 'detected' or 'authored'. */
  fields: FormFieldDefinition[];
  /** Banner flags from the most recent detect call. */
  hasAcroForm: boolean;
  hasXfaForm: boolean;
  hasJavaScriptActions: boolean;
  warnings: string[];
  /** Transient per-field input buffer; the source of truth for the form-fill overlay. */
  values: Record<string, FormFieldValue>;
  /** Mirror of `values` at the last successful commit; diffed by commitFormThunk. */
  committedValues: Record<string, FormFieldValue>;
  /** True when the user is in Form Designer mode (ui-spec §12.4). */
  designerMode: boolean;
  /** Active field-type pill in the designer toolbar; 'select' = the "select / properties" cursor. */
  designerFieldType: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'signature' | 'date' | 'select';
  /** Field-name currently selected in designer (for the properties pane). */
  selectedFieldName: string | null;
  /** Last error from a form IPC call; rendered as toast — set by thunks. */
  lastError: string | null;
}

const initialState: FormsState = {
  detectionStatus: 'unknown',
  fields: [],
  hasAcroForm: false,
  hasXfaForm: false,
  hasJavaScriptActions: false,
  warnings: [],
  values: {},
  committedValues: {},
  designerMode: false,
  designerFieldType: 'text',
  selectedFieldName: null,
  lastError: null,
};

export const formsSlice = createSlice({
  name: 'forms',
  initialState,
  reducers: {
    /** Detection started — banner shows spinner per ui-spec §12.3. */
    setDetecting(state) {
      state.detectionStatus = 'detecting';
    },
    /** Detection finished — replaces field set + banners. */
    setDetected(
      state,
      action: PayloadAction<{
        fields: FormFieldDefinition[];
        hasAcroForm: boolean;
        hasXfaForm: boolean;
        hasJavaScriptActions: boolean;
        warnings: string[];
      }>,
    ) {
      state.detectionStatus =
        action.payload.fields.length > 0 || action.payload.hasAcroForm ? 'present' : 'none';
      state.fields = action.payload.fields;
      state.hasAcroForm = action.payload.hasAcroForm;
      state.hasXfaForm = action.payload.hasXfaForm;
      state.hasJavaScriptActions = action.payload.hasJavaScriptActions;
      state.warnings = action.payload.warnings;
      // Seed committedValues from defaultValue per field — those are the
      // baseline a diff is computed against.
      const seed: Record<string, FormFieldValue> = {};
      for (const f of action.payload.fields) {
        if (f.defaultValue !== undefined) seed[f.name] = f.defaultValue;
      }
      state.committedValues = seed;
      state.values = { ...seed };
    },
    setDetectError(state, action: PayloadAction<string>) {
      state.detectionStatus = 'error';
      state.lastError = action.payload;
    },
    /** Update a single transient fill value (per keystroke; NOT an EditOperation). */
    setFieldValue(state, action: PayloadAction<{ name: string; value: FormFieldValue }>) {
      state.values[action.payload.name] = action.payload.value;
    },
    /** After commitFormThunk: copy `values` into `committedValues` for the changed keys. */
    markCommitted(state, action: PayloadAction<Record<string, FormFieldValue>>) {
      for (const [name, value] of Object.entries(action.payload)) {
        state.committedValues[name] = value;
      }
    },
    /** Discard uncommitted edits: restore `values` to `committedValues`. */
    discardUncommitted(state) {
      state.values = { ...state.committedValues };
    },
    /** Add an authored field def to the in-memory list (renderer mirror of form-design-add). */
    addAuthoredField(state, action: PayloadAction<FormFieldDefinition>) {
      const existing = state.fields.findIndex((f) => f.name === action.payload.name);
      if (existing >= 0) {
        state.fields[existing] = action.payload;
      } else {
        state.fields.push(action.payload);
      }
    },
    /** Remove a field by name (renderer mirror of form-design-remove). */
    removeFieldByName(state, action: PayloadAction<string>) {
      state.fields = state.fields.filter((f) => f.name !== action.payload);
      delete state.values[action.payload];
      delete state.committedValues[action.payload];
      if (state.selectedFieldName === action.payload) state.selectedFieldName = null;
    },
    /** Patch a field's metadata (label, required, options, rect, defaultValue). */
    patchField(
      state,
      action: PayloadAction<{ name: string; patch: Partial<FormFieldDefinition> }>,
    ) {
      const idx = state.fields.findIndex((f) => f.name === action.payload.name);
      if (idx < 0) return;
      const existing = state.fields[idx];
      if (!existing) return;
      state.fields[idx] = { ...existing, ...action.payload.patch };
    },
    setDesignerMode(state, action: PayloadAction<boolean>) {
      state.designerMode = action.payload;
      if (!action.payload) state.selectedFieldName = null;
    },
    toggleDesignerMode(state) {
      state.designerMode = !state.designerMode;
      if (!state.designerMode) state.selectedFieldName = null;
    },
    setDesignerFieldType(state, action: PayloadAction<FormsState['designerFieldType']>) {
      state.designerFieldType = action.payload;
    },
    setSelectedField(state, action: PayloadAction<string | null>) {
      state.selectedFieldName = action.payload;
    },
    /** Reset slice on document close. */
    resetForms() {
      return initialState;
    },
    clearLastError(state) {
      state.lastError = null;
    },
  },
});

export const {
  setDetecting,
  setDetected,
  setDetectError,
  setFieldValue,
  markCommitted,
  discardUncommitted,
  addAuthoredField,
  removeFieldByName,
  patchField,
  setDesignerMode,
  toggleDesignerMode,
  setDesignerFieldType,
  setSelectedField,
  resetForms,
  clearLastError,
} = formsSlice.actions;

export default formsSlice.reducer;
