// Handler: update:install (Phase 7, api-contracts.md §18.3)
//
// Quits and installs a downloaded update. User-initiated ("Restart and
// install"). The controller validates a download exists for the requested
// version, returns ok({ quitting: true }) IMMEDIATELY, then schedules
// quitAndInstall on the next tick — so the Result reaches the renderer before
// the process exits. The renderer never observes a success after the quit.

import { z } from 'zod';

import type { AutoUpdateController } from '../../main/auto-update.js';
import { fail } from '../../shared/result.js';
import type {
  UpdateInstallError,
  UpdateInstallRequest,
  UpdateInstallResponse,
} from '../contracts.js';

const requestSchema = z
  .object({
    version: z.string().min(1),
    // Phase 7.1 (Julian H-29.1): set true when the user has confirmed discarding
    // unsaved work in the "Save before updating?" dialog. Absent/false => the
    // controller's unsaved-work gate may refuse with unsaved_work_blocks_install.
    confirmedDiscardUnsaved: z.boolean().optional(),
  })
  .strict();

export interface UpdateInstallDeps {
  controller: AutoUpdateController;
}

export async function handleUpdateInstall(
  req: unknown,
  deps: UpdateInstallDeps,
): Promise<UpdateInstallResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<UpdateInstallError>('invalid_payload', parsed.error.message);
  }
  // exactOptionalPropertyTypes: omit confirmedDiscardUnsaved when undefined
  // (zod sets the key to `undefined` for absent optionals, which the strict
  // optional interface field rejects).
  const request: UpdateInstallRequest =
    parsed.data.confirmedDiscardUnsaved === undefined
      ? { version: parsed.data.version }
      : {
          version: parsed.data.version,
          confirmedDiscardUnsaved: parsed.data.confirmedDiscardUnsaved,
        };
  return deps.controller.quitAndInstall(request);
}
