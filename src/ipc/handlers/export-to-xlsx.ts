// Handler: export:toXlsx (Phase 6, api-contracts.md §17.2)

import { z } from 'zod';

import type { ExportJobSpec } from '../../main/export/types.js';
import { fail, ok } from '../../shared/result.js';
import type { ExportToXlsxError, ExportToXlsxRequest, ExportToXlsxResponse } from '../contracts.js';

import { buildPerFormat, insertJobRow, preflight, runAndPersist } from './export-shared.js';
import type { ExportHandlerCommonDeps } from './export-shared.js';

const requestSchema = z.object({
  handle: z.number().int().positive(),
  pageRange: z
    .object({
      start: z.number().int().min(0),
      end: z.number().int().min(0),
    })
    .strict(),
  qualityTier: z.enum(['text-only', 'layout-preserving']),
  includeAnnotations: z.boolean(),
  outputPath: z.string().min(1),
});

export async function handleExportToXlsx(
  req: unknown,
  deps: ExportHandlerCommonDeps,
): Promise<ExportToXlsxResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<ExportToXlsxError>('invalid_payload', parsed.error.message);
  }
  const data = parsed.data;

  const pre = await preflight(
    {
      handle: data.handle,
      pageRange: data.pageRange,
      outputPath: data.outputPath,
    },
    deps,
  );
  if (!pre.ok) {
    return fail<ExportToXlsxError>(pre.error, pre.message);
  }

  const jobId = insertJobRow(deps, {
    docHash: pre.docHash,
    format: 'xlsx',
    qualityTier: data.qualityTier,
    pageRange: data.pageRange,
    includeAnnotations: data.includeAnnotations,
    outputPath: data.outputPath,
  });

  const spec: ExportJobSpec = {
    jobId,
    docHash: pre.docHash,
    sourceBytes: pre.bytes,
    pageCount: pre.pageCount,
    format: 'xlsx',
    qualityTier: data.qualityTier,
    pageRange: data.pageRange,
    includeAnnotations: data.includeAnnotations,
    outputPath: data.outputPath,
    perFormat: buildPerFormat('xlsx', {}),
  };

  const r = await runAndPersist(jobId, spec, deps);
  if (!r.ok) {
    const mappedError: ExportToXlsxError =
      r.error === 'cancelled'
        ? 'cancelled'
        : r.error === 'output_path_collision'
          ? 'output_path_unwritable'
          : r.error === 'output_write_failed'
            ? 'output_write_failed'
            : r.error === 'extraction_failed'
              ? 'extraction_failed'
              : 'writer_failed';
    return fail<ExportToXlsxError>(mappedError, r.message);
  }
  return ok({ jobId: r.value.jobId, summary: r.value.summary });
}

export type _UnusedReq = ExportToXlsxRequest;
