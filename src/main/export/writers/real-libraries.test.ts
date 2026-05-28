// @vitest-environment node
//
// Real-library writer validity test (Phase 6.1, David — Diego follow-up #5).
//
// Diego installed docx@9.7.1 + pptxgenjs@4.0.1 in Wave 25. This test exercises
// the REAL libraries through the bootstrap factory functions (createDocxLibrary
// / createPptxLibrary / createExcelJsLibrary) and the writers, then asserts the
// produced files are valid OOXML (ZIP signature 50 4b 03 04, non-trivial size,
// openable). NOT the in-memory recorder stubs — the actual packages.

import { describe, expect, it } from 'vitest';

import { createDocxLibrary, createPptxLibrary, createExcelJsLibrary } from '../export-bootstrap.js';
import type { ExtractedDocument } from '../types.js';

import { createDocxWriter } from './docx-writer.js';
import { createPptxWriter } from './pptx-writer.js';
import { createXlsxWriter } from './xlsx-writer.js';

// A tiny 1x1 PNG (valid, decodes) for image-embed assertions.
const PNG_1x1 = new Uint8Array(
  Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082',
    'hex',
  ),
);

function docWithEverything(): ExtractedDocument {
  return {
    pageCount: 1,
    pageRange: { start: 0, end: 0 },
    pages: [
      {
        pageIndex: 0,
        pageSize: { widthPt: 612, heightPt: 792 },
        text: {
          paragraphs: [
            {
              text: 'Heading One',
              rect: { x: 72, y: 720, w: 200, h: 24 },
              heading: 'H1',
              alignment: 'left',
              fontHints: { bold: true, sizePt: 18 },
            },
            {
              text: 'A body paragraph with some text.',
              rect: { x: 72, y: 680, w: 400, h: 14 },
              heading: null,
              alignment: 'left',
              fontHints: { sizePt: 11 },
            },
          ],
          columnsDetected: 1,
        },
        tables: [
          {
            rect: { x: 72, y: 500, w: 300, h: 60 },
            rows: 2,
            columns: 2,
            cells: [
              [
                { text: 'Name', rect: null },
                { text: 'Value', rect: null },
              ],
              [
                { text: 'Alpha', rect: null },
                { text: '42', rect: null },
              ],
            ],
          },
        ],
        images: [
          {
            rect: { x: 100, y: 300, w: 80, h: 80 },
            bytes: PNG_1x1,
            widthPx: 1,
            heightPx: 1,
          },
        ],
        annotations: [{ kind: 'sticky-note', text: 'a note', rect: null }],
      },
    ],
  };
}

const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04];

function assertZip(bytes: Uint8Array): void {
  expect(bytes.length).toBeGreaterThan(1000);
  expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual(ZIP_SIG);
}

describe('real docx library (Diego Wave 25 install)', () => {
  it('produces a valid .docx with paragraphs, table, image, annotation', async () => {
    const writer = createDocxWriter(createDocxLibrary());
    const bytes = await writer.write(docWithEverything(), {
      pageSize: 'letter',
      includeAnnotations: true,
      qualityTier: 'layout-preserving',
    });
    assertZip(bytes);
    // Writer stats prove the real content flowed (not a stub no-op).
    expect(writer.stats.paragraphsExtracted).toBeGreaterThanOrEqual(2);
    expect(writer.stats.tablesDetected).toBe(1);
    expect(writer.stats.imagesEmbedded).toBe(1);
  });

  it('text-only tier still produces a valid .docx', async () => {
    const writer = createDocxWriter(createDocxLibrary());
    const bytes = await writer.write(docWithEverything(), {
      pageSize: 'auto',
      includeAnnotations: false,
      qualityTier: 'text-only',
    });
    assertZip(bytes);
  });
});

describe('real pptxgenjs library (Diego Wave 25 install)', () => {
  it('produces a valid .pptx with text, image, table, footer', async () => {
    const writer = createPptxWriter(createPptxLibrary());
    const bytes = await writer.write(docWithEverything(), {
      includeAnnotations: true,
      qualityTier: 'layout-preserving',
    });
    assertZip(bytes);
    expect(writer.stats.imagesEmbedded).toBe(1);
    expect(writer.stats.tablesDetected).toBe(1);
  });

  it('text-only tier still produces a valid .pptx', async () => {
    const writer = createPptxWriter(createPptxLibrary());
    const bytes = await writer.write(docWithEverything(), {
      includeAnnotations: false,
      qualityTier: 'text-only',
    });
    assertZip(bytes);
  });
});

describe('real exceljs library (xlsx parity through the same funnel)', () => {
  it('produces a valid .xlsx with a table sheet', async () => {
    const writer = createXlsxWriter(createExcelJsLibrary());
    const bytes = await writer.write(docWithEverything(), {
      includeAnnotations: false,
      qualityTier: 'layout-preserving',
    });
    assertZip(bytes);
    expect(writer.stats.tablesDetected).toBe(1);
  });
});
