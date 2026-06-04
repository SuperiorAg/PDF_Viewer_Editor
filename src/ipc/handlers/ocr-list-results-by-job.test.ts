// @vitest-environment node
//
// Tests for `ocr:listResultsByJob` (Phase 5.2 — Marcus, 2026-06-04).
//
// Validates: payload schema, the job-existence check, repo-null degradation,
// and pass-through of the bridge's parse-and-assemble output.

import { describe, expect, it } from 'vitest';

import type { OcrJobsRepoBridge, OcrResultsRepoBridge } from '../../main/db-bridge.js';
import type { OcrPageResult } from '../contracts.js';

import { handleOcrListResultsByJob } from './ocr-list-results-by-job.js';

function makeJobsRepo(opts: { existsForId?: number } = {}): OcrJobsRepoBridge {
  return {
    insert: () => 1,
    updateStatus: () => true,
    get: (id: number) =>
      id === opts.existsForId
        ? {
            id,
            docHash: 'h',
            pageRangeStart: 0,
            pageRangeEnd: 0,
            langs: 'eng',
            preprocessJson: '{"deskew":false,"denoise":false,"contrastBoost":false}',
            status: 'completed',
            startedAt: 0,
            completedAt: 1,
            meanConfidence: 90,
            totalWords: 10,
            errorMessage: null,
            invalidatedSignatures: false,
            createdAt: 0,
          }
        : null,
    listAll: () => ({ items: [], total: 0 }),
    delete: () => true,
  };
}

function makeResultsRepo(pageResults: OcrPageResult[]): OcrResultsRepoBridge {
  return {
    insert: () => 1,
    listByJobId: () => [],
    listPageResultsByJobId: (_jobId: number) => pageResults,
  };
}

const SAMPLE_PAGE_RESULT: OcrPageResult = {
  pageIndex: 0,
  imgDimsPx: { widthPx: 1700, heightPx: 2200 },
  totalWords: 1,
  lowConfidenceWords: 0,
  meanConfidence: 95,
  words: [
    {
      text: 'hello',
      confidence: 95,
      imgRect: { x0: 10, y0: 10, x1: 50, y1: 30 },
      pdfRect: { x: 10, y: 760, width: 40, height: 20 },
    },
  ],
  durationMs: 100,
};

describe('handleOcrListResultsByJob (Phase 5.2)', () => {
  it('rejects invalid_payload when jobId is missing', async () => {
    const r = await handleOcrListResultsByJob(
      {},
      { jobsRepo: makeJobsRepo({ existsForId: 1 }), resultsRepo: makeResultsRepo([]) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects invalid_payload when jobId is zero or negative', async () => {
    const r1 = await handleOcrListResultsByJob(
      { jobId: 0 },
      { jobsRepo: makeJobsRepo(), resultsRepo: makeResultsRepo([]) },
    );
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toBe('invalid_payload');

    const r2 = await handleOcrListResultsByJob(
      { jobId: -1 },
      { jobsRepo: makeJobsRepo(), resultsRepo: makeResultsRepo([]) },
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe('invalid_payload');
  });

  it('returns job_not_found when the jobs repo has no matching row', async () => {
    const r = await handleOcrListResultsByJob(
      { jobId: 42 },
      {
        jobsRepo: makeJobsRepo({ existsForId: 7 }),
        resultsRepo: makeResultsRepo([SAMPLE_PAGE_RESULT]),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('job_not_found');
  });

  it('returns pageResults from the bridge when job exists', async () => {
    const r = await handleOcrListResultsByJob(
      { jobId: 7 },
      {
        jobsRepo: makeJobsRepo({ existsForId: 7 }),
        resultsRepo: makeResultsRepo([SAMPLE_PAGE_RESULT]),
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pageResults).toHaveLength(1);
      expect(r.value.pageResults[0]!.pageIndex).toBe(0);
      expect(r.value.pageResults[0]!.words[0]!.text).toBe('hello');
    }
  });

  it('degrades to empty pageResults when resultsRepo is null', async () => {
    const r = await handleOcrListResultsByJob(
      { jobId: 7 },
      { jobsRepo: makeJobsRepo({ existsForId: 7 }), resultsRepo: null },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pageResults).toEqual([]);
  });

  it('returns empty pageResults when results repo finds none (job-no-pages edge case)', async () => {
    const r = await handleOcrListResultsByJob(
      { jobId: 7 },
      { jobsRepo: makeJobsRepo({ existsForId: 7 }), resultsRepo: makeResultsRepo([]) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pageResults).toEqual([]);
  });

  it('skips the existence check when jobsRepo is null (test/early-boot bridge)', async () => {
    const r = await handleOcrListResultsByJob(
      { jobId: 7 },
      { jobsRepo: null, resultsRepo: makeResultsRepo([SAMPLE_PAGE_RESULT]) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pageResults).toHaveLength(1);
  });
});
