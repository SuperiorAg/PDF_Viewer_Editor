// Handler: recents:clear

import { fail, ok } from '../../shared/result.js';
import type { RecentsClearError, RecentsClearRequest, RecentsClearResponse } from '../contracts.js';

export interface RecentsClearDeps {
  clearRows: () => number;
}

export function handleRecentsClear(
  _req: RecentsClearRequest,
  deps: RecentsClearDeps,
): RecentsClearResponse {
  try {
    const cleared = deps.clearRows();
    return ok({ cleared });
  } catch (e) {
    return fail<RecentsClearError>('db_unavailable', (e as Error).message);
  }
}
