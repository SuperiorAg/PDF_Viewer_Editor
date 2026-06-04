// Export-engine bootstrap (Phase 6 / Phase 6.1)
//
// Wires the production export engine: layout extractor, table detector,
// image extractor, four writers, page source loader (pdf.js), and a PNG
// encoder (@napi-rs/canvas).
//
// Phase 6.1 (David — Julian M-25.4 + Diego follow-ups #2/#5): the production
// source loader is now REAL (pdf.js-backed — see `pdfjs-source.ts`), and the
// `docx` / `pptxgenjs` writers bind to the actually-installed libraries
// (Diego installed docx@9.7.1 + pptxgenjs@4.0.1 in Wave 25). The single source
// loader funnels text-content, line-segments, image extraction AND
// rasterization for ALL four formats — docx, xlsx, pptx, image.

import { promises as fsPromises } from 'node:fs';
// Type-only companions to the lazy `require('node:path')` / `require('node:url')`
// in resolveExportFontData() — that helper uses CJS `require.resolve(...)`, so it
// keeps the runtime requires; these erased type imports satisfy
// consistent-type-imports without changing load behavior.
import type * as NodePath from 'node:path';
import type * as NodeUrl from 'node:url';

import {
  createExportEngine,
  type ExportEngine,
  type ExportEngineDeps,
  type PageSourceLoader,
} from './export-engine.js';
import { createImageExtractor } from './image-extract.js';
import type { PngEncoder } from './image-extract.js';
import { createLayoutExtractor } from './layout-extract.js';
import {
  createProdPdfJsSource,
  type CreateCanvasFn,
  type PdfJsDataFactory,
  type PdfJsModule,
  type ProdSourceBundle,
} from './pdfjs-source.js';
import { createTableDetector } from './table-detect.js';
import type { LayoutSettings } from './types.js';
import { createDocxWriter, type DocxLibrary, type DocxChild } from './writers/docx-writer.js';
import {
  createImageWriter,
  type ImageWriter,
  type ImageWriterDeps,
} from './writers/image-writer.js';
import { createPptxWriter, type PptxLibrary, type PptxSlideSpec } from './writers/pptx-writer.js';
import { createXlsxWriter, type XlsxLibrary, type XlsxSheetSpec } from './writers/xlsx-writer.js';

// ---- Canvas + utif lazy-load (mirror src/main/pdf-ops/ocr-bootstrap.ts) ----

interface CanvasShape {
  getContext(kind: '2d'): {
    createImageData(w: number, h: number): { data: Uint8ClampedArray | Uint8Array };
    putImageData(d: unknown, x: number, y: number): void;
  };
  toBuffer(mime: 'image/png'): Buffer;
  toBuffer(mime: 'image/jpeg', opts: { quality: number }): Buffer;
  width: number;
  height: number;
}

interface CanvasModule {
  createCanvas(w: number, h: number): CanvasShape;
}

function loadCanvasModule(): CanvasModule {
  const moduleName = '@napi-rs/canvas';
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  return require(moduleName) as CanvasModule;
}

interface UtifModule {
  encodeImage(rgba: Uint8Array, w: number, h: number): ArrayBuffer;
  encode(ifds: unknown[]): ArrayBuffer;
}

function loadUtifModule(): UtifModule {
  const moduleName = 'utif';
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  return require(moduleName) as UtifModule;
}

export function createCanvasPngEncoder(): PngEncoder {
  const canvasMod = loadCanvasModule();
  return (rgba, width, height) => {
    const canvas = canvasMod.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    imgData.data.set(rgba);
    ctx.putImageData(imgData, 0, 0);
    const png = canvas.toBuffer('image/png');
    return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
  };
}

export function createCanvasJpegEncoder(): (
  rgba: Uint8Array,
  w: number,
  h: number,
  q: number,
) => Uint8Array {
  const canvasMod = loadCanvasModule();
  return (rgba, width, height, quality) => {
    const canvas = canvasMod.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    imgData.data.set(rgba);
    ctx.putImageData(imgData, 0, 0);
    const jpg = canvas.toBuffer('image/jpeg', { quality });
    return new Uint8Array(jpg.buffer, jpg.byteOffset, jpg.byteLength);
  };
}

export function createUtifEncoders(): {
  encodeTiffPage: (rgba: Uint8Array, w: number, h: number) => Uint8Array;
  encodeTiffMultiPage: (
    pages: Array<{ rgba: Uint8Array; width: number; height: number }>,
  ) => Uint8Array;
} {
  const utif = loadUtifModule();
  return {
    encodeTiffPage(rgba, width, height) {
      const buf = utif.encodeImage(rgba, width, height);
      return new Uint8Array(buf);
    },
    encodeTiffMultiPage(pages) {
      const ifds = pages.map((p) => ({
        width: p.width,
        height: p.height,
        data: p.rgba,
      }));
      const buf = utif.encode(ifds);
      return new Uint8Array(buf);
    },
  };
}

// ---- docx library wrap (Diego installed docx@9.7.1 in Wave 25) -------------
//
// Single-funnel discipline (export-engine.md §9): `docx` is imported in EXACTLY
// one place. The docx-writer.ts module owns the typed `DocxChild` shape; this
// factory is the only runtime binding to the real package.

interface DocxModule {
  Document: new (opts: unknown) => unknown;
  Packer: { toBuffer(doc: unknown): Promise<Buffer | Uint8Array> };
  Paragraph: new (opts: unknown) => unknown;
  TextRun: new (opts: unknown) => unknown;
  HeadingLevel: { HEADING_1: unknown; HEADING_2: unknown; HEADING_3: unknown };
  Table: new (opts: unknown) => unknown;
  TableRow: new (opts: unknown) => unknown;
  TableCell: new (opts: unknown) => unknown;
  ImageRun: new (opts: unknown) => unknown;
  AlignmentType: { LEFT: unknown; CENTER: unknown; RIGHT: unknown };
  WidthType: { PERCENTAGE: unknown };
  BorderStyle: { SINGLE: unknown };
}

function loadDocxModule(): DocxModule {
  const moduleName = 'docx';
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  return require(moduleName) as DocxModule;
}

function resolveDocxPageSize(
  size: 'letter' | 'a4' | 'auto',
): { width: number; height: number } | undefined {
  // docx page size in twips (1/20 pt). 'auto' lets docx use its default
  // (US Letter), so we omit the override.
  switch (size) {
    case 'letter':
      return { width: 12240, height: 15840 }; // 8.5 x 11 in
    case 'a4':
      return { width: 11906, height: 16838 }; // 210 x 297 mm
    case 'auto':
      return undefined;
  }
}

export function createDocxLibrary(): DocxLibrary {
  return {
    async compose(opts: { pageSize: 'letter' | 'a4' | 'auto'; children: DocxChild[] }) {
      const m = loadDocxModule();
      const headingFor = (h: 'Heading1' | 'Heading2' | 'Heading3' | null): unknown => {
        switch (h) {
          case 'Heading1':
            return m.HeadingLevel.HEADING_1;
          case 'Heading2':
            return m.HeadingLevel.HEADING_2;
          case 'Heading3':
            return m.HeadingLevel.HEADING_3;
          default:
            return undefined;
        }
      };
      const alignFor = (a: 'left' | 'center' | 'right'): unknown =>
        a === 'center'
          ? m.AlignmentType.CENTER
          : a === 'right'
            ? m.AlignmentType.RIGHT
            : m.AlignmentType.LEFT;

      const body: unknown[] = [];
      for (const child of opts.children) {
        if (child.kind === 'paragraph') {
          const heading = headingFor(child.spec.heading);
          const runOpts: Record<string, unknown> = {
            text: child.spec.text,
            bold: child.spec.bold,
            italics: child.spec.italic,
          };
          if (child.spec.sizeHalfPt !== null) runOpts['size'] = child.spec.sizeHalfPt;
          const paraOpts: Record<string, unknown> = {
            alignment: alignFor(child.spec.alignment),
            children: [new m.TextRun(runOpts)],
          };
          if (heading !== undefined) paraOpts['heading'] = heading;
          body.push(new m.Paragraph(paraOpts));
        } else if (child.kind === 'table') {
          const colCount = Math.max(1, child.spec.columns);
          const rows = child.spec.rows.map(
            (row) =>
              new m.TableRow({
                children: row.map(
                  (cell) =>
                    new m.TableCell({
                      width: { size: 100 / colCount, type: m.WidthType.PERCENTAGE },
                      children: [
                        new m.Paragraph({
                          children: [new m.TextRun({ text: cell.text })],
                        }),
                      ],
                    }),
                ),
              }),
          );
          const border = { style: m.BorderStyle.SINGLE, size: 4, color: '000000' };
          body.push(
            new m.Table({
              width: { size: 100, type: m.WidthType.PERCENTAGE },
              borders: {
                top: border,
                bottom: border,
                left: border,
                right: border,
                insideHorizontal: border,
                insideVertical: border,
              },
              rows,
            }),
          );
        } else {
          // image
          body.push(
            new m.Paragraph({
              children: [
                new m.ImageRun({
                  type: 'png',
                  data: child.spec.bytes,
                  transformation: {
                    width: Math.max(1, Math.round(child.spec.widthPx)),
                    height: Math.max(1, Math.round(child.spec.heightPx)),
                  },
                }),
              ],
            }),
          );
        }
      }

      const pageSize = resolveDocxPageSize(opts.pageSize);
      const sectionProps = pageSize !== undefined ? { page: { size: pageSize } } : {};
      const doc = new m.Document({
        creator: 'PDF Viewer & Editor (Phase 6 export)',
        sections: [{ properties: sectionProps, children: body }],
      });
      const buf = await m.Packer.toBuffer(doc);
      return buf instanceof Uint8Array
        ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
        : new Uint8Array(buf);
    },
  };
}

// ---- pptxgenjs library wrap (Diego installed pptxgenjs@4.0.1 in Wave 25) ---

interface PptxGenInstance {
  layout: string;
  title: string;
  addSlide(): PptxGenSlide;
  write(opts: { outputType: 'nodebuffer' }): Promise<Buffer | Uint8Array | ArrayBuffer>;
}
interface PptxGenSlide {
  addText(text: string, opts: Record<string, unknown>): void;
  addImage(opts: Record<string, unknown>): void;
  addTable(rows: Array<Array<{ text: string }>>, opts: Record<string, unknown>): void;
}
type PptxGenCtor = new () => PptxGenInstance;

function loadPptxGenCtor(): PptxGenCtor {
  const moduleName = 'pptxgenjs';
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const mod = require(moduleName) as PptxGenCtor | { default: PptxGenCtor };
  // pptxgenjs ships as both `module.exports = PptxGenJS` and `.default` under
  // esModuleInterop; handle both.
  return (mod as { default?: PptxGenCtor }).default ?? (mod as PptxGenCtor);
}

export function createPptxLibrary(): PptxLibrary {
  return {
    async compose(opts: { slides: PptxSlideSpec[] }) {
      const Ctor = loadPptxGenCtor();
      const pres = new Ctor();
      pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in (16:9)
      pres.title = 'Exported from PDF';
      for (const slideSpec of opts.slides) {
        const slide = pres.addSlide();
        for (const block of slideSpec.blocks) {
          if (block.kind === 'text') {
            slide.addText(block.spec.text, {
              x: block.spec.x,
              y: block.spec.y,
              w: block.spec.w,
              h: block.spec.h,
              fontSize: block.spec.fontSize,
              bold: block.spec.bold,
              italic: block.spec.italic,
              align: block.spec.align,
            });
          } else if (block.kind === 'image') {
            slide.addImage({
              data: block.spec.dataUri,
              x: block.spec.x,
              y: block.spec.y,
              w: block.spec.w,
              h: block.spec.h,
            });
          } else {
            slide.addTable(block.spec.rows, {
              x: block.spec.x,
              y: block.spec.y,
              w: block.spec.w,
              h: block.spec.h,
            });
          }
        }
        if (slideSpec.footer !== null) {
          slide.addText(slideSpec.footer, {
            x: 0.3,
            y: 6.5,
            w: 12.7,
            h: 0.9,
            fontSize: 9,
            color: '666666',
            italic: true,
          });
        }
      }
      const out = await pres.write({ outputType: 'nodebuffer' });
      if (out instanceof Uint8Array) {
        return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
      }
      return new Uint8Array(out as ArrayBuffer);
    },
  };
}

// ---- exceljs library wrap (already in deps from Phase 3) -------------------

export function createExcelJsLibrary(): XlsxLibrary {
  return {
    async compose(spec) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const ExcelJS = require('exceljs') as {
        Workbook: new () => {
          creator: string;
          created: Date;
          addWorksheet(name: string): {
            addRow(values: Array<string | number>): unknown;
            eachRow(
              fn: (row: {
                eachCell: (
                  fn: (cell: {
                    value: unknown;
                    alignment: { horizontal?: 'left' | 'right' };
                  }) => void,
                ) => void;
              }) => void,
            ): void;
          };
          xlsx: {
            writeBuffer(opts: {
              useSharedStrings: boolean;
              useStyles: boolean;
            }): Promise<ArrayBuffer>;
          };
        };
      };
      const wb = new ExcelJS.Workbook();
      wb.creator = 'PDF Viewer & Editor (Phase 6 export)';
      wb.created = new Date();
      for (const sheet of spec.sheets) {
        const ws = wb.addWorksheet(sheet.name);
        for (const row of sheet.rows) ws.addRow(row);
        // Per-column alignment.
        if (sheet.columnAlignments) {
          const aligns = sheet.columnAlignments;
          ws.eachRow((row) =>
            row.eachCell((cell) => {
              const colIdx = (cell as unknown as { col: number }).col;
              const a = typeof colIdx === 'number' ? aligns[colIdx - 1] : undefined;
              if (a) cell.alignment = { horizontal: a };
            }),
          );
        }
      }
      const buf = await wb.xlsx.writeBuffer({
        useSharedStrings: true,
        useStyles: true,
      });
      return new Uint8Array(buf);
    },
  };
}

// ---- Image writer deps (production wires real canvas + utif) ---------------

export function createImageWriterDeps(rasterize: ImageWriterDeps['rasterize']): ImageWriterDeps {
  const pngEncoder = createCanvasPngEncoder();
  const jpegEncoder = createCanvasJpegEncoder();
  const utif = createUtifEncoders();
  return {
    rasterize,
    encodePng: pngEncoder,
    encodeJpeg: jpegEncoder,
    encodeTiffPage: utif.encodeTiffPage,
    encodeTiffMultiPage: utif.encodeTiffMultiPage,
  };
}

// ---- Production source loader (pdf.js backed) ------------------------------

/**
 * Lazy pdf.js loader for the export engine. Mirrors
 * `src/main/pdf-ops/ocr-bootstrap.ts:loadPdfJs` — the legacy build is used
 * because it runs in a Node (non-DOM) context. The module name is built
 * indirectly so Vite does not statically resolve it into the main bundle
 * (it stays a dynamic import chunk; see the 2026-05-27 require/import RCA).
 */
let _exportPdfjs: PdfJsModule | null = null;
async function loadExportPdfJs(): Promise<PdfJsModule> {
  if (_exportPdfjs !== null) return _exportPdfjs;
  const moduleName = 'pdfjs-dist' + '/legacy/build/pdf.mjs';
  const mod = (await import(moduleName)) as unknown as PdfJsModule;
  _exportPdfjs = mod;
  return mod;
}

function loadExportCanvasFactory(): CreateCanvasFn {
  const moduleName = '@napi-rs/canvas';
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const canvasMod = require(moduleName) as { createCanvas: CreateCanvasFn };
  return canvasMod.createCanvas;
}

/**
 * Register the Canvas2D globals pdf.js v4 needs to render glyph paths in Node.
 * pdf.js detects `globalThis.Path2D`; if absent it builds an internal `Path`
 * polyfill that @napi-rs/canvas's `ctx.fill()` rejects with `Value is none of
 * these types String, Path`. Pulling the natives from @napi-rs/canvas onto
 * globalThis fixes ALL image-export rasterization of text pages. Idempotent —
 * never clobbers an existing (e.g. Electron renderer) global.
 */
function registerExportCanvasGlobals(): void {
  const moduleName = '@napi-rs/canvas';
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const canvasMod = require(moduleName) as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  // `Image` was added 2026-06-02 alongside the OCR pipeline polyfill (David,
  // v0.7.11 fix). pdf.js's image-XObject decoder calls `new Image()` and then
  // assigns image data via property setters; @napi-rs/canvas's `Image`
  // constructor accepts that shape but rejects pdf.js's internal polyfill,
  // surfacing as "Value is none of these types String, Path" on any PDF page
  // that contains an embedded raster. Pin it on globalThis up front.
  for (const key of ['Image', 'Path2D', 'DOMMatrix', 'ImageData', 'DOMPoint']) {
    if (g[key] === undefined && typeof canvasMod[key] === 'function') {
      g[key] = canvasMod[key];
    }
  }
}

/**
 * Build a Node-safe pdf.js data factory (standard-fonts or cmaps) rooted at an
 * absolute directory. pdf.js constructs it with `{ baseUrl }` and calls
 * `fetch({ filename })`; we read the bytes via `fs.readFile` from
 * `<absDir>/<filename>`. This REPLACES pdf.js's default Node factory, which
 * calls `fs.readFile` on the verbatim `file://` URL STRING and fails (a
 * `file://` string is not a path), dropping every glyph — the v0.6.1 L-002
 * blank-text bug. By resolving the filename against the absolute dir ourselves
 * we sidestep the url-vs-path ambiguity entirely. `baseUrl` from pdf.js is the
 * `file://` URL we set; we ignore it and use the captured absolute dir.
 */
function makeNodeDataFactory(absDir: string): PdfJsDataFactory {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const nodePath = require('node:path') as typeof NodePath;
  class NodeFsDataFactory {
    constructor(_opts: { baseUrl: string | null }) {
      void _opts; // baseUrl ignored — we use the captured absolute dir.
    }
    async fetch(opts: { filename: string; compressionType?: number }): Promise<Uint8Array> {
      const full = nodePath.join(absDir, opts.filename);
      const buf = await fsPromises.readFile(full);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
  }
  return NodeFsDataFactory as unknown as PdfJsDataFactory;
}

/**
 * Resolve the pdfjs-dist standard-fonts + cmaps directories. Returns BOTH the
 * file:// URLs (kept for API compatibility / the browser fallback path) AND
 * explicit Node-safe data factories (the load-bearing part in the Electron main
 * process / Node test runner — see makeNodeDataFactory).
 *
 * Without these, pdf.js cannot resolve glyph paths for PDFs that reference
 * non-embedded standard fonts (Helvetica, Times, etc.) and standard-font text
 * rasterizes BLANK (v0.6.1 L-002). Resolving from the package root keeps the
 * paths correct in both dev and packaged (electron-builder ships pdfjs-dist
 * unpacked from the asar via `asarUnpack` — Diego's packaging concern).
 *
 * **Exported (Phase 5.2 — David, 2026-06-04):** the OCR rasterizer
 * (`ocr-bootstrap.ts:rasterizePageProd`) consumes this exact factory to fix the
 * SAME blank-text class for non-image-only PDFs. Any new pdf.js consumer in
 * the main process MUST go through this helper rather than re-implement —
 * see the Phase-5.2 lesson note in `D:\Vault\Agents\Learnings`.
 */
export function resolveExportFontData(): {
  standardFontDataUrl: string;
  cMapUrl: string;
  StandardFontDataFactory: PdfJsDataFactory;
  CMapReaderFactory: PdfJsDataFactory;
} {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const nodePath = require('node:path') as typeof NodePath;
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const { pathToFileURL } = require('node:url') as typeof NodeUrl;
  const pkgJson = require.resolve('pdfjs-dist/package.json');
  const root = nodePath.dirname(pkgJson);
  const dirFor = (sub: string): string => nodePath.join(root, sub) + nodePath.sep;
  const toUrl = (sub: string): string => pathToFileURL(dirFor(sub)).href;
  return {
    standardFontDataUrl: toUrl('standard_fonts'),
    cMapUrl: toUrl('cmaps'),
    StandardFontDataFactory: makeNodeDataFactory(dirFor('standard_fonts')),
    CMapReaderFactory: makeNodeDataFactory(dirFor('cmaps')),
  };
}

/**
 * Build the production source bundle (loader + rasterizer sharing one active
 * pdf.js document, rebound per job via `loader.bind(spec)`). This is the
 * single funnel that feeds text-content, line-segments, image extraction AND
 * rasterization for ALL four export formats.
 *
 * `deps` is OPTIONAL: production omits it (the real pdf.js + @napi-rs/canvas
 * loaders are used); unit tests inject synthetic loaders to drive the whole
 * pipeline without a real PDF or native canvas.
 */
export function createProdSourceLoader(
  deps?: Partial<{
    loadPdfJs: () => Promise<PdfJsModule>;
    createCanvas: () => CreateCanvasFn;
    resolveFontData: () => { standardFontDataUrl: string; cMapUrl: string };
    registerCanvasGlobals: () => void;
  }>,
): ProdSourceBundle {
  return createProdPdfJsSource({
    loadPdfJs: deps?.loadPdfJs ?? loadExportPdfJs,
    createCanvas: deps?.createCanvas ?? loadExportCanvasFactory,
    resolveFontData: deps?.resolveFontData ?? resolveExportFontData,
    registerCanvasGlobals: deps?.registerCanvasGlobals ?? registerExportCanvasGlobals,
  });
}

// ---- Engine bootstrap ------------------------------------------------------

export interface BootstrapExportOptions {
  layoutSettings?: Partial<LayoutSettings>;
}

export function bootstrapExportEngine(
  loader: PageSourceLoader,
  imageWriterRasterize: ImageWriterDeps['rasterize'],
  opts?: BootstrapExportOptions,
): ExportEngine {
  const pngEncoder = createCanvasPngEncoder();
  const deps: ExportEngineDeps = {
    layoutExtractor: createLayoutExtractor(opts?.layoutSettings),
    tableDetector: createTableDetector(),
    imageExtractor: createImageExtractor(pngEncoder),
    writers: {
      docx: createDocxWriter(createDocxLibrary()),
      xlsx: createXlsxWriter(createExcelJsLibrary()),
      pptx: createPptxWriter(createPptxLibrary()),
      image: createImageWriter(createImageWriterDeps(imageWriterRasterize)),
    },
    pngEncoder,
    loader,
    fs: {
      writeFile: (p, b) => fsPromises.writeFile(p, b),
      rename: (a, b) => fsPromises.rename(a, b),
      unlink: (p) => fsPromises.unlink(p),
      access: (p) => fsPromises.access(p),
    },
    ...(opts?.layoutSettings ? { layoutSettings: opts.layoutSettings } : {}),
  };
  return createExportEngine(deps);
}

// Keep type-only XlsxSheetSpec + PptxSlideSpec imports alive so consumers
// have a runtime-reachable handle to the schema for tests that build specs.
export type { XlsxSheetSpec, PptxSlideSpec };

export type { ImageWriter, ImageWriterDeps, PageSourceLoader };
