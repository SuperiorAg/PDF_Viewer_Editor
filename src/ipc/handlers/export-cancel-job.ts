// Handler: export:cancelJob (Phase 6, api-contracts.md §17.6)
//
// Idempotent. The engine checks `signal.aborted` between pages (NOT mid-page);
// the current page completes then the loop exits. Partial output is deleted
// from disk by the engine on abort.

import { z } from 'zod';

import { getActiveExportJob } from '../../main/export/export-engine.js';
import type { ExportQueue } from '../../main/export/export-queue.js';
import { fail, ok } from '../../shared/result.js';
import type {
  ExportCancelJobError,
  ExportCancelJobRequest,
  ExportCancelJobResponse,
} from '../contracts.js';

const requestSchema = z.object({
  jobId: z.number().int(),
});

export interface ExportCancelJobDeps {
  /** When wired, cancel routes through the queue so a still-QUEUED job (not yet
   *  running, hence not in activeJobs) can also be cancelled. */
  queue?: ExportQueue;
}

export async function handleExportCancelJob(
  req: unknown,
  deps?: ExportCancelJobDeps,
): Promise<ExportCancelJobResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<ExportCancelJobError>('invalid_payload', parsed.error.message);
  }
  const jobId = parsed.data.jobId;

  // Running job: abort via its AbortController (the engine checks between pages).
  const job = getActiveExportJob(jobId);
  if (job) {
    if (job.terminal !== null) {
      return fail<ExportCancelJobError>(
        'job_already_terminal',
        `job ${jobId} already ${job.terminal}`,
      );
    }
    job.controller.abort();
    return ok({ cancelled: true, pagesCompleted: job.pagesCompleted });
  }

  // Not running — it may still be QUEUED. The queue can drop it before it runs.
  if (deps?.queue) {
    const result = await deps.queue.cancel(jobId);
    if (result.cancelled) {
      return ok({ cancelled: true, pagesCompleted: result.pagesCompleted });
    }
  }

  return fail<ExportCancelJobError>('job_not_found', `jobId ${jobId} not active`);
}

export type _UnusedReq = ExportCancelJobRequest;
