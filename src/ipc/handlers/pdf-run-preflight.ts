// Handler: pdf:runPreflight (Phase 7.5 Wave 5a — C2).
//
// Contract: docs/api-contracts.md §19.6.
// Engine:   src/main/pdf-ops/preflight-engine.ts.

import { z } from 'zod';

import {
  runPreflight,
  type PreflightEngineError as EngineErr,
  type PreflightProfile,
} from '../../main/pdf-ops/preflight-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfRunPreflightError,
  PdfRunPreflightResponse,
  PdfRunPreflightValue,
  PreflightRuleResult,
} from '../contracts.js';

const profileSchema = z.union([
  z.literal('pdf-x-1a'),
  z.literal('pdf-x-4'),
  z.literal('pdf-a-1b'),
  z.literal('pdf-a-2b'),
]);

const requestSchema = z.object({
  handle: z.number().int().positive(),
  profiles: z.array(profileSchema).min(1),
});

export interface PdfRunPreflightDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  /** Test seam — override the engine. */
  engine?: typeof runPreflight;
}

export async function handlePdfRunPreflight(
  req: unknown,
  deps: PdfRunPreflightDeps,
): Promise<PdfRunPreflightResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfRunPreflightError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfRunPreflightError>('handle_not_found', `handle ${r.handle} is not registered`);
  }

  const engine = deps.engine ?? runPreflight;
  let engineRes;
  try {
    engineRes = await engine({
      pdfBytes: bytes,
      profiles: r.profiles as ReadonlyArray<PreflightProfile>,
    });
  } catch (e) {
    return fail<PdfRunPreflightError>('engine_failed', safeMessage(e, 'preflight engine threw'));
  }

  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message);
  }

  // Strip rule-internal `details` from the IPC value; the contract does not
  // expose it. (Details are useful for engine tests + future debugging but
  // out of the contract surface today.)
  const sanitized: PreflightRuleResult[] = engineRes.value.results.map((rr) => ({
    ruleId: rr.ruleId,
    profile: rr.profile,
    severity: rr.severity,
    passed: rr.passed,
    message: rr.message,
    locations: rr.locations,
  }));

  const v: PdfRunPreflightValue = {
    results: sanitized,
    ranAt: engineRes.value.ranAt,
    shippedRuleCount: engineRes.value.shippedRuleCount,
  };
  return ok(v);
}

function mapEngineErr(engineErr: EngineErr, message: string): PdfRunPreflightResponse {
  switch (engineErr) {
    case 'invalid_payload':
      return fail<PdfRunPreflightError>('invalid_payload', message);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfRunPreflightError>('engine_failed', message);
  }
}
