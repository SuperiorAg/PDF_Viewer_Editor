// Handler: telemetry:setOptIn (Phase 7, api-contracts.md §18.5)
//
// Sets the telemetry opt-in flag (persists to settings.telemetry.optIn,
// default false). Turning opt-in OFF MUST clear the ring buffer — no orphaned
// events survive opt-out (api-contracts.md §18.10). The service owns both the
// persistence and the buffer-clear; this handler is the validated boundary.

import { z } from 'zod';

import type { TelemetryService } from '../../main/telemetry.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type { TelemetrySetOptInError, TelemetrySetOptInResponse } from '../contracts.js';

const requestSchema = z
  .object({
    optIn: z.boolean(),
  })
  .strict();

export interface TelemetrySetOptInDeps {
  service: TelemetryService;
}

export async function handleTelemetrySetOptIn(
  req: unknown,
  deps: TelemetrySetOptInDeps,
): Promise<TelemetrySetOptInResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<TelemetrySetOptInError>('invalid_payload', parsed.error.message);
  }
  try {
    const { optIn, bufferCleared } = deps.service.setOptIn(parsed.data.optIn);
    return ok({ optIn, bufferCleared });
  } catch (e) {
    return fail<TelemetrySetOptInError>(
      'settings_write_failed',
      safeMessage(e, 'Failed to update telemetry setting'),
    );
  }
}
