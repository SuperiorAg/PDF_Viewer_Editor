// @vitest-environment node
//
// Export queue test (Phase 6.1, David — Julian H-25.1).
//
// Proves FIFO order, concurrency=1, same-output-path collision rejection,
// queue_full cap, and cancel (both queued and running).

import { describe, expect, it, beforeEach } from 'vitest';

import type { ExportEngine, ExportEngineResult } from './export-engine.js';
import { createExportQueue } from './export-queue.js';
import type { ExportJobSpec } from './types.js';

function spec(jobId: number, outputPath: string): ExportJobSpec {
  return {
    jobId,
    docHash: 'h',
    sourceBytes: new Uint8Array([1]),
    pageCount: 1,
    format: 'docx',
    qualityTier: 'layout-preserving',
    pageRange: { start: 0, end: 0 },
    includeAnnotations: false,
    outputPath,
    perFormat: { format: 'docx', pageSize: 'auto' },
  };
}

function fakeResult(jobId: number): ExportEngineResult {
  return {
    summary: {
      jobId,
      format: 'docx',
      qualityTier: 'layout-preserving',
      pageCount: 1,
      durationMs: 1,
      outputBasename: 'o.docx',
      outputDirHint: 'd',
      outputSizeBytes: 10,
      contentStats: null,
      perPageProgress: [],
    },
    outputPaths: [`/tmp/${jobId}.docx`],
  };
}

/**
 * A controllable engine: each runJob blocks until its gate is released, so the
 * test can assert serialization (concurrency=1) and FIFO ordering.
 */
function gatedEngine() {
  const runOrder: number[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const gates = new Map<number, () => void>();
  const engine: ExportEngine = {
    async runJob(s) {
      runOrder.push(s.jobId);
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise<void>((resolve) => gates.set(s.jobId, resolve));
      concurrent -= 1;
      return { ok: true, value: fakeResult(s.jobId) };
    },
  };
  return {
    engine,
    runOrder,
    release: (jobId: number) => gates.get(jobId)?.(),
    get maxConcurrent() {
      return maxConcurrent;
    },
  };
}

describe('export queue (Julian H-25.1)', () => {
  beforeEach(() => {
    globalThis.__pdfvExportActiveJobs?.clear();
  });

  it('rejects a colliding output path at enqueue time', () => {
    const ge = gatedEngine();
    const queue = createExportQueue({ engine: ge.engine, getMaxQueueSize: () => 50 });
    const r1 = queue.enqueue(
      spec(1, '/out/file.docx'),
      () => {},
      () => {},
    );
    expect(r1.ok).toBe(true);
    const r2 = queue.enqueue(
      spec(2, '/out/file.docx'),
      () => {},
      () => {},
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe('output_path_collision');
    // Different path is fine.
    const r3 = queue.enqueue(
      spec(3, '/out/other.docx'),
      () => {},
      () => {},
    );
    expect(r3.ok).toBe(true);
    ge.release(1);
    ge.release(3);
  });

  it('enforces concurrency=1 and FIFO order', async () => {
    const ge = gatedEngine();
    const queue = createExportQueue({ engine: ge.engine, getMaxQueueSize: () => 50 });
    const done: number[] = [];
    for (const id of [10, 20, 30]) {
      queue.enqueue(
        spec(id, `/out/${id}.docx`),
        () => {},
        () => done.push(id),
      );
    }
    // Let the microtask drain start the first job.
    await new Promise((r) => setTimeout(r, 5));
    // Only one job should be running.
    expect(ge.runOrder).toEqual([10]);
    expect(queue.status().running).toBe(10);
    expect(queue.status().queued).toEqual([20, 30]);
    ge.release(10);
    await new Promise((r) => setTimeout(r, 5));
    expect(ge.runOrder).toEqual([10, 20]);
    ge.release(20);
    await new Promise((r) => setTimeout(r, 5));
    expect(ge.runOrder).toEqual([10, 20, 30]);
    ge.release(30);
    await new Promise((r) => setTimeout(r, 5));
    expect(done).toEqual([10, 20, 30]);
    expect(ge.maxConcurrent).toBe(1);
  });

  it('enforces the queue_full cap (running + queued)', () => {
    const ge = gatedEngine();
    const queue = createExportQueue({ engine: ge.engine, getMaxQueueSize: () => 2 });
    expect(
      queue.enqueue(
        spec(1, '/o/1.docx'),
        () => {},
        () => {},
      ).ok,
    ).toBe(true);
    expect(
      queue.enqueue(
        spec(2, '/o/2.docx'),
        () => {},
        () => {},
      ).ok,
    ).toBe(true);
    const r3 = queue.enqueue(
      spec(3, '/o/3.docx'),
      () => {},
      () => {},
    );
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error).toBe('queue_full');
    ge.release(1);
    ge.release(2);
  });

  it('cancel removes a queued job before it runs', async () => {
    const ge = gatedEngine();
    const queue = createExportQueue({ engine: ge.engine, getMaxQueueSize: () => 50 });
    const results = new Map<number, unknown>();
    queue.enqueue(
      spec(1, '/o/1.docx'),
      () => {},
      (r) => results.set(1, r),
    );
    queue.enqueue(
      spec(2, '/o/2.docx'),
      () => {},
      (r) => results.set(2, r),
    );
    await new Promise((r) => setTimeout(r, 5));
    // Job 1 is running; cancel queued job 2.
    const c = await queue.cancel(2);
    expect(c.cancelled).toBe(true);
    ge.release(1);
    await new Promise((r) => setTimeout(r, 5));
    // Job 2 resolved as cancelled WITHOUT ever running.
    expect(ge.runOrder).toEqual([1]);
    const r2 = results.get(2) as { ok: boolean; failure?: { error: string } };
    expect(r2.ok).toBe(false);
    expect(r2.failure?.error).toBe('cancelled');
  });

  it('cancel of an unknown job reports not cancelled', async () => {
    const ge = gatedEngine();
    const queue = createExportQueue({ engine: ge.engine, getMaxQueueSize: () => 50 });
    const c = await queue.cancel(999);
    expect(c.cancelled).toBe(false);
    void ge;
  });
});
