// Phase 5 — OCR runtime bootstrap.
//
// Wires the REQUIRED `RegisterOcrOptions` (per conventions §16.3.1 — no
// optional fallback) at app startup. This module is the production glue
// between:
//
//   - tesseract.js workerFactory  → ocr-worker-pool (single funnel)
//   - language-pack-manager       → bundled `eng` + lazy-download
//   - pdfjs page rasterizer       → main-side raster bytes feed
//   - searchable-pdf-builder      → text-behind-image composition
//
// Diego's Wave 21 packaging installs tesseract.js + adds the
// extraResources entry for `eng.traineddata.gz`. Before Wave 21, the worker
// factory's `create()` will throw "module 'tesseract.js' not found" at the
// first OCR run — the pool wraps that in a typed `worker_init_failed`
// Result the renderer surfaces honestly.
//
// THIS FILE IS REQUIRED AT BOOT. There is no opt-out.

import {
  promises as fsPromises,
  existsSync,
  createWriteStream,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import * as nodeHttps from 'node:https';
import { join as pathJoin } from 'node:path';

import { app } from 'electron';
// Type-only companion to the lazy `require('electron')` in the OCR-init error
// path below — erased at compile time; satisfies consistent-type-imports
// without forcing electron to load eagerly in that branch.
import type * as ElectronModule from 'electron';

import type { OcrPageResult } from '../../ipc/contracts.js';
import { safeMessage } from '../../shared/result.js';

import { documentStore } from './document-store.js';
import {
  createLanguagePackManager,
  type Catalog,
  type DownloadProgressFn,
  type Filesystem,
  type HttpStreamer,
  type LanguagePackManager,
  type PathResolver,
} from './language-pack-manager.js';
import {
  createOcrWorkerPool,
  type OcrWorkerPool,
  type TesseractWorker,
  type TesseractWorkerFactory,
  type RasterPageOptions,
} from './ocr-engine.js';
import { composeSearchablePdf as composeSearchablePdfImpl } from './ocr-text-layer.js';
import { loadPdfMetadata } from './pdf-metadata-loader.js';

// ============================================================================
// Tesseract.js worker factory
//
// Production-grade thin wrapper. Imports `tesseract.js` via a dynamic
// `require()` so the type compiler does not require the package to be
// installed (Diego Wave 21 installs it). At first OCR run on a machine
// without tesseract.js installed, this throws "Cannot find module" which
// the pool surfaces as `worker_init_failed` — a typed Result the renderer
// handles, not a process crash.
// ============================================================================

interface TesseractJsWorker {
  recognize: (image: Uint8Array | Buffer | string) => Promise<{
    data: {
      words: Array<{
        text: string;
        confidence: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
      // tesseract.js v6+ exposes the recognized image dimensions on the data
      // result; we fall back to defaults if absent.
      imageWidth?: number;
      imageHeight?: number;
    };
  }>;
  terminate: () => Promise<void>;
}

interface TesseractJsModule {
  createWorker: (
    lang: string,
    oem?: number,
    options?: {
      langPath?: string;
      gzip?: boolean;
      cachePath?: string;
    },
  ) => Promise<TesseractJsWorker>;
}

function createTesseractWorkerFactory(): TesseractWorkerFactory {
  return {
    async create(lang: string, langDir: string): Promise<TesseractWorker> {
      // Dynamic require avoids a hard compile-time dep on tesseract.js.
      // The string is built indirectly so a future webpack bundle on the
      // main process does not try to resolve it at bundle time.
      let mod: TesseractJsModule;
      try {
        const moduleName = 'tesseract' + '.js';
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        mod = require(moduleName) as TesseractJsModule;
      } catch (e) {
        // Use `.message` so the operator sees WHY require failed
        // (MODULE_NOT_FOUND vs ERR_DLOPEN_FAILED vs syntax error).
        const cause = e instanceof Error ? e.message : 'unknown';
        throw new Error(
          `tesseract.js module not found — Diego Wave 21 must install it. (${cause})`,
        );
      }
      const cachePath = pathJoin(app.getPath('userData'), 'tessdata-cache');
      const raw = await mod.createWorker(lang, 1, {
        langPath: langDir,
        gzip: true,
        cachePath,
      });
      return {
        async recognize(imageBytes: Uint8Array) {
          // tesseract.js accepts a Uint8Array / Buffer / file path / data URL.
          const r = await raw.recognize(imageBytes);
          return {
            words: r.data.words.map((w) => ({
              text: w.text,
              confidence: w.confidence,
              bbox: w.bbox,
            })),
            imageWidthPx: r.data.imageWidth ?? 0,
            imageHeightPx: r.data.imageHeight ?? 0,
          };
        },
        async terminate() {
          await raw.terminate();
        },
      };
    },
  };
}

// ============================================================================
// Page rasterizer + dimensions
//
// Production wiring: load doc bytes (from documentStore) → render the
// requested page via pdfjs-dist at the chosen DPI → return PNG bytes.
//
// Wave 20 ships a metadata-driven implementation that uses pdf-lib for page
// dimensions (loadPdfMetadata) AND defers the actual raster output to a
// lazy pdfjs-dist import at first OCR call (avoids a startup penalty for
// users who never OCR). When pdfjs-dist is not available, the rasterizer
// throws — the engine surfaces this as `pdf_render_failed`.
// ============================================================================

interface PdfJsPage {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: { canvasContext: unknown; viewport: unknown }) => {
    promise: Promise<void>;
  };
}

interface PdfJsDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfJsPage>;
}

interface PdfJsModule {
  getDocument: (params: { data: Uint8Array }) => { promise: Promise<PdfJsDoc> };
  GlobalWorkerOptions?: { workerSrc?: string };
}

// Cached pdfjs module reference; lazy-loaded on first OCR.
let _pdfjs: PdfJsModule | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (_pdfjs !== null) return _pdfjs;
  // Canvas globals (Path2D/Image/DOMMatrix/ImageData/DOMPoint) MUST be on
  // globalThis BEFORE pdf.js's legacy module is evaluated. pdf.js v4 captures
  // whether `globalThis.Path2D` exists at load time and builds an internal
  // `Path` polyfill if absent — and @napi-rs/canvas's `ctx.fill(path)` rejects
  // that polyfill with "Value is none of these types `String`, `Path`,". This
  // mirrors `src/main/export/export-bootstrap.ts:ensurePdfJs` which had the
  // same fix for export. `tryLoadCanvas()` is idempotent and side-effects the
  // global install; we ignore its return value here (rasterizePageProd reads
  // it later for the createCanvas function + the actionable error message).
  tryLoadCanvas();
  const moduleName = 'pdfjs-dist' + '/legacy/build/pdf.mjs';
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const mod = (await import(moduleName)) as PdfJsModule;
  _pdfjs = mod;
  return mod;
}

// ============================================================================
// Canvas adapter loader (extracted from rasterizePageProd so the diagnose-ocr
// IPC handler can introspect it without running a full rasterize).
//
// HARDENING (David, 2026-06-01): the v0.7.9 bug report showed users hitting
// "rasterize page 0 failed: Error" when the canvas .node binary is in the
// packaged binary but Windows refuses to dlopen it. The original catch was a
// bare `catch {}` that hid every loader failure behind a generic
// "@napi-rs/canvas or canvas required" message. We now:
//   1. Catch `MODULE_NOT_FOUND` (require resolution miss) and
//      `ERR_DLOPEN_FAILED` (Windows-side .node load failure) DISTINCTLY so
//      the operator sees an actionable message.
//   2. Cache both the loaded module reference AND the failure error so the
//      diagnose-ocr handler can report ground truth without re-attempting.
// ============================================================================

type CreateCanvasFn = (
  w: number,
  h: number,
) => { getContext: (kind: '2d') => unknown; toBuffer: (mime: string) => Buffer };

interface CanvasLoadOk {
  ok: true;
  source: '@napi-rs/canvas' | 'canvas';
  createCanvas: CreateCanvasFn;
}
interface CanvasLoadErr {
  ok: false;
  /** Concatenated diagnostic from BOTH @napi-rs/canvas and canvas attempts. */
  errorMessage: string;
  /** True when at least one attempt failed with ERR_DLOPEN_FAILED (Windows asar miss). */
  dlopenFailed: boolean;
}
type CanvasLoadResult = CanvasLoadOk | CanvasLoadErr;

// Cached load result so the diagnose handler doesn't double-attempt.
let _canvasLoadResult: CanvasLoadResult | null = null;

function describeLoadError(e: unknown): { code: string; message: string } {
  const code =
    e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string'
      ? (e as { code: string }).code
      : 'unknown';
  const message = e instanceof Error ? e.message : String(e);
  return { code, message };
}

/**
 * Install Canvas2D / Web-Image globals onto `globalThis` from the loaded canvas
 * module. pdf.js's legacy build resolves `Image`, `Path2D`, `ImageData`,
 * `DOMMatrix`, and `DOMPoint` via `globalThis` at render time. Both
 * `@napi-rs/canvas` and `node-canvas` ship these as NAMED EXPORTS but do NOT
 * auto-install them on `globalThis` — so without this step pdf.js falls back to
 * its internal polyfills (e.g. it builds its own `Path` class) which the native
 * 2d context rejects.
 *
 * Two symptoms in the wild before this install ran:
 *   1. Text pages: `Value is none of these types String, Path` from
 *      `ctx.fill(path)` because pdf.js handed it the internal Path polyfill.
 *      (Already fixed for EXPORT in export-bootstrap.registerExportCanvasGlobals
 *      via Path2D/DOMMatrix/ImageData/DOMPoint — but the OCR rasterizer was
 *      missing the same step, regression v0.7.10.)
 *   2. Image XObjects: `Value is none of these types String, Path` from
 *      @napi-rs/canvas's `Image` constructor when pdf.js does `new Image()` and
 *      then assigns image data via property setters. @napi-rs/canvas's `Image`
 *      requires constructor args (String filepath or Path filesystem object) —
 *      installing the class on globalThis lets pdf.js's image-XObject decoder
 *      take its alternate code path that uses the named constructor signature.
 *      (User-reported in v0.7.10 on a real text-bearing PDF.)
 *
 * The `=== undefined` guards prevent stomping on real globals if some other
 * code (Electron renderer, polyfill loader, test setup) already installed them.
 * Idempotent — safe to call multiple times.
 */
function installCanvasGlobals(napi: Record<string, unknown>): void {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of ['Image', 'Path2D', 'ImageData', 'DOMMatrix', 'DOMPoint']) {
    if (g[key] === undefined && typeof napi[key] === 'function') {
      g[key] = napi[key];
    }
  }
}

export function tryLoadCanvas(): CanvasLoadResult {
  if (_canvasLoadResult !== null) return _canvasLoadResult;
  const attempts: string[] = [];
  let dlopenFailed = false;
  try {
    const moduleName = '@napi-rs/canvas';
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const canvasMod = require(moduleName) as Record<string, unknown> & {
      createCanvas: CreateCanvasFn;
    };
    installCanvasGlobals(canvasMod);
    _canvasLoadResult = {
      ok: true,
      source: '@napi-rs/canvas',
      createCanvas: canvasMod.createCanvas,
    };
    // Fire-and-forget one-time success snapshot — gives us ground truth on
    // what the user's machine actually has installed for the canvas globals.
    writeCanvasLoadSnapshot('@napi-rs/canvas');
    return _canvasLoadResult;
  } catch (e) {
    const { code, message } = describeLoadError(e);
    if (code === 'ERR_DLOPEN_FAILED') dlopenFailed = true;
    attempts.push(`@napi-rs/canvas: ${code} — ${message}`);
  }
  try {
    const moduleName = 'canvas';
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const canvasMod = require(moduleName) as Record<string, unknown> & {
      createCanvas: CreateCanvasFn;
    };
    installCanvasGlobals(canvasMod);
    _canvasLoadResult = { ok: true, source: 'canvas', createCanvas: canvasMod.createCanvas };
    writeCanvasLoadSnapshot('canvas');
    return _canvasLoadResult;
  } catch (e) {
    const { code, message } = describeLoadError(e);
    if (code === 'ERR_DLOPEN_FAILED') dlopenFailed = true;
    attempts.push(`canvas: ${code} — ${message}`);
  }
  _canvasLoadResult = {
    ok: false,
    errorMessage: attempts.join('; '),
    dlopenFailed,
  };
  return _canvasLoadResult;
}

// ============================================================================
// Rasterize-failure diagnostic capture (David, 2026-06-04 — v0.7.12 follow-up)
//
// Background: v0.7.10 → v0.7.11 → v0.7.12 each shipped a fix for the
// "rasterize page 0 failed: Value is none of these types `String`, `Path`,..."
// toast. Synthetic PDFs reproduce nothing on our dev machines. v0.7.12's
// `@napi-rs/canvas` globalThis polyfill is in place but a real user still
// hits the bug on a real PDF we don't have.
//
// To break the loop without asking the user to run an external diagnose
// script, we now capture the FULL native stack (canvas module + version,
// node/electron versions, platform/arch, the pdf bytes length, the canvas
// dimensions we tried to render at, every relevant globalThis class
// presence, full error stack/cause) to a JSON file under userData/logs/
// every time `page.render().promise` rejects. The thrown error then carries
// the log-file path so the user-facing toast tells them WHERE to send us.
//
// Design rules:
//   - The capture path NEVER masks the original error. If writeFileSync
//     itself throws (read-only userData, ENOSPC, AV interference), we
//     swallow the secondary failure and rethrow an error that still
//     contains the original message. The user will be no worse off than
//     before this feature; with luck they'll be in a much better place.
//   - `require('electron')` is lazy inside the catch so the test-context
//     module load (vitest, where `electron` exists as a stub but
//     `app.getPath` would throw) does not break unit tests for this file.
//     The unit tests mock `electron` explicitly and assert the catch path.
//   - One canvas-load snapshot per process. Subsequent calls no-op via a
//     module-scope boolean.
// ============================================================================

interface DiagnosticRecord {
  timestamp: number;
  kind: 'rasterize-failure' | 'canvas-load';
  error: {
    name: string | null;
    message: string | null;
    stack: string | null;
    code: string | null;
    cause: string | null;
  } | null;
  pdfBytes_length: number | null;
  pageIndex: number | null;
  dpi: number | null;
  scale: number | null;
  canvasWidth: number | null;
  canvasHeight: number | null;
  canvas_module: '@napi-rs/canvas' | 'canvas' | 'none';
  module_version: string | null;
  node_version: string;
  electron_version: string;
  platform: string;
  arch: string;
  hasGlobalImage: string;
  hasGlobalPath2D: string;
  hasGlobalImageData: string;
  hasGlobalDOMMatrix: string;
  hasGlobalDOMPoint: string;
}

function readCanvasModuleVersion(source: '@napi-rs/canvas' | 'canvas'): string | null {
  try {
    // Reading the package.json with `require` is the cheapest way to learn
    // the installed version — no second `require` of the native binding.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const pkg = require(`${source}/package.json`) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

function describeRasterizeError(e: unknown): NonNullable<DiagnosticRecord['error']> {
  const name = e instanceof Error ? e.name : null;
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : null;
  const stack = e instanceof Error && typeof e.stack === 'string' ? e.stack : null;
  let code: string | null = null;
  if (e && typeof e === 'object' && 'code' in e) {
    const c = (e as { code: unknown }).code;
    if (typeof c === 'string' || typeof c === 'number') code = String(c);
  }
  let cause: string | null = null;
  if (e && typeof e === 'object' && 'cause' in e) {
    const c = (e as { cause: unknown }).cause;
    if (c instanceof Error) cause = `${c.name}: ${c.message}`;
    else if (typeof c === 'string') cause = c;
    else if (c !== undefined && c !== null) cause = JSON.stringify(c);
  }
  return { name, message, stack, code, cause };
}

function buildDiagnosticRecord(args: {
  kind: 'rasterize-failure' | 'canvas-load';
  error: unknown | null;
  pdfBytesLength: number | null;
  pageIndex: number | null;
  dpi: number | null;
  scale: number | null;
  canvasWidth: number | null;
  canvasHeight: number | null;
}): DiagnosticRecord {
  // Read the cached load result instead of re-attempting — the diagnostic
  // path must never trigger another require of a possibly-broken binding.
  const loaded = _canvasLoadResult;
  const canvasModule: '@napi-rs/canvas' | 'canvas' | 'none' =
    loaded && loaded.ok ? loaded.source : 'none';
  const moduleVersion = loaded && loaded.ok ? readCanvasModuleVersion(loaded.source) : null;
  const g = globalThis as unknown as Record<string, unknown>;
  return {
    timestamp: Date.now(),
    kind: args.kind,
    error: args.error === null ? null : describeRasterizeError(args.error),
    pdfBytes_length: args.pdfBytesLength,
    pageIndex: args.pageIndex,
    dpi: args.dpi,
    scale: args.scale,
    canvasWidth: args.canvasWidth,
    canvasHeight: args.canvasHeight,
    canvas_module: canvasModule,
    module_version: moduleVersion,
    node_version: process.versions.node,
    electron_version: process.versions.electron ?? '',
    platform: process.platform,
    arch: process.arch,
    hasGlobalImage: typeof g['Image'],
    hasGlobalPath2D: typeof g['Path2D'],
    hasGlobalImageData: typeof g['ImageData'],
    hasGlobalDOMMatrix: typeof g['DOMMatrix'],
    hasGlobalDOMPoint: typeof g['DOMPoint'],
  };
}

/**
 * Resolves the userData/logs directory. Throws if `app.getPath('userData')`
 * itself throws (e.g. running under a non-Electron host) — callers MUST wrap
 * in try/catch so failure to resolve the log dir never masks the original
 * error we're trying to log.
 *
 * Uses the top-level ESM `app` binding rather than a lazy CJS `require()`
 * because vitest's `vi.mock('electron', ...)` only intercepts the ESM
 * specifier; a CJS require here would bypass the mock and crash unit tests.
 */
function resolveLogsDir(): string {
  return pathJoin(app.getPath('userData'), 'logs');
}

/**
 * Writes the diagnostic record to userData/logs/<filename>.json. Returns the
 * absolute path on success, or `null` if anything in the path resolution /
 * mkdir / writeFileSync chain threw. NEVER throws — the caller depends on
 * this being side-effect-only.
 */
function writeDiagnosticLog(filename: string, record: DiagnosticRecord): string | null {
  try {
    const dir = resolveLogsDir();
    mkdirSync(dir, { recursive: true });
    const logPath = pathJoin(dir, filename);
    writeFileSync(logPath, JSON.stringify(record, null, 2), 'utf8');
    return logPath;
  } catch (writeErr) {
    // Logging failure must never mask the bug. Surface the secondary error to
    // the console for operator triage, then return null so the caller falls
    // back to the bare original message.
    console.error('[ocr-bootstrap] failed to write diagnostic log:', writeErr);
    return null;
  }
}

// Module-scope guard: write the canvas-load snapshot at most once per process.
let _canvasLoadSnapshotWritten = false;

function writeCanvasLoadSnapshot(source: '@napi-rs/canvas' | 'canvas'): void {
  if (_canvasLoadSnapshotWritten) return;
  _canvasLoadSnapshotWritten = true;
  const record = buildDiagnosticRecord({
    kind: 'canvas-load',
    error: null,
    pdfBytesLength: null,
    pageIndex: null,
    dpi: null,
    scale: null,
    canvasWidth: null,
    canvasHeight: null,
  });
  // Force the canvas_module field to reflect the load that JUST succeeded —
  // _canvasLoadResult is set BEFORE we call writeCanvasLoadSnapshot in
  // tryLoadCanvas, so buildDiagnosticRecord already picks it up; but this
  // explicit override is a belt-and-braces guard against future reordering.
  record.canvas_module = source;
  record.module_version = readCanvasModuleVersion(source);
  writeDiagnosticLog('canvas-load.json', record);
}

// ============================================================================
// Test seams (David, 2026-06-04)
//
// Exposed via a single export so unit tests can drive the diagnostic capture
// without standing up a full pdf.js + canvas pipeline. NOT part of the
// production API surface — call sites in tests only. The leading underscore +
// the `__test` namespace make accidental production import obvious in PR
// review.
// ============================================================================

export const __test = {
  buildDiagnosticRecord,
  writeDiagnosticLog,
  /** Force-reset the canvas-load snapshot guard between tests. */
  resetCanvasLoadSnapshotGuard(): void {
    _canvasLoadSnapshotWritten = false;
  },
  /** Inspect the snapshot guard (read-only). */
  isCanvasLoadSnapshotWritten(): boolean {
    return _canvasLoadSnapshotWritten;
  },
  writeCanvasLoadSnapshot,
};

/**
 * Production rasterizer. Renders a page to a PNG-equivalent ImageData buffer
 * at the requested DPI. The output is the raw pixel bytes Tesseract accepts.
 *
 * Implementation note: pdfjs in main needs a canvas adapter. For Wave 20
 * we use Node's `@napi-rs/canvas` if available; otherwise we throw and the
 * engine surfaces `pdf_render_failed`. Diego Wave 21 may install a canvas
 * polyfill (`canvas` MIT or `@napi-rs/canvas` MIT) as part of the OCR
 * dependency bundle.
 */
export async function rasterizePageProd(opts: RasterPageOptions): Promise<Uint8Array> {
  const rec = documentStore.get(opts.handle);
  if (!rec) throw new Error(`handle ${opts.handle} not in document store`);
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: rec.bytes }).promise;
  if (opts.pageIndex >= doc.numPages) {
    throw new Error(`pageIndex ${opts.pageIndex} >= numPages ${doc.numPages}`);
  }
  const page = await doc.getPage(opts.pageIndex + 1); // pdfjs is 1-indexed
  const scale = opts.dpi / 72;
  const viewport = page.getViewport({ scale });

  // Canvas adapter — lazy-load via the shared tryLoadCanvas() helper. The
  // helper distinguishes MODULE_NOT_FOUND (dep truly missing) from
  // ERR_DLOPEN_FAILED (Windows refused to dlopen the .node file inside asar
  // — almost always a packaging/asarUnpack issue) so the user sees an
  // actionable message instead of a bare "Error".
  //
  // 2026-06-01 (David): hardened in response to v0.7.9 user report where the
  // toast read "rasterize page 0 failed: Error" with no diagnostic.
  const loaded = tryLoadCanvas();
  if (!loaded.ok) {
    if (loaded.dlopenFailed) {
      throw new Error(
        `@napi-rs/canvas native binding could not be loaded in the packaged app. This is a packaging issue (the .node file failed to dlopen — likely missing from asarUnpack or blocked by AV/permissions), not a runtime config issue. Reinstall the app or report to dev. Details: ${loaded.errorMessage}`,
      );
    }
    throw new Error(
      `canvas adapter not installed (@napi-rs/canvas or canvas required for OCR rasterization). Details: ${loaded.errorMessage}`,
    );
  }
  const createCanvasFn = loaded.createCanvas;
  const canvasWidth = Math.ceil(viewport.width);
  const canvasHeight = Math.ceil(viewport.height);
  const canvas = createCanvasFn(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  try {
    await page.render({ canvasContext: ctx, viewport }).promise;
  } catch (originalErr) {
    // Hard-Won (David, 2026-06-04 — v0.7.13): synthetic PDFs reproduce
    // nothing, so we can't fix this from our machines. Instead, capture the
    // FULL native stack to a JSON file under userData/logs/ and surface the
    // log path in the rethrown error message. The user's bug report then
    // includes a path they can attach — turns every report into a
    // self-service diagnostic.
    const record = buildDiagnosticRecord({
      kind: 'rasterize-failure',
      error: originalErr,
      pdfBytesLength: rec.bytes.length,
      pageIndex: opts.pageIndex,
      dpi: opts.dpi,
      scale,
      canvasWidth,
      canvasHeight,
    });
    const logPath = writeDiagnosticLog(`ocr-rasterize-${record.timestamp}.json`, record);
    const originalMessage = safeMessage(originalErr, 'unknown');
    const detail =
      logPath !== null ? `${originalMessage} — diagnostic written to ${logPath}` : originalMessage;
    const wrapped = new Error(`rasterize page ${opts.pageIndex} failed: ${detail}`);
    // Preserve the original error for any downstream consumer that walks
    // `Error.cause` (Node ≥16.9). The engine's `safeMessage(e, ...)` reads
    // `.message` only, so the wrapped message is what surfaces to the toast.
    (wrapped as Error & { cause?: unknown }).cause = originalErr;
    throw wrapped;
  }
  const png = canvas.toBuffer('image/png');
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}

export async function pageDimensionsProd(
  handle: number,
  pageIndex: number,
): Promise<{ widthPts: number; heightPts: number }> {
  const rec = documentStore.get(handle);
  if (!rec) throw new Error(`handle ${handle} not in document store`);
  // pdf-lib metadata loader exposes per-page dimensions; here we read them
  // from the parsed metadata. For Wave 20 we minimally call loadPdfMetadata
  // and synthesize via pdf-lib's page-by-page access pattern. The cleanest
  // path is loading once and getPage(n).getWidth()/getHeight().
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(rec.bytes, { updateMetadata: false });
  if (pageIndex < 0 || pageIndex >= doc.getPageCount()) {
    throw new Error(`pageIndex ${pageIndex} out of range`);
  }
  const page = doc.getPage(pageIndex);
  return { widthPts: page.getWidth(), heightPts: page.getHeight() };
}

// ============================================================================
// HTTP streamer (production)
// ============================================================================

export function createNodeHttpsStreamer(): HttpStreamer {
  return {
    async download(
      url: string,
      destPath: string,
      onProgress: DownloadProgressFn,
      signal: AbortSignal,
    ): Promise<number> {
      return await new Promise<number>((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error('AbortError'));
          return;
        }
        const writeStream = createWriteStream(destPath);
        let totalBytes = 0;
        let bytesDownloaded = 0;
        // Hoist writeStream listeners BEFORE `nodeHttps.get` so a synchronous
        // 'error' emit from createWriteStream (e.g. read-only destination,
        // EACCES, ENOSPC) is captured by `reject` instead of crashing the main
        // process. Audit finding 2026-06-02 — same pattern as `tsa-client.ts:183`.
        writeStream.on('error', (err) => reject(err));
        writeStream.on('finish', () => {
          writeStream.close();
          resolve(bytesDownloaded);
        });
        const req = nodeHttps.get(url, { timeout: 30_000 }, (res) => {
          // Attach the response error handler FIRST — TLS truncation / mid-stream
          // ECONNRESET emits 'error' on `res`, and without a listener Node
          // crashes the main process. Mirrors `tsa-client.ts:183`.
          res.on('error', (err) => reject(err));
          const contentLength = parseInt(res.headers['content-length'] ?? '0', 10);
          totalBytes = isNaN(contentLength) ? 0 : contentLength;
          res.on('data', (chunk: Buffer) => {
            bytesDownloaded += chunk.byteLength;
            onProgress(bytesDownloaded, totalBytes);
          });
          res.pipe(writeStream);
        });
        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
          req.destroy(new Error('timeout'));
        });
        signal.addEventListener('abort', () => {
          req.destroy(new Error('AbortError'));
          writeStream.close();
        });
      });
    },
  };
}

// ============================================================================
// Filesystem adapter
// ============================================================================

function createFilesystem(): Filesystem {
  return {
    existsSync,
    async mkdir(path: string, recursive: boolean) {
      await fsPromises.mkdir(path, { recursive });
    },
    async readFileBytes(path: string) {
      return new Uint8Array(await fsPromises.readFile(path));
    },
    async unlink(path: string) {
      await fsPromises.unlink(path);
    },
    async stat(path: string) {
      const s = await fsPromises.stat(path);
      return { size: s.size };
    },
  };
}

// ============================================================================
// Path resolver
// ============================================================================

function createPathResolver(): PathResolver {
  return {
    bundledTessdataDir() {
      // process.resourcesPath is set by Electron in packaged builds; in dev
      // it points at the Electron app's resources dir which doesn't contain
      // the bundled pack. Wave 21 Diego copies `eng.traineddata.gz` here via
      // electron-builder extraResources.
      return pathJoin(process.resourcesPath ?? '.', 'tessdata');
    },
    userTessdataDir() {
      return pathJoin(app.getPath('userData'), 'tessdata');
    },
  };
}

// ============================================================================
// Catalog loader (loads the shipped JSON from disk)
// ============================================================================

function loadCatalogSync(): Catalog {
  // The catalog ships at `src/main/pdf-ops/language-pack-catalog.json`.
  // After Vite-electron build, it lands alongside the main bundle. We
  // resolve it via `require` (synchronous JSON load — small file).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const catalog = require('./language-pack-catalog.json') as Catalog;
    return catalog;
  } catch (e) {
    // Wave 21 Julian-finding H-21.2 fix: silently degrading to an empty
    // catalog masks a packaging defect (the build artifact is missing the
    // JSON). The renderer would show "no language packs available" with no
    // diagnostic. Log loudly + surface a startup error box so the failure
    // is visible to operators. The renderer's existing toast pathway
    // (src/main/index.ts post-bootstrap branch) is reserved for DB-init
    // failure; this is a parallel signal on the OCR boot side.
    const msg = (e as Error).message ?? 'unknown error';
    console.error(
      '[ocr-bootstrap] language-pack-catalog.json failed to load — OCR will be unreachable. Cause:',
      msg,
    );
    try {
      // dialog.showErrorBox is synchronous and main-process-only; safe to
      // call here because bootstrapOcr() runs from the after-whenReady
      // hook in src/main/index.ts.
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const { dialog } = require('electron') as typeof ElectronModule;
      dialog.showErrorBox(
        'OCR initialization failed',
        `The language-pack catalog could not be loaded (${msg}). OCR features will be unavailable until the installation is repaired.`,
      );
    } catch {
      /* in non-Electron test contexts the dialog import will fail — ignore */
    }
    return { version: 'unknown', baseUrl: '', packs: [] };
  }
}

// ============================================================================
// Public entry — production wiring for register.ts
// ============================================================================

export interface BootstrappedOcr {
  pool: OcrWorkerPool;
  languagePackManager: LanguagePackManager;
  rasterizePage: (opts: RasterPageOptions) => Promise<Uint8Array>;
  pageDimensions: (
    handle: number,
    pageIndex: number,
  ) => Promise<{ widthPts: number; heightPts: number }>;
  composeSearchablePdf: (
    originalBytes: Uint8Array,
    pageResults: OcrPageResult[],
  ) => Promise<Uint8Array>;
  watchdogMs: number;
  rasterDpi: number;
}

export function bootstrapOcr(): BootstrappedOcr {
  void loadPdfMetadata; // referenced for cross-link; not called directly.
  const languagePackManager = createLanguagePackManager({
    paths: createPathResolver(),
    httpStreamer: createNodeHttpsStreamer(),
    fs: createFilesystem(),
    catalog: loadCatalogSync(),
  });
  const pool = createOcrWorkerPool({
    workerFactory: createTesseractWorkerFactory(),
    languagePackManager,
    maxConcurrentLanguages: 4,
  });
  return {
    pool,
    languagePackManager,
    rasterizePage: rasterizePageProd,
    pageDimensions: pageDimensionsProd,
    composeSearchablePdf: async (orig, results) => {
      const r = await composeSearchablePdfImpl(orig, results);
      if (!r.ok) {
        throw new Error(`composeSearchablePdf failed: ${r.error} — ${r.message}`);
      }
      return r.value;
    },
    watchdogMs: 60_000,
    rasterDpi: 300,
  };
}

// ============================================================================
// Diagnostic introspection (David, 2026-06-01)
//
// Used by the `app:diagnoseOcr` IPC channel. Returns a snapshot of every
// runtime dependency the OCR pipeline needs. Safe to call from any context:
// it never throws and never mutates state (loadPdfJs IS a cached lazy import,
// but reading the cache is read-only).
// ============================================================================

export interface DiagnoseOcrSnapshot {
  /** True if `require('@napi-rs/canvas')` or `require('canvas')` succeeds. */
  canvasModuleResolvable: boolean;
  /** Concatenated load-attempt errors when canvasModuleResolvable=false. */
  canvasModuleLoadError: string | null;
  /** True if pdfjs-dist legacy build can be dynamically imported. */
  pdfjsLoadable: boolean;
  /** True if tesseract.js-core is reachable from the runtime resolver. */
  tesseractCoreReachable: boolean;
  /** Number of documents currently held in the main-process document store. */
  documentStoreCount: number;
}

export async function diagnoseOcr(): Promise<DiagnoseOcrSnapshot> {
  const canvas = tryLoadCanvas();
  let pdfjsLoadable = false;
  try {
    await loadPdfJs();
    pdfjsLoadable = true;
  } catch {
    pdfjsLoadable = false;
  }
  let tesseractCoreReachable = false;
  try {
    const moduleName = 'tesseract.js' + '-core';
    // We only require the *resolve*, not the full load — tesseract.js-core
    // ships a sizeable WASM blob and we don't want to materialise it just to
    // answer a diagnostic. require.resolve throws iff the module's package
    // root can't be located.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require.resolve(moduleName);
    tesseractCoreReachable = true;
  } catch {
    tesseractCoreReachable = false;
  }
  return {
    canvasModuleResolvable: canvas.ok,
    canvasModuleLoadError: canvas.ok ? null : canvas.errorMessage,
    pdfjsLoadable,
    tesseractCoreReachable,
    documentStoreCount: documentStore.size(),
  };
}
