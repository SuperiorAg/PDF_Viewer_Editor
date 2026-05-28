// Handler: update:check (Phase 7, api-contracts.md §18.1)
//
// Checks the configured release feed. Explicit (About-modal button) or auto
// ('launch', only when settings.update.channel === 'check-on-launch'). The
// handler does NOT re-read the channel setting (the renderer gates 'launch'),
// but it DOES respect the placeholder gate: when the publish target is a
// placeholder the controller returns the honest `update_not_configured`
// (NOT a fake up-to-date — P7-L-2 trust-floor obligation #2).
//
// Crash-safety: the controller never throws across this boundary; every
// failure mode is a typed discriminated Result.

import { z } from 'zod';

import type { AutoUpdateController } from '../../main/auto-update.js';
import { fail } from '../../shared/result.js';
import type { UpdateCheckError, UpdateCheckResponse } from '../contracts.js';

const requestSchema = z
  .object({
    trigger: z.enum(['explicit', 'launch']),
  })
  .strict();

export interface UpdateCheckDeps {
  controller: AutoUpdateController;
}

export async function handleUpdateCheck(
  req: unknown,
  deps: UpdateCheckDeps,
): Promise<UpdateCheckResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<UpdateCheckError>('invalid_payload', parsed.error.message);
  }
  return deps.controller.checkForUpdates(parsed.data);
}
