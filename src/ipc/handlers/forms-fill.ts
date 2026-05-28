// Handler: forms:fill (Phase 3, api-contracts.md §13.2)
//
// Validates a per-field fill value against the document's current schema.
// Returns a normalized value (date coerced to ISO-8601, etc.). Does NOT
// dispatch an EditOperation — per the Phase-3 hybrid model the renderer
// accumulates values transiently in formsSlice.values and batches them
// into ONE form-commit op at the commit boundary (conventions §14.2).

import { detectForms } from '../../main/pdf-ops/form-engine.js';
import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  FormFieldValue,
  FormsFillError,
  FormsFillRequest,
  FormsFillResponse,
} from '../contracts.js';

export interface FormsFillDeps {
  getBytes(handle: DocumentHandle): Uint8Array | null;
}

export async function handleFormsFill(
  req: FormsFillRequest,
  deps: FormsFillDeps,
): Promise<FormsFillResponse> {
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<FormsFillError>('invalid_payload', 'handle must be an integer');
  }
  if (typeof req.fieldName !== 'string' || req.fieldName.length === 0) {
    return fail<FormsFillError>('invalid_payload', 'fieldName required');
  }
  if (!req.value || typeof req.value !== 'object' || typeof req.value.type !== 'string') {
    return fail<FormsFillError>('invalid_payload', 'value invalid');
  }
  const bytes = deps.getBytes(req.handle);
  if (!bytes) {
    return fail<FormsFillError>('handle_not_found', `handle ${req.handle} not found`);
  }
  const det = await detectForms(bytes);
  if (!det.ok) {
    return fail<FormsFillError>('invalid_payload', `detect failed: ${det.message}`);
  }
  const def = det.value.fields.find((f) => f.name === req.fieldName);
  if (!def) {
    return fail<FormsFillError>('field_not_found', `field '${req.fieldName}' not found`);
  }
  // Type-match the value against the field's declared type. Date is stored
  // as a text field with the date-marker tooltip; accept either 'text' or
  // 'date' for date fields.
  const valueType = req.value.type;
  if (def.type === 'date') {
    if (valueType !== 'date' && valueType !== 'text') {
      return fail<FormsFillError>(
        'field_type_mismatch',
        `field '${req.fieldName}' is date; got value.type=${valueType}`,
      );
    }
  } else if (def.type === 'text') {
    if (valueType !== 'text') {
      return fail<FormsFillError>(
        'field_type_mismatch',
        `field '${req.fieldName}' is text; got value.type=${valueType}`,
      );
    }
  } else if (valueType !== def.type) {
    return fail<FormsFillError>(
      'field_type_mismatch',
      `field '${req.fieldName}' is ${def.type}; got value.type=${valueType}`,
    );
  }

  // Option-membership check for radio + dropdown
  if (
    (def.type === 'radio' || def.type === 'dropdown') &&
    (req.value.type === 'radio' || req.value.type === 'dropdown')
  ) {
    const opts = def.options ?? [];
    const wanted = req.value.value;
    if (!opts.some((o) => o.value === wanted)) {
      return fail<FormsFillError>(
        'option_not_in_field',
        `value '${wanted}' not in options for '${req.fieldName}'`,
      );
    }
  }

  const normalized = normalizeValue(req.value);
  return ok({
    fieldName: req.fieldName,
    normalizedValue: normalized,
    warnings: [],
  });
}

function normalizeValue(v: FormFieldValue): FormFieldValue {
  if (v.type === 'date') {
    // Coerce common date forms to ISO-8601 (best-effort; renderer's date
    // picker is the source of truth for the on-disk value).
    const trimmed = v.value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return { type: 'date', value: trimmed.slice(0, 10) };
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (us) {
      const mm = us[1]?.padStart(2, '0') ?? '01';
      const dd = us[2]?.padStart(2, '0') ?? '01';
      return { type: 'date', value: `${us[3]}-${mm}-${dd}` };
    }
    return { type: 'date', value: trimmed };
  }
  return v;
}
