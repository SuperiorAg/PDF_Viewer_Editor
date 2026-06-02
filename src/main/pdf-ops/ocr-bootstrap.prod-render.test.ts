// @vitest-environment node
//
// Production OCR rasterizer integration test (David, 2026-06-02 — v0.7.11 fix).
//
// Proves the FULL OCR rasterize path against a REAL pdf.js render with the real
// @napi-rs/canvas binding: a tiny pdf-lib-authored PDF parked in the
// documentStore → `rasterizePageProd` → real PNG bytes.
//
// This is the regression guard for the v0.7.10 user bug:
//   "ocr failed rasterize page 0 failed: Value is none of these types
//    `String`, `Path`,"
//
// Root cause: pdf.js's legacy build resolves `Image` / `Path2D` / `ImageData` /
// `DOMMatrix` via `globalThis` at render time. @napi-rs/canvas exports those
// classes but does NOT install them on `globalThis`, so pdf.js fell back to its
// internal polyfills (or hit the @napi-rs `Image` constructor guard for image
// XObjects). Fix: `tryLoadCanvas()` now installs the classes on `globalThis`
// inside the success branch. This test exercises the rasterizer end-to-end
// against the real binding so the polyfill install is exercised in CI.
//
// Skips gracefully if @napi-rs/canvas's native binding isn't loadable in the
// test runner — the binding ABI-mismatches when vitest runs under Node 24 vs
// the Electron-target rebuild (see backend-engineer learnings 2026-05-28).

import { createRequire } from 'node:module';

import type * as PdfLib from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { documentStore } from './document-store.js';
import { rasterizePageProd, tryLoadCanvas } from './ocr-bootstrap.js';

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

async function makeTextPdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = require('pdf-lib') as typeof PdfLib;
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([200, 200]);
  // Glyph run so the page has real content to render (image XObjects + text).
  page.drawText('OCR ME', { x: 12, y: 90, size: 36, font: f });
  return doc.save();
}

// PNG magic — first 8 bytes of every valid PNG file.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function startsWithPngMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_MAGIC[i]) return false;
  return true;
}

const run = canRunRealCanvas() ? describe : describe.skip;

run('OCR production rasterizer (real @napi-rs/canvas binding)', () => {
  it('installs Image/Path2D/ImageData/DOMMatrix on globalThis after tryLoadCanvas', () => {
    const r = tryLoadCanvas();
    expect(r.ok).toBe(true);
    const g = globalThis as unknown as Record<string, unknown>;
    // After tryLoadCanvas() succeeds, every class pdf.js may resolve via
    // globalThis at render time must be present. Missing any of these is the
    // v0.7.10 regression.
    expect(typeof g['Image']).toBe('function');
    expect(typeof g['Path2D']).toBe('function');
    expect(typeof g['ImageData']).toBe('function');
    expect(typeof g['DOMMatrix']).toBe('function');
  });

  it('rasterizes a real text page to PNG bytes without the String/Path error', async () => {
    const bytes = await makeTextPdf();
    const rec = documentStore.register({
      path: null,
      displayName: 'test-ocr-rasterize.pdf',
      // FileHash is `string` (sha256 hex). Real renderer code computes via
      // computeFileHash(); fixed-fingerprint is fine for an in-memory test.
      fileHash: '0'.repeat(64),
      bytes,
      pageCount: 1,
      pdflibLoadWarnings: [],
    });
    try {
      const png = await rasterizePageProd({ handle: rec.handle, pageIndex: 0, dpi: 96 });
      // Real PNG bytes — non-empty + starts with the PNG magic.
      expect(png).toBeInstanceOf(Uint8Array);
      expect(png.byteLength).toBeGreaterThan(0);
      expect(startsWithPngMagic(png)).toBe(true);
    } finally {
      documentStore.release(rec.handle);
    }
  });
});
