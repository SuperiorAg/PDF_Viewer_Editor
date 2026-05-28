// Handler: ocr:listJobs (Phase 5, api-contracts.md §16.6)
//
// Lists rows from `ocr_jobs` (for the audit / debugging panel — Phase 5.2
// candidate UI; ships in Phase 5 for contract completeness per api-contracts
// §16.6).

import { z } from 'zod';

import type {
  OcrJobBridgeStatus,
  OcrJobRowDto as BridgeOcrJobRowDto,
} from '../../main/db-bridge.js';
import { fail, ok } from '../../shared/result.js';
import type {
  OcrJobRowDto,
  OcrListJobsError,
  OcrListJobsRequest,
  OcrListJobsResponse,
  PreprocessOptions,
} from '../contracts.js';

// Bridge contract — consumes David's camelCase OcrJobRowDto (already
// translated from Ravi's snake_case row by the db-bridge adapter).

export interface OcrJobsListBridge {
  listAll(
    filters: { docHash?: string; status?: OcrJobBridgeStatus; since?: number; until?: number },
    limit: number,
    offset: number,
  ): { items: BridgeOcrJobRowDto[]; total: number };
}

export interface OcrListJobsDeps {
  repo: OcrJobsListBridge | null;
}

const requestSchema = z.object({
  filters: z
    .object({
      docHash: z.string().optional(),
      status: z
        .enum(['queued', 'running', 'completed', 'cancelled', 'failed', 'superseded_by_undo'])
        .optional(),
      since: z.number().int().nonnegative().optional(),
      until: z.number().int().nonnegative().optional(),
    })
    .optional(),
  limit: z.number().int().min(0).max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
});

function safeParsePreprocess(json: string): PreprocessOptions {
  try {
    const parsed = JSON.parse(json) as Partial<PreprocessOptions>;
    return {
      deskew: parsed.deskew === true,
      denoise: parsed.denoise === true,
      contrastBoost: parsed.contrastBoost === true,
    };
  } catch {
    return { deskew: false, denoise: false, contrastBoost: false };
  }
}

function rowToDto(r: BridgeOcrJobRowDto): OcrJobRowDto {
  return {
    id: r.id,
    docHash: r.docHash,
    pageRange: { start: r.pageRangeStart, end: r.pageRangeEnd },
    langs: r.langs.length > 0 ? r.langs.split('+') : [],
    preprocess: safeParsePreprocess(r.preprocessJson),
    status: r.status,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    meanConfidence: r.meanConfidence,
    totalWords: r.totalWords,
    errorMessage: r.errorMessage,
    invalidatedSignatures: r.invalidatedSignatures,
    createdAt: r.createdAt,
  };
}

export async function handleOcrListJobs(
  req: unknown,
  deps: OcrListJobsDeps,
): Promise<OcrListJobsResponse> {
  const parsed = requestSchema.safeParse(req ?? {});
  if (!parsed.success) {
    return fail<OcrListJobsError>('invalid_payload', parsed.error.message);
  }
  const limit = parsed.data.limit ?? 100;
  const offset = parsed.data.offset ?? 0;
  if (!deps.repo) {
    // Repo not yet wired (Ravi parallel-wave skew); return empty list.
    return ok({ jobs: [], total: 0 });
  }
  const filters = parsed.data.filters ?? {};
  const result = deps.repo.listAll(
    {
      ...(filters.docHash !== undefined ? { docHash: filters.docHash } : {}),
      ...(filters.status !== undefined ? { status: filters.status } : {}),
      ...(filters.since !== undefined ? { since: filters.since } : {}),
      ...(filters.until !== undefined ? { until: filters.until } : {}),
    },
    limit,
    offset,
  );
  return ok({
    jobs: result.items.map(rowToDto),
    total: result.total,
  });
}

export type _UnusedReq = OcrListJobsRequest;
