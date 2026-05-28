// Handler: forms:designRemove (Phase 3, api-contracts.md §13.5)
//
// Returns a `form-design-remove` EditOperation carrying the full
// FormFieldDefinition snapshot needed for the inverse (data-models §8.3).

import { randomUUID } from 'node:crypto';

import { detectForms } from '../../main/pdf-ops/form-engine.js';
import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  EditOperation,
  EditOperationSerialized,
  FormsDesignRemoveError,
  FormsDesignRemoveRequest,
  FormsDesignRemoveResponse,
} from '../contracts.js';

export interface FormsDesignRemoveDeps {
  getBytes(handle: DocumentHandle): Uint8Array | null;
}

export async function handleFormsDesignRemove(
  req: FormsDesignRemoveRequest,
  deps: FormsDesignRemoveDeps,
): Promise<FormsDesignRemoveResponse> {
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<FormsDesignRemoveError>('invalid_payload', 'handle must be an integer');
  }
  if (typeof req.fieldName !== 'string' || req.fieldName.length === 0) {
    return fail<FormsDesignRemoveError>('invalid_payload', 'fieldName required');
  }
  const bytes = deps.getBytes(req.handle);
  if (!bytes) {
    return fail<FormsDesignRemoveError>('handle_not_found', `handle ${req.handle} not found`);
  }
  const det = await detectForms(bytes);
  if (!det.ok) {
    return fail<FormsDesignRemoveError>('invalid_payload', `detect failed: ${det.message}`);
  }
  const before = det.value.fields.find((f) => f.name === req.fieldName);
  if (!before) {
    return fail<FormsDesignRemoveError>('field_not_found', `field '${req.fieldName}' not found`);
  }
  const op: EditOperation = {
    kind: 'form-design-remove',
    meta: { ts: Date.now(), undoable: true, operationId: randomUUID() },
    fieldName: req.fieldName,
    before,
  };
  return ok({
    op: op as EditOperationSerialized,
    warnings: [],
  });
}
