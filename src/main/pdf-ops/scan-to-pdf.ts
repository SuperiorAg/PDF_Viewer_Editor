// Phase 5.1 — compose scanned image pages into a single PDF.
//
// ARCHITECTURE: the scan:acquire handler hands the scanned pages here so a
// multi-page ADF scan becomes one PDF (the Phase 5 use case "scan -> PDF"),
// and the result can be fed to the OCR pipeline for scan -> searchable-PDF.
//
// FORMAT NORMALIZATION:
//   WIA emits BMP by default; the addon may also yield PNG/JPEG/TIFF. pdf-lib
//   embeds only PNG/JPEG, so we normalize:
//     - bmp  -> PNG via bmp-decoder (no new dep; reuses the TIFF PNG encoder)
//     - tiff -> PNG via the existing decodeTiff (utif)
//     - png  -> embedPng
//     - jpeg -> embedJpg
//   Each page is sized to its native pixel dims at 72 DPI-equivalent points so
//   the PDF page matches the scan's aspect ratio (no A4 cap — scans are real
//   document sizes the user expects 1:1).
//
// Pure-ish: takes bytes in, returns bytes out. No FS, no DB. Async because
// pdf-lib embed + TIFF decode are async.

import { PDFDocument } from 'pdf-lib';

import type { Result } from '../../shared/result.js';
import { fail, ok } from '../../shared/result.js';

import { decodeBmp } from './bmp-decoder.js';
import { decodeTiff } from './tiff-decoder.js';

export type ScanToPdfError = 'no_pages' | 'page_decode_failed' | 'pdf_compose_failed';

export interface ScanPage {
  bytes: Uint8Array;
  format: 'bmp' | 'png' | 'jpeg' | 'tiff';
}

export interface ScanToPdfValue {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
}

interface Embeddable {
  bytes: Uint8Array;
  kind: 'png' | 'jpeg';
}

async function normalize(
  page: ScanPage,
  warnings: string[],
): Promise<Result<Embeddable, ScanToPdfError>> {
  switch (page.format) {
    case 'png':
      return ok({ bytes: page.bytes, kind: 'png' });
    case 'jpeg':
      return ok({ bytes: page.bytes, kind: 'jpeg' });
    case 'bmp': {
      const r = decodeBmp(page.bytes);
      if (!r.ok) return fail<ScanToPdfError>('page_decode_failed', `bmp: ${r.message}`);
      return ok({ bytes: r.value.bytes, kind: 'png' });
    }
    case 'tiff': {
      const r = await decodeTiff(page.bytes);
      if (!r.ok) return fail<ScanToPdfError>('page_decode_failed', `tiff: ${r.message}`);
      warnings.push(...r.value.warnings);
      return ok({ bytes: r.value.bytes, kind: 'png' });
    }
    default: {
      const exhaustive: never = page.format;
      void exhaustive;
      return fail<ScanToPdfError>('page_decode_failed', `unsupported format ${String(page.format)}`);
    }
  }
}

/**
 * Compose scanned pages into a single PDF. Each page is embedded at its native
 * pixel dimensions (1 px = 1 pt) so the document keeps the scan's aspect ratio.
 */
export async function composeScanToPdf(
  pages: ScanPage[],
): Promise<Result<ScanToPdfValue, ScanToPdfError>> {
  if (!pages || pages.length === 0) {
    return fail<ScanToPdfError>('no_pages', 'no scanned pages to compose');
  }
  const warnings: string[] = [];
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.create();
  } catch (e) {
    return fail<ScanToPdfError>('pdf_compose_failed', `PDFDocument.create threw: ${(e as Error).message}`);
  }

  for (let i = 0; i < pages.length; i += 1) {
    const norm = await normalize(pages[i]!, warnings);
    if (!norm.ok) return fail<ScanToPdfError>(norm.error, `page ${i}: ${norm.message}`);
    try {
      const img =
        norm.value.kind === 'png'
          ? await doc.embedPng(norm.value.bytes)
          : await doc.embedJpg(norm.value.bytes);
      const { width, height } = img.size();
      const page = doc.addPage([width, height]);
      page.drawImage(img, { x: 0, y: 0, width, height });
    } catch (e) {
      return fail<ScanToPdfError>('pdf_compose_failed', `embed/draw page ${i} threw: ${(e as Error).message}`);
    }
  }

  let bytes: Uint8Array;
  try {
    bytes = await doc.save();
  } catch (e) {
    return fail<ScanToPdfError>('pdf_compose_failed', `doc.save threw: ${(e as Error).message}`);
  }
  return ok({ bytes, pageCount: pages.length, warnings });
}
