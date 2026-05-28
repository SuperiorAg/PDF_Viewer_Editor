// DOCX writer (Phase 6, export-engine.md §4)
//
// Library: `docx` (MIT, ^9.7.1) — pure-JS DOCX authoring. Diego installs the
// dep in Wave 25.
//
// SCOPE (P6-L-2 / Q-A):
//   - Paragraph, TextRun, HeadingLevel (H1-H3), Table/Row/Cell, ImageRun
//   - Bold / italic via font-name regex match
//   - Alignment (left/center/right)
//   - Annotations: text annotations append as `[Note: <text>]` inline runs
//
// DEFERRED to Phase 6.1:
//   - Footnotes, comments, revision tracking, custom styles
//   - Hyperlinks, bookmark anchors
//
// DISCIPLINE (conventions §17.5 — NO `as any`):
//   - Library is injected via `DocxLibrary` so production binds to the real
//     `docx` package while tests inject a typed in-memory recorder. This
//     avoids the bare `import 'docx'` that would fail typecheck until Diego
//     installs the dep in Wave 25.
//   - Required-on-interface (§17.4) — no optional dep with a stub fallback.

import type {
  ExtractedDocument,
  ExtractedPage,
  ExtractedParagraph,
  TableRegion,
} from '../types.js';

// ---- Library-shape interfaces (mirror docx@9.x API) ------------------------
//
// We type only the surface this writer uses. Production wires `docx` directly;
// tests wire a typed recorder. The interfaces are deliberately small — they
// model the data, not docx's classes.

export type DocxHeadingLevel = 'Heading1' | 'Heading2' | 'Heading3' | null;
export type DocxAlignment = 'left' | 'center' | 'right';

export interface DocxParagraphSpec {
  text: string;
  bold: boolean;
  italic: boolean;
  /** Half-points per docx convention (12pt = 24). */
  sizeHalfPt: number | null;
  alignment: DocxAlignment;
  heading: DocxHeadingLevel;
}

export interface DocxTableCellSpec {
  text: string;
}

export interface DocxTableSpec {
  rows: DocxTableCellSpec[][];
  columns: number;
}

export interface DocxImageSpec {
  bytes: Uint8Array;
  /** docx ImageRun.transformation accepts pixels at 96 DPI. */
  widthPx: number;
  heightPx: number;
}

export type DocxChild =
  | { kind: 'paragraph'; spec: DocxParagraphSpec }
  | { kind: 'table'; spec: DocxTableSpec }
  | { kind: 'image'; spec: DocxImageSpec };

export interface DocxLibrary {
  /**
   * Compose the typed children into a DOCX byte buffer. Production wires
   * `docx`'s `Document` + `Packer.toBuffer` here; tests wire a JSON-shape
   * recorder that just round-trips for assertion.
   */
  compose(opts: { pageSize: 'letter' | 'a4' | 'auto'; children: DocxChild[] }): Promise<Uint8Array>;
}

// ---- Writer surface ---------------------------------------------------------

export interface DocxWriteOptions {
  pageSize: 'letter' | 'a4' | 'auto';
  includeAnnotations: boolean;
  qualityTier: 'text-only' | 'layout-preserving';
}

export interface DocxWriter {
  write(doc: ExtractedDocument, opts: DocxWriteOptions): Promise<Uint8Array>;
}

export interface DocxWriterStats {
  paragraphsExtracted: number;
  tablesDetected: number;
  imagesEmbedded: number;
}

// ---- Builder helpers --------------------------------------------------------

function paragraphHeading(p: ExtractedParagraph): DocxHeadingLevel {
  switch (p.heading) {
    case 'H1':
      return 'Heading1';
    case 'H2':
      return 'Heading2';
    case 'H3':
      return 'Heading3';
    default:
      return null;
  }
}

function buildParagraph(p: ExtractedParagraph): DocxChild {
  return {
    kind: 'paragraph',
    spec: {
      text: p.text,
      bold: p.fontHints.bold === true,
      italic: p.fontHints.italic === true,
      sizeHalfPt:
        typeof p.fontHints.sizePt === 'number' ? Math.round(p.fontHints.sizePt * 2) : null,
      alignment: p.alignment,
      heading: paragraphHeading(p),
    },
  };
}

function buildTable(t: TableRegion): DocxChild {
  return {
    kind: 'table',
    spec: {
      columns: t.columns,
      rows: t.cells.map((row) => row.map((c) => ({ text: c.text }))),
    },
  };
}

function buildAnnotationParagraph(text: string): DocxChild {
  return {
    kind: 'paragraph',
    spec: {
      text: `[Note: ${text}]`,
      bold: false,
      italic: true,
      sizeHalfPt: null,
      alignment: 'left',
      heading: null,
    },
  };
}

// Merge paragraphs + tables + images in reading order (top-to-bottom by rect.y).
interface OrderedItem {
  kind: 'paragraph' | 'table' | 'image';
  y: number;
  index: number;
  payload: ExtractedParagraph | TableRegion | ExtractedPage['images'][number];
}

function mergeReadingOrder(page: ExtractedPage): OrderedItem[] {
  const items: OrderedItem[] = [];
  if (page.text) {
    page.text.paragraphs.forEach((p, i) => {
      items.push({
        kind: 'paragraph',
        y: (p.rect?.y ?? 0) + (p.rect?.h ?? 0),
        index: i,
        payload: p,
      });
    });
  }
  page.tables.forEach((t, i) => {
    items.push({
      kind: 'table',
      y: (t.rect?.y ?? 0) + (t.rect?.h ?? 0),
      index: i,
      payload: t,
    });
  });
  page.images.forEach((img, i) => {
    items.push({
      kind: 'image',
      y: (img.rect?.y ?? 0) + (img.rect?.h ?? 0),
      index: i,
      payload: img,
    });
  });
  // Top first (higher PDF Y first).
  items.sort((a, b) => b.y - a.y);
  return items;
}

export function createDocxWriter(library: DocxLibrary): DocxWriter & {
  stats: DocxWriterStats;
} {
  const stats: DocxWriterStats = {
    paragraphsExtracted: 0,
    tablesDetected: 0,
    imagesEmbedded: 0,
  };
  return {
    stats,
    async write(doc, opts) {
      const children: DocxChild[] = [];

      for (const page of doc.pages) {
        if (opts.qualityTier === 'text-only') {
          // Fast tier: flat paragraphs, no tables, no images.
          if (page.text) {
            for (const p of page.text.paragraphs) {
              children.push(buildParagraph(p));
              stats.paragraphsExtracted += 1;
            }
          }
        } else {
          const ordered = mergeReadingOrder(page);
          for (const item of ordered) {
            if (item.kind === 'paragraph') {
              children.push(buildParagraph(item.payload as ExtractedParagraph));
              stats.paragraphsExtracted += 1;
            } else if (item.kind === 'table') {
              children.push(buildTable(item.payload as TableRegion));
              stats.tablesDetected += 1;
            } else {
              const img = item.payload as ExtractedPage['images'][number];
              children.push({
                kind: 'image',
                spec: {
                  bytes: img.bytes,
                  widthPx: img.widthPx,
                  heightPx: img.heightPx,
                },
              });
              stats.imagesEmbedded += 1;
            }
          }
        }
        // Annotations as trailing notes per page (if includeAnnotations).
        if (opts.includeAnnotations) {
          for (const ann of page.annotations) {
            if (ann.text !== null) children.push(buildAnnotationParagraph(ann.text));
          }
        }
      }

      return library.compose({
        pageSize: opts.pageSize,
        children,
      });
    },
  };
}
