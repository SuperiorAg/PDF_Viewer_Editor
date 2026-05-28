// Handler: export:listJobs (Phase 6, api-contracts.md §17.7)
//
// Lists rows from `export_jobs`. The bridge returns snake_case rows; this
// handler translates them to the renderer-facing camelCase `ExportJobRowDto`
// — including stripping `output_path` to `outputBasename` + `outputDirHint`
// per the boundary discipline (conventions §17.2).
//
// When Ravi's repo hasn't shipped yet (parallel-wave skew), returns an empty
// list — same Phase-5 precedent as ocr-list-jobs.

import { basename, dirname } from 'node:path';

import { z } from 'zod';

import { fail, ok } from '../../shared/result.js';
import type {
  ExportFormat,
  ExportJobRowDto,
  ExportJobStatus,
  ExportListJobsError,
  ExportListJobsRequest,
  ExportListJobsResponse,
} from '../contracts.js';

/** Raw row shape from the bridge — matches Ravi's SQLite snake_case schema. */
export interface ExportJobsBridgeRow {
  id: number;
  doc_hash: string;
  format: ExportFormat;
  quality_tier: 'text-only' | 'layout-preserving' | 'n/a';
  page_range_start: number;
  page_range_end: number;
  include_annotations: 0 | 1;
  dpi: number | null;
  jpeg_quality: number | null;
  multi_page_tiff: 0 | 1 | null;
  output_path: string;
  output_size_bytes: number | null;
  status: ExportJobStatus;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  pages_processed: number;
  paragraphs_extracted: number | null;
  tables_detected: number | null;
  images_embedded: number | null;
  error_message: string | null;
  created_at: number;
}

export interface ExportJobsListBridge {
  listAll(
    filters: {
      docHash?: string;
      format?: ExportFormat;
      status?: ExportJobStatus;
      since?: number;
      until?: number;
    },
    limit: number,
    offset: number,
  ): { items: unknown[]; total: number };
}

export interface ExportListJobsDeps {
  repo: ExportJobsListBridge | null;
}

function isImageFormat(f: ExportFormat): boolean {
  return f === 'png' || f === 'jpeg' || f === 'tiff';
}

function rowToDto(raw: unknown): ExportJobRowDto | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as ExportJobsBridgeRow;
  if (typeof r.id !== 'number') return null;
  const imageOptions: ExportJobRowDto['imageOptions'] = isImageFormat(r.format)
    ? {
        dpi: r.dpi ?? 0,
        jpegQuality: r.jpeg_quality,
        multiPageTiff: r.multi_page_tiff === null ? null : r.multi_page_tiff === 1,
      }
    : null;
  const contentStats: ExportJobRowDto['contentStats'] =
    r.status === 'completed' &&
    !isImageFormat(r.format) &&
    r.paragraphs_extracted !== null &&
    r.tables_detected !== null &&
    r.images_embedded !== null
      ? {
          paragraphsExtracted: r.paragraphs_extracted,
          tablesDetected: r.tables_detected,
          imagesEmbedded: r.images_embedded,
        }
      : null;
  // Output-path boundary strip — renderer NEVER sees absolute paths.
  const outputBasename = basename(r.output_path);
  const outputDirHint = basename(dirname(r.output_path));
  return {
    id: r.id,
    docHash: r.doc_hash,
    format: r.format,
    qualityTier: r.quality_tier,
    pageRange: { start: r.page_range_start, end: r.page_range_end },
    includeAnnotations: r.include_annotations === 1,
    imageOptions,
    outputBasename,
    outputDirHint,
    outputSizeBytes: r.output_size_bytes,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    durationMs: r.duration_ms,
    pagesProcessed: r.pages_processed,
    contentStats,
    errorMessage: r.error_message,
    createdAt: r.created_at,
  };
}

const requestSchema = z.object({
  filters: z
    .object({
      docHash: z.string().optional(),
      format: z.enum(['docx', 'xlsx', 'pptx', 'png', 'jpeg', 'tiff']).optional(),
      status: z.enum(['queued', 'running', 'completed', 'cancelled', 'failed']).optional(),
      since: z.number().int().nonnegative().optional(),
      until: z.number().int().nonnegative().optional(),
    })
    .optional(),
  limit: z.number().int().min(0).max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
});

export async function handleExportListJobs(
  req: unknown,
  deps: ExportListJobsDeps,
): Promise<ExportListJobsResponse> {
  const parsed = requestSchema.safeParse(req ?? {});
  if (!parsed.success) {
    return fail<ExportListJobsError>('invalid_payload', parsed.error.message);
  }
  const limit = parsed.data.limit ?? 100;
  const offset = parsed.data.offset ?? 0;
  if (!deps.repo) {
    return ok({ jobs: [], total: 0 });
  }
  const filters = parsed.data.filters ?? {};
  const result = deps.repo.listAll(
    {
      ...(filters.docHash !== undefined ? { docHash: filters.docHash } : {}),
      ...(filters.format !== undefined ? { format: filters.format } : {}),
      ...(filters.status !== undefined ? { status: filters.status } : {}),
      ...(filters.since !== undefined ? { since: filters.since } : {}),
      ...(filters.until !== undefined ? { until: filters.until } : {}),
    },
    limit,
    offset,
  );
  const jobs: ExportJobRowDto[] = [];
  for (const r of result.items) {
    const dto = rowToDto(r);
    if (dto) jobs.push(dto);
  }
  return ok({ jobs, total: result.total });
}

export type _UnusedReq = ExportListJobsRequest;
