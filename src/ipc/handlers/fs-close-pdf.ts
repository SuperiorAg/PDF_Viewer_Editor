// Handler: fs:closePdf — release document handle + bytes.

import { fail, ok } from '../../shared/result.js';
import type { FsClosePdfError, FsClosePdfRequest, FsClosePdfResponse } from '../contracts.js';

export interface FsClosePdfDeps {
  releaseHandle: (handle: number) => boolean;
}

export function handleFsClosePdf(req: FsClosePdfRequest, deps: FsClosePdfDeps): FsClosePdfResponse {
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<FsClosePdfError>('handle_not_found', 'handle must be an integer');
  }
  const released = deps.releaseHandle(req.handle);
  if (!released) {
    return fail<FsClosePdfError>('handle_not_found', `handle ${req.handle} not found`);
  }
  return ok({});
}
