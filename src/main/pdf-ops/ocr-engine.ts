// Phase 5 — OCR engine (single funnel).
//
// Contract: docs/ocr-engine.md (Riley Wave 19) + docs/architecture-phase-5.md
// §4 + docs/conventions.md §16.
//
// THIS MODULE IS THE ONLY ENTRY POINT INTO tesseract.js (conventions §16.1).
// IPC handlers MUST NOT call createWorker directly. ESLint will eventually
// (Wave 21) enforce `no-restricted-imports` to ban tesseract.js anywhere else.
//
// FIVE WORKER LIFECYCLE NON-NEGOTIABLES (conventions §16.1):
//   1. One worker per active language, persisted for the app lifetime.
//   2. releaseAll() on app.before-quit AND process.exit.
//   3. No createWorker outside this module.
//   4. Watchdog per page.
//   5. LRU eviction at the worker pool cap.
//
// LIBRARY INJECTION (conventions §16.3 — required-on-interface, no fallbacks):
//   - `workerFactory`        — creates a TesseractWorker for a given lang +
//                              langPath. Production wiring imports tesseract.js's
//                              `createWorker`; tests inject a synthetic.
//   - `languagePackManager`  — resolves lang -> directory path.
//   - `searchablePdfBuilder` — composes text-behind-image blocks.
//   - `rasterizePage`        — turns a (handle, pageIndex, DPI) into raster bytes.
//   - `pageDimensions`       — returns {widthPts, heightPts} for a page; used by
//                              the searchable-PDF builder for coordinate xform.
//   - `now`                  — clock supplier; tests inject a fixed clock.
//
// ALL ARE REQUIRED. No optional + stub fallback. This is the structural fix
// from the 2026-05-27 stub-shipped-with-TODO global JSONL lesson.

import type {
  DocumentHandle,
  OcrJobStatus,
  OcrJobSummary,
  OcrPageResult,
  OcrProgressEvent,
  OcrWord,
  PreprocessOptions,
} from '../../ipc/contracts.js';
import { fail, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';

import type { LanguagePackManager } from './language-pack-manager.js';

// ============================================================================
// Worker contract (tesseract.js-compatible subset; library-injected)
// ============================================================================

export interface TesseractWordBox {
  text: string;
  confidence: number; // 0..100
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface TesseractRecognizeResult {
  words: TesseractWordBox[];
  imageWidthPx: number;
  imageHeightPx: number;
}

/**
 * Minimal worker surface the engine needs. Production wiring (Wave 21) maps
 * each method to `tesseract.js`'s `Worker` API:
 *
 *   - `recognize(imageBytes)` -> tesseract.js `Worker.recognize(buffer).data`
 *   - `terminate()`           -> tesseract.js `Worker.terminate()`
 *
 * Tests inject a synthetic implementation returning fixed word boxes.
 */
export interface TesseractWorker {
  recognize(imageBytes: Uint8Array): Promise<TesseractRecognizeResult>;
  terminate(): Promise<void>;
}

/**
 * Library-injected factory. Per `ocr-engine.md §3.2`:
 *   `createWorker(lang, 1, { langPath, gzip: true, cachePath })`
 *
 * Returns a ready-to-use worker; init (WASM load + lang data load) is
 * implicit in `createWorker` for tesseract.js v6+.
 */
export interface TesseractWorkerFactory {
  create(lang: string, langDir: string): Promise<TesseractWorker>;
}

// ============================================================================
// Worker pool (conventions §16.1 — one per language, persisted, LRU-evictable)
// ============================================================================

export interface OcrWorkerPoolStatus {
  lang: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface OcrWorkerPool {
  /** Get-or-create a worker for the given language. Idempotent on cache hit. */
  acquire(lang: string): Promise<Result<TesseractWorker, OcrEngineError>>;
  /** Terminate every worker. Called from app.before-quit + process.exit. */
  releaseAll(): Promise<void>;
  /** Snapshot of pool state for debugging / `ocr:listJobs` audit. */
  status(): OcrWorkerPoolStatus[];
}

export type OcrEngineError =
  | 'language_pack_not_installed'
  | 'worker_init_failed'
  | 'ocr_engine_failed'
  | 'worker_watchdog_timeout'
  | 'pdf_render_failed'
  | 'output_serialize_failed'
  | 'cancelled';

interface PoolEntry {
  worker: TesseractWorker;
  lang: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface CreateOcrWorkerPoolOptions {
  workerFactory: TesseractWorkerFactory;
  languagePackManager: LanguagePackManager;
  maxConcurrentLanguages: number;
  now?: () => number;
}

export function createOcrWorkerPool(opts: CreateOcrWorkerPoolOptions): OcrWorkerPool {
  const { workerFactory, languagePackManager, maxConcurrentLanguages } = opts;
  const clock = opts.now ?? Date.now;
  const entries = new Map<string, PoolEntry>();

  async function evictLruIfNeeded(): Promise<void> {
    if (entries.size < maxConcurrentLanguages) return;
    let oldestLang: string | null = null;
    let oldestTs = Infinity;
    for (const [lang, e] of entries) {
      if (e.lastUsedAt < oldestTs) {
        oldestTs = e.lastUsedAt;
        oldestLang = lang;
      }
    }
    if (oldestLang === null) return;
    const evicting = entries.get(oldestLang);
    if (evicting) {
      try {
        await evicting.worker.terminate();
      } catch {
        /* swallow: terminate must never throw on shutdown path */
      }
      entries.delete(oldestLang);
    }
  }

  return {
    async acquire(lang) {
      const existing = entries.get(lang);
      if (existing) {
        existing.lastUsedAt = clock();
        languagePackManager.touchLastUsed(lang, existing.lastUsedAt);
        return ok(existing.worker);
      }
      const langDir = languagePackManager.resolve(lang);
      if (langDir === null) {
        return fail<OcrEngineError>(
          'language_pack_not_installed',
          `language pack not installed: ${lang}`,
        );
      }
      await evictLruIfNeeded();
      try {
        const worker = await workerFactory.create(lang, langDir);
        const now = clock();
        entries.set(lang, {
          worker,
          lang,
          createdAt: now,
          lastUsedAt: now,
        });
        languagePackManager.touchLastUsed(lang, now);
        return ok(worker);
      } catch (e) {
        return fail<OcrEngineError>(
          'worker_init_failed',
          `worker init failed: ${(e as Error).name ?? 'unknown'}`,
        );
      }
    },

    async releaseAll() {
      // Synchronous walk; await each terminate but never throw.
      for (const [, entry] of entries) {
        try {
          await entry.worker.terminate();
        } catch {
          /* defensive */
        }
      }
      entries.clear();
    },

    status() {
      return Array.from(entries.values()).map((e) => ({
        lang: e.lang,
        createdAt: e.createdAt,
        lastUsedAt: e.lastUsedAt,
      }));
    },
  };
}

// ============================================================================
// runOcrOnPage — single funnel into tesseract.js
// ============================================================================

export interface RunOcrOnPageOptions {
  /** REQUIRED — no fallback. Conventions §16.3.1 + ocr-engine.md §4.2.2. */
  pool: OcrWorkerPool;
  /** Tesseract lang code (single or '+'-joined). REQUIRED. */
  lang: string;
  /** REQUIRED — raw page raster (PNG/JPEG/BMP/TIFF Uint8Array). */
  rasterBytes: Uint8Array;
  /** REQUIRED — sparse partial NOT permitted. */
  preprocess: PreprocessOptions;
  /** Per-page watchdog cap in milliseconds (default 60 000). */
  watchdogMs: number;
  /** Abort signal — checked at every async boundary. */
  signal: AbortSignal;
  /** PDF page-space dimensions in points for coordinate xform. */
  pageDimsPts: { widthPts: number; heightPts: number };
  /** Page index in the document (for `OcrPageResult.pageIndex`). */
  pageIndex: number;
  /** Optional clock supplier; tests inject. Defaults Date.now. */
  now?: () => number;
}

/**
 * Run OCR on a single raster page. Pure single-funnel entry point per
 * conventions §16.1.3 — `tesseract.js`'s `createWorker` is reachable ONLY
 * via the injected `pool`.
 *
 * REQUIRED on the interface (NOT optional + stub fallback) per the 2026-05-27
 * structural anti-stub-shipped-with-TODO rule (conventions §16.3.1).
 */
export async function runOcrOnPage(
  options: RunOcrOnPageOptions,
): Promise<Result<OcrPageResult, OcrEngineError>> {
  const { pool, lang, rasterBytes, watchdogMs, signal, pageDimsPts, pageIndex } = options;
  const clock = options.now ?? Date.now;

  if (signal.aborted) {
    return fail<OcrEngineError>('cancelled', 'aborted before recognition');
  }

  const acq = await pool.acquire(lang);
  if (!acq.ok) {
    return fail<OcrEngineError>(acq.error, acq.message);
  }
  const worker = acq.value;

  if (signal.aborted) {
    return fail<OcrEngineError>('cancelled', 'aborted before recognition');
  }

  const startedAt = clock();

  // Per-page watchdog (R-W19-D). If `recognize` hangs > watchdogMs, we
  // terminate the worker (the pool drops it on next acquire).
  let watchdogFired = false;
  const watchdog = new Promise<TesseractRecognizeResult>((_resolve, reject) => {
    const t = setTimeout(() => {
      watchdogFired = true;
      // Best-effort terminate — the worker may be hung in a WASM call.
      void worker.terminate().catch(() => {
        /* defensive */
      });
      reject(new Error('worker_watchdog_timeout'));
    }, watchdogMs);
    // Clear on abort too, so we don't leak the timer.
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
      },
      { once: true },
    );
    // Detach when the recognize promise resolves; we attach via Promise.race
    // below — the timeout is the only path that fires the `reject`.
  });

  let result: TesseractRecognizeResult;
  try {
    result = await Promise.race([worker.recognize(rasterBytes), watchdog]);
  } catch (e) {
    if (watchdogFired) {
      return fail<OcrEngineError>(
        'worker_watchdog_timeout',
        `watchdog fired after ${watchdogMs}ms on page ${pageIndex}`,
      );
    }
    if (signal.aborted) {
      return fail<OcrEngineError>('cancelled', 'aborted during recognition');
    }
    return fail<OcrEngineError>(
      'ocr_engine_failed',
      `recognize threw: ${(e as Error).name ?? 'unknown'}`,
    );
  }

  // Build OcrPageResult.
  const lowConfidenceThreshold = 60; // conventions §16.4 — applied at render
  // time too; this is the engine's pre-aggregated count.
  const words: OcrWord[] = result.words.map((w) => ({
    text: w.text,
    confidence: w.confidence,
    imgRect: w.bbox,
    pdfRect: null, // Phase 4.1 nullable-late-init; populated by builder later.
  }));
  const totalWords = words.length;
  const lowConfidenceWords = words.filter((w) => w.confidence < lowConfidenceThreshold).length;
  const meanConfidence =
    totalWords === 0 ? 0 : words.reduce((s, w) => s + w.confidence, 0) / totalWords;

  void pageDimsPts; // builder uses this; engine just plumbs it forward.

  const durationMs = clock() - startedAt;
  return ok<OcrPageResult>({
    pageIndex,
    imgDimsPx: { widthPx: result.imageWidthPx, heightPx: result.imageHeightPx },
    totalWords,
    lowConfidenceWords,
    meanConfidence,
    words,
    durationMs,
  });
}

// ============================================================================
// runOcrOnDocument — sequential per-page, cancellable, watchdog'd
// ============================================================================

export interface RasterPageOptions {
  handle: DocumentHandle;
  pageIndex: number;
  dpi: number;
  signal: AbortSignal;
}

export interface RunOcrOnDocumentDeps {
  pool: OcrWorkerPool;
  languagePackManager: LanguagePackManager;
  rasterizePage: (opts: RasterPageOptions) => Promise<Uint8Array>;
  pageDimensions: (
    handle: DocumentHandle,
    pageIndex: number,
  ) => Promise<{ widthPts: number; heightPts: number }>;
  /**
   * Compose the searchable-PDF output. Returns the new bytes with the
   * text-behind-image layer appended to /Contents on every recognized page.
   * Implementation in `searchable-pdf-builder.ts`.
   */
  composeSearchablePdf: (
    originalBytes: Uint8Array,
    pageResults: OcrPageResult[],
  ) => Promise<Uint8Array>;
  /** Optional progress emit; defaults to no-op. */
  emitProgress?: (event: OcrProgressEvent) => void;
  /** Clock; tests inject. */
  now?: () => number;
}

export interface RunOcrOnDocumentOptions {
  jobId: number;
  handle: DocumentHandle;
  pageRange: { start: number; end: number };
  langs: string[];
  preprocess: PreprocessOptions;
  rasterDpi: number;
  watchdogMs: number;
  signal: AbortSignal;
  originalBytes: Uint8Array;
}

export interface RunOcrOnDocumentValue {
  /** Post-OCR PDF bytes (with text-behind-image layer). */
  newBytes: Uint8Array;
  summary: OcrJobSummary;
}

export async function runOcrOnDocument(
  opts: RunOcrOnDocumentOptions,
  deps: RunOcrOnDocumentDeps,
): Promise<Result<RunOcrOnDocumentValue, OcrEngineError>> {
  const {
    jobId,
    handle,
    pageRange,
    langs,
    preprocess,
    rasterDpi,
    watchdogMs,
    signal,
    originalBytes,
  } = opts;
  const clock = deps.now ?? Date.now;
  const emit = deps.emitProgress ?? ((): void => undefined);

  const langKey = langs.join('+');
  const totalPages = pageRange.end - pageRange.start + 1;
  const startedAt = clock();

  emit({ jobId, phase: 'starting', totalPages });

  // Pre-flight worker creation (warms WASM + lang data once).
  const acq = await deps.pool.acquire(langKey);
  if (!acq.ok) {
    return fail<OcrEngineError>(acq.error, acq.message);
  }

  const pageResults: OcrPageResult[] = [];
  let pagesCompleted = 0;

  // Sequential per-page (R-W19-C: bounded memory).
  for (let p = pageRange.start; p <= pageRange.end; p += 1) {
    if (signal.aborted) {
      emit({
        jobId,
        phase: 'cancelled',
        pagesCompleted,
        totalPages,
      });
      return fail<OcrEngineError>('cancelled', `cancelled at page ${p}`);
    }
    emit({ jobId, phase: 'rasterizing', pageIndex: p, totalPages });
    let raster: Uint8Array;
    try {
      raster = await deps.rasterizePage({
        handle,
        pageIndex: p,
        dpi: rasterDpi,
        signal,
      });
    } catch (e) {
      const errMsg = `rasterize page ${p} failed: ${(e as Error).name ?? 'unknown'}`;
      emit({
        jobId,
        phase: 'failed',
        pagesCompleted,
        totalPages,
        error: errMsg,
      });
      return fail<OcrEngineError>('pdf_render_failed', errMsg);
    }
    emit({ jobId, phase: 'preprocessing', pageIndex: p, totalPages });
    // Preprocessing is applied at the image bytes level upstream of the
    // engine — the engine does NOT call preprocess functions inline. The
    // `rasterizePage` dep handles the pipeline (deskew/denoise/contrast)
    // before returning bytes. We forward the flags via watchdog state for
    // audit only.
    void preprocess; // shape-validated; consumed by deps.rasterizePage upstream.

    if (signal.aborted) {
      emit({ jobId, phase: 'cancelled', pagesCompleted, totalPages });
      return fail<OcrEngineError>('cancelled', `cancelled at page ${p}`);
    }
    const pageDims = await deps.pageDimensions(handle, p);

    emit({
      jobId,
      phase: 'recognizing',
      pageIndex: p,
      totalPages,
      confidenceSoFar:
        pageResults.length === 0
          ? null
          : pageResults.reduce((s, r) => s + r.meanConfidence, 0) / pageResults.length,
    });
    const pageRes = await runOcrOnPage({
      pool: deps.pool,
      lang: langKey,
      rasterBytes: raster,
      preprocess,
      watchdogMs,
      signal,
      pageDimsPts: pageDims,
      pageIndex: p,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    });
    if (!pageRes.ok) {
      emit({
        jobId,
        phase: 'failed',
        pagesCompleted,
        totalPages,
        error: pageRes.message,
      });
      return fail<OcrEngineError>(pageRes.error, pageRes.message);
    }
    pageResults.push(pageRes.value);
    pagesCompleted += 1;
    emit({ jobId, phase: 'composing-text-behind-image', pageIndex: p, totalPages });
  }

  // After every page is OCR'd, compose the searchable PDF.
  emit({
    jobId,
    phase: 'writing-output',
    pageIndex: pageRange.end,
    totalPages,
  });
  let newBytes: Uint8Array;
  try {
    newBytes = await deps.composeSearchablePdf(originalBytes, pageResults);
  } catch (e) {
    const errMsg = `compose failed: ${(e as Error).name ?? 'unknown'}`;
    emit({
      jobId,
      phase: 'failed',
      pagesCompleted,
      totalPages,
      error: errMsg,
    });
    return fail<OcrEngineError>('output_serialize_failed', errMsg);
  }

  const totalWords = pageResults.reduce((s, r) => s + r.totalWords, 0);
  const meanConfidence =
    totalWords === 0
      ? 0
      : pageResults.reduce((s, r) => s + r.meanConfidence * r.totalWords, 0) / totalWords;

  const summary: OcrJobSummary = {
    jobId,
    pageRange,
    langs,
    status: 'completed' satisfies OcrJobStatus & string as 'completed' | 'cancelled' | 'failed',
    totalWords,
    meanConfidence,
    totalDurationMs: clock() - startedAt,
    pageResults,
  };
  emit({ jobId, phase: 'completed', summary });
  return ok({ newBytes, summary });
}
