// Forms selectors — Phase 3.
// Per docs/conventions.md §6.3 colocation rule.

import { type FormFieldDefinition, type FormFieldValue } from '../../types/ipc-contract';
import { type RootState } from '../store';

export const selectFormsState = (s: RootState) => s.forms;
export const selectFormFields = (s: RootState): FormFieldDefinition[] => s.forms.fields;
export const selectFormDetectionStatus = (s: RootState) => s.forms.detectionStatus;
export const selectFormValues = (s: RootState): Record<string, FormFieldValue> => s.forms.values;
export const selectFormCommittedValues = (s: RootState): Record<string, FormFieldValue> =>
  s.forms.committedValues;
export const selectDesignerMode = (s: RootState): boolean => s.forms.designerMode;
export const selectDesignerFieldType = (s: RootState) => s.forms.designerFieldType;
export const selectSelectedFieldName = (s: RootState) => s.forms.selectedFieldName;
export const selectHasJavaScriptActions = (s: RootState): boolean => s.forms.hasJavaScriptActions;
export const selectHasXfaForm = (s: RootState): boolean => s.forms.hasXfaForm;
export const selectFormWarnings = (s: RootState): string[] => s.forms.warnings;

/**
 * The set of field names with a value in `values` that differs from `committedValues`.
 * Used by:
 *   - Forms sidebar to render the "Commit form values" banner (ui-spec §12.3)
 *   - commit-middleware to short-circuit no-op commits
 *   - close-document prompt to detect uncommitted edits as unsaved changes
 */
export const selectUncommittedFieldNames = (s: RootState): string[] => {
  const out: string[] = [];
  for (const [name, value] of Object.entries(s.forms.values)) {
    const committed = s.forms.committedValues[name];
    if (!deepEqualValue(value, committed)) out.push(name);
  }
  return out;
};

export const selectHasUncommittedValues = (s: RootState): boolean =>
  selectUncommittedFieldNames(s).length > 0;

export const selectSelectedField = (s: RootState): FormFieldDefinition | null => {
  if (s.forms.selectedFieldName === null) return null;
  return s.forms.fields.find((f) => f.name === s.forms.selectedFieldName) ?? null;
};

/**
 * Pure value comparator. FormFieldValue is a discriminated union with primitive
 * payloads (string | boolean | null), so a shallow strict-eq on `type` + `value`
 * suffices. Exported for thunks (commitFormThunk diff) + tests.
 */
export function deepEqualValue(
  a: FormFieldValue | undefined,
  b: FormFieldValue | undefined,
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (a.type !== b.type) return false;
  return a.value === b.value;
}
