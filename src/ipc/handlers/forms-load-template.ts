// Handler: forms:loadTemplate (Phase 3, api-contracts.md §13.8)
//
// Returns the template's field definitions for the renderer to dispatch as
// `form-design-add` ops onto the current document (each is undoable).

import type { FormTemplatesRepo } from '../../main/db-bridge.js';
import { fail, ok } from '../../shared/result.js';
import type {
  FormsLoadTemplateError,
  FormsLoadTemplateRequest,
  FormsLoadTemplateResponse,
} from '../contracts.js';

export interface FormsLoadTemplateDeps {
  repo: FormTemplatesRepo;
}

export async function handleFormsLoadTemplate(
  req: FormsLoadTemplateRequest,
  deps: FormsLoadTemplateDeps,
): Promise<FormsLoadTemplateResponse> {
  if (typeof req.templateId !== 'number' || !Number.isInteger(req.templateId)) {
    return fail<FormsLoadTemplateError>('invalid_payload', 'templateId must be an integer');
  }
  try {
    const dto = deps.repo.get(req.templateId);
    if (!dto) {
      return fail<FormsLoadTemplateError>(
        'template_not_found',
        `template ${req.templateId} not found`,
      );
    }
    return ok({
      id: dto.id,
      name: dto.name,
      fields: dto.fields,
      lastColumnMappings: dto.lastColumnMappings,
    });
  } catch (e) {
    return fail<FormsLoadTemplateError>('db_unavailable', (e as Error).message);
  }
}
