// Handler: ocr:cancelJob (Phase 5, api-contracts.md §16.5)
//
// Cancel an in-flight OCR job. Idempotent. The engine checks `signal.aborted`
// between pages (NOT mid-page); the current page completes then the loop
// exits. Worker is NOT terminated (workers persist; conventions §16.1).

import { z } from 'zod';

import { fail, ok } from '../../shared/result.js';
import type { OcrCancelJobError, OcrCancelJobRequest, OcrCancelJobResponse } from '../contracts.js';

import { getActiveJob } from './ocr-run-on-document.js';

const requestSchema = z.object({
  jobId: z.number().int(),
});

export async function handleOcrCancelJob(req: unknown): Promise<OcrCancelJobResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<OcrCancelJobError>('invalid_payload', parsed.error.message);
  }
  const job = getActiveJob(parsed.data.jobId);
  if (!job) {
    return fail<OcrCancelJobError>('job_not_found', `jobId ${parsed.data.jobId} not active`);
  }
  if (job.terminal !== null) {
    return fail<OcrCancelJobError>(
      'job_already_terminal',
      `job ${parsed.data.jobId} already ${job.terminal}`,
    );
  }
  job.controller.abort();
  return ok({
    cancelled: true,
    pagesCompleted: job.pagesCompleted,
  });
}

// Keep alias alive.
export type _UnusedReq = OcrCancelJobRequest;
