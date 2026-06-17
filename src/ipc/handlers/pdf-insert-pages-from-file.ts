// Handler: pdf:insertPagesFromFile (Phase 7.5 Wave 2 — B11)
//
// Contract: docs/api-contracts.md §19.2.5.
// Engine:   src/main/pdf-ops/insert-pages.ts.
//
// Behavior:
//   1. zod-validate the request shape.
//   2. Resolve target bytes via handle, source bytes via sanitized path read.
//   3. Translate the contract's `sourcePages: 'all' | { start; end } | number[]`
//      into the engine's discriminated union.
//   4. Call `insertPagesFromFile`.
//   5. Replace the document-store bytes on success.

import { z } from 'zod';

import {
  insertPagesFromFile,
  type InsertPagesFromFileOptions,
  type InsertPagesFromFileError as EngineErr,
} from '../../main/pdf-ops/insert-pages.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfInsertPagesFromFileError,
  PdfInsertPagesFromFileResponse,
  PdfInsertPagesFromFileValue,
} from '../contracts.js';

// ============================================================================
// Schemas
// ============================================================================

const rangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

const sourcePagesSchema = z.union([
  z.literal('all'),
  rangeSchema,
  z.array(z.number().int().nonnegative()).min(1),
]);

const requestSchema = z.object({
  handle: z.number().int().positive(),
  sourcePath: z.string().min(1),
  sourcePages: sourcePagesSchema,
  insertAfterPageIndex: z.number().int().min(-1),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfInsertPagesFromFileDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  readFile: (path: string) => Promise<Uint8Array>;
  sanitizePath: (raw: unknown) => string | null;
  insertEngine?: typeof insertPagesFromFile;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfInsertPagesFromFile(
  req: unknown,
  deps: PdfInsertPagesFromFileDeps,
): Promise<PdfInsertPagesFromFileResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfInsertPagesFromFileError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const targetBytes = deps.getBytes(r.handle);
  if (!targetBytes) {
    return fail<PdfInsertPagesFromFileError>(
      'handle_not_found',
      `handle ${r.handle} is not registered`,
    );
  }

  const safe = deps.sanitizePath(r.sourcePath);
  if (!safe) {
    return fail<PdfInsertPagesFromFileError>(
      'source_invalid_pdf',
      'sourcePath failed sanitization',
    );
  }

  let sourceBytes: Uint8Array;
  try {
    sourceBytes = await deps.readFile(safe);
  } catch (e) {
    return fail<PdfInsertPagesFromFileError>(
      'source_invalid_pdf',
      safeMessage(e, 'could not read source file'),
    );
  }

  const engine = deps.insertEngine ?? insertPagesFromFile;
  let engineRes;
  try {
    const opts: InsertPagesFromFileOptions = {
      targetBytes,
      sourceBytes,
      sourcePages: toEngineScope(r.sourcePages),
      insertAfterPageIndex: r.insertAfterPageIndex,
    };
    engineRes = await engine(opts);
  } catch (e) {
    return fail<PdfInsertPagesFromFileError>(
      'engine_failed',
      safeMessage(e, 'insert engine threw'),
    );
  }
  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  deps.setBytes(r.handle, engineRes.value.bytes);
  const v: PdfInsertPagesFromFileValue = {
    pagesInserted: engineRes.value.pagesInserted,
    newPageCount: engineRes.value.newPageCount,
  };
  return ok(v);
}

// ============================================================================
// Helpers
// ============================================================================

function toEngineScope(
  pages: z.infer<typeof sourcePagesSchema>,
): InsertPagesFromFileOptions['sourcePages'] {
  if (pages === 'all') return { kind: 'all' };
  if (Array.isArray(pages)) return { kind: 'list', indices: pages };
  return { kind: 'range', start: pages.start, end: pages.end };
}

function mapEngineErr(
  engineErr: EngineErr,
  message: string,
  details?: Record<string, unknown>,
): PdfInsertPagesFromFileResponse {
  switch (engineErr) {
    case 'invalid_insertion_index':
    case 'invalid_page_range':
    case 'no_source_pages_in_scope':
      return fail<PdfInsertPagesFromFileError>('invalid_payload', message, details);
    case 'source_page_out_of_range':
      return fail<PdfInsertPagesFromFileError>('source_page_out_of_range', message, details);
    case 'target_load_failed':
      return fail<PdfInsertPagesFromFileError>('engine_failed', message, details);
    case 'source_load_failed':
      return fail<PdfInsertPagesFromFileError>('source_invalid_pdf', message, details);
    case 'engine_failed':
    default:
      return fail<PdfInsertPagesFromFileError>('engine_failed', message, details);
  }
}
