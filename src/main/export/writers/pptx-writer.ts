// PPTX writer (Phase 6, export-engine.md §6)
//
// Library: `pptxgenjs` (MIT, ^4.0.1) — pure-JS PPTX authoring. Diego installs
// the dep in Wave 25.
//
// SCOPE (P6-L-4):
//   - One slide per source PDF page.
//   - 16:9 widescreen layout (13.333in x 7.5in — pptxgenjs LAYOUT_WIDE).
//   - Text positioned via x/y/w/h converted from PDF pts → inches (1pt=1/72in).
//   - Images embedded inline at PDF coords; base64 PNG.
//   - Tables emitted via slide.addTable at the table's rect.
//
// DEFERRED to Phase 6.1:
//   - Slide masters, themes, animations, speaker notes.
//
// DISCIPLINE (conventions §17.5):
//   - Library injection mirrors the docx writer pattern.

import type {
  ExtractedDocument,
  ExtractedImage,
  ExtractedParagraph,
  TableRegion,
} from '../types.js';

// ---- Library-shape -----------------------------------------------------------

export interface PptxTextBlockSpec {
  text: string;
  /** Position in inches (origin top-left, pptxgenjs convention). */
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
}

export interface PptxImageBlockSpec {
  /** Already-base64'd PNG bytes — caller passes `data:image/png;base64,...`. */
  dataUri: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PptxTableBlockSpec {
  rows: Array<Array<{ text: string }>>;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PptxBlock =
  | { kind: 'text'; spec: PptxTextBlockSpec }
  | { kind: 'image'; spec: PptxImageBlockSpec }
  | { kind: 'table'; spec: PptxTableBlockSpec };

export interface PptxSlideSpec {
  blocks: PptxBlock[];
  /** Optional speaker-note-like footer text (annotations). */
  footer: string | null;
}

export interface PptxLibrary {
  compose(opts: { slides: PptxSlideSpec[] }): Promise<Uint8Array>;
}

// ---- Writer surface ---------------------------------------------------------

export interface PptxWriteOptions {
  includeAnnotations: boolean;
  qualityTier: 'text-only' | 'layout-preserving';
}

export interface PptxWriter {
  write(doc: ExtractedDocument, opts: PptxWriteOptions): Promise<Uint8Array>;
}

export interface PptxWriterStats {
  paragraphsExtracted: number;
  tablesDetected: number;
  imagesEmbedded: number;
}

// ---- Helpers ----------------------------------------------------------------

const SLIDE_W_IN = 13.333; // pptxgenjs LAYOUT_WIDE
const SLIDE_H_IN = 7.5;

function ptToIn(pt: number): number {
  return pt / 72;
}

function buildTextBlock(
  p: ExtractedParagraph,
  pageHeightPt: number,
  sx: number,
  sy: number,
): PptxBlock | null {
  if (p.rect === null) return null;
  // PDF Y is bottom-up; PPTX Y is top-down. Flip via page height.
  const x = ptToIn(p.rect.x) * sx;
  const y = ptToIn(pageHeightPt - (p.rect.y + p.rect.h)) * sy;
  const w = ptToIn(p.rect.w) * sx;
  const h = ptToIn(p.rect.h) * sy;
  return {
    kind: 'text',
    spec: {
      text: p.text,
      x,
      y,
      w,
      h,
      fontSize: typeof p.fontHints.sizePt === 'number' ? p.fontHints.sizePt : 12,
      bold: p.fontHints.bold === true,
      italic: p.fontHints.italic === true,
      align: p.alignment,
    },
  };
}

function buildImageBlock(
  img: ExtractedImage,
  pageHeightPt: number,
  sx: number,
  sy: number,
): PptxBlock | null {
  if (img.rect === null) return null;
  const dataUri = `data:image/png;base64,${Buffer.from(img.bytes).toString('base64')}`;
  return {
    kind: 'image',
    spec: {
      dataUri,
      x: ptToIn(img.rect.x) * sx,
      y: ptToIn(pageHeightPt - (img.rect.y + img.rect.h)) * sy,
      w: ptToIn(img.rect.w) * sx,
      h: ptToIn(img.rect.h) * sy,
    },
  };
}

function buildTableBlock(
  t: TableRegion,
  pageHeightPt: number,
  sx: number,
  sy: number,
): PptxBlock | null {
  if (t.rect === null) return null;
  return {
    kind: 'table',
    spec: {
      rows: t.cells.map((row) => row.map((c) => ({ text: c.text }))),
      x: ptToIn(t.rect.x) * sx,
      y: ptToIn(pageHeightPt - (t.rect.y + t.rect.h)) * sy,
      w: ptToIn(t.rect.w) * sx,
      h: ptToIn(t.rect.h) * sy,
    },
  };
}

export function createPptxWriter(library: PptxLibrary): PptxWriter & {
  stats: PptxWriterStats;
} {
  const stats: PptxWriterStats = {
    paragraphsExtracted: 0,
    tablesDetected: 0,
    imagesEmbedded: 0,
  };
  return {
    stats,
    async write(doc, opts) {
      const slides: PptxSlideSpec[] = [];

      for (const page of doc.pages) {
        const blocks: PptxBlock[] = [];
        const pageWIn = ptToIn(page.pageSize.widthPt);
        const pageHIn = ptToIn(page.pageSize.heightPt);
        const sx = pageWIn > 0 ? SLIDE_W_IN / pageWIn : 1;
        const sy = pageHIn > 0 ? SLIDE_H_IN / pageHIn : 1;

        if (opts.qualityTier === 'text-only') {
          // Single text box per slide with all text concatenated.
          const concatenated = (page.text?.paragraphs ?? []).map((p) => p.text).join('\n\n');
          blocks.push({
            kind: 'text',
            spec: {
              text: concatenated,
              x: 0.5,
              y: 0.5,
              w: SLIDE_W_IN - 1,
              h: SLIDE_H_IN - 1,
              fontSize: 12,
              bold: false,
              italic: false,
              align: 'left',
            },
          });
          stats.paragraphsExtracted += page.text?.paragraphs.length ?? 0;
        } else {
          // layout-preserving
          if (page.text) {
            for (const p of page.text.paragraphs) {
              const block = buildTextBlock(p, page.pageSize.heightPt, sx, sy);
              if (block) {
                blocks.push(block);
                stats.paragraphsExtracted += 1;
              }
            }
          }
          for (const img of page.images) {
            const block = buildImageBlock(img, page.pageSize.heightPt, sx, sy);
            if (block) {
              blocks.push(block);
              stats.imagesEmbedded += 1;
            }
          }
          for (const t of page.tables) {
            const block = buildTableBlock(t, page.pageSize.heightPt, sx, sy);
            if (block) {
              blocks.push(block);
              stats.tablesDetected += 1;
            }
          }
        }

        let footer: string | null = null;
        if (opts.includeAnnotations) {
          const annLines = page.annotations
            .filter((a) => a.text !== null)
            .map((a) => `[${a.kind}] ${a.text}`);
          if (annLines.length > 0) footer = annLines.join('\n');
        }
        slides.push({ blocks, footer });
      }

      return library.compose({ slides });
    },
  };
}
