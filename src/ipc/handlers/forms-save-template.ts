// Handler: forms:saveTemplate (Phase 3, api-contracts.md §13.7)
//
// Saves the current document's authored field set as a reusable template.
// Returns the new template id.
//
// DEPENDS ON: Ravi's form-templates-repo via db-bridge.formTemplates.

import type { FormTemplatesRepo } from '../../main/db-bridge.js';
import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  FormsSaveTemplateError,
  FormsSaveTemplateRequest,
  FormsSaveTemplateResponse,
} from '../contracts.js';

export interface FormsSaveTemplateDeps {
  repo: FormTemplatesRepo;
  hasHandle(handle: DocumentHandle): boolean;
  getDocumentHash(handle: DocumentHandle): string | null;
}

export async function handleFormsSaveTemplate(
  req: FormsSaveTemplateRequest,
  deps: FormsSaveTemplateDeps,
): Promise<FormsSaveTemplateResponse> {
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<FormsSaveTemplateError>('invalid_payload', 'handle must be an integer');
  }
  if (!deps.hasHandle(req.handle)) {
    return fail<FormsSaveTemplateError>('handle_not_found', `handle ${req.handle} not found`);
  }
  if (typeof req.name !== 'string' || req.name.length === 0 || req.name.length > 200) {
    return fail<FormsSaveTemplateError>('invalid_payload', 'name must be 1..200 chars');
  }
  if (!Array.isArray(req.fields) || req.fields.length === 0) {
    return fail<FormsSaveTemplateError>('invalid_payload', 'fields must be a non-empty array');
  }

  try {
    const sourceDocHash = deps.getDocumentHash(req.handle);
    const saveResult = deps.repo.save({
      name: req.name,
      fields: req.fields,
      sourceDocHash,
      ...(req.columnMappings !== undefined ? { columnMappings: req.columnMappings } : {}),
    });
    if (!saveResult.ok) {
      if (saveResult.error === 'name_in_use') {
        return fail<FormsSaveTemplateError>(
          'name_in_use',
          `template name '${req.name}' already in use`,
        );
      }
      return fail<FormsSaveTemplateError>('invalid_payload', saveResult.error);
    }
    return ok({ id: saveResult.id, warnings: [] });
  } catch (e) {
    return fail<FormsSaveTemplateError>('db_unavailable', (e as Error).message);
  }
}
