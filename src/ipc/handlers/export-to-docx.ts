// Handler: export:toDocx (Phase 6, api-contracts.md §17.1)
//
// DISCIPLINE (conventions §17.1-§17.6):
//   - zod safeParse at the boundary (qualityTier as enum, NEVER .optional())
//   - read-only on source — engine never mutates source bytes
//   - output bytes stay in main; renderer receives only `{ jobId, summary }`

import { z } from 'zod';

import type { ExportJobSpec } from '../../main/export/types.js';
import { fail, ok } from '../../shared/result.js';
import type { ExportToDocxError, ExportToDocxRequest, ExportToDocxResponse } from '../contracts.js';

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
  // Q-D discipline: enum, NOT optional. The renderer ALWAYS sends an explicit
  // tier — modal reads the per-format default from settings.
  qualityTier: z.enum(['text-only', 'layout-preserving']),
  includeAnnotations: z.boolean(),
  pageSize: z.enum(['letter', 'a4', 'auto']),
  outputPath: z.string().min(1),
});

export async function handleExportToDocx(
  req: unknown,
  deps: ExportHandlerCommonDeps,
): Promise<ExportToDocxResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<ExportToDocxError>('invalid_payload', parsed.error.message);
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
    return fail<ExportToDocxError>(pre.error, pre.message);
  }

  const jobId = insertJobRow(deps, {
    docHash: pre.docHash,
    format: 'docx',
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
    format: 'docx',
    qualityTier: data.qualityTier,
    pageRange: data.pageRange,
    includeAnnotations: data.includeAnnotations,
    outputPath: data.outputPath,
    perFormat: buildPerFormat('docx', { pageSize: data.pageSize }),
  };

  const r = await runAndPersist(jobId, spec, deps);
  if (!r.ok) {
    const mappedError: ExportToDocxError =
      r.error === 'cancelled'
        ? 'cancelled'
        : r.error === 'output_path_collision'
          ? 'output_path_unwritable'
          : r.error === 'output_write_failed'
            ? 'output_write_failed'
            : r.error === 'extraction_failed'
              ? 'extraction_failed'
              : 'writer_failed';
    return fail<ExportToDocxError>(mappedError, r.message);
  }
  return ok({ jobId: r.value.jobId, summary: r.value.summary });
}

// Keep alias alive.
export type _UnusedReq = ExportToDocxRequest;
