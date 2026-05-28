// Handler: update:download (Phase 7, api-contracts.md §18.2)
//
// Downloads the available update bundle. NEVER auto-invoked — always
// user-initiated after update:check reports 'available'. The controller
// validates the requested version against the last 'available' check (guards
// stale UI) and emits progress via update:onProgress. A bundle that fails
// signature verification surfaces `signature_verification_failed` (cert
// dependency; P7-L-2 §3.5) — correct security behavior, not a bug.

import { z } from 'zod';

import type { AutoUpdateController } from '../../main/auto-update.js';
import { fail } from '../../shared/result.js';
import type { UpdateDownloadError, UpdateDownloadResponse } from '../contracts.js';

const requestSchema = z
  .object({
    version: z.string().min(1),
  })
  .strict();

export interface UpdateDownloadDeps {
  controller: AutoUpdateController;
}

export async function handleUpdateDownload(
  req: unknown,
  deps: UpdateDownloadDeps,
): Promise<UpdateDownloadResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<UpdateDownloadError>('invalid_payload', parsed.error.message);
  }
  return deps.controller.downloadUpdate(parsed.data);
}
