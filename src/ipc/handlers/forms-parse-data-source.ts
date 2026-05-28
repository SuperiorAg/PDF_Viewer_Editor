// Handler: forms:parseDataSource (Phase 3, api-contracts.md §13.9 companion;
// architecture-phase-3.md §6.1 wizard step 2). Returns the headers + first N
// rows + total row count so the mail-merge wizard can drive its
// column-mapping UX without round-tripping the full dataset.

import { parseDataSource } from '../../main/pdf-ops/csv-excel-parser.js';
import { fail, ok } from '../../shared/result.js';
import type {
  FormsParseDataSourceError,
  FormsParseDataSourceRequest,
  FormsParseDataSourceResponse,
} from '../contracts.js';

export interface FormsParseDataSourceDeps {
  /* no main-side deps; the parser is pure over the supplied bytes */
}

const DEFAULT_PREVIEW = 5;
const MAX_PREVIEW = 50;

export async function handleFormsParseDataSource(
  req: FormsParseDataSourceRequest,
  _deps: FormsParseDataSourceDeps,
): Promise<FormsParseDataSourceResponse> {
  if (!req.dataSource || typeof req.dataSource !== 'object') {
    return fail<FormsParseDataSourceError>('invalid_payload', 'dataSource required');
  }
  if (req.dataSource.kind !== 'csv' && req.dataSource.kind !== 'xlsx') {
    return fail<FormsParseDataSourceError>('invalid_payload', `dataSource.kind must be csv|xlsx`);
  }
  if (!(req.dataSource.bytes instanceof Uint8Array) || req.dataSource.bytes.byteLength === 0) {
    return fail<FormsParseDataSourceError>('invalid_payload', 'dataSource.bytes empty');
  }

  const preview = Math.min(MAX_PREVIEW, Math.max(0, req.previewRowCount ?? DEFAULT_PREVIEW));

  const r = await parseDataSource(req.dataSource);
  if (!r.ok) {
    return fail<FormsParseDataSourceError>('invalid_data_source', r.message);
  }
  return ok({
    headers: r.value.headers,
    previewRows: r.value.rows.slice(0, preview),
    totalRowCount: r.value.rows.length,
    warnings: r.value.warnings,
  });
}
