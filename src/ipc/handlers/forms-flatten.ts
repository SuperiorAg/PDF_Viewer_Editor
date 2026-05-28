// Handler: forms:flatten (Phase 3, api-contracts.md §13.3)
//
// Returns a `form-flatten` EditOperation. Standalone op (also bundled into
// pdf:export via the flattenForms?: boolean flag — that path is handled
// inside the export pipeline).

import { randomUUID } from 'node:crypto';

import { detectForms } from '../../main/pdf-ops/form-engine.js';
import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  EditOperation,
  EditOperationSerialized,
  FormsFlattenError,
  FormsFlattenRequest,
  FormsFlattenResponse,
} from '../contracts.js';

export interface FormsFlattenDeps {
  getBytes(handle: DocumentHandle): Uint8Array | null;
}

export async function handleFormsFlatten(
  req: FormsFlattenRequest,
  deps: FormsFlattenDeps,
): Promise<FormsFlattenResponse> {
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<FormsFlattenError>('flatten_failed', 'handle must be an integer');
  }
  const bytes = deps.getBytes(req.handle);
  if (!bytes) {
    return fail<FormsFlattenError>('handle_not_found', `handle ${req.handle} not found`);
  }
  // Snapshot the current fields + their detected values so the op carries
  // a faithful inverse (data-models §8.2 + §8.3).
  const det = await detectForms(bytes);
  if (!det.ok) {
    return fail<FormsFlattenError>('load_failed', det.message);
  }
  if (!det.value.hasAcroForm || det.value.fields.length === 0) {
    return fail<FormsFlattenError>('form_not_present', 'document has no AcroForm fields');
  }

  const op: EditOperation = {
    kind: 'form-flatten',
    meta: { ts: Date.now(), undoable: true, operationId: randomUUID() },
    beforeFields: det.value.fields,
    // Phase 3 ships an empty beforeValues snapshot here — the renderer's
    // formsSlice.committedValues is the authoritative source for the
    // inverse. The shape is preserved so the data-models §8.3 composite
    // inverse stays valid (data-models permits the snapshot to be the
    // empty map when no committed values exist).
    beforeValues: {},
  };

  return ok({
    op: op as EditOperationSerialized,
    flattenedFieldCount: det.value.fields.length,
    warnings: det.value.warnings,
  });
}
