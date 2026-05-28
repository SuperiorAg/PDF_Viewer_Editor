// Handler: export:toImages (Phase 6, api-contracts.md §17.4)

import { z } from 'zod';

import type { ExportJobSpec } from '../../main/export/types.js';
import { fail, ok } from '../../shared/result.js';
import type {
  ExportToImagesError,
  ExportToImagesRequest,
  ExportToImagesResponse,
} from '../contracts.js';

import { buildPerFormat, insertJobRow, preflight, runAndPersist } from './export-shared.js';
import type { ExportHandlerCommonDeps } from './export-shared.js';

const requestSchema = z
  .object({
    handle: z.number().int().positive(),
    pageRange: z
      .object({
        start: z.number().int().min(0),
        end: z.number().int().min(0),
      })
      .strict(),
    format: z.enum(['png', 'jpeg', 'tiff']),
    dpi: z.number().int().min(72).max(600),
    jpegQuality: z.number().min(0.1).max(1.0).optional(),
    multiPageTiff: z.boolean().optional(),
    includeAnnotations: z.boolean(),
    outputPath: z.string().min(1),
  })
  .strict();

export async function handleExportToImages(
  req: unknown,
  deps: ExportHandlerCommonDeps,
): Promise<ExportToImagesResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<ExportToImagesError>('invalid_payload', parsed.error.message);
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
    return fail<ExportToImagesError>(pre.error, pre.message);
  }

  // Conditional-spread per exactOptionalPropertyTypes (TS2379) — only emit
  // image-format-specific extras when the format actually carries them.
  const jobRowExtras: {
    dpi?: number;
    jpegQuality?: number;
    multiPageTiff?: boolean;
  } = { dpi: data.dpi };
  if (data.format === 'jpeg' && typeof data.jpegQuality === 'number') {
    jobRowExtras.jpegQuality = data.jpegQuality;
  }
  if (data.format === 'tiff') {
    jobRowExtras.multiPageTiff = data.multiPageTiff ?? false;
  }
  const jobId = insertJobRow(deps, {
    docHash: pre.docHash,
    format: data.format,
    qualityTier: 'n/a',
    pageRange: data.pageRange,
    includeAnnotations: data.includeAnnotations,
    outputPath: data.outputPath,
    ...jobRowExtras,
  });

  const perFormatExtras: {
    dpi: number;
    jpegQuality?: number;
    multiPageTiff?: boolean;
  } = { dpi: data.dpi };
  if (data.format === 'jpeg' && typeof data.jpegQuality === 'number') {
    perFormatExtras.jpegQuality = data.jpegQuality;
  }
  if (data.format === 'tiff') {
    perFormatExtras.multiPageTiff = data.multiPageTiff ?? false;
  }

  const spec: ExportJobSpec = {
    jobId,
    docHash: pre.docHash,
    sourceBytes: pre.bytes,
    pageCount: pre.pageCount,
    format: data.format,
    qualityTier: 'n/a',
    pageRange: data.pageRange,
    includeAnnotations: data.includeAnnotations,
    outputPath: data.outputPath,
    perFormat: buildPerFormat(data.format, perFormatExtras),
  };

  const r = await runAndPersist(jobId, spec, deps);
  if (!r.ok) {
    // Image-specific error mapping: extraction_failed → rasterize_failed;
    // writer_failed → encode_failed.
    const mappedError: ExportToImagesError =
      r.error === 'cancelled'
        ? 'cancelled'
        : r.error === 'output_path_collision'
          ? 'output_path_unwritable'
          : r.error === 'output_write_failed'
            ? 'output_write_failed'
            : r.error === 'extraction_failed'
              ? 'rasterize_failed'
              : 'encode_failed';
    return fail<ExportToImagesError>(mappedError, r.message);
  }
  return ok({
    jobId: r.value.jobId,
    summary: r.value.summary,
    outputPaths: r.value.outputPaths,
  });
}

export type _UnusedReq = ExportToImagesRequest;
