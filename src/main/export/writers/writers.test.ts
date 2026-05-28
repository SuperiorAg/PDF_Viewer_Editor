// @vitest-environment node
//
// Co-located tests for all four writers. Each writer uses a typed in-memory
// recorder as the library injection — production wires the real libs.
//
// Golden-bytes-LITE pattern: we assert the recorded ChildSpec structure that
// the writer would feed to docx / pptxgenjs / exceljs — that's the load-
// bearing transformation (PDF model → library spec). The library itself
// emits valid bytes; Wave 25 packaging adds an end-to-end smoke that verifies
// the docx zip round-trips.

import { describe, expect, it } from 'vitest';

import type { ExtractedDocument, ExtractedPage } from '../types.js';

import { createDocxWriter, type DocxChild, type DocxLibrary } from './docx-writer.js';
import { createImageWriter, type ImageWriterDeps } from './image-writer.js';
import { createPptxWriter, type PptxLibrary, type PptxSlideSpec } from './pptx-writer.js';
import { createXlsxWriter, type XlsxLibrary, type XlsxWorkbookSpec } from './xlsx-writer.js';

function buildDoc(pages: Partial<ExtractedPage>[]): ExtractedDocument {
  return {
    pageCount: pages.length,
    pageRange: { start: 0, end: pages.length - 1 },
    pages: pages.map((p, i) => ({
      pageIndex: i,
      pageSize: { widthPt: 612, heightPt: 792 },
      text: p.text ?? null,
      tables: p.tables ?? [],
      images: p.images ?? [],
      annotations: p.annotations ?? [],
    })),
  };
}

// ---------------------------------------------------------------------------
// DOCX WRITER
// ---------------------------------------------------------------------------

describe('docx-writer (export-engine.md §4)', () => {
  function recorderLib(): DocxLibrary & {
    last: { pageSize?: 'letter' | 'a4' | 'auto'; children: DocxChild[] };
  } {
    const last: {
      pageSize?: 'letter' | 'a4' | 'auto';
      children: DocxChild[];
    } = { children: [] };
    return {
      last,
      async compose(opts) {
        last.pageSize = opts.pageSize;
        last.children = opts.children;
        // Return a sentinel byte buffer (docx file signature: PK\x03\x04 is
        // valid ZIP — we use a synthetic byte string for round-trip test only)
        return new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
      },
    };
  }

  it('emits one paragraph per ExtractedParagraph in layout-preserving tier', async () => {
    const lib = recorderLib();
    const w = createDocxWriter(lib);
    const doc = buildDoc([
      {
        text: {
          paragraphs: [
            {
              text: 'Hello',
              rect: { x: 72, y: 720, w: 100, h: 12 },
              heading: null,
              alignment: 'left',
              fontHints: { bold: false, italic: false, sizePt: 12 },
            },
            {
              text: 'Heading',
              rect: { x: 72, y: 680, w: 100, h: 24 },
              heading: 'H1',
              alignment: 'left',
              fontHints: { bold: true, italic: false, sizePt: 24 },
            },
          ],
          columnsDetected: 1,
        },
      },
    ]);
    await w.write(doc, {
      pageSize: 'auto',
      includeAnnotations: false,
      qualityTier: 'layout-preserving',
    });
    const paragraphs = lib.last.children.filter((c) => c.kind === 'paragraph');
    expect(paragraphs).toHaveLength(2);
    if (paragraphs[1]!.kind === 'paragraph') {
      expect(paragraphs[1]!.spec.heading).toBe('Heading1');
      expect(paragraphs[1]!.spec.bold).toBe(true);
    }
    expect(w.stats.paragraphsExtracted).toBe(2);
  });

  it('text-only tier skips tables and images', async () => {
    const lib = recorderLib();
    const w = createDocxWriter(lib);
    const doc = buildDoc([
      {
        text: {
          paragraphs: [
            {
              text: 'Some text',
              rect: { x: 72, y: 720, w: 100, h: 12 },
              heading: null,
              alignment: 'left',
              fontHints: {},
            },
          ],
          columnsDetected: 1,
        },
        tables: [
          {
            rect: { x: 100, y: 400, w: 200, h: 100 },
            rows: 2,
            columns: 2,
            cells: [
              [
                { text: 'A', rect: null },
                { text: 'B', rect: null },
              ],
              [
                { text: 'C', rect: null },
                { text: 'D', rect: null },
              ],
            ],
          },
        ],
        images: [
          {
            rect: { x: 0, y: 0, w: 100, h: 100 },
            bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
            widthPx: 32,
            heightPx: 32,
          },
        ],
      },
    ]);
    await w.write(doc, {
      pageSize: 'auto',
      includeAnnotations: false,
      qualityTier: 'text-only',
    });
    const tables = lib.last.children.filter((c) => c.kind === 'table');
    const images = lib.last.children.filter((c) => c.kind === 'image');
    expect(tables).toHaveLength(0);
    expect(images).toHaveLength(0);
  });

  it('emits annotations as italic [Note: ...] paragraphs when includeAnnotations=true', async () => {
    const lib = recorderLib();
    const w = createDocxWriter(lib);
    const doc = buildDoc([
      {
        annotations: [{ kind: 'sticky-note', text: 'review me', rect: null }],
      },
    ]);
    await w.write(doc, {
      pageSize: 'auto',
      includeAnnotations: true,
      qualityTier: 'layout-preserving',
    });
    const para = lib.last.children.find(
      (c) => c.kind === 'paragraph' && c.spec.text.includes('review me'),
    );
    expect(para).toBeDefined();
    if (para && para.kind === 'paragraph') {
      expect(para.spec.italic).toBe(true);
    }
  });

  it('omits annotations when includeAnnotations=false', async () => {
    const lib = recorderLib();
    const w = createDocxWriter(lib);
    const doc = buildDoc([{ annotations: [{ kind: 'sticky-note', text: 'note', rect: null }] }]);
    await w.write(doc, {
      pageSize: 'auto',
      includeAnnotations: false,
      qualityTier: 'layout-preserving',
    });
    expect(lib.last.children).toEqual([]);
  });

  it('passes pageSize through to the library', async () => {
    const lib = recorderLib();
    const w = createDocxWriter(lib);
    await w.write(buildDoc([{}]), {
      pageSize: 'letter',
      includeAnnotations: false,
      qualityTier: 'text-only',
    });
    expect(lib.last.pageSize).toBe('letter');
  });
});

// ---------------------------------------------------------------------------
// XLSX WRITER
// ---------------------------------------------------------------------------

describe('xlsx-writer (export-engine.md §5)', () => {
  function recorderLib(): XlsxLibrary & { last: XlsxWorkbookSpec | null } {
    const last: { last: XlsxWorkbookSpec | null } = { last: null };
    return {
      last: null,
      async compose(spec) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).last = spec;
        last.last = spec;
        return new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
      },
    };
  }

  it('emits one sheet per detected TableRegion in layout-preserving tier', async () => {
    const lib = recorderLib();
    const w = createXlsxWriter(lib);
    const doc = buildDoc([
      {
        tables: [
          {
            rect: { x: 100, y: 400, w: 200, h: 100 },
            rows: 2,
            columns: 2,
            cells: [
              [
                { text: 'Name', rect: null },
                { text: 'Qty', rect: null },
              ],
              [
                { text: 'Widget', rect: null },
                { text: '42', rect: null },
              ],
            ],
          },
        ],
      },
    ]);
    await w.write(doc, {
      includeAnnotations: false,
      qualityTier: 'layout-preserving',
    });
    const sheets = lib.last?.sheets ?? [];
    expect(sheets.length).toBeGreaterThan(0);
    const tableSheet = sheets.find((s) => s.name.startsWith('Page1_Table'));
    expect(tableSheet).toBeDefined();
    // Numeric coercion check — '42' should become number.
    expect(tableSheet!.rows[1]![1]).toBe(42);
  });

  it('text-only tier emits one Text sheet per page (no Table sheets)', async () => {
    const lib = recorderLib();
    const w = createXlsxWriter(lib);
    const doc = buildDoc([
      {
        text: {
          paragraphs: [
            {
              text: 'Para A',
              rect: { x: 0, y: 0, w: 50, h: 10 },
              heading: null,
              alignment: 'left',
              fontHints: {},
            },
            {
              text: 'Para B',
              rect: { x: 0, y: 20, w: 50, h: 10 },
              heading: null,
              alignment: 'left',
              fontHints: {},
            },
          ],
          columnsDetected: 1,
        },
        tables: [
          {
            rect: { x: 100, y: 100, w: 100, h: 50 },
            rows: 1,
            columns: 1,
            cells: [[{ text: 'X', rect: null }]],
          },
        ],
      },
    ]);
    await w.write(doc, {
      includeAnnotations: false,
      qualityTier: 'text-only',
    });
    const sheets = lib.last?.sheets ?? [];
    expect(sheets.find((s) => s.name.startsWith('Page1_Table'))).toBeUndefined();
    expect(sheets.find((s) => s.name === 'Page1')).toBeDefined();
  });

  it('appends Annotations sheet only when includeAnnotations=true', async () => {
    const lib = recorderLib();
    const w = createXlsxWriter(lib);
    const doc = buildDoc([
      {
        annotations: [{ kind: 'sticky-note', text: 'review', rect: null }],
      },
    ]);
    await w.write(doc, {
      includeAnnotations: true,
      qualityTier: 'text-only',
    });
    const sheets = lib.last?.sheets ?? [];
    expect(sheets.find((s) => s.name === 'Annotations')).toBeDefined();
  });

  it('truncates sheet names to 31 chars', async () => {
    const lib = recorderLib();
    const w = createXlsxWriter(lib);
    await w.write(buildDoc([{}]), {
      includeAnnotations: false,
      qualityTier: 'text-only',
    });
    // No content → Empty placeholder sheet
    const sheets = lib.last?.sheets ?? [];
    for (const s of sheets) expect(s.name.length).toBeLessThanOrEqual(31);
  });
});

// ---------------------------------------------------------------------------
// PPTX WRITER
// ---------------------------------------------------------------------------

describe('pptx-writer (export-engine.md §6)', () => {
  function recorderLib(): PptxLibrary & { last: PptxSlideSpec[] } {
    const last: { last: PptxSlideSpec[] } = { last: [] };
    return {
      last: [],
      async compose(opts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).last = opts.slides;
        last.last = opts.slides;
        return new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
      },
    };
  }

  it('emits one slide per page', async () => {
    const lib = recorderLib();
    const w = createPptxWriter(lib);
    const doc = buildDoc([{}, {}, {}]);
    await w.write(doc, {
      includeAnnotations: false,
      qualityTier: 'text-only',
    });
    expect(lib.last).toHaveLength(3);
  });

  it('text-only tier produces ONE text block per slide concatenating paragraphs', async () => {
    const lib = recorderLib();
    const w = createPptxWriter(lib);
    const doc = buildDoc([
      {
        text: {
          paragraphs: [
            {
              text: 'one',
              rect: null,
              heading: null,
              alignment: 'left',
              fontHints: {},
            },
            {
              text: 'two',
              rect: null,
              heading: null,
              alignment: 'left',
              fontHints: {},
            },
          ],
          columnsDetected: 1,
        },
      },
    ]);
    await w.write(doc, {
      includeAnnotations: false,
      qualityTier: 'text-only',
    });
    expect(lib.last).toHaveLength(1);
    expect(lib.last[0]!.blocks).toHaveLength(1);
    if (lib.last[0]!.blocks[0]!.kind === 'text') {
      expect(lib.last[0]!.blocks[0]!.spec.text).toContain('one');
      expect(lib.last[0]!.blocks[0]!.spec.text).toContain('two');
    }
  });

  it('layout-preserving converts paragraph rects from pt → in (PDF Y flipped)', async () => {
    const lib = recorderLib();
    const w = createPptxWriter(lib);
    const doc = buildDoc([
      {
        text: {
          paragraphs: [
            {
              text: 'Para',
              // PDF user-space: bottom-left at (72, 720); height 12 → top at 732
              // PPTX top-down: y = (792 - 732) / 72 = 0.833 in (scaled to slide)
              rect: { x: 72, y: 720, w: 100, h: 12 },
              heading: null,
              alignment: 'left',
              fontHints: { sizePt: 12 },
            },
          ],
          columnsDetected: 1,
        },
      },
    ]);
    await w.write(doc, {
      includeAnnotations: false,
      qualityTier: 'layout-preserving',
    });
    const slide = lib.last[0]!;
    const textBlock = slide.blocks.find((b) => b.kind === 'text');
    expect(textBlock).toBeDefined();
    if (textBlock && textBlock.kind === 'text') {
      // Source page is 612×792pt = 8.5×11in. Slide layout is 13.333×7.5in.
      // Scale ratios: sx = 13.333/8.5 ≈ 1.5686 ; sy = 7.5/11 ≈ 0.6818.
      // 72pt source X → 1.0in → 1.0 × sx ≈ 1.5686 slide-X (export-engine.md §6.2).
      const sx = 13.333 / 8.5;
      expect(textBlock.spec.x).toBeCloseTo(1.0 * sx, 2);
      // PDF Y is bottom-up; PPTX is top-down. Source rect y=720, h=12 →
      // top-pt = 792 - (720 + 12) = 60 → top-in = 60/72 ≈ 0.833 → ×sy ≈ 0.568.
      const sy = 7.5 / 11;
      expect(textBlock.spec.y).toBeCloseTo(((792 - (720 + 12)) / 72) * sy, 2);
    }
  });

  it('emits footer when includeAnnotations and annotations present', async () => {
    const lib = recorderLib();
    const w = createPptxWriter(lib);
    const doc = buildDoc([
      {
        annotations: [{ kind: 'sticky-note', text: 'remember this', rect: null }],
      },
    ]);
    await w.write(doc, {
      includeAnnotations: true,
      qualityTier: 'text-only',
    });
    expect(lib.last[0]!.footer).toContain('remember this');
  });
});

// ---------------------------------------------------------------------------
// IMAGE WRITER
// ---------------------------------------------------------------------------

describe('image-writer (export-engine.md §7)', () => {
  function syntheticDeps(): ImageWriterDeps {
    return {
      rasterize: async ({ pageIndex }) => ({
        rgba: new Uint8Array(16 * 16 * 4).fill(pageIndex + 1),
        width: 16,
        height: 16,
      }),
      encodePng: (_rgba, w, h) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, w, h]),
      encodeJpeg: (_rgba, w, h, q) => new Uint8Array([0xff, 0xd8, 0xff, w, h, Math.round(q * 100)]),
      encodeTiffPage: (_rgba, w, h) => new Uint8Array([0x49, 0x49, 0x2a, 0, w, h]),
      encodeTiffMultiPage: (pages) => new Uint8Array([0x49, 0x49, 0x2a, 0, pages.length]),
    };
  }

  it('emits one buffer per page for PNG with zero-padded suffixes', async () => {
    const w = createImageWriter(syntheticDeps());
    const doc = buildDoc([{}, {}, {}]);
    const r = await w.write(doc, {
      format: 'png',
      dpi: 150,
      includeAnnotations: true,
    });
    expect(r.buffers).toHaveLength(3);
    expect(r.suffixes[0]).toBe('-page1'); // 3 pages → width 1
    expect(r.buffers[0]![0]).toBe(0x89);
  });

  it('JPEG quality is forwarded to encoder', async () => {
    const w = createImageWriter(syntheticDeps());
    const doc = buildDoc([{}]);
    const r = await w.write(doc, {
      format: 'jpeg',
      dpi: 150,
      jpegQuality: 0.5,
      includeAnnotations: true,
    });
    expect(r.buffers[0]![0]).toBe(0xff);
    expect(r.buffers[0]![5]).toBe(50); // quality * 100
  });

  it('multi-page TIFF emits ONE buffer, no suffix', async () => {
    const w = createImageWriter(syntheticDeps());
    const doc = buildDoc([{}, {}, {}]);
    const r = await w.write(doc, {
      format: 'tiff',
      dpi: 150,
      multiPageTiff: true,
      includeAnnotations: true,
    });
    expect(r.buffers).toHaveLength(1);
    expect(r.suffixes).toEqual(['']);
    expect(r.buffers[0]![4]).toBe(3); // page count
  });

  it('single-page TIFF emits ONE buffer per page', async () => {
    const w = createImageWriter(syntheticDeps());
    const doc = buildDoc([{}, {}]);
    const r = await w.write(doc, {
      format: 'tiff',
      dpi: 150,
      multiPageTiff: false,
      includeAnnotations: true,
    });
    expect(r.buffers).toHaveLength(2);
    expect(r.buffers[0]![0]).toBe(0x49);
  });

  it('zero-pads suffix to width of total-page-count', async () => {
    const w = createImageWriter(syntheticDeps());
    const doc = buildDoc(new Array(12).fill({}));
    const r = await w.write(doc, {
      format: 'png',
      dpi: 150,
      includeAnnotations: true,
    });
    expect(r.suffixes[0]).toBe('-page01');
    expect(r.suffixes[11]).toBe('-page12');
  });
});
