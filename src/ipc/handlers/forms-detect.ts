// Handler: forms:detect (Phase 3, api-contracts.md §13.1)
//
// Detects AcroForm fields in the open document. No mutation; cheap. Returns
// a FormFieldDefinition[] snapshot the renderer drops into formsSlice.fields.
//
// Pure handler over (handle -> bytes). FS / DB untouched.

import { detectForms } from '../../main/pdf-ops/form-engine.js';
import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  FormsDetectError,
  FormsDetectRequest,
  FormsDetectResponse,
} from '../contracts.js';

export interface FormsDetectDeps {
  getBytes(handle: DocumentHandle): Uint8Array | null;
}

export async function handleFormsDetect(
  req: FormsDetectRequest,
  deps: FormsDetectDeps,
): Promise<FormsDetectResponse> {
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<FormsDetectError>('detect_failed', 'handle must be an integer');
  }
  const bytes = deps.getBytes(req.handle);
  if (!bytes) {
    return fail<FormsDetectError>('handle_not_found', `handle ${req.handle} not found`);
  }
  const r = await detectForms(bytes);
  if (!r.ok) {
    if (r.error === 'load_failed') {
      return fail<FormsDetectError>('load_failed', r.message);
    }
    return fail<FormsDetectError>('detect_failed', r.message);
  }
  return ok(r.value);
}
