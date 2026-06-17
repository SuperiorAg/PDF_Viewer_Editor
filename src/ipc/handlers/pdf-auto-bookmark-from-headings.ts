// Handler: pdf:autoBookmarkFromHeadings (Phase 7.5 Wave 4 — B19)
//
// Contract: docs/api-contracts.md §19.14.1.
// Engine:   src/main/pdf-ops/auto-bookmark-engine.ts.
//
// Design notes:
//   The engine is pure (no pdf.js dep — L-004/L-005). This handler bridges
//   `documentStore.getBytes(handle)` → engine, and supplies the production
//   text extractor + pageCount discovery via INJECTED dependencies. The
//   injection seam means:
//     - Tests pass a synthetic extractor + pageCount source (see tests).
//     - Production (`register.ts`) wires `loadPdfMetadata` for pageCount and
//       a lazy pdf.js getTextContent walker for items.
//   This isolates the load-bearing pdf.js polyfill ordering inside the
//   production wiring point AND keeps the engine + handler unit-testable
//   without spinning up pdf.js in the test runner.

import { z } from 'zod';

import {
  autoBookmarkFromHeadings,
  type AutoBookmarkError as EngineErr,
  type AutoBookmarkOptions,
  type PageTextItem,
} from '../../main/pdf-ops/auto-bookmark-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfAutoBookmarkFromHeadingsError,
  PdfAutoBookmarkFromHeadingsResponse,
  PdfAutoBookmarkFromHeadingsValue,
  ProposedBookmark,
} from '../contracts.js';

// ============================================================================
// Schema
// ============================================================================

const requestSchema = z.object({
  handle: z.number().int().positive(),
  heuristic: z.literal('font-size-cluster'),
  maxDepth: z.number().int().min(1).max(6),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfAutoBookmarkFromHeadingsDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  /** Returns the page count of the document referenced by the bytes. */
  getPageCount: (bytes: Uint8Array) => Promise<number>;
  /** Per-page reading-order text extractor. Production wires a pdf.js walker
   *  in `register.ts`; tests pass a synthetic. */
  extractPageTextItems: (bytes: Uint8Array, pageIndex: number) => Promise<PageTextItem[]>;
  autoBookmarkEngine?: typeof autoBookmarkFromHeadings;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfAutoBookmarkFromHeadings(
  req: unknown,
  deps: PdfAutoBookmarkFromHeadingsDeps,
): Promise<PdfAutoBookmarkFromHeadingsResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfAutoBookmarkFromHeadingsError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfAutoBookmarkFromHeadingsError>(
      'handle_not_found',
      `handle ${r.handle} is not registered`,
    );
  }

  let pageCount: number;
  try {
    pageCount = await deps.getPageCount(bytes);
  } catch (e) {
    return fail<PdfAutoBookmarkFromHeadingsError>(
      'engine_failed',
      safeMessage(e, 'getPageCount threw'),
    );
  }

  const engine = deps.autoBookmarkEngine ?? autoBookmarkFromHeadings;
  let engineRes;
  try {
    const opts: AutoBookmarkOptions = {
      pdfBytes: bytes,
      maxDepth: r.maxDepth,
      pageCount,
      extractPageTextItems: deps.extractPageTextItems,
    };
    engineRes = await engine(opts);
  } catch (e) {
    return fail<PdfAutoBookmarkFromHeadingsError>(
      'engine_failed',
      safeMessage(e, 'auto-bookmark engine threw'),
    );
  }

  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  // Strip any non-contract fields from the engine's bookmark items in case the
  // engine extends ProposedBookmark in a later wave.
  const proposed: ProposedBookmark[] = engineRes.value.proposed.map((b) => ({
    title: b.title,
    pageIndex: b.pageIndex,
    depth: b.depth,
  }));

  const v: PdfAutoBookmarkFromHeadingsValue = {
    proposed,
    warnings: engineRes.value.warnings,
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
): PdfAutoBookmarkFromHeadingsResponse {
  switch (engineErr) {
    case 'invalid_payload':
      return fail<PdfAutoBookmarkFromHeadingsError>('invalid_payload', message, details);
    case 'no_headings_detected':
      return fail<PdfAutoBookmarkFromHeadingsError>('no_headings_detected', message, details);
    case 'engine_failed':
    default:
      return fail<PdfAutoBookmarkFromHeadingsError>('engine_failed', message, details);
  }
}
