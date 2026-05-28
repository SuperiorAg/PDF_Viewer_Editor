// Shared helpers for the six Phase 6 export handlers (Wave 24, David).
//
// All export:to* handlers share:
//   - the writability probe (output_path_unwritable)
//   - the queue-size enforcement
//   - the source-handle resolution (handle_not_found / page_range_out_of_range)
//   - the engine dispatch + summary construction
//
// Each handler validates its own zod schema then delegates here.

import * as fsConstants from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';

import type {
  ExportEngine,
  ExportEngineErrorKind,
  ExportEngineResult,
} from '../../main/export/export-engine.js';
import type { ExportQueue } from '../../main/export/export-queue.js';
import type { ExportJobSpec, PerFormatSpec } from '../../main/export/types.js';
import type {
  ExportFormat,
  ExportJobSummary,
  ExportProgressEvent,
  ExportQualityTier,
} from '../contracts.js';

export interface ExportHandlerCommonDeps {
  engine: ExportEngine;
  /**
   * FIFO single-worker queue (Julian H-25.1). When wired, runAndPersist routes
   * the job through the queue so concurrency=1 + same-output-path collision
   * rejection are enforced. Optional for back-compat with tests that drive the
   * engine directly; production always wires it.
   */
  queue?: ExportQueue;
  getBytes: (handle: number) => Uint8Array | null;
  getPageCount: (handle: number) => number | null;
  getDocHash: (handle: number) => string | null;
  exportJobsRepo: ExportJobsRepoBridge | null;
  emitProgress: (event: ExportProgressEvent) => void;
  /** Settings repo lookup for `export.maxQueueSize`. */
  getMaxQueueSize: () => number;
  /** Read the count of currently in-flight jobs (queue.size + running). */
  getActiveJobCount: () => number;
  now?: () => number;
}

export interface ExportJobsRepoBridge {
  insert(row: {
    doc_hash: string;
    format: ExportFormat;
    quality_tier: ExportQualityTier | 'n/a';
    page_range_start: number;
    page_range_end: number;
    include_annotations: 0 | 1;
    dpi: number | null;
    jpeg_quality: number | null;
    multi_page_tiff: 0 | 1 | null;
    output_path: string;
    status: 'queued';
    started_at: number;
    created_at?: number;
  }): number;
  updateStatus(
    id: number,
    update: {
      status: 'completed' | 'cancelled' | 'failed' | 'running';
      completed_at?: number;
      duration_ms?: number;
      error_message?: string;
    },
  ): boolean;
  updateProgress(
    id: number,
    pagesProcessed: number,
    extras?: {
      paragraphsExtracted?: number;
      tablesDetected?: number;
      imagesEmbedded?: number;
      outputSizeBytes?: number;
    },
  ): boolean;
}

/** Common error union after pre-flight checks. Maps to per-channel errors. */
export type PreflightError =
  | 'handle_not_found'
  | 'page_range_out_of_range'
  | 'output_path_unwritable'
  | 'queue_full';

export interface PreflightResult {
  ok: true;
  bytes: Uint8Array;
  pageCount: number;
  docHash: string;
}

/** Probe handle + range + writability + queue size. */
export async function preflight(
  req: {
    handle: number;
    pageRange: { start: number; end: number };
    outputPath: string;
  },
  deps: Pick<
    ExportHandlerCommonDeps,
    'getBytes' | 'getPageCount' | 'getDocHash' | 'getMaxQueueSize' | 'getActiveJobCount'
  >,
): Promise<PreflightResult | { ok: false; error: PreflightError; message: string }> {
  const bytes = deps.getBytes(req.handle);
  if (!bytes) {
    return { ok: false, error: 'handle_not_found', message: `handle ${req.handle} not found` };
  }
  const pageCount = deps.getPageCount(req.handle);
  if (pageCount === null) {
    return { ok: false, error: 'handle_not_found', message: 'pageCount unknown' };
  }
  if (req.pageRange.start > req.pageRange.end) {
    return {
      ok: false,
      error: 'page_range_out_of_range',
      message: `start ${req.pageRange.start} > end ${req.pageRange.end}`,
    };
  }
  if (req.pageRange.start < 0 || req.pageRange.end >= pageCount) {
    return {
      ok: false,
      error: 'page_range_out_of_range',
      message: `range [${req.pageRange.start},${req.pageRange.end}] out of [0,${pageCount - 1}]`,
    };
  }
  // Writability probe — best-effort.
  const parentDir = path.dirname(req.outputPath);
  try {
    await fsPromises.access(parentDir, fsConstants.constants.W_OK);
  } catch {
    return {
      ok: false,
      error: 'output_path_unwritable',
      message: `parent dir ${parentDir} not writable`,
    };
  }
  // Queue cap.
  const maxQueue = deps.getMaxQueueSize();
  const active = deps.getActiveJobCount();
  if (active >= maxQueue) {
    return {
      ok: false,
      error: 'queue_full',
      message: `${active} active >= max ${maxQueue}`,
    };
  }
  return {
    ok: true,
    bytes,
    pageCount,
    docHash: deps.getDocHash(req.handle) ?? '',
  };
}

/** Insert an export_jobs row (status='queued'). Returns the jobId, OR a
 *  synthetic negative id if Ravi's repo isn't wired yet (parallel-wave skew). */
export function insertJobRow(
  deps: Pick<ExportHandlerCommonDeps, 'exportJobsRepo' | 'now'>,
  base: {
    docHash: string;
    format: ExportFormat;
    qualityTier: ExportQualityTier | 'n/a';
    pageRange: { start: number; end: number };
    includeAnnotations: boolean;
    outputPath: string;
    dpi?: number;
    jpegQuality?: number;
    multiPageTiff?: boolean;
  },
): number {
  const clock = deps.now ?? Date.now;
  const startedAt = clock();
  if (!deps.exportJobsRepo) {
    // Parallel-wave skew: assign a synthetic negative id.
    return -1 * startedAt;
  }
  return deps.exportJobsRepo.insert({
    doc_hash: base.docHash,
    format: base.format,
    quality_tier: base.qualityTier,
    page_range_start: base.pageRange.start,
    page_range_end: base.pageRange.end,
    include_annotations: base.includeAnnotations ? 1 : 0,
    dpi: typeof base.dpi === 'number' ? base.dpi : null,
    jpeg_quality: typeof base.jpegQuality === 'number' ? base.jpegQuality : null,
    multi_page_tiff: typeof base.multiPageTiff === 'boolean' ? (base.multiPageTiff ? 1 : 0) : null,
    output_path: base.outputPath,
    status: 'queued',
    started_at: startedAt,
  });
}

/** Dispatch to the engine + persist completion / failure state. */
export async function runAndPersist(
  jobId: number,
  spec: ExportJobSpec,
  deps: Pick<
    ExportHandlerCommonDeps,
    'engine' | 'queue' | 'exportJobsRepo' | 'emitProgress' | 'now'
  >,
): Promise<
  | { ok: true; value: ExportEngineResult & { jobId: number } }
  | { ok: false; error: ExportEngineErrorKind | 'output_path_collision'; message: string }
> {
  const clock = deps.now ?? Date.now;

  // Route through the FIFO queue when wired (Julian H-25.1): enforces
  // concurrency=1 + same-output-path collision rejection. The handler still
  // awaits the result so the IPC response shape ({ jobId, summary }) is
  // preserved — the queue serializes execution; the await preserves the
  // synchronous-response contract the renderer expects.
  let r: Awaited<ReturnType<ExportEngine['runJob']>>;
  if (deps.queue) {
    const queue = deps.queue;
    const enqueued = new Promise<Awaited<ReturnType<ExportEngine['runJob']>>>((resolve, reject) => {
      const enq = queue.enqueue(spec, deps.emitProgress, resolve);
      if (!enq.ok) reject(new Error(enq.error));
    });
    try {
      // The status flips to 'running' only when the queue actually dequeues
      // this job; the engine emits the 'starting' progress event at that point.
      if (deps.exportJobsRepo) {
        deps.exportJobsRepo.updateStatus(jobId, { status: 'running' });
      }
      r = await enqueued;
    } catch (e) {
      const reason = (e as Error).message;
      if (deps.exportJobsRepo) {
        deps.exportJobsRepo.updateStatus(jobId, {
          status: 'failed',
          completed_at: clock(),
          error_message: reason,
        });
      }
      if (reason === 'output_path_collision') {
        return {
          ok: false,
          error: 'output_path_collision',
          message: `another export is already writing ${spec.outputPath}`,
        };
      }
      // queue_full (defensive — preflight catches it first) maps to write-fail.
      return { ok: false, error: 'output_write_failed', message: reason };
    }
  } else {
    if (deps.exportJobsRepo) {
      deps.exportJobsRepo.updateStatus(jobId, { status: 'running' });
    }
    r = await deps.engine.runJob(spec, deps.emitProgress);
  }
  if (r.ok) {
    const sum: ExportJobSummary = r.value.summary;
    if (deps.exportJobsRepo) {
      deps.exportJobsRepo.updateStatus(jobId, {
        status: 'completed',
        completed_at: clock(),
        duration_ms: sum.durationMs,
      });
      // Conditional-spread per exactOptionalPropertyTypes: undefined cannot
      // satisfy `T?` (TS2379). Only emit keys whose values are present.
      const stats = sum.contentStats;
      const extras: {
        outputSizeBytes?: number;
        paragraphsExtracted?: number;
        tablesDetected?: number;
        imagesEmbedded?: number;
      } = { outputSizeBytes: sum.outputSizeBytes };
      if (stats !== null) {
        extras.paragraphsExtracted = stats.paragraphsExtracted;
        extras.tablesDetected = stats.tablesDetected;
        extras.imagesEmbedded = stats.imagesEmbedded;
      }
      deps.exportJobsRepo.updateProgress(jobId, sum.pageCount, extras);
    }
    return { ok: true, value: { ...r.value, jobId } };
  }
  if (deps.exportJobsRepo) {
    deps.exportJobsRepo.updateStatus(jobId, {
      status: r.failure.error === 'cancelled' ? 'cancelled' : 'failed',
      completed_at: clock(),
      error_message: r.failure.message,
    });
  }
  return { ok: false, error: r.failure.error, message: r.failure.message };
}

/** Construct the `PerFormatSpec` discriminant for the engine. */
export function buildPerFormat(
  format: ExportFormat,
  extras: {
    pageSize?: 'letter' | 'a4' | 'auto';
    dpi?: number;
    jpegQuality?: number;
    multiPageTiff?: boolean;
  },
): PerFormatSpec {
  switch (format) {
    case 'docx':
      return { format: 'docx', pageSize: extras.pageSize ?? 'auto' };
    case 'xlsx':
      return { format: 'xlsx' };
    case 'pptx':
      return { format: 'pptx' };
    case 'png':
      return { format: 'png', dpi: extras.dpi ?? 150 };
    case 'jpeg':
      return {
        format: 'jpeg',
        dpi: extras.dpi ?? 150,
        quality: typeof extras.jpegQuality === 'number' ? extras.jpegQuality : 0.9,
      };
    case 'tiff':
      return {
        format: 'tiff',
        dpi: extras.dpi ?? 150,
        multiPage: extras.multiPageTiff === true,
      };
    default: {
      const exhaustive: never = format;
      throw new Error(`unknown format: ${String(exhaustive)}`);
    }
  }
}
