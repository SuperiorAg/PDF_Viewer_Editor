// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';

import { handleOcrCancelJob } from './ocr-cancel-job.js';

describe('handleOcrCancelJob (api-contracts.md §16.5)', () => {
  beforeEach(() => {
    // Clear any registry state from prior tests.
    globalThis.__pdfvOcrActiveJobs?.clear();
  });

  it('rejects invalid_payload', async () => {
    const r = await handleOcrCancelJob({ jobId: 'not-a-number' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects missing jobId', async () => {
    const r = await handleOcrCancelJob({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('returns job_not_found when no active job has the id', async () => {
    const r = await handleOcrCancelJob({ jobId: 99999 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('job_not_found');
  });

  it('cancels an active job and returns pagesCompleted', async () => {
    const controller = new AbortController();
    const jobId = 1234;
    globalThis.__pdfvOcrActiveJobs!.set(jobId, {
      jobId,
      controller,
      pagesCompleted: 3,
      totalPages: 10,
      startedAt: Date.now(),
      terminal: null,
    });
    const r = await handleOcrCancelJob({ jobId });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.cancelled).toBe(true);
      expect(r.value.pagesCompleted).toBe(3);
    }
    expect(controller.signal.aborted).toBe(true);
  });

  it('returns job_already_terminal when job already completed', async () => {
    const jobId = 4567;
    globalThis.__pdfvOcrActiveJobs!.set(jobId, {
      jobId,
      controller: new AbortController(),
      pagesCompleted: 10,
      totalPages: 10,
      startedAt: Date.now(),
      terminal: 'completed',
    });
    const r = await handleOcrCancelJob({ jobId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('job_already_terminal');
  });
});
