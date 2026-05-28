// @vitest-environment node
//
// Engine integration test — synthetic source loader + recorder libraries
// drive the entire single-funnel path end-to-end without touching real PDFs.

import { describe, expect, it, beforeEach } from 'vitest';

import {
  createExportEngine,
  getActiveExportJob,
  writeAtomic,
  type ExportEngineDeps,
  type PageSourceLoader,
} from './export-engine.js';
import { createImageExtractor, type PngEncoder } from './image-extract.js';
import { createLayoutExtractor } from './layout-extract.js';
import { createTableDetector } from './table-detect.js';
import type { ExportJobSpec } from './types.js';
import { createDocxWriter, type DocxLibrary, type DocxChild } from './writers/docx-writer.js';
import { createImageWriter, type ImageWriterDeps } from './writers/image-writer.js';
import { createPptxWriter, type PptxLibrary, type PptxSlideSpec } from './writers/pptx-writer.js';
import {
  createXlsxWriter,
  type XlsxLibrary,
  type XlsxWorkbookSpec,
} from './writers/xlsx-writer.js';

function syntheticLoader(): PageSourceLoader {
  return {
    async getPageSize() {
      return { widthPt: 612, heightPt: 792 };
    },
    async getTextContent() {
      return {
        items: [
          {
            str: 'Hello',
            transform: [12, 0, 0, 12, 72, 720],
            width: 40,
            height: 12,
            fontName: 'Helvetica',
          },
        ],
      };
    },
    async getOperatorList() {
      return { fnArray: [], argsArray: [] };
    },
    async getImageResolver() {
      return { get: () => null };
    },
    async getLineSegments() {
      return [];
    },
  };
}

const png: PngEncoder = (_rgba, w, h) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, w, h]);

function recordedFs(): {
  fs: ExportEngineDeps['fs'];
  written: Array<{ path: string; bytes: Uint8Array }>;
  renamed: Array<{ from: string; to: string }>;
} {
  const written: Array<{ path: string; bytes: Uint8Array }> = [];
  const renamed: Array<{ from: string; to: string }> = [];
  return {
    written,
    renamed,
    fs: {
      async writeFile(p, b) {
        written.push({ path: p, bytes: b });
      },
      async rename(from, to) {
        renamed.push({ from, to });
      },
      async unlink() {
        /* no-op */
      },
      async access() {
        /* no-op — parent dir always accessible in tests */
      },
    },
  };
}

function recorderDocxLib(): DocxLibrary & { children: DocxChild[] } {
  const out: { children: DocxChild[] } = { children: [] };
  return {
    children: [],
    async compose(opts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).children = opts.children;
      out.children = opts.children;
      return new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    },
  };
}

function recorderXlsxLib(): XlsxLibrary & { lastSpec: XlsxWorkbookSpec | null } {
  const out: { lastSpec: XlsxWorkbookSpec | null } = { lastSpec: null };
  return {
    lastSpec: null,
    async compose(spec) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).lastSpec = spec;
      out.lastSpec = spec;
      return new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    },
  };
}

function recorderPptxLib(): PptxLibrary & { slides: PptxSlideSpec[] } {
  const out: { slides: PptxSlideSpec[] } = { slides: [] };
  return {
    slides: [],
    async compose(opts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).slides = opts.slides;
      out.slides = opts.slides;
      return new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    },
  };
}

function imageDeps(): ImageWriterDeps {
  return {
    rasterize: async () => ({
      rgba: new Uint8Array(16 * 16 * 4),
      width: 16,
      height: 16,
    }),
    encodePng: (_r, w, h) => new Uint8Array([0x89, 0x50, w, h]),
    encodeJpeg: (_r, w, h, q) => new Uint8Array([0xff, 0xd8, w, h, Math.round(q * 100)]),
    encodeTiffPage: (_r, w, h) => new Uint8Array([0x49, 0x49, w, h]),
    encodeTiffMultiPage: (pages) => new Uint8Array([0x49, 0x49, pages.length]),
  };
}

function buildDeps(overrides?: Partial<ExportEngineDeps>): ExportEngineDeps & {
  fsRec: ReturnType<typeof recordedFs>;
  docxLib: ReturnType<typeof recorderDocxLib>;
} {
  const fsRec = recordedFs();
  const docxLib = recorderDocxLib();
  const deps: ExportEngineDeps = {
    layoutExtractor: createLayoutExtractor(),
    tableDetector: createTableDetector(),
    imageExtractor: createImageExtractor(png),
    writers: {
      docx: createDocxWriter(docxLib),
      xlsx: createXlsxWriter(recorderXlsxLib()),
      pptx: createPptxWriter(recorderPptxLib()),
      image: createImageWriter(imageDeps()),
    },
    pngEncoder: png,
    loader: syntheticLoader(),
    fs: fsRec.fs,
    ...overrides,
  };
  return { ...deps, fsRec, docxLib };
}

function buildSpec(over: Partial<ExportJobSpec>): ExportJobSpec {
  return {
    jobId: 100,
    docHash: 'abc',
    sourceBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    pageCount: 1,
    format: 'docx',
    qualityTier: 'layout-preserving',
    pageRange: { start: 0, end: 0 },
    includeAnnotations: false,
    outputPath: '/tmp/out.docx',
    perFormat: { format: 'docx', pageSize: 'auto' },
    ...over,
  };
}

describe('export-engine (export-engine.md §3 + §8)', () => {
  beforeEach(() => {
    globalThis.__pdfvExportActiveJobs?.clear();
  });

  it('runs a docx job end-to-end and writes atomically', async () => {
    const deps = buildDeps();
    const engine = createExportEngine(deps);
    const progress: string[] = [];
    const r = await engine.runJob(buildSpec({}), (e) => {
      progress.push(e.phase);
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.outputPaths).toEqual(['/tmp/out.docx']);
      expect(r.value.summary.outputBasename).toBe('out.docx');
      expect(r.value.summary.contentStats).not.toBeNull();
    }
    expect(progress).toContain('starting');
    expect(progress).toContain('completed');
    // Atomic write: temp file written first, then renamed.
    expect(deps.fsRec.written[0]!.path).toBe('/tmp/out.docx.export-temp');
    expect(deps.fsRec.renamed[0]).toEqual({
      from: '/tmp/out.docx.export-temp',
      to: '/tmp/out.docx',
    });
  });

  it('emits per-page progress events', async () => {
    const deps = buildDeps();
    const engine = createExportEngine(deps);
    const phases: string[] = [];
    await engine.runJob(buildSpec({ pageRange: { start: 0, end: 2 }, pageCount: 3 }), (e) =>
      phases.push(e.phase),
    );
    expect(phases.filter((p) => p === 'extracting-text').length).toBe(3);
    expect(phases.filter((p) => p === 'detecting-tables').length).toBe(3);
  });

  it('image format emits rasterizing phase + multiple output paths', async () => {
    const deps = buildDeps();
    const engine = createExportEngine(deps);
    const phases: string[] = [];
    const r = await engine.runJob(
      buildSpec({
        format: 'png',
        qualityTier: 'n/a',
        outputPath: '/tmp/out.png',
        pageRange: { start: 0, end: 1 },
        pageCount: 2,
        perFormat: { format: 'png', dpi: 150 },
      }),
      (e) => phases.push(e.phase),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.outputPaths.length).toBe(2);
    expect(phases.filter((p) => p === 'rasterizing').length).toBe(2);
  });

  it('cancellation aborts mid-stream and returns cancelled error', async () => {
    const deps = buildDeps();
    const engine = createExportEngine(deps);
    const spec = buildSpec({
      jobId: 200,
      pageRange: { start: 0, end: 4 },
      pageCount: 5,
    });
    let cancelled = false;
    const promise = engine.runJob(spec, (e) => {
      if (e.phase === 'extracting-text' && !cancelled) {
        // Abort after the first page has started extracting.
        const job = getActiveExportJob(200);
        if (job) {
          job.controller.abort();
          cancelled = true;
        }
      }
    });
    const r = await promise;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.error).toBe('cancelled');
  });

  it('writeAtomic helper unlinks tmp on rename failure', async () => {
    let unlinked = false;
    const fs: ExportEngineDeps['fs'] = {
      async writeFile() {
        /* ok */
      },
      async rename() {
        throw new Error('rename failed');
      },
      async unlink() {
        unlinked = true;
      },
      async access() {
        /* ok */
      },
    };
    await expect(writeAtomic('/tmp/x.docx', new Uint8Array([1]), fs)).rejects.toThrow();
    expect(unlinked).toBe(true);
  });

  it('failure in writer surfaces as writer_failed', async () => {
    const deps = buildDeps({
      writers: {
        docx: {
          async write() {
            throw new Error('docx package missing');
          },
        },
        xlsx: createXlsxWriter(recorderXlsxLib()),
        pptx: createPptxWriter(recorderPptxLib()),
        image: createImageWriter(imageDeps()),
      },
    });
    const engine = createExportEngine(deps);
    const r = await engine.runJob(buildSpec({}), () => {
      /* noop */
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.error).toBe('writer_failed');
      expect(r.failure.message).toMatch(/docx package missing/);
    }
  });

  it('handles xlsx format via xlsx writer (verifies exhaustive dispatch)', async () => {
    const deps = buildDeps();
    const engine = createExportEngine(deps);
    const r = await engine.runJob(
      buildSpec({
        format: 'xlsx',
        qualityTier: 'text-only',
        outputPath: '/tmp/out.xlsx',
        perFormat: { format: 'xlsx' },
      }),
      () => {
        /* noop */
      },
    );
    expect(r.ok).toBe(true);
  });

  it('handles pptx format via pptx writer (verifies exhaustive dispatch)', async () => {
    const deps = buildDeps();
    const engine = createExportEngine(deps);
    const r = await engine.runJob(
      buildSpec({
        format: 'pptx',
        qualityTier: 'layout-preserving',
        outputPath: '/tmp/out.pptx',
        perFormat: { format: 'pptx' },
      }),
      () => {
        /* noop */
      },
    );
    expect(r.ok).toBe(true);
  });
});
