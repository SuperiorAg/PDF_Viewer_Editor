// Export queue (Phase 6.1, David — Julian H-25.1; architecture-phase-6.md §4.6)
//
// THE PROBLEM (Julian H-25.1): architecture-phase-6.md §4.6 specifies a FIFO
// queue with concurrency=1, but Wave 24 ran jobs INLINE in the handlers. Up to
// `maxQueueSize` jobs could race — two exports to the SAME output path would
// both write `<path>.export-temp` and clobber each other's atomic rename.
//
// THIS MODULE: a single-worker FIFO queue.
//   - enqueue(spec) → resolves with the engine result when the job finishes.
//   - concurrency = 1: at most one job runs; the rest wait FIFO.
//   - same-output-path collision: enqueue rejects if a queued/running job
//     already targets the same outputPath (case-insensitive on Windows).
//   - cancel(jobId): removes a queued job, OR aborts the running one via its
//     ActiveJob AbortController (the engine checks signal.aborted between pages).
//   - releaseAll(): cancels everything (called from app.before-quit).
//
// The queue does NOT own persistence — the handler still inserts the
// export_jobs row and persists completion (runAndPersist). The queue owns
// SCHEDULING + collision safety only. This keeps the engine's single-funnel
// contract intact.

import * as path from 'node:path';

import type { ExportProgressEvent } from '../../ipc/contracts.js';

import type { ExportEngine, ExportEngineFailure, ExportEngineResult } from './export-engine.js';
import { getActiveExportJob } from './export-engine.js';
import type { ExportJobSpec } from './types.js';

export type EnqueueError = 'queue_full' | 'output_path_collision';

export type QueueRunResult =
  | { ok: true; value: ExportEngineResult }
  | { ok: false; failure: ExportEngineFailure };

interface QueuedEntry {
  spec: ExportJobSpec;
  onProgress: (event: ExportProgressEvent) => void;
  resolve: (r: QueueRunResult) => void;
  /** Set true when cancel() removes it before it starts running. */
  cancelledWhileQueued: boolean;
}

export interface ExportQueue {
  /**
   * Enqueue a job. Returns a promise that resolves with the run result when the
   * job eventually completes / fails / cancels. The OUTER promise (this call)
   * resolves immediately with the enqueue outcome so the handler can return a
   * jobId without blocking — `onResult` is invoked later with the run result.
   */
  enqueue(
    spec: ExportJobSpec,
    onProgress: (event: ExportProgressEvent) => void,
    onResult: (r: QueueRunResult) => void,
  ): { ok: true } | { ok: false; error: EnqueueError; message: string };
  cancel(jobId: number): Promise<{ cancelled: boolean; pagesCompleted: number }>;
  status(): { running: number | null; queued: number[] };
  releaseAll(): Promise<void>;
}

function normalizePath(p: string): string {
  // Windows is case-insensitive + path-separator-insensitive for collision
  // detection. Resolve to absolute + lowercase on win32.
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export interface ExportQueueDeps {
  engine: ExportEngine;
  getMaxQueueSize: () => number;
}

export function createExportQueue(deps: ExportQueueDeps): ExportQueue {
  const pending: QueuedEntry[] = [];
  let runningJobId: number | null = null;
  let runningSpec: ExportJobSpec | null = null;
  let draining = false;

  const targetedPaths = (): string[] => {
    const out: string[] = [];
    if (runningSpec) out.push(normalizePath(runningSpec.outputPath));
    for (const e of pending) out.push(normalizePath(e.spec.outputPath));
    return out;
  };

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (pending.length > 0) {
        const entry = pending.shift()!;
        if (entry.cancelledWhileQueued) {
          entry.resolve({
            ok: false,
            failure: {
              error: 'cancelled',
              message: 'cancelled while queued',
              pagesCompleted: 0,
            },
          });
          continue;
        }
        runningJobId = entry.spec.jobId;
        runningSpec = entry.spec;
        try {
          const r = await deps.engine.runJob(entry.spec, entry.onProgress);
          entry.resolve(r);
        } catch (e) {
          // The engine never throws (it catches internally), but be defensive.
          entry.resolve({
            ok: false,
            failure: {
              error: 'writer_failed',
              message: `queue caught: ${(e as Error).message ?? 'unknown'}`,
              pagesCompleted: 0,
            },
          });
        } finally {
          runningJobId = null;
          runningSpec = null;
        }
      }
    } finally {
      draining = false;
    }
  }

  return {
    enqueue(spec, onProgress, onResult) {
      const maxQueue = deps.getMaxQueueSize();
      // queued + 1 running cap per §4.6.
      const activeCount = pending.length + (runningJobId !== null ? 1 : 0);
      if (activeCount >= maxQueue) {
        return {
          ok: false,
          error: 'queue_full',
          message: `${activeCount} active >= max ${maxQueue}`,
        };
      }
      // Same-output-path collision (R-W23-F): reject if any queued/running job
      // already targets this path. Prevents two atomic-renames clobbering.
      const norm = normalizePath(spec.outputPath);
      if (targetedPaths().includes(norm)) {
        return {
          ok: false,
          error: 'output_path_collision',
          message: `another export to ${spec.outputPath} is already queued or running`,
        };
      }
      pending.push({
        spec,
        onProgress,
        resolve: onResult,
        cancelledWhileQueued: false,
      });
      // Kick the drain loop (fire-and-forget; errors handled per-entry).
      void drain();
      return { ok: true };
    },

    async cancel(jobId) {
      // Queued (not yet running): mark + drop. It resolves cancelled on drain.
      const queued = pending.find((e) => e.spec.jobId === jobId);
      if (queued) {
        queued.cancelledWhileQueued = true;
        return { cancelled: true, pagesCompleted: 0 };
      }
      // Running: abort via the engine's ActiveJob controller (checked between
      // pages). The engine resolves the job as 'cancelled'.
      if (runningJobId === jobId) {
        const active = getActiveExportJob(jobId);
        if (active) {
          const pagesCompleted = active.pagesCompleted;
          active.controller.abort();
          return { cancelled: true, pagesCompleted };
        }
      }
      return { cancelled: false, pagesCompleted: 0 };
    },

    status() {
      return {
        running: runningJobId,
        queued: pending.map((e) => e.spec.jobId),
      };
    },

    async releaseAll() {
      // Cancel queued entries.
      for (const e of pending) e.cancelledWhileQueued = true;
      // Abort the running one.
      if (runningJobId !== null) {
        const active = getActiveExportJob(runningJobId);
        active?.controller.abort();
      }
      // Wait for the drain loop to flush all resolves.
      while (draining || pending.length > 0 || runningJobId !== null) {
        await new Promise((r) => setTimeout(r, 5));
      }
    },
  };
}
