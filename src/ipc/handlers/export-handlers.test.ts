// @vitest-environment node
//
// IPC handler tests for the six Phase 6 export channels + dialog +
// cancel. Covers the zod boundary, pre-flight, and happy/failure dispatch.

import { describe, expect, it, beforeEach } from 'vitest';

import type {
  ExportEngine,
  ExportEngineFailure,
  ExportEngineResult,
} from '../../main/export/export-engine.js';
import type { ExportJobSummary } from '../contracts.js';

import { handleDialogPickExportOutputPath } from './dialog-pick-export-output-path.js';
import { handleExportCancelJob } from './export-cancel-job.js';
import { handleExportListFormats } from './export-list-formats.js';
import { handleExportListJobs } from './export-list-jobs.js';
import type { ExportHandlerCommonDeps } from './export-shared.js';
import { handleExportToDocx } from './export-to-docx.js';
import { handleExportToImages } from './export-to-images.js';
import { handleExportToPptx } from './export-to-pptx.js';
import { handleExportToXlsx } from './export-to-xlsx.js';

const SAMPLE_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

function syntheticEngine(
  fixture:
    | { ok: true; summary: ExportJobSummary; outputPaths?: string[] }
    | { ok: false; failure: ExportEngineFailure },
): ExportEngine {
  return {
    async runJob(spec, onProgress) {
      onProgress({
        jobId: spec.jobId,
        format: spec.format,
        phase: 'starting',
        totalPages: 1,
      });
      if (fixture.ok) {
        const result: ExportEngineResult = {
          summary: fixture.summary,
          outputPaths: fixture.outputPaths ?? [spec.outputPath],
        };
        onProgress({
          jobId: spec.jobId,
          format: spec.format,
          phase: 'completed',
          summary: fixture.summary,
        });
        return { ok: true, value: result };
      }
      return { ok: false, failure: fixture.failure };
    },
  };
}

const SUMMARY: ExportJobSummary = {
  jobId: 1,
  format: 'docx',
  qualityTier: 'layout-preserving',
  pageCount: 1,
  durationMs: 100,
  outputBasename: 'out.docx',
  outputDirHint: 'tmp',
  outputSizeBytes: 1024,
  contentStats: {
    paragraphsExtracted: 5,
    tablesDetected: 1,
    imagesEmbedded: 2,
  },
  perPageProgress: null,
};

function commonDeps(over?: Partial<ExportHandlerCommonDeps>): ExportHandlerCommonDeps {
  return {
    engine: syntheticEngine({ ok: true, summary: SUMMARY }),
    getBytes: () => SAMPLE_BYTES,
    getPageCount: () => 10,
    getDocHash: () => 'abc123',
    exportJobsRepo: null,
    emitProgress: () => {
      /* noop */
    },
    getMaxQueueSize: () => 50,
    getActiveJobCount: () => 0,
    ...over,
  };
}

// ============================================================================
// export:toDocx
// ============================================================================

describe('handleExportToDocx (api-contracts.md §17.1)', () => {
  it('rejects invalid_payload on missing handle', async () => {
    const r = await handleExportToDocx(
      {
        pageRange: { start: 0, end: 1 },
        qualityTier: 'layout-preserving',
        includeAnnotations: false,
        pageSize: 'auto',
        outputPath: '/tmp/out.docx',
      },
      commonDeps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects invalid_payload on missing qualityTier (NEVER .optional())', async () => {
    const r = await handleExportToDocx(
      {
        handle: 1,
        pageRange: { start: 0, end: 1 },
        includeAnnotations: false,
        pageSize: 'auto',
        outputPath: '/tmp/out.docx',
      },
      commonDeps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects handle_not_found', async () => {
    const r = await handleExportToDocx(
      {
        handle: 1,
        pageRange: { start: 0, end: 1 },
        qualityTier: 'layout-preserving',
        includeAnnotations: false,
        pageSize: 'auto',
        outputPath: '/tmp/out.docx',
      },
      commonDeps({ getBytes: () => null }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('handle_not_found');
  });

  it('rejects page_range_out_of_range when end >= pageCount', async () => {
    const r = await handleExportToDocx(
      {
        handle: 1,
        pageRange: { start: 0, end: 999 },
        qualityTier: 'layout-preserving',
        includeAnnotations: false,
        pageSize: 'auto',
        outputPath: '/tmp/out.docx',
      },
      commonDeps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('page_range_out_of_range');
  });

  it('rejects queue_full when active >= max', async () => {
    const r = await handleExportToDocx(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        qualityTier: 'layout-preserving',
        includeAnnotations: false,
        pageSize: 'auto',
        outputPath: '/tmp/out.docx',
      },
      commonDeps({ getActiveJobCount: () => 50, getMaxQueueSize: () => 50 }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('queue_full');
  });

  it('returns ok with jobId + summary on successful engine run', async () => {
    const r = await handleExportToDocx(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        qualityTier: 'layout-preserving',
        includeAnnotations: false,
        pageSize: 'auto',
        outputPath: '/tmp/out.docx',
      },
      commonDeps(),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.jobId).toBeDefined();
      expect(r.value.summary.outputBasename).toBe('out.docx');
    }
  });

  it('maps engine cancelled → cancelled error variant', async () => {
    const r = await handleExportToDocx(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        qualityTier: 'layout-preserving',
        includeAnnotations: false,
        pageSize: 'auto',
        outputPath: '/tmp/out.docx',
      },
      commonDeps({
        engine: syntheticEngine({
          ok: false,
          failure: { error: 'cancelled', message: 'user cancelled', pagesCompleted: 0 },
        }),
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('cancelled');
  });

  it('maps engine extraction_failed → extraction_failed variant', async () => {
    const r = await handleExportToDocx(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        qualityTier: 'layout-preserving',
        includeAnnotations: false,
        pageSize: 'auto',
        outputPath: '/tmp/out.docx',
      },
      commonDeps({
        engine: syntheticEngine({
          ok: false,
          failure: { error: 'extraction_failed', message: 'pdfjs missing', pagesCompleted: 0 },
        }),
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('extraction_failed');
  });
});

// ============================================================================
// export:toXlsx / toPptx — smoke-test the shared preflight + dispatch
// ============================================================================

describe('handleExportToXlsx (api-contracts.md §17.2)', () => {
  it('happy path returns summary', async () => {
    const r = await handleExportToXlsx(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        qualityTier: 'text-only',
        includeAnnotations: false,
        outputPath: '/tmp/out.xlsx',
      },
      commonDeps(),
    );
    expect(r.ok).toBe(true);
  });

  it('rejects invalid qualityTier value', async () => {
    const r = await handleExportToXlsx(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        qualityTier: 'high-fidelity',
        includeAnnotations: false,
        outputPath: '/tmp/out.xlsx',
      },
      commonDeps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });
});

describe('handleExportToPptx (api-contracts.md §17.3)', () => {
  it('happy path returns summary', async () => {
    const r = await handleExportToPptx(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        qualityTier: 'layout-preserving',
        includeAnnotations: true,
        outputPath: '/tmp/out.pptx',
      },
      commonDeps(),
    );
    expect(r.ok).toBe(true);
  });
});

// ============================================================================
// export:toImages
// ============================================================================

describe('handleExportToImages (api-contracts.md §17.4)', () => {
  it('rejects out-of-range DPI', async () => {
    const r = await handleExportToImages(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        format: 'png',
        dpi: 9999,
        includeAnnotations: true,
        outputPath: '/tmp/out.png',
      },
      commonDeps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects out-of-range JPEG quality', async () => {
    const r = await handleExportToImages(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        format: 'jpeg',
        dpi: 150,
        jpegQuality: 5,
        includeAnnotations: true,
        outputPath: '/tmp/out.jpeg',
      },
      commonDeps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects unknown format', async () => {
    const r = await handleExportToImages(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        format: 'bmp',
        dpi: 150,
        includeAnnotations: true,
        outputPath: '/tmp/out.bmp',
      },
      commonDeps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('happy PNG path returns outputPaths', async () => {
    const r = await handleExportToImages(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        format: 'png',
        dpi: 150,
        includeAnnotations: true,
        outputPath: '/tmp/out.png',
      },
      commonDeps({
        engine: syntheticEngine({
          ok: true,
          summary: { ...SUMMARY, format: 'png', qualityTier: 'n/a' },
          outputPaths: ['/tmp/out-page1.png'],
        }),
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.outputPaths).toEqual(['/tmp/out-page1.png']);
  });

  it('maps engine extraction_failed → rasterize_failed for image jobs', async () => {
    const r = await handleExportToImages(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        format: 'png',
        dpi: 150,
        includeAnnotations: true,
        outputPath: '/tmp/out.png',
      },
      commonDeps({
        engine: syntheticEngine({
          ok: false,
          failure: { error: 'extraction_failed', message: 'rast', pagesCompleted: 0 },
        }),
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('rasterize_failed');
  });
});

// ============================================================================
// export:cancelJob
// ============================================================================

describe('handleExportCancelJob (api-contracts.md §17.6)', () => {
  beforeEach(() => {
    globalThis.__pdfvExportActiveJobs?.clear();
  });

  it('rejects invalid_payload for non-numeric jobId', async () => {
    const r = await handleExportCancelJob({ jobId: 'abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('returns job_not_found when jobId is not active', async () => {
    const r = await handleExportCancelJob({ jobId: 999 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('job_not_found');
  });

  it('cancels active job', async () => {
    const controller = new AbortController();
    const jobId = 7;
    globalThis.__pdfvExportActiveJobs!.set(jobId, {
      jobId,
      format: 'docx',
      controller,
      pagesCompleted: 2,
      totalPages: 5,
      startedAt: Date.now(),
      terminal: null,
    });
    const r = await handleExportCancelJob({ jobId });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.cancelled).toBe(true);
      expect(r.value.pagesCompleted).toBe(2);
    }
    expect(controller.signal.aborted).toBe(true);
  });

  it('returns job_already_terminal when terminal != null', async () => {
    const jobId = 8;
    globalThis.__pdfvExportActiveJobs!.set(jobId, {
      jobId,
      format: 'docx',
      controller: new AbortController(),
      pagesCompleted: 5,
      totalPages: 5,
      startedAt: Date.now(),
      terminal: 'completed',
    });
    const r = await handleExportCancelJob({ jobId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('job_already_terminal');
  });
});

// ============================================================================
// export:listFormats
// ============================================================================

describe('handleExportListFormats (api-contracts.md §17.8)', () => {
  it('returns the 6-format catalog', async () => {
    const r = await handleExportListFormats({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.formats).toHaveLength(6);
      const docx = r.value.formats.find((f) => f.format === 'docx');
      expect(docx?.defaultQualityTier).toBe('layout-preserving');
      const xlsx = r.value.formats.find((f) => f.format === 'xlsx');
      expect(xlsx?.defaultQualityTier).toBe('text-only');
      const png = r.value.formats.find((f) => f.format === 'png');
      expect(png?.defaultQualityTier).toBe('n/a');
    }
  });
});

// ============================================================================
// export:listJobs
// ============================================================================

describe('handleExportListJobs (api-contracts.md §17.7)', () => {
  it('returns empty list when no repo wired', async () => {
    const r = await handleExportListJobs({}, { repo: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.jobs).toEqual([]);
  });

  it('translates snake_case rows to camelCase DTOs', async () => {
    const r = await handleExportListJobs(
      {},
      {
        repo: {
          listAll: () => ({
            items: [
              {
                id: 1,
                doc_hash: 'h',
                format: 'docx',
                quality_tier: 'layout-preserving',
                page_range_start: 0,
                page_range_end: 0,
                include_annotations: 1,
                dpi: null,
                jpeg_quality: null,
                multi_page_tiff: null,
                output_path: '/tmp/sub/out.docx',
                output_size_bytes: 1024,
                status: 'completed',
                started_at: 1,
                completed_at: 100,
                duration_ms: 99,
                pages_processed: 1,
                paragraphs_extracted: 5,
                tables_detected: 1,
                images_embedded: 2,
                error_message: null,
                created_at: 0,
              },
            ],
            total: 1,
          }),
        },
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.jobs[0]!.outputBasename).toBe('out.docx');
      expect(r.value.jobs[0]!.outputDirHint).toBe('sub');
      expect(r.value.jobs[0]!.includeAnnotations).toBe(true);
      expect(r.value.jobs[0]!.contentStats).toEqual({
        paragraphsExtracted: 5,
        tablesDetected: 1,
        imagesEmbedded: 2,
      });
    }
  });

  it('sets imageOptions for image formats', async () => {
    const r = await handleExportListJobs(
      {},
      {
        repo: {
          listAll: () => ({
            items: [
              {
                id: 2,
                doc_hash: 'h',
                format: 'jpeg',
                quality_tier: 'n/a',
                page_range_start: 0,
                page_range_end: 0,
                include_annotations: 1,
                dpi: 150,
                jpeg_quality: 0.85,
                multi_page_tiff: null,
                output_path: '/tmp/out.jpeg',
                output_size_bytes: 5,
                status: 'completed',
                started_at: 1,
                completed_at: 2,
                duration_ms: 1,
                pages_processed: 1,
                paragraphs_extracted: null,
                tables_detected: null,
                images_embedded: null,
                error_message: null,
                created_at: 0,
              },
            ],
            total: 1,
          }),
        },
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.jobs[0]!.imageOptions).toEqual({
        dpi: 150,
        jpegQuality: 0.85,
        multiPageTiff: null,
      });
      expect(r.value.jobs[0]!.contentStats).toBeNull();
    }
  });
});

// ============================================================================
// dialog:pickExportOutputPath
// ============================================================================

describe('handleDialogPickExportOutputPath (api-contracts.md §17.9)', () => {
  it('returns outputPath: null when user cancels', async () => {
    const r = await handleDialogPickExportOutputPath(
      { defaultBasename: 'my-doc', format: 'docx' },
      {
        showSaveDialog: async () => ({ canceled: true }),
        sanitizePath: (p) => String(p),
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.outputPath).toBeNull();
  });

  it('returns sanitized output path when user picks a file', async () => {
    const r = await handleDialogPickExportOutputPath(
      { defaultBasename: 'my-doc', format: 'pptx' },
      {
        showSaveDialog: async () => ({
          canceled: false,
          filePath: '/tmp/picked.pptx',
        }),
        sanitizePath: (p) => String(p),
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.outputPath).toBe('/tmp/picked.pptx');
  });

  it('rejects path separators in defaultBasename', async () => {
    const r = await handleDialogPickExportOutputPath(
      { defaultBasename: '../sneaky', format: 'docx' },
      {
        showSaveDialog: async () => ({ canceled: true }),
        sanitizePath: (p) => String(p),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects unknown format', async () => {
    const r = await handleDialogPickExportOutputPath(
      { defaultBasename: 'x', format: 'bmp' },
      {
        showSaveDialog: async () => ({ canceled: true }),
        sanitizePath: (p) => String(p),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });
});
