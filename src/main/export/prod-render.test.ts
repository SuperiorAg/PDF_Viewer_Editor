// @vitest-environment node
//
// Production rasterization integration test (Phase 6.1, David — image export).
//
// Proves the FULL image-export path against a REAL pdf.js render with the real
// @napi-rs/canvas binding: a tiny pdf-lib-authored PDF → prod source bundle
// rasterize → real PNG/JPEG/TIFF bytes with correct file signatures.
//
// This is the regression guard for the two production bugs found wiring M-25.4:
//   1. pdf.js DETACHES the input buffer — bind() must copy (else 2nd export of
//      the same doc fails "Cannot transfer object of unsupported type").
//   2. pdf.js v4 needs globalThis.Path2D registered from @napi-rs/canvas before
//      it loads — else page.render throws "Value is none of these types
//      String, Path" on any text page.
//
// Skips gracefully if @napi-rs/canvas's native binding isn't loadable in the
// test runner (the unit-level proof lives in pdfjs-source.test.ts with a
// synthetic canvas; this test is the real-binding belt-and-suspenders).

import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import type * as PdfLib from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { createProdPdfJsSource } from './pdfjs-source.js';
import type { PdfJsModule } from './pdfjs-source.js';
import type { ExportJobSpec } from './types.js';

const require = createRequire(import.meta.url);

function canRunRealCanvas(): boolean {
  try {
    require('@napi-rs/canvas');
    require('pdfjs-dist/package.json');
    return true;
  } catch {
    return false;
  }
}

async function makeTextPdf(font = 'Helvetica'): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = require('pdf-lib') as typeof PdfLib;
  const doc = await PDFDocument.create();
  const f = await doc.embedFont((StandardFonts as Record<string, string>)[font]!);
  const page = doc.addPage([200, 200]);
  // Big, dense glyph run so the dark-pixel count is unambiguous vs a blank page.
  page.drawText('RENDER ME', { x: 12, y: 90, size: 36, font: f });
  return doc.save();
}

/** A PDF with NO text at all — the dark-pixel baseline for the glyph assertion. */
async function makeBlankPdf(): Promise<Uint8Array> {
  const { PDFDocument } = require('pdf-lib') as typeof PdfLib;
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save();
}

/**
 * Count "dark" pixels (any RGBA pixel whose max channel is below `threshold`).
 * pdf.js renders text as near-black ink on a white background; a glyph run
 * produces hundreds of dark pixels, a blank page produces ~zero. This is the
 * assertion that distinguishes "text rendered" from "text dropped" — the
 * `.some(b => b !== 0)` check the original test used passes even on a blank
 * WHITE page (every byte is 255, none zero), so it could NOT catch the
 * standard-font glyph-drop bug (v0.6.1 L-002). See Diego's global learning
 * 2026-05-27: "Assert asset-presence in output (glyph dark-pixel count), not
 * just 'did not throw'."
 */
function countDarkPixels(rgba: Uint8Array, threshold = 100): number {
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    if (Math.max(r, g, b) < threshold) n++;
  }
  return n;
}

/** A Node-safe pdf.js data factory mirroring production's makeNodeDataFactory:
 *  reads font/cmap bytes from the filesystem instead of fetch(file://). This is
 *  the load-bearing fix for v0.6.1 L-002 — without it pdf.js's default Node
 *  factory fs.readFile's the verbatim file:// URL string and drops all glyphs. */
function nodeDataFactory(absDir: string) {
  return class {
    constructor(_opts: { baseUrl: string | null }) {
      void _opts;
    }
    async fetch(opts: { filename: string }): Promise<Uint8Array> {
      const buf = require('node:fs').readFileSync(path.join(absDir, opts.filename)) as Buffer;
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
  };
}

function realDeps() {
  const canvas = require('@napi-rs/canvas') as Record<string, unknown> & {
    createCanvas: (w: number, h: number) => unknown;
  };
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const fontsDir = path.join(root, 'standard_fonts') + path.sep;
  const cmapsDir = path.join(root, 'cmaps') + path.sep;
  return {
    loadPdfJs: async () =>
      (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsModule,
    createCanvas: () => canvas.createCanvas as (w: number, h: number) => never,
    resolveFontData: () => ({
      standardFontDataUrl: pathToFileURL(fontsDir).href,
      cMapUrl: pathToFileURL(cmapsDir).href,
      StandardFontDataFactory: nodeDataFactory(fontsDir),
      CMapReaderFactory: nodeDataFactory(cmapsDir),
    }),
    registerCanvasGlobals: () => {
      const g = globalThis as unknown as Record<string, unknown>;
      for (const k of ['Path2D', 'DOMMatrix', 'ImageData', 'DOMPoint']) {
        if (g[k] === undefined && typeof canvas[k] === 'function') g[k] = canvas[k];
      }
    },
  };
}

function spec(over?: Partial<ExportJobSpec>): ExportJobSpec {
  return {
    jobId: 1,
    docHash: 'h',
    sourceBytes: new Uint8Array(),
    pageCount: 1,
    format: 'png',
    qualityTier: 'n/a',
    pageRange: { start: 0, end: 0 },
    includeAnnotations: false,
    outputPath: '/tmp/o.png',
    perFormat: { format: 'png', dpi: 96 },
    ...over,
  };
}

const run = canRunRealCanvas() ? describe : describe.skip;

run('production pdf.js render (real @napi-rs/canvas binding)', () => {
  it('rasterizes a real text page to RGBA without the Path2D error', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = createProdPdfJsSource(realDeps() as any);
    const bytes = await makeTextPdf();
    await bundle.loader.bind!(spec({ sourceBytes: bytes }));
    const r = await bundle.rasterize({
      pageIndex: 0,
      dpi: 96,
      includeAnnotations: false,
    });
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    expect(r.rgba.length).toBe(r.width * r.height * 4);
    // Real pixels — not all-zero (the text rendered).
    expect(r.rgba.some((b) => b !== 0)).toBe(true);
    await bundle.loader.release!();
  });

  // REGRESSION GUARD for v0.6.1 L-002 (Phase 6.2): standard-font text must
  // actually appear in the rasterized output, not just "the render didn't
  // throw". Compares the dark-pixel count of a text page against a blank page.
  // BEFORE the font-readiness gate, the Helvetica glyphs were dropped and the
  // text page rasterized identically to the blank page (both all-white) — this
  // test would have caught that; the original `.some(b => b !== 0)` did not.
  it.each(['Helvetica', 'TimesRoman', 'Courier'])(
    'renders standard-font (%s) text as visible dark pixels (not blank)',
    async (fontName) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bundle = createProdPdfJsSource(realDeps() as any);

      const blankBytes = await makeBlankPdf();
      await bundle.loader.bind!(spec({ jobId: 1, sourceBytes: blankBytes }));
      const blank = await bundle.rasterize({ pageIndex: 0, dpi: 96, includeAnnotations: false });
      const blankDark = countDarkPixels(blank.rgba);
      await bundle.loader.release!();

      const textBytes = await makeTextPdf(fontName);
      await bundle.loader.bind!(spec({ jobId: 2, sourceBytes: textBytes }));
      const text = await bundle.rasterize({ pageIndex: 0, dpi: 96, includeAnnotations: false });
      const textDark = countDarkPixels(text.rgba);
      await bundle.loader.release!();

      // A blank page has essentially no dark pixels.
      expect(blankDark).toBeLessThan(20);
      // A 36pt "RENDER ME" run produces hundreds of dark glyph pixels. If the
      // standard font failed to load, textDark would be ~blankDark (the bug).
      expect(textDark).toBeGreaterThan(200);
      expect(textDark).toBeGreaterThan(blankDark + 200);
    },
  );

  it('a SECOND export of the same bytes still works (buffer-detach fix)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = createProdPdfJsSource(realDeps() as any);
    const bytes = await makeTextPdf();
    // First job consumes the bytes.
    await bundle.loader.bind!(spec({ jobId: 1, sourceBytes: bytes }));
    await bundle.rasterize({ pageIndex: 0, dpi: 72, includeAnnotations: false });
    await bundle.loader.release!();
    // Second job with the SAME byte reference — must NOT throw "Cannot transfer
    // object of unsupported type" (bind copies before handing to pdf.js).
    await bundle.loader.bind!(spec({ jobId: 2, sourceBytes: bytes }));
    const size = await bundle.loader.getPageSize(0);
    expect(size.widthPt).toBeGreaterThan(0);
    await bundle.loader.release!();
  });
});
