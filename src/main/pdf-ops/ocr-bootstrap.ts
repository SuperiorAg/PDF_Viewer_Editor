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

import { promises as fsPromises, existsSync, createWriteStream } from 'node:fs';
import * as nodeHttps from 'node:https';
import { join as pathJoin } from 'node:path';

import { app } from 'electron';
// Type-only companion to the lazy `require('electron')` in the OCR-init error
// path below — erased at compile time; satisfies consistent-type-imports
// without forcing electron to load eagerly in that branch.
import type * as ElectronModule from 'electron';

import type { OcrPageResult } from '../../ipc/contracts.js';

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
        throw new Error(
          `tesseract.js module not found — Diego Wave 21 must install it. (${(e as Error).name})`,
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
  const moduleName = 'pdfjs-dist' + '/legacy/build/pdf.mjs';
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const mod = (await import(moduleName)) as PdfJsModule;
  _pdfjs = mod;
  return mod;
}

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

  // Canvas adapter — lazy-load. Wave 21 Diego installs `@napi-rs/canvas`
  // or `canvas` (both MIT) so this works in production. If not installed,
  // we throw a typed error the engine maps to `pdf_render_failed`.
  let createCanvasFn: (
    w: number,
    h: number,
  ) => { getContext: (kind: '2d') => unknown; toBuffer: (mime: string) => Buffer };
  try {
    const moduleName = '@napi-rs/canvas';
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const canvasMod = require(moduleName) as {
      createCanvas: typeof createCanvasFn;
    };
    createCanvasFn = canvasMod.createCanvas;
  } catch {
    try {
      const moduleName = 'canvas';
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const canvasMod = require(moduleName) as {
        createCanvas: typeof createCanvasFn;
      };
      createCanvasFn = canvasMod.createCanvas;
    } catch {
      throw new Error(
        'canvas adapter not installed (@napi-rs/canvas or canvas required for OCR rasterization)',
      );
    }
  }
  const canvas = createCanvasFn(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
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

function createNodeHttpsStreamer(): HttpStreamer {
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
        const req = nodeHttps.get(url, { timeout: 30_000 }, (res) => {
          const contentLength = parseInt(res.headers['content-length'] ?? '0', 10);
          totalBytes = isNaN(contentLength) ? 0 : contentLength;
          res.on('data', (chunk: Buffer) => {
            bytesDownloaded += chunk.byteLength;
            onProgress(bytesDownloaded, totalBytes);
          });
          res.pipe(writeStream);
          writeStream.on('finish', () => {
            writeStream.close();
            resolve(bytesDownloaded);
          });
          writeStream.on('error', (err) => reject(err));
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
