// Handler: forms:listTemplates (Phase 3, api-contracts.md §13.6)
//
// Returns summary metadata only (id/name/fieldCount/timestamps). Full field
// definitions come via forms:loadTemplate (cheaper list fetch).
//
// DEPENDS ON: Ravi's form-templates-repo via the db-bridge.formTemplates
// adapter. Falls back to the memory-backed repo in tests + until Ravi's
// SQLite implementation lands.

import type { FormTemplatesRepo } from '../../main/db-bridge.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  FormsListTemplatesError,
  FormsListTemplatesRequest,
  FormsListTemplatesResponse,
} from '../contracts.js';

export interface FormsListTemplatesDeps {
  repo: FormTemplatesRepo;
}

export async function handleFormsListTemplates(
  _req: FormsListTemplatesRequest,
  deps: FormsListTemplatesDeps,
): Promise<FormsListTemplatesResponse> {
  try {
    const items = deps.repo.list();
    return ok({ items });
  } catch (e) {
    return fail<FormsListTemplatesError>(
      'db_unavailable',
      safeMessage(e, 'Database is unavailable'),
    );
  }
}
