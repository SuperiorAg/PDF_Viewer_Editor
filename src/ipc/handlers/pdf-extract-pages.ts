// Handler: pdf:extractPages (Phase 7.5 Wave 2 — B10)
//
// Contract: docs/api-contracts.md §19.2.2.
// Engine:   src/main/pdf-ops/extract-pages.ts.
//
// Behavior:
//   1. zod-validate the request shape.
//   2. Consume the destinationToken issued by `dialog:saveAs`.
//   3. Resolve the source bytes via handle.
//   4. Call `extractPages` to build the output bytes.
//   5. Write the output bytes to the token-resolved absolute path.
//   6. Return bytesWritten + outputFileHash.

import { z } from 'zod';

import {
  extractPages,
  type ExtractPagesError as EngineErr,
  type ExtractPagesOptions,
} from '../../main/pdf-ops/extract-pages.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfExtractPagesError,
  PdfExtractPagesResponse,
  PdfExtractPagesValue,
} from '../contracts.js';

// ============================================================================
// Schemas
// ============================================================================

const rangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

const pagesSchema = z.union([rangeSchema, z.array(z.number().int().nonnegative()).min(1)]);

const requestSchema = z.object({
  handle: z.number().int().positive(),
  pages: pagesSchema,
  destinationToken: z.string().min(1),
  includeBookmarks: z.boolean().optional(),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfExtractPagesDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  consumeDestinationToken: (
    token: string,
  ) => { token: string; path: string; displayName: string } | null;
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  computeBufferHash: (bytes: Uint8Array) => string;
  extractEngine?: typeof extractPages;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfExtractPages(
  req: unknown,
  deps: PdfExtractPagesDeps,
): Promise<PdfExtractPagesResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfExtractPagesError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfExtractPagesError>('handle_not_found', `handle ${r.handle} is not registered`);
  }

  const dest = deps.consumeDestinationToken(r.destinationToken);
  if (!dest) {
    return fail<PdfExtractPagesError>('token_expired', 'destinationToken is expired or unknown');
  }

  const engine = deps.extractEngine ?? extractPages;
  let engineRes;
  try {
    const opts: ExtractPagesOptions = {
      pdfBytes: bytes,
      pages: Array.isArray(r.pages)
        ? { kind: 'list', indices: r.pages }
        : { kind: 'range', start: r.pages.start, end: r.pages.end },
      ...(r.includeBookmarks !== undefined ? { includeBookmarks: r.includeBookmarks } : {}),
    };
    engineRes = await engine(opts);
  } catch (e) {
    return fail<PdfExtractPagesError>('engine_failed', safeMessage(e, 'extract engine threw'));
  }
  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  try {
    await deps.writeFile(dest.path, engineRes.value.bytes);
  } catch (e) {
    return fail<PdfExtractPagesError>(
      'fs_write_failed',
      safeMessage(e, 'could not write extracted PDF to disk'),
    );
  }

  const v: PdfExtractPagesValue = {
    bytesWritten: engineRes.value.bytes.byteLength,
    outputFileHash: deps.computeBufferHash(engineRes.value.bytes),
  };
  return ok(v);
}

// ============================================================================
// Helpers
// ============================================================================

function mapEngineErr(
  engineErr: EngineErr,
  message: string,
  details?: Record<string, unknown>,
): PdfExtractPagesResponse {
  switch (engineErr) {
    case 'invalid_page_range':
    case 'no_pages_in_range':
      return fail<PdfExtractPagesError>('invalid_payload', message, details);
    case 'page_out_of_range':
      return fail<PdfExtractPagesError>('page_out_of_range', message, details);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfExtractPagesError>('engine_failed', message, details);
  }
}
