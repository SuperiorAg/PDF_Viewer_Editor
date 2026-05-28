// Handler: ocr:runOnPage (Phase 5, api-contracts.md §16.2)
//
// Single-page OCR. Short-running (≤30s typical); no progress events.
//
// DISCIPLINE (conventions §16):
//   - zod safeParse at the boundary
//   - PAdES pre-flight via detectPriorPadesSignatures (§16.5) — non-skippable
//   - Engine pool is REQUIRED in deps (no fallback) per §16.3.1
//   - Returns `Result<T,E>`; never throws across the IPC bridge

import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';

import type { LanguagePackManager } from '../../main/pdf-ops/language-pack-manager.js';
import {
  runOcrOnPage,
  type OcrWorkerPool,
  type RasterPageOptions,
} from '../../main/pdf-ops/ocr-engine.js';
import { detectPriorPadesSignatures } from '../../main/pdf-ops/pades-detect.js';
import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  OcrRunOnPageError,
  OcrRunOnPageRequest,
  OcrRunOnPageResponse,
} from '../contracts.js';

export interface OcrRunOnPageDeps {
  /** REQUIRED — no optional fallback (conventions §16.3.1). */
  ocrPool: OcrWorkerPool;
  /** REQUIRED. */
  languagePackManager: LanguagePackManager;
  /** REQUIRED — engine raster source. */
  rasterizePage: (opts: RasterPageOptions) => Promise<Uint8Array>;
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  getPageCount: (handle: DocumentHandle) => number | null;
  pageDimensions: (
    handle: DocumentHandle,
    pageIndex: number,
  ) => Promise<{ widthPts: number; heightPts: number }>;
  /** Watchdog cap. Defaults provided by register.ts wiring. */
  watchdogMs: number;
  /** DPI for rasterization. Defaults provided by register.ts wiring. */
  rasterDpi: number;
}

const requestSchema = z.object({
  handle: z.number().int().positive(),
  pageIndex: z.number().int().min(0),
  langs: z.array(z.string().regex(/^[a-z]{3}(_[a-z]+)?$/i)).min(1),
  preprocess: z
    .object({
      deskew: z.boolean(),
      denoise: z.boolean(),
      contrastBoost: z.boolean(),
    })
    .strict(),
  invalidatesSignaturesConfirmed: z.boolean().optional(),
});

export async function handleOcrRunOnPage(
  req: unknown,
  deps: OcrRunOnPageDeps,
): Promise<OcrRunOnPageResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<OcrRunOnPageError>('invalid_payload', parsed.error.message);
  }
  const data = parsed.data;

  const bytes = deps.getBytes(data.handle);
  if (!bytes) {
    return fail<OcrRunOnPageError>('handle_not_found', `handle ${data.handle} not found`);
  }
  const pageCount = deps.getPageCount(data.handle);
  if (pageCount === null) {
    return fail<OcrRunOnPageError>('handle_not_found', `handle ${data.handle} pageCount unknown`);
  }
  if (data.pageIndex >= pageCount) {
    return fail<OcrRunOnPageError>(
      'page_out_of_range',
      `pageIndex ${data.pageIndex} >= pageCount ${pageCount}`,
    );
  }

  // Resolve every lang to ensure packs are installed.
  for (const l of data.langs) {
    if (deps.languagePackManager.resolve(l) === null) {
      return fail<OcrRunOnPageError>(
        'language_pack_not_installed',
        `language pack not installed: ${l}`,
      );
    }
  }

  // PAdES pre-flight — non-skippable (conventions §16.5).
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    return fail<OcrRunOnPageError>(
      'pdf_render_failed',
      `pdf-lib load threw: ${(e as Error).name ?? 'unknown'}`,
    );
  }
  const signedFields = detectPriorPadesSignatures(doc);
  if (signedFields.length > 0 && !data.invalidatesSignaturesConfirmed) {
    return fail<OcrRunOnPageError>(
      'signed_pdf_requires_confirm',
      `doc has ${signedFields.length} prior PAdES signature(s); confirm required`,
      { fields: signedFields },
    );
  }

  // Rasterize.
  const langKey = data.langs.join('+');
  const signal = new AbortController().signal; // no cancel on single-page path
  let rasterBytes: Uint8Array;
  try {
    rasterBytes = await deps.rasterizePage({
      handle: data.handle,
      pageIndex: data.pageIndex,
      dpi: deps.rasterDpi,
      signal,
    });
  } catch (e) {
    return fail<OcrRunOnPageError>(
      'pdf_render_failed',
      `rasterize failed: ${(e as Error).name ?? 'unknown'}`,
    );
  }
  const pageDims = await deps.pageDimensions(data.handle, data.pageIndex);
  const startedAt = Date.now();
  const result = await runOcrOnPage({
    pool: deps.ocrPool,
    lang: langKey,
    rasterBytes,
    preprocess: data.preprocess,
    watchdogMs: deps.watchdogMs,
    signal,
    pageDimsPts: pageDims,
    pageIndex: data.pageIndex,
  });
  if (!result.ok) {
    // Map engine errors to handler error union.
    if (result.error === 'language_pack_not_installed') {
      return fail<OcrRunOnPageError>('language_pack_not_installed', result.message);
    }
    if (result.error === 'worker_watchdog_timeout') {
      return fail<OcrRunOnPageError>('worker_watchdog_timeout', result.message);
    }
    if (result.error === 'cancelled') {
      return fail<OcrRunOnPageError>('ocr_engine_failed', result.message);
    }
    return fail<OcrRunOnPageError>('ocr_engine_failed', result.message);
  }
  return ok({
    pageResult: result.value,
    durationMs: Date.now() - startedAt,
  });
}

// Keep alias alive under verbatimModuleSyntax.
export type _UnusedReq = OcrRunOnPageRequest;
