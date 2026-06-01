// Handler: pdf:combine (Wave-30 follow-up H-30.1, David 2026-06-01).
//
// Replaces the Phase-1 `not_implemented` stub at src/ipc/handlers/pdf-ops.ts.
// Reads each source (path or handle) → calls the pure combine engine →
// registers the output bytes in documentStore so the renderer can open it
// like any other PDF (handle-based reads via fs:readBytesByHandle).
//
// DI mirrors dialog-open-pdf.ts:
//   readFile, sanitizePath, getBytesByHandle, hasHandle, computeBufferHash,
//   combineEngine, registerHandle.
//
// Request shape (PdfCombineRequest):
//   sources: Array<
//     | { kind: 'handle'; handle: number; pageRange?: { start; end } }
//     | { kind: 'path'; path: string; pageRange?: { start; end } }
//   >;
//
// pageRange handling — Phase-1 (this engine) does NOT honor pageRange. The
// request type carries it forward as a near-term Riley enhancement (the
// modal needs per-source UI before pageRange becomes a real knob). The
// handler still validates the range so we never accept an obviously-invalid
// request, and surfaces 'invalid_page_range' if the renderer sends one.
// When Riley wires the UI, this handler will extend to honor it (subset the
// page indices passed to copyPages); the engine signature is already
// general enough to take a per-source page-index list.

import { z } from 'zod';

import type { combinePdfs } from '../../main/pdf-ops/combine.js';
import type { DocumentRecord } from '../../main/pdf-ops/document-store.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  FileHash,
  PdfCombineError,
  PdfCombineRequest,
  PdfCombineResponse,
  PdfCombineValue,
} from '../contracts.js';

// Inline zod schemas — keep the request boundary typed AND validated so
// malformed renderer payloads can never reach the engine.
const pageRangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

const handleSourceSchema = z.object({
  kind: z.literal('handle'),
  handle: z.number().int().positive(),
  pageRange: pageRangeSchema.optional(),
});

const pathSourceSchema = z.object({
  kind: z.literal('path'),
  path: z.string().min(1),
  pageRange: pageRangeSchema.optional(),
});

const requestSchema = z.object({
  sources: z.array(z.union([handleSourceSchema, pathSourceSchema])).min(1),
});

export interface PdfCombineDeps {
  readFile: (path: string) => Promise<Uint8Array>;
  sanitizePath: (raw: unknown) => string | null;
  /** Returns the original document bytes for a registered handle, or null. */
  getBytesByHandle: (handle: DocumentHandle) => Uint8Array | null;
  /** Compute SHA-256 hex over an in-memory buffer (no fs round trip). */
  computeBufferHash: (bytes: Uint8Array) => string;
  /** The pure engine — pass-through for test injection. */
  combineEngine: typeof combinePdfs;
  /** Mint a new DocumentHandle for the combined output. */
  registerHandle: (rec: Omit<DocumentRecord, 'handle' | 'openedAt'>) => DocumentRecord;
  /** Display name for the combined document. Default: "Combined.pdf". */
  getDisplayName?: () => string;
}

export async function handlePdfCombine(
  req: unknown,
  deps: PdfCombineDeps,
): Promise<PdfCombineResponse> {
  // ---- 1. Schema-level validation
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfCombineError>('invalid_source', parsed.error.message);
  }
  const { sources } = parsed.data as PdfCombineRequest;
  if (sources.length < 2) {
    return fail<PdfCombineError>('invalid_source', 'sources[] must have at least 2 entries');
  }

  // ---- 2. Per-source page-range invariant (range.end >= range.start)
  for (let i = 0; i < sources.length; i += 1) {
    const r = sources[i]!.pageRange;
    if (r && r.end < r.start) {
      return fail<PdfCombineError>(
        'invalid_page_range',
        `Source ${i}: pageRange.end must be >= start`,
        { sourceIndex: i },
      );
    }
  }

  // ---- 3. Read each source into a Uint8Array (paths sanitized + read; handles
  //          resolved via documentStore lookup).
  const inputBytes: Uint8Array[] = [];
  for (let i = 0; i < sources.length; i += 1) {
    const s = sources[i]!;
    if (s.kind === 'handle') {
      const bytes = deps.getBytesByHandle(s.handle);
      if (!bytes) {
        return fail<PdfCombineError>(
          'handle_not_found',
          `Source ${i}: handle ${s.handle} is not registered`,
          { sourceIndex: i, handle: s.handle },
        );
      }
      inputBytes.push(bytes);
      continue;
    }

    // kind: 'path'
    const safe = deps.sanitizePath(s.path);
    if (safe === null) {
      return fail<PdfCombineError>('path_rejected', `Source ${i}: path failed sanitization`, {
        sourceIndex: i,
      });
    }
    try {
      const bytes = await deps.readFile(safe);
      inputBytes.push(bytes);
    } catch (e) {
      return fail<PdfCombineError>(
        'fs_read_failed',
        safeMessage(e, `Source ${i}: could not read file`),
        { sourceIndex: i },
      );
    }
  }

  // ---- 4. Call the engine.
  const engineRes = await deps.combineEngine(inputBytes);
  if (!engineRes.ok) {
    // Engine variants are a strict subset of PdfCombineError + 'pdf_load_failed'.
    // Map combine_invalid_source -> pdf_load_failed if we can be confident the
    // bytes were ours (post-readFile), but in practice combine_invalid_source
    // already carries the sourceIndex which is the actionable info. Keep as-is.
    const passThrough: ReadonlySet<string> = new Set([
      'combine_no_inputs',
      'combine_invalid_source',
      'combine_output_too_large',
    ]);
    if (passThrough.has(engineRes.error)) {
      return fail<PdfCombineError>(
        engineRes.error as PdfCombineError,
        engineRes.message,
        engineRes.details,
      );
    }
    // Defensive fallback (engine union narrowed above — unreachable today).
    return fail<PdfCombineError>('pdf_load_failed', engineRes.message);
  }

  // ---- 5. Register the combined output in documentStore.
  const fileHash: FileHash = deps.computeBufferHash(engineRes.value.bytes);
  const displayName = deps.getDisplayName ? deps.getDisplayName() : 'Combined.pdf';
  const rec = deps.registerHandle({
    path: null, // in-memory only until Save-As
    displayName,
    fileHash,
    bytes: engineRes.value.bytes,
    pageCount: engineRes.value.pageCount,
    pdflibLoadWarnings: engineRes.value.warnings,
  });

  const value: PdfCombineValue = {
    handle: rec.handle,
    pageCount: engineRes.value.pageCount,
    displayName,
    fileHash,
    warnings: engineRes.value.warnings,
  };
  return ok(value);
}
