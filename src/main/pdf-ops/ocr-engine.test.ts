// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';

import type { LanguagePackManager } from './language-pack-manager.js';
import {
  createOcrWorkerPool,
  runOcrOnPage,
  runOcrOnDocument,
  type OcrWorkerPool,
  type TesseractWorker,
  type TesseractWorkerFactory,
  type TesseractRecognizeResult,
} from './ocr-engine.js';

// ============================================================================
// Synthetic test doubles
// ============================================================================

interface SyntheticWorker extends TesseractWorker {
  terminateCalls: number;
  recognizeCalls: number;
  hangNext?: boolean;
}

function makeWorker(
  result: TesseractRecognizeResult = {
    words: [
      { text: 'hello', confidence: 92, bbox: { x0: 10, y0: 10, x1: 50, y1: 20 } },
      { text: 'world', confidence: 45, bbox: { x0: 60, y0: 10, x1: 100, y1: 20 } },
    ],
    imageWidthPx: 800,
    imageHeightPx: 1000,
  },
): SyntheticWorker {
  const w: SyntheticWorker = {
    terminateCalls: 0,
    recognizeCalls: 0,
    async recognize() {
      w.recognizeCalls += 1;
      if (w.hangNext) {
        // Simulate hang — never resolve.
        return await new Promise<TesseractRecognizeResult>(() => {
          /* never */
        });
      }
      return result;
    },
    async terminate() {
      w.terminateCalls += 1;
    },
  };
  return w;
}

function makeFactory(): {
  factory: TesseractWorkerFactory;
  workers: SyntheticWorker[];
} {
  const workers: SyntheticWorker[] = [];
  return {
    workers,
    factory: {
      async create() {
        const w = makeWorker();
        workers.push(w);
        return w;
      },
    },
  };
}

function makeManager(installedLangs: string[]): LanguagePackManager {
  return {
    async list() {
      return { installed: [], downloadable: [] };
    },
    resolve(lang) {
      return installedLangs.includes(lang) ? '/tessdata/' + lang : null;
    },
    async download() {
      throw new Error('not used in this test');
    },
    async remove() {
      throw new Error('not used in this test');
    },
    touchLastUsed() {
      // no-op
    },
    catalogEntry() {
      return null;
    },
    getCatalog() {
      return { version: 'test', baseUrl: '', packs: [] };
    },
  };
}

// ============================================================================
// Worker pool tests
// ============================================================================

describe('createOcrWorkerPool', () => {
  let pool: OcrWorkerPool;

  beforeEach(() => {
    const { factory } = makeFactory();
    pool = createOcrWorkerPool({
      workerFactory: factory,
      languagePackManager: makeManager(['eng', 'spa', 'fra', 'deu', 'rus']),
      maxConcurrentLanguages: 4,
    });
  });

  it('acquire returns a real worker on first call', async () => {
    const r = await pool.acquire('eng');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBeDefined();
      expect(typeof r.value.recognize).toBe('function');
    }
  });

  it('acquire is idempotent — same lang returns same worker', async () => {
    const r1 = await pool.acquire('eng');
    const r2 = await pool.acquire('eng');
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.value).toBe(r2.value);
    }
  });

  it('acquire fails when lang pack not installed', async () => {
    const r = await pool.acquire('chi_sim');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('language_pack_not_installed');
  });

  it('LRU eviction at cap (conventions §16.1 rule 5)', async () => {
    const { factory, workers } = makeFactory();
    pool = createOcrWorkerPool({
      workerFactory: factory,
      languagePackManager: makeManager(['eng', 'spa', 'fra', 'deu', 'rus']),
      maxConcurrentLanguages: 2,
    });
    await pool.acquire('eng');
    await pool.acquire('spa');
    // Acquiring a 3rd lang triggers LRU eviction (oldest = eng).
    const r3 = await pool.acquire('fra');
    expect(r3.ok).toBe(true);
    expect(pool.status().length).toBe(2);
    expect(
      pool
        .status()
        .map((s) => s.lang)
        .sort(),
    ).toEqual(['fra', 'spa']);
    // The evicted worker (eng) was terminated.
    expect(workers[0]!.terminateCalls).toBe(1);
  });

  it('releaseAll terminates every live worker', async () => {
    const { factory, workers } = makeFactory();
    pool = createOcrWorkerPool({
      workerFactory: factory,
      languagePackManager: makeManager(['eng', 'spa']),
      maxConcurrentLanguages: 4,
    });
    await pool.acquire('eng');
    await pool.acquire('spa');
    await pool.releaseAll();
    expect(pool.status().length).toBe(0);
    expect(workers[0]!.terminateCalls).toBe(1);
    expect(workers[1]!.terminateCalls).toBe(1);
  });

  it('releaseAll is idempotent (conventions §16.1 rule 2)', async () => {
    await pool.acquire('eng');
    await pool.releaseAll();
    await pool.releaseAll();
    expect(pool.status().length).toBe(0);
  });

  it('worker_init_failed when factory throws', async () => {
    const factory: TesseractWorkerFactory = {
      async create() {
        throw new Error('boom');
      },
    };
    pool = createOcrWorkerPool({
      workerFactory: factory,
      languagePackManager: makeManager(['eng']),
      maxConcurrentLanguages: 4,
    });
    const r = await pool.acquire('eng');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('worker_init_failed');
  });
});

// ============================================================================
// runOcrOnPage tests
// ============================================================================

describe('runOcrOnPage', () => {
  it('happy path: synthetic worker returns recognized words', async () => {
    const { factory } = makeFactory();
    const pool = createOcrWorkerPool({
      workerFactory: factory,
      languagePackManager: makeManager(['eng']),
      maxConcurrentLanguages: 4,
    });
    const r = await runOcrOnPage({
      pool,
      lang: 'eng',
      rasterBytes: new Uint8Array([1, 2, 3]),
      preprocess: { deskew: false, denoise: false, contrastBoost: false },
      watchdogMs: 5000,
      signal: new AbortController().signal,
      pageDimsPts: { widthPts: 612, heightPts: 792 },
      pageIndex: 0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.totalWords).toBe(2);
      expect(r.value.lowConfidenceWords).toBe(1); // 'world' at 45 < 60
      expect(r.value.meanConfidence).toBeCloseTo((92 + 45) / 2, 1);
      expect(r.value.words[0]!.text).toBe('hello');
      // Nullable-late-init: pdfRect is null at engine output.
      expect(r.value.words[0]!.pdfRect).toBeNull();
      expect(r.value.pageIndex).toBe(0);
      expect(r.value.imgDimsPx).toEqual({ widthPx: 800, heightPx: 1000 });
    }
  });

  it('returns cancelled when signal aborted before recognition', async () => {
    const { factory } = makeFactory();
    const pool = createOcrWorkerPool({
      workerFactory: factory,
      languagePackManager: makeManager(['eng']),
      maxConcurrentLanguages: 4,
    });
    const ctl = new AbortController();
    ctl.abort();
    const r = await runOcrOnPage({
      pool,
      lang: 'eng',
      rasterBytes: new Uint8Array([1]),
      preprocess: { deskew: false, denoise: false, contrastBoost: false },
      watchdogMs: 5000,
      signal: ctl.signal,
      pageDimsPts: { widthPts: 612, heightPts: 792 },
      pageIndex: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('cancelled');
  });

  it("returns language_pack_not_installed when pool can't acquire", async () => {
    const { factory } = makeFactory();
    const pool = createOcrWorkerPool({
      workerFactory: factory,
      languagePackManager: makeManager([]), // no langs
      maxConcurrentLanguages: 4,
    });
    const r = await runOcrOnPage({
      pool,
      lang: 'eng',
      rasterBytes: new Uint8Array([1]),
      preprocess: { deskew: false, denoise: false, contrastBoost: false },
      watchdogMs: 5000,
      signal: new AbortController().signal,
      pageDimsPts: { widthPts: 612, heightPts: 792 },
      pageIndex: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('language_pack_not_installed');
  });

  it('watchdog fires when recognize hangs past watchdogMs', async () => {
    // Make a worker that hangs forever on recognize.
    const hangingWorker = makeWorker();
    hangingWorker.hangNext = true;
    const factory: TesseractWorkerFactory = {
      async create() {
        return hangingWorker;
      },
    };
    const pool = createOcrWorkerPool({
      workerFactory: factory,
      languagePackManager: makeManager(['eng']),
      maxConcurrentLanguages: 4,
    });
    const r = await runOcrOnPage({
      pool,
      lang: 'eng',
      rasterBytes: new Uint8Array([1]),
      preprocess: { deskew: false, denoise: false, contrastBoost: false },
      watchdogMs: 25, // short fuse for the test
      signal: new AbortController().signal,
      pageDimsPts: { widthPts: 612, heightPts: 792 },
      pageIndex: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('worker_watchdog_timeout');
    // Watchdog terminate fired.
    expect(hangingWorker.terminateCalls).toBe(1);
  });
});

// ============================================================================
// runOcrOnDocument tests
// ============================================================================

describe('runOcrOnDocument', () => {
  it('iterates page range and produces a summary', async () => {
    const { factory } = makeFactory();
    const pool = createOcrWorkerPool({
      workerFactory: factory,
      languagePackManager: makeManager(['eng']),
      maxConcurrentLanguages: 4,
    });
    const progressEvents: string[] = [];
    const r = await runOcrOnDocument(
      {
        jobId: 42,
        handle: 1,
        pageRange: { start: 0, end: 1 },
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
        rasterDpi: 300,
        watchdogMs: 5000,
        signal: new AbortController().signal,
        originalBytes: new Uint8Array([1, 2, 3]),
      },
      {
        pool,
        languagePackManager: makeManager(['eng']),
        rasterizePage: async () => new Uint8Array([0xa, 0xb, 0xc]),
        pageDimensions: async () => ({ widthPts: 612, heightPts: 792 }),
        composeSearchablePdf: async (orig) => new Uint8Array([...orig, 99]),
        emitProgress: (evt) => progressEvents.push(evt.phase),
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.summary.status).toBe('completed');
      expect(r.value.summary.pageResults).not.toBeNull();
      expect(r.value.summary.pageResults!.length).toBe(2);
      expect(r.value.summary.totalWords).toBe(4); // 2 words/page × 2 pages
      // Bytes are post-composed (with our trailing 99).
      expect(r.value.newBytes[r.value.newBytes.length - 1]).toBe(99);
    }
    // Progress events fired: starting, rasterizing, recognizing, etc.
    expect(progressEvents).toContain('starting');
    expect(progressEvents).toContain('completed');
  });

  it('cancellation returns cancelled with partial progress', async () => {
    const { factory } = makeFactory();
    const pool = createOcrWorkerPool({
      workerFactory: factory,
      languagePackManager: makeManager(['eng']),
      maxConcurrentLanguages: 4,
    });
    const ctl = new AbortController();
    // Abort after first rasterize call.
    let rasterCalls = 0;
    const r = await runOcrOnDocument(
      {
        jobId: 1,
        handle: 1,
        pageRange: { start: 0, end: 5 },
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
        rasterDpi: 300,
        watchdogMs: 5000,
        signal: ctl.signal,
        originalBytes: new Uint8Array([1]),
      },
      {
        pool,
        languagePackManager: makeManager(['eng']),
        rasterizePage: async () => {
          rasterCalls += 1;
          if (rasterCalls === 2) ctl.abort();
          return new Uint8Array([0xa]);
        },
        pageDimensions: async () => ({ widthPts: 612, heightPts: 792 }),
        composeSearchablePdf: async () => new Uint8Array(),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('cancelled');
  });

  it('propagates pdf_render_failed when rasterizer throws', async () => {
    const { factory } = makeFactory();
    const pool = createOcrWorkerPool({
      workerFactory: factory,
      languagePackManager: makeManager(['eng']),
      maxConcurrentLanguages: 4,
    });
    const r = await runOcrOnDocument(
      {
        jobId: 1,
        handle: 1,
        pageRange: { start: 0, end: 0 },
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
        rasterDpi: 300,
        watchdogMs: 5000,
        signal: new AbortController().signal,
        originalBytes: new Uint8Array([1]),
      },
      {
        pool,
        languagePackManager: makeManager(['eng']),
        rasterizePage: async () => {
          throw new Error('synthetic-raster-fail');
        },
        pageDimensions: async () => ({ widthPts: 612, heightPts: 792 }),
        composeSearchablePdf: async () => new Uint8Array(),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('pdf_render_failed');
  });

  it('propagates output_serialize_failed when composeSearchablePdf throws', async () => {
    const { factory } = makeFactory();
    const pool = createOcrWorkerPool({
      workerFactory: factory,
      languagePackManager: makeManager(['eng']),
      maxConcurrentLanguages: 4,
    });
    const r = await runOcrOnDocument(
      {
        jobId: 1,
        handle: 1,
        pageRange: { start: 0, end: 0 },
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
        rasterDpi: 300,
        watchdogMs: 5000,
        signal: new AbortController().signal,
        originalBytes: new Uint8Array([1]),
      },
      {
        pool,
        languagePackManager: makeManager(['eng']),
        rasterizePage: async () => new Uint8Array([0xa]),
        pageDimensions: async () => ({ widthPts: 612, heightPts: 792 }),
        composeSearchablePdf: async () => {
          throw new Error('compose-fail');
        },
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('output_serialize_failed');
  });
});
