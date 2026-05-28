// Handler: telemetry:getStatus (Phase 7, api-contracts.md §18.6)
//
// Returns the current opt-in state + buffer snapshot. The Settings toggle
// passes `includeBuffer: false`; the debug panel (which makes the opt-in
// auditable) passes `includeBuffer: true` to receive the name+dayBucket-only
// event list. `lastEventAt` is nullable + late-init (NO sentinel 0).
//
// The buffer snapshot carries ONLY { name, dayBucket } per entry — there is no
// PII to leak because none was ever recorded.

import { z } from 'zod';

import type { TelemetryService } from '../../main/telemetry.js';
import { fail, ok } from '../../shared/result.js';
import type { TelemetryGetStatusError, TelemetryGetStatusResponse } from '../contracts.js';

const requestSchema = z
  .object({
    includeBuffer: z.boolean(),
  })
  .strict();

export interface TelemetryGetStatusDeps {
  service: TelemetryService;
}

export async function handleTelemetryGetStatus(
  req: unknown,
  deps: TelemetryGetStatusDeps,
): Promise<TelemetryGetStatusResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<TelemetryGetStatusError>('invalid_payload', parsed.error.message);
  }
  return ok(deps.service.getStatus(parsed.data.includeBuffer));
}
