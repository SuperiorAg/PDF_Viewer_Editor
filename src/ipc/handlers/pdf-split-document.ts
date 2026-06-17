// Handler: pdf:splitDocument (Phase 7.5 Wave 2 — B10)
//
// Contract: docs/api-contracts.md §19.2.3.
// Engine:   src/main/pdf-ops/split-document.ts.
//
// Behavior:
//   1. zod-validate the request shape.
//   2. Resolve the source bytes via handle.
//   3. Resolve the destination directory via destinationDirectoryToken.
//      [OPEN: dialog:pickFolder helper does not exist as of Wave 2 — the
//       handler accepts the token via an injected resolver so the renderer
//       can wire it once Riley lands the folder dialog. For now, production
//       wiring in register.ts passes the literal token through as a
//       sanitized absolute path (the test suite injects a deterministic
//       resolver). Flagged in the Wave 2 handoff for Marcus.]
//   4. Call `splitDocument` to plan + serialize parts.
//   5. Write each part using filenamePattern (`{base}` + `{index}` tokens).
//   6. Return per-file paths + page ranges + bytesWritten.

import { z } from 'zod';

import {
  splitDocument,
  type SplitDocumentError as EngineErr,
  type SplitStrategy as EngineStrategy,
} from '../../main/pdf-ops/split-document.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfSplitDocumentError,
  PdfSplitDocumentResponse,
  PdfSplitDocumentValue,
} from '../contracts.js';

// ============================================================================
// Schemas
// ============================================================================

const strategySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('by-page-count'), pagesPerFile: z.number().int().positive() }),
  z.object({ kind: z.literal('by-file-count'), targetFileCount: z.number().int().positive() }),
  z.object({ kind: z.literal('by-bookmarks'), topLevelOnly: z.boolean() }),
]);

const requestSchema = z.object({
  handle: z.number().int().positive(),
  strategy: strategySchema,
  destinationDirectoryToken: z.string().min(1),
  filenamePattern: z.string().min(1),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfSplitDocumentDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  /** Resolve the directory token -> absolute sanitized directory path + base
   *  filename to seed `{base}`. Returns null on token miss / expired. */
  resolveDestinationDirectory: (
    token: string,
  ) => { directory: string; baseFilename: string } | null;
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Join directory + filename into an absolute path; production = path.join. */
  joinPath: (directory: string, filename: string) => string;
  splitEngine?: typeof splitDocument;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfSplitDocument(
  req: unknown,
  deps: PdfSplitDocumentDeps,
): Promise<PdfSplitDocumentResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfSplitDocumentError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfSplitDocumentError>('handle_not_found', `handle ${r.handle} is not registered`);
  }

  const destDir = deps.resolveDestinationDirectory(r.destinationDirectoryToken);
  if (!destDir) {
    return fail<PdfSplitDocumentError>(
      'token_expired',
      'destinationDirectoryToken is expired or unknown',
    );
  }

  const engine = deps.splitEngine ?? splitDocument;
  let engineRes;
  try {
    engineRes = await engine({
      pdfBytes: bytes,
      strategy: r.strategy as EngineStrategy,
    });
  } catch (e) {
    return fail<PdfSplitDocumentError>('engine_failed', safeMessage(e, 'split engine threw'));
  }
  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  const files: PdfSplitDocumentValue['files'] = [];
  for (let i = 0; i < engineRes.value.parts.length; i += 1) {
    const part = engineRes.value.parts[i]!;
    const filename = renderFilenamePattern(r.filenamePattern, destDir.baseFilename, i + 1);
    const absolute = deps.joinPath(destDir.directory, filename);
    try {
      await deps.writeFile(absolute, part.newBytes);
    } catch (e) {
      return fail<PdfSplitDocumentError>(
        'fs_write_failed',
        safeMessage(e, `could not write split part ${i + 1}`),
        { partIndex: i, path: absolute },
      );
    }
    files.push({
      path: absolute,
      bytesWritten: part.newBytes.byteLength,
      pageRange: part.pageRange,
    });
  }

  // Phase 7.5 Wave 3 carry-over (David, 2026-06-17): surface engine warnings
  // at the response top level so Riley's UI renders ONE banner instead of
  // per-part toasts.
  const v: PdfSplitDocumentValue = { files, warnings: engineRes.value.warnings };
  return ok(v);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Substitute the supported tokens in the filename pattern:
 *   `{base}`   -> the source's base name (without extension)
 *   `{index}`  -> 1-based part index, zero-padded to 3 digits
 *
 * Any other curly tokens are left verbatim (handler doesn't sanitize for
 * fs-illegal characters — that's the dialog's job; we accept whatever the
 * caller passed and let the underlying fs surface a write error).
 */
export function renderFilenamePattern(pattern: string, base: string, index: number): string {
  return pattern.replace(/\{base\}/g, base).replace(/\{index\}/g, String(index).padStart(3, '0'));
}

function mapEngineErr(
  engineErr: EngineErr,
  message: string,
  details?: Record<string, unknown>,
): PdfSplitDocumentResponse {
  switch (engineErr) {
    case 'invalid_strategy':
      return fail<PdfSplitDocumentError>('invalid_payload', message, details);
    case 'no_bookmarks_for_split':
      return fail<PdfSplitDocumentError>('no_bookmarks_for_split', message, details);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfSplitDocumentError>('engine_failed', message, details);
  }
}
