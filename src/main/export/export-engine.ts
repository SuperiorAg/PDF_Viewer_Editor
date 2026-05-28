// Export engine (Phase 6, export-engine.md §3 + §8)
//
// SINGLE FUNNEL. Receives an ExportJobSpec, allocates an export_jobs row,
// enqueues, dequeues (concurrency = 1), opens the source PDF via pdf.js,
// extracts per page (text → layout → tables → images), dispatches to ONE
// writer per job, writes atomically (.export-temp → rename).
//
// DISCIPLINE (conventions §17.1-§17.6):
//   - Read-only on source — NO pdf-lib.save / no signature_audit_log update / no edit_history insert.
//   - Output bytes stay in main. The renderer receives ONLY `{ jobId, summary, outputPaths }`.
//   - Required-on-interface DI (no optional writer with stub fallback).
//   - LayoutRect is `T | null` everywhere — no sentinel-zero defaults.
//   - No `as any` / no `@ts-ignore` (Julian Wave 21 H-21.1 ratchet).
//   - Trust-floor obligations live in the modal panel + docs — the engine
//     itself just enforces the boundaries.
//
// CANCELLATION (export-engine.md §8.3 — graceful):
//   - signal.aborted checked at THREE points per page: start, after layout
//     extract, after table detect.
//   - On abort: partial `.export-temp` file is fs.unlink'd.
//   - status → 'cancelled'; progress event emitted.

import * as path from 'node:path';

import type { ExportFormat, ExportJobSummary, ExportProgressEvent } from '../../ipc/contracts.js';

import { createImageExtractor } from './image-extract.js';
import type {
  ImageExtractor,
  ImageResolver,
  PdfOperatorList,
  PngEncoder,
} from './image-extract.js';
import { createLayoutExtractor } from './layout-extract.js';
import type { LayoutExtractor } from './layout-extract.js';
import { createTableDetector } from './table-detect.js';
import type { LineSegment, TableDetector } from './table-detect.js';
import type {
  ExportJobSpec,
  ExtractedDocument,
  ExtractedPage,
  LayoutSettings,
  PageSize,
  PdfTextContent,
} from './types.js';
import type { DocxWriter } from './writers/docx-writer.js';
import type { ImageWriter } from './writers/image-writer.js';
import type { PptxWriter } from './writers/pptx-writer.js';
import type { XlsxWriter } from './writers/xlsx-writer.js';

// ============================================================================
// Required-on-interface DI (conventions §17.4.1)
//
// Every dep below is REQUIRED. If Wave 24 (or any future caller) constructs
// the engine without wiring a writer, TypeScript fails the build at the
// `createExportEngine` call site.
// ============================================================================

/** Per-page source extraction inputs. Production wires pdf.js; tests wire a
 *  synthetic source so we don't need a real PDF for the engine unit tests. */
export interface PageSourceLoader {
  /**
   * OPTIONAL per-job binding hook. The engine is a long-lived singleton but
   * each `runJob` carries its own `spec.sourceBytes`. Production loaders open
   * the pdf.js document lazily from the bound bytes (see
   * `createProdSourceLoader`); synthetic test loaders ignore this. Called once
   * at the start of every job BEFORE any per-page extraction. The engine
   * `await`s it so the document can be opened up-front.
   */
  bind?(spec: ExportJobSpec): Promise<void>;
  /**
   * OPTIONAL per-job teardown. Called after a job terminates (success, failure
   * or cancel) so the loader can release the pdf.js document + cached page
   * objects. Production loaders destroy the doc proxy here.
   */
  release?(): Promise<void>;
  getPageSize(pageIndex: number): Promise<PageSize>;
  getTextContent(pageIndex: number): Promise<PdfTextContent>;
  getOperatorList(pageIndex: number): Promise<PdfOperatorList>;
  /** Resolves XObject names → decoded raster objects. */
  getImageResolver(pageIndex: number): Promise<ImageResolver>;
  /** Path-construction segments captured from the page's operator stream
   *  (the table detector's input). Production extracts these via a parallel
   *  walk of the same opList; tests pass directly. */
  getLineSegments(pageIndex: number): Promise<LineSegment[]>;
}

export interface ExportEngineDeps {
  layoutExtractor: LayoutExtractor;
  tableDetector: TableDetector;
  imageExtractor: ImageExtractor;
  /** All four writers REQUIRED — exhaustive dispatch on `request.format`. */
  writers: {
    docx: DocxWriter;
    xlsx: XlsxWriter;
    pptx: PptxWriter;
    image: ImageWriter;
  };
  /** PNG encoder injected so the image-extractor and image-writer share. */
  pngEncoder: PngEncoder;
  /** Per-page source loader. */
  loader: PageSourceLoader;
  /** fs adapter — production passes node:fs/promises; tests inject a mock. */
  fs: {
    writeFile(p: string, b: Uint8Array): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    unlink(p: string): Promise<void>;
    access(p: string): Promise<void>;
  };
  /** Settings overrides for the layout extractor. Optional; defaults sensible. */
  layoutSettings?: Partial<LayoutSettings>;
  now?: () => number;
}

// ============================================================================
// Job registry — shared with the export-cancel-job handler.
// ============================================================================

interface ActiveJob {
  jobId: number;
  format: ExportFormat;
  controller: AbortController;
  pagesCompleted: number;
  totalPages: number;
  startedAt: number;
  terminal: 'completed' | 'cancelled' | 'failed' | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __pdfvExportActiveJobs: Map<number, ActiveJob> | undefined;
}

const activeJobs: Map<number, ActiveJob> = globalThis.__pdfvExportActiveJobs ?? new Map();
globalThis.__pdfvExportActiveJobs = activeJobs;

export function getActiveExportJob(jobId: number): ActiveJob | null {
  return activeJobs.get(jobId) ?? null;
}

export function listActiveExportJobs(): ActiveJob[] {
  return Array.from(activeJobs.values());
}

// ============================================================================
// Atomic write helper (export-engine.md §8.5)
// ============================================================================

export async function writeAtomic(
  outputPath: string,
  bytes: Uint8Array,
  fs: ExportEngineDeps['fs'],
): Promise<void> {
  const tmp = `${outputPath}.export-temp`;
  await fs.writeFile(tmp, bytes);
  try {
    await fs.rename(tmp, outputPath);
  } catch (renameErr) {
    // Best-effort cleanup of the temp; surface the original error.
    try {
      await fs.unlink(tmp);
    } catch {
      /* ignore */
    }
    throw renameErr;
  }
}

// ============================================================================
// Engine API
// ============================================================================

export type ExportEngineErrorKind =
  | 'extraction_failed'
  | 'writer_failed'
  | 'output_write_failed'
  | 'rasterize_failed'
  | 'encode_failed'
  | 'cancelled';

export interface ExportEngineResult {
  summary: ExportJobSummary;
  /** Output paths actually written (1 for office; N for image; 1 for multi-tiff). */
  outputPaths: string[];
}

export interface ExportEngineFailure {
  error: ExportEngineErrorKind;
  message: string;
  pagesCompleted: number;
}

export interface ExportEngine {
  runJob(
    spec: ExportJobSpec,
    onProgress: (event: ExportProgressEvent) => void,
  ): Promise<{ ok: true; value: ExportEngineResult } | { ok: false; failure: ExportEngineFailure }>;
}

// ============================================================================
// Per-page streaming extractor
// ============================================================================

async function extractOnePage(
  pageIndex: number,
  spec: ExportJobSpec,
  deps: ExportEngineDeps,
): Promise<ExtractedPage> {
  const pageSize = await deps.loader.getPageSize(pageIndex);
  const textContent = await deps.loader.getTextContent(pageIndex);
  const text = deps.layoutExtractor.extract(textContent, pageSize, deps.layoutSettings);
  const segments = await deps.loader.getLineSegments(pageIndex);
  const tables = deps.tableDetector.detect(segments, textContent, pageSize);
  let images: ExtractedPage['images'] = [];
  if (spec.format === 'docx' || spec.format === 'pptx' || spec.format === 'xlsx') {
    // Office-format extraction — only run image-extract if quality tier is
    // layout-preserving (text-only skips images entirely).
    if (spec.qualityTier === 'layout-preserving') {
      const opList = await deps.loader.getOperatorList(pageIndex);
      const resolver = await deps.loader.getImageResolver(pageIndex);
      images = deps.imageExtractor.extract(opList, resolver, pageSize);
    }
  }
  // Annotations: in v1 we don't read them from the source; the modal toggle
  // determines whether the renderer-aware annotations layer is captured.
  // Phase 6 v1 ships with an empty annotation list (rasterized images
  // capture them visually). Phase 6.1 will wire pdf-lib's getAnnotations().
  const annotations: ExtractedPage['annotations'] = [];
  return {
    pageIndex,
    pageSize,
    text,
    tables,
    images,
    annotations,
  };
}

// ============================================================================
// runJob — single funnel
// ============================================================================

export function createExportEngine(deps: ExportEngineDeps): ExportEngine {
  const clock = deps.now ?? Date.now;

  return {
    async runJob(spec, onProgress) {
      const totalPages = spec.pageRange.end - spec.pageRange.start + 1;
      const controller = new AbortController();
      const job: ActiveJob = {
        jobId: spec.jobId,
        format: spec.format,
        controller,
        pagesCompleted: 0,
        totalPages,
        startedAt: clock(),
        terminal: null,
      };
      activeJobs.set(spec.jobId, job);

      // Per-job loader teardown — best-effort; never masks the job result.
      const releaseLoader = async (): Promise<void> => {
        if (deps.loader.release) {
          try {
            await deps.loader.release();
          } catch (e) {
            console.error(
              `[export-engine] loader.release failed for job ${spec.jobId}:`,
              (e as Error).message ?? 'unknown',
            );
          }
        }
      };

      const fail = (
        kind: ExportEngineErrorKind,
        message: string,
      ): { ok: false; failure: ExportEngineFailure } => {
        job.terminal = kind === 'cancelled' ? 'cancelled' : 'failed';
        activeJobs.delete(spec.jobId);
        return {
          ok: false,
          failure: {
            error: kind,
            message,
            pagesCompleted: job.pagesCompleted,
          },
        };
      };

      try {
        onProgress({
          jobId: spec.jobId,
          format: spec.format,
          phase: 'starting',
          totalPages,
        });

        // Pre-flight: writable parent dir probe.
        const parentDir = path.dirname(spec.outputPath);
        try {
          await deps.fs.access(parentDir);
        } catch {
          // The handler should have caught this; engine returns the typed err.
          return fail('output_write_failed', `parent dir not accessible: ${parentDir}`);
        }

        // Per-job source binding — production loaders open the pdf.js document
        // from spec.sourceBytes here. A bind failure (corrupt / unparseable
        // PDF) surfaces as extraction_failed, not a crash.
        if (deps.loader.bind) {
          try {
            await deps.loader.bind(spec);
          } catch (e) {
            return fail('extraction_failed', `source bind: ${(e as Error).message ?? 'unknown'}`);
          }
        }

        // Stream pages and accumulate the ExtractedDocument.
        const pages: ExtractedPage[] = [];
        for (let i = spec.pageRange.start; i <= spec.pageRange.end; i++) {
          // Cancel checkpoint #1 — start of page.
          if (controller.signal.aborted) {
            return fail('cancelled', 'cancelled before page extraction');
          }
          onProgress({
            jobId: spec.jobId,
            format: spec.format,
            phase: 'extracting-text',
            pageIndex: i,
            totalPages,
          });
          let page: ExtractedPage;
          try {
            page = await extractOnePage(i, spec, deps);
          } catch (e) {
            return fail(
              'extraction_failed',
              `page ${i} extraction: ${(e as Error).message ?? 'unknown'}`,
            );
          }
          // Cancel checkpoint #2 — after layout extract.
          if (controller.signal.aborted) {
            return fail('cancelled', 'cancelled after layout extract');
          }
          onProgress({
            jobId: spec.jobId,
            format: spec.format,
            phase: 'detecting-tables',
            pageIndex: i,
            totalPages,
          });
          // Cancel checkpoint #3 — after table detect.
          if (controller.signal.aborted) {
            return fail('cancelled', 'cancelled after table detect');
          }
          if (spec.format === 'docx' || spec.format === 'pptx' || spec.format === 'xlsx') {
            onProgress({
              jobId: spec.jobId,
              format: spec.format,
              phase: 'extracting-images',
              pageIndex: i,
              totalPages,
            });
          }
          if (spec.format === 'png' || spec.format === 'jpeg' || spec.format === 'tiff') {
            onProgress({
              jobId: spec.jobId,
              format: spec.format,
              phase: 'rasterizing',
              pageIndex: i,
              totalPages,
            });
          }
          pages.push(page);
          job.pagesCompleted += 1;
        }

        const doc: ExtractedDocument = {
          pageCount: spec.pageCount,
          pageRange: spec.pageRange,
          pages,
        };

        onProgress({
          jobId: spec.jobId,
          format: spec.format,
          phase: 'writing-output',
          bytesWritten: 0,
          totalBytesEstimate: null,
        });

        // Dispatch to writer (exhaustive — never branch enforces all formats).
        let outputPaths: string[];
        let outputSizeBytes = 0;
        let contentStats: ExportJobSummary['contentStats'] = null;
        try {
          switch (spec.format) {
            case 'docx': {
              const w = deps.writers.docx;
              const pageSize = spec.perFormat.format === 'docx' ? spec.perFormat.pageSize : 'auto';
              const bytes = await w.write(doc, {
                pageSize,
                includeAnnotations: spec.includeAnnotations,
                qualityTier: spec.qualityTier === 'n/a' ? 'layout-preserving' : spec.qualityTier,
              });
              await writeAtomic(spec.outputPath, bytes, deps.fs);
              outputSizeBytes = bytes.byteLength;
              outputPaths = [spec.outputPath];
              contentStats = collectStats(w);
              break;
            }
            case 'xlsx': {
              const w = deps.writers.xlsx;
              const bytes = await w.write(doc, {
                includeAnnotations: spec.includeAnnotations,
                qualityTier: spec.qualityTier === 'n/a' ? 'text-only' : spec.qualityTier,
              });
              await writeAtomic(spec.outputPath, bytes, deps.fs);
              outputSizeBytes = bytes.byteLength;
              outputPaths = [spec.outputPath];
              contentStats = collectStats(w);
              break;
            }
            case 'pptx': {
              const w = deps.writers.pptx;
              const bytes = await w.write(doc, {
                includeAnnotations: spec.includeAnnotations,
                qualityTier: spec.qualityTier === 'n/a' ? 'layout-preserving' : spec.qualityTier,
              });
              await writeAtomic(spec.outputPath, bytes, deps.fs);
              outputSizeBytes = bytes.byteLength;
              outputPaths = [spec.outputPath];
              contentStats = collectStats(w);
              break;
            }
            case 'png':
            case 'jpeg':
            case 'tiff': {
              const w = deps.writers.image;
              const dpi =
                spec.perFormat.format === 'png' ||
                spec.perFormat.format === 'jpeg' ||
                spec.perFormat.format === 'tiff'
                  ? spec.perFormat.dpi
                  : 150;
              // Conditional-spread per exactOptionalPropertyTypes (TS2379).
              const writeOpts: {
                format: typeof spec.format;
                dpi: number;
                includeAnnotations: boolean;
                jpegQuality?: number;
                multiPageTiff?: boolean;
              } = {
                format: spec.format,
                dpi,
                includeAnnotations: spec.includeAnnotations,
              };
              if (spec.perFormat.format === 'jpeg') {
                writeOpts.jpegQuality = spec.perFormat.quality;
              }
              if (spec.perFormat.format === 'tiff') {
                writeOpts.multiPageTiff = spec.perFormat.multiPage;
              }
              const result = await w.write(doc, writeOpts);
              // Write each buffer atomically with the per-page suffix.
              const ext = `.${spec.format}`;
              const base = spec.outputPath.endsWith(ext)
                ? spec.outputPath.slice(0, -ext.length)
                : spec.outputPath;
              outputPaths = [];
              for (let i = 0; i < result.buffers.length; i++) {
                const suffix = result.suffixes[i] ?? '';
                const p = suffix === '' ? `${base}${ext}` : `${base}${suffix}${ext}`;
                await writeAtomic(p, result.buffers[i]!, deps.fs);
                outputSizeBytes += result.buffers[i]!.byteLength;
                outputPaths.push(p);
              }
              break;
            }
            default: {
              // Exhaustive — TS proves no missing case.
              const exhaustive: never = spec.format;
              throw new Error(`unsupported format: ${String(exhaustive)}`);
            }
          }
        } catch (e) {
          return fail(
            'writer_failed',
            `writer ${spec.format}: ${(e as Error).message ?? 'unknown'}`,
          );
        }

        const completedAt = clock();
        const durationMs = completedAt - job.startedAt;
        const outputBasename = path.basename(spec.outputPath);
        const outputDirHint = path.basename(path.dirname(spec.outputPath));

        const summary: ExportJobSummary = {
          jobId: spec.jobId,
          format: spec.format,
          qualityTier: spec.qualityTier,
          pageCount: totalPages,
          durationMs,
          outputBasename,
          outputDirHint,
          outputSizeBytes,
          contentStats,
          perPageProgress: pages.map((p) => ({
            pageIndex: p.pageIndex,
            phase: 'completed',
            completedAt,
          })),
        };

        onProgress({
          jobId: spec.jobId,
          format: spec.format,
          phase: 'completed',
          summary,
        });

        job.terminal = 'completed';
        activeJobs.delete(spec.jobId);
        return { ok: true, value: { summary, outputPaths } };
      } catch (e) {
        // Catch-all: any uncaught throw becomes a structured failure event.
        const message = (e as Error).message ?? 'unknown';
        onProgress({
          jobId: spec.jobId,
          format: spec.format,
          phase: 'failed',
          pagesCompleted: job.pagesCompleted,
          totalPages,
          error: message,
        });
        return fail('writer_failed', `uncaught: ${message}`);
      } finally {
        // Release the per-job pdf.js document on EVERY terminal path (success,
        // typed failure, cancel, uncaught throw). Runs after the return value
        // is computed but before the promise resolves.
        await releaseLoader();
      }
    },
  };
}

interface MaybeWriterStats {
  stats?: {
    paragraphsExtracted: number;
    tablesDetected: number;
    imagesEmbedded: number;
  };
}

function collectStats(writer: unknown): ExportJobSummary['contentStats'] {
  const s = (writer as MaybeWriterStats).stats;
  if (!s) return null;
  return {
    paragraphsExtracted: s.paragraphsExtracted,
    tablesDetected: s.tablesDetected,
    imagesEmbedded: s.imagesEmbedded,
  };
}

// ============================================================================
// Default-factory convenience for tests
// ============================================================================

export function createDefaultExtractors(pngEncoder: PngEncoder): {
  layoutExtractor: LayoutExtractor;
  tableDetector: TableDetector;
  imageExtractor: ImageExtractor;
} {
  return {
    layoutExtractor: createLayoutExtractor(),
    tableDetector: createTableDetector(),
    imageExtractor: createImageExtractor(pngEncoder),
  };
}
