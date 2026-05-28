// Handler: recents:list

import { fail, ok } from '../../shared/result.js';
import type {
  RecentsListError,
  RecentsListItem,
  RecentsListRequest,
  RecentsListResponse,
} from '../contracts.js';

export interface RecentsListDeps {
  listRows: (limit: number) => RecentsListItem[];
  fileExists: (path: string) => boolean;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

export function handleRecentsList(
  req: RecentsListRequest,
  deps: RecentsListDeps,
): RecentsListResponse {
  const limit =
    typeof req.limit === 'number' && Number.isInteger(req.limit) && req.limit > 0
      ? Math.min(req.limit, MAX_LIMIT)
      : DEFAULT_LIMIT;
  try {
    const rows = deps.listRows(limit);
    const items = rows.map((r) => ({ ...r, fileStillExists: deps.fileExists(r.path) }));
    return ok({ items });
  } catch (e) {
    return fail<RecentsListError>('db_unavailable', (e as Error).message);
  }
}
