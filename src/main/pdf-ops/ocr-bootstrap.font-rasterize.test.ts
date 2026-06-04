// @vitest-environment node
//
// Phase 5.2 Item B regression test (David, 2026-06-04).
//
// Proves the OCR rasterizer renders NON-EMBEDDED STANDARD-FONT glyphs
// (Helvetica/Times/Symbol — the PDF 1.7 base-14 set) as actual pixels rather
// than blank. Symptom this test guards: pdf.js emits
//   "Warning: getPathGenerator - ignoring character: <Helvetica_path_X>"
// and the rasterized PNG comes back with NO dark pixels in the glyph region.
// Tesseract then sees a near-empty image, returns very few words at collapsed
// confidence (the user's invoice OCR returned 22 words at 28.5 mean confidence
// with 81.8% low-confidence).
//
// Fix: `rasterizePageProd` now passes `standardFontDataUrl` +
// `StandardFontDataFactory` + `cMapUrl` + `cMapPacked` + `CMapReaderFactory`
// to `pdfjs.getDocument(...)`, mirroring the same wiring the EXPORT path uses
// in `src/main/export/pdfjs-source.ts:484`. Then forces font materialization
// via `page.getOperatorList()` before `page.render()` (same FONT-READINESS
// GATE the export rasterizer uses — pdfjs-source.ts:615).
//
// Skips if @napi-rs/canvas's native binding can't load in the test runner —
// same as the prod-render sibling test.

import { createRequire } from 'node:module';

import type * as PdfLib from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { documentStore } from './document-store.js';
import { _resetOcrFontDataCacheForTests, rasterizePageProd } from './ocr-bootstrap.js';

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

async function makeHelveticaPdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = require('pdf-lib') as typeof PdfLib;
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([200, 200]);
  // Big, dark glyph run so the dark-pixel assertion has a generous margin.
  page.drawText('OCR ME', { x: 10, y: 90, size: 48, font: f });
  return doc.save();
}

// Decode the raw 8-byte PNG header + first IHDR chunk to get the image
// dimensions. Mirrors `extractImageDimensionsFromPng` already in
// ocr-run-on-document but kept local so this test has no engine dep.
function pngDims(png: Uint8Array): { width: number; height: number } {
  // PNG signature (8) + IHDR length+type (4+4) → width at offset 16, height at 20.
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const run = canRunRealCanvas() ? describe : describe.skip;

run('OCR rasterizer: standard-font glyph rendering (Phase 5.2 Item B)', () => {
  it('renders Helvetica glyphs (non-trivial dark pixel count) after the font-factory wiring', async () => {
    _resetOcrFontDataCacheForTests();
    const bytes = await makeHelveticaPdf();
    const rec = documentStore.register({
      path: null,
      displayName: 'test-helvetica.pdf',
      fileHash: '0'.repeat(64),
      bytes,
      pageCount: 1,
      pdflibLoadWarnings: [],
    });
    try {
      const png = await rasterizePageProd({ handle: rec.handle, pageIndex: 0, dpi: 96 });
      const { width, height } = pngDims(png);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);

      // Decode the PNG into pixel bytes via @napi-rs/canvas and count
      // non-white pixels. Without the font-factory wiring this count is
      // essentially 0 (all glyphs ignored as "_path_X isn't resolved yet");
      // with the wiring, the glyphs paint dark pixels and the count is in
      // the thousands. We assert a conservative floor of 50.
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const canvasMod = require('@napi-rs/canvas') as {
        createCanvas: (
          w: number,
          h: number,
        ) => {
          getContext: (k: '2d') => {
            drawImage: (img: unknown, x: number, y: number) => void;
            getImageData: (
              x: number,
              y: number,
              w: number,
              h: number,
            ) => { data: Uint8ClampedArray };
          };
        };
        Image: new () => {
          src: Buffer | Uint8Array;
          width: number;
          height: number;
        };
      };
      const img = new canvasMod.Image();
      img.src = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
      const canvas = canvasMod.createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height);
      const data = imgData.data;
      let darkPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 255;
        const g = data[i + 1] ?? 255;
        const b = data[i + 2] ?? 255;
        // "Dark" = average channel below 200 (white-ish background = ~255).
        // The Helvetica glyphs paint near-black (0,0,0); the background is
        // transparent on the canvas, fills to white when @napi-rs decodes the
        // PNG, so any non-white pixel is a glyph stroke.
        if ((r + g + b) / 3 < 200) darkPixels++;
      }
      // Without the font-factory wiring: ~0 dark pixels (all glyphs blank).
      // With the wiring (this assertion): hundreds to thousands. Floor of 50
      // is a generous guard against a partial regression.
      expect(darkPixels).toBeGreaterThan(50);
    } finally {
      documentStore.release(rec.handle);
    }
  });
});
