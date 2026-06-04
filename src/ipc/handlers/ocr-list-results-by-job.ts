// Handler: ocr:listResultsByJob (Phase 5.2 — Marcus, 2026-06-04)
//
// Returns the per-page OCR results for a single completed job. Backs the
// "restore confidence overlay on reopen" path:
//
//   renderer (doc-open):
//     -> ocr:listJobs({ filters: { docHash, status: 'completed' }, limit: 1 })
//     -> if a job exists:
//          ocr:listResultsByJob({ jobId: job.id })
//          dispatch(setCurrentSummary({ ...summary, pageResults }))
//   slice:
//     setCurrentSummary's existing `if (action.payload?.pageResults)` branch
//     indexes the array into `pageResultsByPage`, which `OcrConfidenceOverlay`
//     subscribes to. The overlay repaints automatically.
//
// Architecture: the existing `ocr:listJobs` DTO deliberately omits the heavy
// per-page word lists (data-models §10.5 keeps list payloads light); a
// dedicated by-job channel that always returns the full per-page array is the
// Phase-5.2 follow-up Riley flagged in `thunks-phase5.ts:256-259`.
//
// JSON parse boundary: the bridge (`db-bridge.ts:listPageResultsByJobId`) is
// the canonical parse layer per data-models §10.6 + ocr-results-repo's
// "repo never parses" rule. This handler is a thin authorization +
// existence-check + DTO assembly wrapper around the bridge.

import { z } from 'zod';

import type { OcrJobsRepoBridge, OcrResultsRepoBridge } from '../../main/db-bridge.js';
import { fail, ok } from '../../shared/result.js';
import type {
  OcrListResultsByJobError,
  OcrListResultsByJobRequest,
  OcrListResultsByJobResponse,
} from '../contracts.js';

export interface OcrListResultsByJobDeps {
  /**
   * Existence check — used to discriminate `job_not_found` from "job exists
   * with zero results yet" (a cancelled-before-page-0 scenario).
   */
  jobsRepo: OcrJobsRepoBridge | null;
  resultsRepo: OcrResultsRepoBridge | null;
}

const requestSchema = z.object({
  jobId: z.number().int().positive(),
});

export async function handleOcrListResultsByJob(
  req: unknown,
  deps: OcrListResultsByJobDeps,
): Promise<OcrListResultsByJobResponse> {
  const parsed = requestSchema.safeParse(req ?? {});
  if (!parsed.success) {
    return fail<OcrListResultsByJobError>('invalid_payload', parsed.error.message);
  }
  // Repos not yet wired (memory bridge in tests / early boot) — surface as an
  // empty pageResults rather than an error. The renderer pattern-matches on
  // ok-but-empty as "OCR was run, but no per-page rows recoverable" which is a
  // benign degraded state (the summary banner still shows).
  if (!deps.resultsRepo) {
    return ok({ pageResults: [] });
  }
  // Existence check: distinguish job-not-found from zero-page-results.
  if (deps.jobsRepo) {
    const job = deps.jobsRepo.get(parsed.data.jobId);
    if (job === null) {
      return fail<OcrListResultsByJobError>(
        'job_not_found',
        `no ocr_jobs row with id=${String(parsed.data.jobId)}`,
      );
    }
  }
  const pageResults = deps.resultsRepo.listPageResultsByJobId(parsed.data.jobId);
  return ok({ pageResults });
}

// Re-export the request type so callers don't double-import the contract just
// for type narrowing in tests.
export type _UnusedReq = OcrListResultsByJobRequest;
