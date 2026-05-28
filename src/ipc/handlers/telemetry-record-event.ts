// Handler: telemetry:recordEvent (Phase 7, api-contracts.md §18.4)
//
// Records an allowlisted anonymous usage event. The renderer's opt-in gate
// already dropped the event when opt-in is OFF; this handler RE-CHECKS opt-in
// (belt-and-suspenders) and RE-VALIDATES the name against the static allowlist
// server-side.
//
// THE STRUCTURAL PII GUARD (conventions §18.5 rule 3, the headline):
//   The zod schema is `.strict()` — it REJECTS ANY extra property. The request
//   shape PHYSICALLY cannot carry PII: there is no free-text field, no path
//   field, no value field, no user-id field. A request like
//   `{ name, dayBucket, userId: 'x' }` fails `safeParse` → `invalid_payload`.
//   This is the structural enforcement of the opt-in/anonymous promise — not a
//   discipline that can be forgotten.
//
//   `dayBucket` is constrained to `YYYY-MM-DD` (NO sub-day timestamp — defeats
//   session fingerprinting; api-contracts.md §18.10).
//
// NEVER log the event payload (conventions §9 + §18.5). This handler logs
// NOTHING about the payload — not the name, not the bucket.

import { z } from 'zod';

import type { TelemetryService } from '../../main/telemetry.js';
import { fail, ok } from '../../shared/result.js';
import type { TelemetryRecordEventError, TelemetryRecordEventResponse } from '../contracts.js';

// `.strict()` is the PII guard: ANY property beyond { name, dayBucket } is
// rejected. `name` is a non-empty string (the allowlist re-check happens in the
// service); `dayBucket` must match the coarse day-bucket format exactly.
const requestSchema = z
  .object({
    name: z.string().min(1),
    dayBucket: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dayBucket must be YYYY-MM-DD'),
  })
  .strict();

export interface TelemetryRecordEventDeps {
  service: TelemetryService;
}

export async function handleTelemetryRecordEvent(
  req: unknown,
  deps: TelemetryRecordEventDeps,
): Promise<TelemetryRecordEventResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    // Do NOT echo the rejected payload (it could be an injection attempt).
    return fail<TelemetryRecordEventError>(
      'invalid_payload',
      'telemetry event rejected: payload failed strict validation',
    );
  }

  const result = deps.service.recordEvent(parsed.data.name, parsed.data.dayBucket);
  if (result.recorded) {
    return ok({ recorded: true });
  }
  // Dropped: surface the typed reason as an error variant (for renderer
  // assertion in tests) — the spec returns the error, not a thrown exception.
  return fail<TelemetryRecordEventError>(
    result.reason,
    result.reason === 'not_opted_in'
      ? 'telemetry is opted out; event dropped'
      : 'event name is not allowlisted; dropped',
  );
}
