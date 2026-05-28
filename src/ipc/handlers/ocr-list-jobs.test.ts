// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { OcrJobRowDto } from '../../main/db-bridge.js';

import { handleOcrListJobs, type OcrJobsListBridge } from './ocr-list-jobs.js';

function makeRepo(items: OcrJobRowDto[]): OcrJobsListBridge {
  return {
    listAll() {
      return { items, total: items.length };
    },
  };
}

function mkRow(id: number, status: OcrJobRowDto['status']): OcrJobRowDto {
  return {
    id,
    docHash: 'h',
    pageRangeStart: 0,
    pageRangeEnd: 5,
    langs: 'eng+spa',
    preprocessJson: '{"deskew":true,"denoise":false,"contrastBoost":true}',
    status,
    startedAt: 1000,
    completedAt: status === 'completed' ? 2000 : null,
    meanConfidence: status === 'completed' ? 85 : null,
    totalWords: status === 'completed' ? 100 : null,
    errorMessage: status === 'failed' ? 'boom' : null,
    invalidatedSignatures: false,
    createdAt: 1000,
  };
}

describe('handleOcrListJobs (api-contracts.md §16.6)', () => {
  it('returns empty list when repo is null', async () => {
    const r = await handleOcrListJobs({}, { repo: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.jobs).toHaveLength(0);
      expect(r.value.total).toBe(0);
    }
  });

  it('rejects invalid_payload for malformed filters', async () => {
    const r = await handleOcrListJobs(
      { filters: { status: 'not-a-status' } },
      { repo: makeRepo([]) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('translates langs string → array and parses preprocess JSON', async () => {
    const r = await handleOcrListJobs({}, { repo: makeRepo([mkRow(1, 'completed')]) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.jobs[0]!.langs).toEqual(['eng', 'spa']);
      expect(r.value.jobs[0]!.preprocess).toEqual({
        deskew: true,
        denoise: false,
        contrastBoost: true,
      });
      expect(r.value.jobs[0]!.pageRange).toEqual({ start: 0, end: 5 });
    }
  });

  it('handles empty langs string as empty array', async () => {
    const row = mkRow(1, 'completed');
    row.langs = '';
    const r = await handleOcrListJobs({}, { repo: makeRepo([row]) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.jobs[0]!.langs).toEqual([]);
  });

  it('defaults limit + offset', async () => {
    const captured: { limit: number; offset: number }[] = [];
    const repo: OcrJobsListBridge = {
      listAll(_f, limit, offset) {
        captured.push({ limit, offset });
        return { items: [], total: 0 };
      },
    };
    await handleOcrListJobs({}, { repo });
    expect(captured[0]).toEqual({ limit: 100, offset: 0 });
  });

  it('clamps limit to 1000', async () => {
    const r = await handleOcrListJobs({ limit: 5000 }, { repo: makeRepo([]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });
});
