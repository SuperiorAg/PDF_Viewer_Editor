// Handler: ocr:runOnDocument (Phase 5, api-contracts.md §16.3)
//
// Long-running multi-page OCR. Emits ocr:progress events; cancellable via
// ocr:cancelJob. Returns the EditOperationSerialized + summary on completion.
//
// DISCIPLINE (conventions §16):
//   - zod safeParse at the boundary
//   - PAdES pre-flight via detectPriorPadesSignatures — non-skippable
//   - ocrPool REQUIRED (no fallback)
//   - PAdES invalidation flag flows through to the EditOperation
//   - Audit-log update on completion (when invalidating signatures)
//   - Job lifecycle persisted via ocr_jobs / ocr_results repos
//
// CANCELLATION (ocr-engine.md §7.3): graceful — the engine checks between
// pages, NOT mid-page. The handler exposes an AbortController via a module-
// scoped registry keyed by jobId; ocr-cancel-job.ts aborts it.

import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';

import type { LanguagePackManager } from '../../main/pdf-ops/language-pack-manager.js';
import {
  runOcrOnDocument,
  type OcrWorkerPool,
  type RasterPageOptions,
} from '../../main/pdf-ops/ocr-engine.js';
import { detectPriorPadesSignatures } from '../../main/pdf-ops/pades-detect.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  EditMeta,
  EditOperationSerialized,
  OcrJobSummary,
  OcrProgressEvent,
  OcrRunOnDocumentError,
  OcrRunOnDocumentRequest,
  OcrRunOnDocumentResponse,
} from '../contracts.js';

// ============================================================================
// Module-scoped job registry (cancellation handles)
//
// Per Conductor Playbook entry #3: stash on globalThis so test fixtures and
// duplicate module instances (custom-server Next.js apps in dev) share state.
// This project is Electron + Vite, single-runtime, but the discipline is
// cheap and consistent.
// ============================================================================

interface ActiveJob {
  jobId: number;
  controller: AbortController;
  pagesCompleted: number;
  totalPages: number;
  startedAt: number;
  terminal: 'completed' | 'cancelled' | 'failed' | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __pdfvOcrActiveJobs: Map<number, ActiveJob> | undefined;
}

const activeJobs: Map<number, ActiveJob> = globalThis.__pdfvOcrActiveJobs ?? new Map();
globalThis.__pdfvOcrActiveJobs = activeJobs;

export function getActiveJob(jobId: number): ActiveJob | null {
  return activeJobs.get(jobId) ?? null;
}

export function listActiveJobs(): ActiveJob[] {
  return Array.from(activeJobs.values());
}

// ============================================================================
// Bridge contract for the ocr_jobs / ocr_results / signature-audit repos
// ============================================================================

export interface OcrJobInsertInput {
  doc_hash: string;
  page_range_start: number;
  page_range_end: number;
  langs: string;
  preprocess_json: string;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  started_at: number;
  invalidated_signatures: 0 | 1;
}

export interface OcrJobUpdateInput {
  status: 'completed' | 'cancelled' | 'failed';
  completed_at?: number;
  mean_confidence?: number;
  total_words?: number;
  error_message?: string;
}

export interface OcrResultInsertInput {
  job_id: number;
  page_index: number;
  total_words: number;
  low_confidence_words: number;
  mean_confidence: number;
  words_json: string;
  img_width_px: number;
  img_height_px: number;
  duration_ms: number;
}

export interface OcrJobsRepoBridge {
  insert(row: OcrJobInsertInput): number;
  updateStatus(id: number, update: OcrJobUpdateInput): boolean;
}

export interface OcrResultsRepoBridge {
  insert(row: OcrResultInsertInput): number;
}

export interface SignatureAuditOcrInvalidationRepoBridge {
  /**
   * Mark every signature_audit_log row matching `docHash` whose `field_name`
   * is in `fieldNames` as invalidated by `ocrJobId`. Returns rows updated.
   */
  markInvalidatedByOcrJob(docHash: string, fieldNames: string[], ocrJobId: number): number;
}

// ============================================================================
// Handler deps
// ============================================================================

export interface OcrRunOnDocumentDeps {
  /** REQUIRED — no fallback. */
  ocrPool: OcrWorkerPool;
  languagePackManager: LanguagePackManager;
  rasterizePage: (opts: RasterPageOptions) => Promise<Uint8Array>;
  pageDimensions: (
    handle: DocumentHandle,
    pageIndex: number,
  ) => Promise<{ widthPts: number; heightPts: number }>;
  composeSearchablePdf: (
    originalBytes: Uint8Array,
    pageResults: OcrJobSummary['pageResults'] extends infer T ? Exclude<T, null> : never,
  ) => Promise<Uint8Array>;
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  getPageCount: (handle: DocumentHandle) => number | null;
  getDocHash: (handle: DocumentHandle) => string | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  /** Job-table repo bridge. Null if Ravi's repos not yet wired. */
  ocrJobsRepo: OcrJobsRepoBridge | null;
  /** Per-page results repo bridge. Null if not yet wired. */
  ocrResultsRepo: OcrResultsRepoBridge | null;
  /** Signature audit log bridge for PAdES invalidation backref. */
  signatureAudit: SignatureAuditOcrInvalidationRepoBridge | null;
  watchdogMs: number;
  rasterDpi: number;
  emitProgress: (event: OcrProgressEvent) => void;
  now?: () => number;
}

// ============================================================================
// Payload schema
// ============================================================================

const requestSchema = z.object({
  handle: z.number().int().positive(),
  pageRange: z
    .object({
      start: z.number().int().min(0),
      end: z.number().int().min(0),
    })
    .strict(),
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

// ============================================================================
// Handler
// ============================================================================

export async function handleOcrRunOnDocument(
  req: unknown,
  deps: OcrRunOnDocumentDeps,
): Promise<OcrRunOnDocumentResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<OcrRunOnDocumentError>('invalid_payload', parsed.error.message);
  }
  const data = parsed.data;
  const clock = deps.now ?? Date.now;

  if (data.pageRange.start > data.pageRange.end) {
    return fail<OcrRunOnDocumentError>(
      'page_range_out_of_range',
      `start ${data.pageRange.start} > end ${data.pageRange.end}`,
    );
  }

  const bytes = deps.getBytes(data.handle);
  if (!bytes) {
    return fail<OcrRunOnDocumentError>('handle_not_found', `handle ${data.handle} not found`);
  }
  const pageCount = deps.getPageCount(data.handle);
  if (pageCount === null) {
    return fail<OcrRunOnDocumentError>('handle_not_found', `pageCount unknown`);
  }
  if (data.pageRange.end >= pageCount) {
    return fail<OcrRunOnDocumentError>(
      'page_range_out_of_range',
      `end ${data.pageRange.end} >= pageCount ${pageCount}`,
    );
  }

  // Lang-pack pre-flight.
  for (const l of data.langs) {
    if (deps.languagePackManager.resolve(l) === null) {
      return fail<OcrRunOnDocumentError>(
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
    return fail<OcrRunOnDocumentError>(
      'ocr_engine_failed',
      `pdf-lib load threw: ${safeMessage(e, 'unknown error')}`,
    );
  }
  const signedFields = detectPriorPadesSignatures(doc);
  if (signedFields.length > 0 && !data.invalidatesSignaturesConfirmed) {
    return fail<OcrRunOnDocumentError>(
      'signed_pdf_requires_confirm',
      `doc has ${signedFields.length} prior PAdES signature(s); confirm required`,
      { fields: signedFields },
    );
  }
  const invalidatesSignatures = signedFields.length > 0;

  // Insert ocr_jobs row (status=running). If repo is null (Ravi parallel),
  // assign a synthetic local jobId; the EditOperation jobId reference will
  // be NaN-safe even if Ravi's row doesn't exist yet (no FK in dev).
  const docHash = deps.getDocHash(data.handle) ?? '';
  let jobId: number;
  if (deps.ocrJobsRepo) {
    jobId = deps.ocrJobsRepo.insert({
      doc_hash: docHash,
      page_range_start: data.pageRange.start,
      page_range_end: data.pageRange.end,
      langs: data.langs.join('+'),
      preprocess_json: JSON.stringify(data.preprocess),
      status: 'running',
      started_at: clock(),
      invalidated_signatures: invalidatesSignatures ? 1 : 0,
    });
  } else {
    // Synthetic ID for dev parallel-wave; negative so a real FK would never
    // collide with a real ocr_jobs.id.
    jobId = -1 * clock();
  }

  const totalPages = data.pageRange.end - data.pageRange.start + 1;
  const controller = new AbortController();
  const job: ActiveJob = {
    jobId,
    controller,
    pagesCompleted: 0,
    totalPages,
    startedAt: clock(),
    terminal: null,
  };
  activeJobs.set(jobId, job);

  try {
    const engineRes = await runOcrOnDocument(
      {
        jobId,
        handle: data.handle,
        pageRange: data.pageRange,
        langs: data.langs,
        preprocess: data.preprocess,
        rasterDpi: deps.rasterDpi,
        watchdogMs: deps.watchdogMs,
        signal: controller.signal,
        originalBytes: bytes,
      },
      {
        pool: deps.ocrPool,
        languagePackManager: deps.languagePackManager,
        rasterizePage: deps.rasterizePage,
        pageDimensions: deps.pageDimensions,
        composeSearchablePdf: async (orig, results) => {
          // results is OcrPageResult[]; the dep accepts it via type-narrowing.
          return deps.composeSearchablePdf(
            orig,
            results as unknown as Exclude<OcrJobSummary['pageResults'], null>,
          );
        },
        emitProgress: (evt) => {
          if (evt.phase === 'rasterizing' || evt.phase === 'recognizing') {
            // Update pagesCompleted on every per-page phase transition.
            // We treat the 'rasterizing' boundary as the next page start.
          }
          if (evt.phase === 'composing-text-behind-image') {
            // The engine emits this right after recognize() resolves; treat
            // it as page-completion.
            job.pagesCompleted += 1;
          }
          deps.emitProgress(evt);
        },
        ...(deps.now !== undefined ? { now: deps.now } : {}),
      },
    );

    if (!engineRes.ok) {
      // Persist failure state.
      if (deps.ocrJobsRepo) {
        deps.ocrJobsRepo.updateStatus(jobId, {
          status: engineRes.error === 'cancelled' ? 'cancelled' : 'failed',
          completed_at: clock(),
          error_message: engineRes.message,
        });
      }
      job.terminal = engineRes.error === 'cancelled' ? 'cancelled' : 'failed';
      activeJobs.delete(jobId);
      if (engineRes.error === 'cancelled') {
        return fail<OcrRunOnDocumentError>('cancelled', engineRes.message);
      }
      return fail<OcrRunOnDocumentError>(
        engineRes.error === 'output_serialize_failed'
          ? 'output_serialize_failed'
          : engineRes.error === 'language_pack_not_installed'
            ? 'language_pack_not_installed'
            : 'ocr_engine_failed',
        engineRes.message,
      );
    }

    // Persist completion state.
    if (deps.ocrJobsRepo) {
      deps.ocrJobsRepo.updateStatus(jobId, {
        status: 'completed',
        completed_at: clock(),
        mean_confidence: engineRes.value.summary.meanConfidence,
        total_words: engineRes.value.summary.totalWords,
      });
    }
    if (deps.ocrResultsRepo && engineRes.value.summary.pageResults !== null) {
      for (const pr of engineRes.value.summary.pageResults) {
        deps.ocrResultsRepo.insert({
          job_id: jobId,
          page_index: pr.pageIndex,
          total_words: pr.totalWords,
          low_confidence_words: pr.lowConfidenceWords,
          mean_confidence: pr.meanConfidence,
          words_json: JSON.stringify(pr.words),
          img_width_px: pr.imgDimsPx.widthPx,
          img_height_px: pr.imgDimsPx.heightPx,
          duration_ms: pr.durationMs,
        });
      }
    }

    // Signature-audit invalidation backref (conventions §16.5).
    if (invalidatesSignatures && deps.signatureAudit) {
      try {
        deps.signatureAudit.markInvalidatedByOcrJob(docHash, signedFields, jobId);
      } catch {
        // Best-effort; do not fail the entire OCR run for an audit-log
        // hiccup. The job row's invalidated_signatures=1 is the primary
        // record.
      }
    }

    // Update the document-store with the new bytes (per existing
    // signatures-apply-pades pattern).
    deps.setBytes(data.handle, engineRes.value.newBytes);

    // Build the EditOperation. The replay engine reads `invalidatesSignatures`
    // as the user-confirmed flag (Phase 5 §4.8).
    const meta: EditMeta = {
      ts: clock(),
      undoable: true,
      operationId: `ocr-${jobId}-${clock()}`,
    };
    const op: EditOperationSerialized = {
      kind: 'ocr-text-behind-applied',
      meta,
      jobId,
      pageRange: data.pageRange,
      langs: data.langs,
      meanConfidence: engineRes.value.summary.meanConfidence,
      totalWordsRecognized: engineRes.value.summary.totalWords,
      invalidatesSignatures,
    };

    job.terminal = 'completed';
    activeJobs.delete(jobId);
    return ok({
      jobId,
      summary: engineRes.value.summary,
      op,
    });
  } catch (e) {
    if (deps.ocrJobsRepo) {
      deps.ocrJobsRepo.updateStatus(jobId, {
        status: 'failed',
        completed_at: clock(),
        error_message: safeMessage(e, 'unknown error'),
      });
    }
    job.terminal = 'failed';
    activeJobs.delete(jobId);
    return fail<OcrRunOnDocumentError>(
      'ocr_engine_failed',
      `unexpected: ${safeMessage(e, 'unknown error')}`,
    );
  }
}

// Keep alias alive.
export type _UnusedReq = OcrRunOnDocumentRequest;
