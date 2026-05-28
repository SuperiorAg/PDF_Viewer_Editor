// Handler: recents:add — typically called internally on open; exposed for completeness.

import { fail, ok } from '../../shared/result.js';
import type { RecentsAddError, RecentsAddRequest, RecentsAddResponse } from '../contracts.js';

const FILE_HASH_RE = /^[a-f0-9]{64}$/;

export interface RecentsAddDeps {
  upsertRow: (row: { path: string; displayName: string; fileHash: string }) => void;
  sanitizePath: (raw: unknown) => string | null;
}

export function handleRecentsAdd(req: RecentsAddRequest, deps: RecentsAddDeps): RecentsAddResponse {
  if (typeof req.path !== 'string' || typeof req.displayName !== 'string') {
    return fail<RecentsAddError>('invalid_payload', 'path/displayName required');
  }
  if (typeof req.fileHash !== 'string' || !FILE_HASH_RE.test(req.fileHash)) {
    return fail<RecentsAddError>('invalid_payload', 'fileHash must be 64-char hex');
  }
  const safe = deps.sanitizePath(req.path);
  if (safe === null) {
    return fail<RecentsAddError>('invalid_payload', 'path failed sanitization');
  }
  try {
    deps.upsertRow({ path: safe, displayName: req.displayName, fileHash: req.fileHash });
    return ok({});
  } catch (e) {
    return fail<RecentsAddError>('db_unavailable', (e as Error).message);
  }
}
