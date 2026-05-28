// Image writer (Phase 6, export-engine.md §7 — Q-F)
//
// SCOPE (P6-L-5):
//   - PNG default (lossless; no quality slider)
//   - JPEG opt-in with quality slider (default 0.9)
//   - TIFF opt-in with multi-page bundle toggle (default false)
//
// Rasterization path: pdfjs getPage → @napi-rs/canvas → canvas.toBuffer
// (image/png | image/jpeg). TIFF via `utif` over the canvas RGBA buffer.
//
// File-signature contract:
//   - PNG: `89 50 4E 47 0D 0A 1A 0A`
//   - JPEG: `FF D8 FF`
//   - TIFF: `49 49 2A 00` (little-endian) or `4D 4D 00 2A` (big-endian)
//
// DISCIPLINE (conventions §17.5):
//   - The rasterizer + tiff-encoder are INJECTED. Production wires
//     @napi-rs/canvas + utif (already in deps); tests inject deterministic
//     synthetic encoders that produce well-known fixture bytes.

import type { ImageExportFormat } from '../../../ipc/contracts.js';
import type { ExtractedDocument, ExtractedPage as _ExtractedPage } from '../types.js';

void (0 as unknown as _ExtractedPage); // keep import alive for type tooling

export interface RasterizedPage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

export interface ImageWriterDeps {
  /** Rasterize a single page at the requested DPI. Returns RGBA + dims. */
  rasterize(opts: {
    pageIndex: number;
    dpi: number;
    includeAnnotations: boolean;
  }): Promise<RasterizedPage>;
  /** Encode RGBA → PNG bytes. Production uses @napi-rs/canvas. */
  encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array;
  /** Encode RGBA → JPEG bytes. Quality is 0-1. */
  encodeJpeg(rgba: Uint8Array, width: number, height: number, quality: number): Uint8Array;
  /** Encode RGBA → single-page TIFF bytes. */
  encodeTiffPage(rgba: Uint8Array, width: number, height: number): Uint8Array;
  /** Encode multiple RGBA pages → ONE multi-page TIFF byte buffer. */
  encodeTiffMultiPage(
    pages: Array<{ rgba: Uint8Array; width: number; height: number }>,
  ): Uint8Array;
}

export interface ImageWriteOptions {
  format: ImageExportFormat;
  /** 72-600 inclusive */
  dpi: number;
  /** 0.1-1.0; honored only for jpeg */
  jpegQuality?: number;
  /** honored only for tiff */
  multiPageTiff?: boolean;
  includeAnnotations: boolean;
}

export interface ImageWriterStats {
  pagesProcessed: number;
}

export interface ImageWriteResult {
  /** ONE buffer per page for single-page formats; ONE buffer total for multi-tiff. */
  buffers: Uint8Array[];
  /** Suffix to append to the basename per buffer. */
  suffixes: string[];
}

export interface ImageWriter {
  write(doc: ExtractedDocument, opts: ImageWriteOptions): Promise<ImageWriteResult>;
}

function zeroPad(n: number, width: number): string {
  const s = String(n);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

export function createImageWriter(deps: ImageWriterDeps): ImageWriter & {
  stats: ImageWriterStats;
} {
  const stats: ImageWriterStats = { pagesProcessed: 0 };
  return {
    stats,
    async write(doc, opts) {
      const pageCount = doc.pages.length;
      const padWidth = String(pageCount).length;

      if (opts.format === 'tiff' && opts.multiPageTiff === true) {
        // Multi-page TIFF: rasterize all, encode once.
        const rasters: Array<{ rgba: Uint8Array; width: number; height: number }> = [];
        for (const page of doc.pages) {
          const r = await deps.rasterize({
            pageIndex: page.pageIndex,
            dpi: opts.dpi,
            includeAnnotations: opts.includeAnnotations,
          });
          rasters.push({ rgba: r.rgba, width: r.width, height: r.height });
          stats.pagesProcessed += 1;
        }
        const bytes = deps.encodeTiffMultiPage(rasters);
        return { buffers: [bytes], suffixes: [''] };
      }

      // Single-page outputs (one file per page).
      const buffers: Uint8Array[] = [];
      const suffixes: string[] = [];
      let pageNum = 0;
      for (const page of doc.pages) {
        pageNum += 1;
        const r = await deps.rasterize({
          pageIndex: page.pageIndex,
          dpi: opts.dpi,
          includeAnnotations: opts.includeAnnotations,
        });
        let bytes: Uint8Array;
        switch (opts.format) {
          case 'png':
            bytes = deps.encodePng(r.rgba, r.width, r.height);
            break;
          case 'jpeg': {
            const q = typeof opts.jpegQuality === 'number' ? opts.jpegQuality : 0.9;
            bytes = deps.encodeJpeg(r.rgba, r.width, r.height, q);
            break;
          }
          case 'tiff':
            bytes = deps.encodeTiffPage(r.rgba, r.width, r.height);
            break;
          default: {
            // Exhaustive — if a new format is added to ImageExportFormat,
            // typecheck fails here (the `never` branch).
            const exhaustive: never = opts.format;
            throw new Error(`unsupported image format: ${String(exhaustive)}`);
          }
        }
        buffers.push(bytes);
        suffixes.push(`-page${zeroPad(pageNum, padWidth)}`);
        stats.pagesProcessed += 1;
      }
      return { buffers, suffixes };
    },
  };
}
