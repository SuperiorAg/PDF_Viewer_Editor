// Internal export-engine types — the intermediate shape that all writers
// consume. Single source of truth for `ExtractedDocument`, `ExtractedPage`,
// `LayoutRect`, `TableRegion`, `ExtractedImage`, etc.
//
// All "may be unknown" geometry uses `LayoutRect = {...} | null` (NEVER the
// {0,0,0,0} sentinel — see conventions §17.4.2 + the 2026-05-26 lesson).
//
// These types are MAIN-ONLY. They never cross the IPC bridge — the boundary
// DTOs live in contracts.ts (ExportJobSummary, ExportJobRowDto, etc.).

import type { ExportFormat, ExportQualityTier } from '../../ipc/contracts.js';

/**
 * Anti-sentinel discipline: `LayoutRect` is nullable EVERYWHERE it appears.
 * Consumers pattern-match on `null` to skip / render a placeholder. NEVER
 * read `{x:0,y:0,w:0,h:0}` as "unknown" — that's the bug class the 2026-05-26
 * lesson banned.
 */
export type LayoutRect = { x: number; y: number; w: number; h: number } | null;

export interface PageSize {
  widthPt: number;
  heightPt: number;
}

export interface LayoutSettings {
  /** Y-coordinate epsilon for line clustering. Default 2. */
  lineEpsilonPt: number;
  /** Line-gap / median-line-height ratio for paragraph break. Default 1.5. */
  paragraphBreakRatio: number;
  /** Font-size / median-body-font ratio for heading classification. Default 1.3. */
  headingRatio: number;
  /** Minimum X-gap for column boundary detection. Default 40. */
  columnGapPt: number;
}

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  lineEpsilonPt: 2,
  paragraphBreakRatio: 1.5,
  headingRatio: 1.3,
  columnGapPt: 40,
};

export interface ExtractedParagraph {
  text: string;
  rect: LayoutRect;
  heading: 'H1' | 'H2' | 'H3' | null;
  alignment: 'left' | 'center' | 'right';
  fontHints: {
    bold?: boolean;
    italic?: boolean;
    sizePt?: number;
  };
}

export interface ExtractedText {
  paragraphs: ExtractedParagraph[];
  columnsDetected: number;
}

export interface TableCell {
  text: string;
  rect: LayoutRect;
}

export interface TableRegion {
  rect: LayoutRect;
  rows: number;
  columns: number;
  /** cells[rowIndex][colIndex] */
  cells: TableCell[][];
}

export interface ExtractedImage {
  rect: LayoutRect;
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
}

export type AnnotationKind = 'sticky-note' | 'text-box' | 'highlight' | 'strikethrough' | 'shape';

export interface ExtractedAnnotation {
  kind: AnnotationKind;
  text: string | null;
  rect: LayoutRect;
}

export interface ExtractedPage {
  pageIndex: number;
  pageSize: PageSize;
  /** Null if the page has zero text fragments (image-only page). */
  text: ExtractedText | null;
  tables: TableRegion[];
  images: ExtractedImage[];
  annotations: ExtractedAnnotation[];
}

export interface ExtractedDocument {
  pageCount: number;
  pageRange: { start: number; end: number };
  pages: ExtractedPage[];
}

// ---- pdf.js-shaped inputs (typed minimally — full surface lives in pdfjs's
//      .d.ts and we don't want to import the full namespace into types.ts) --

export interface PdfTextItem {
  str: string;
  /** [a, b, c, d, e, f] transform matrix; e,f are translation; |a| ~= font scale */
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
  fontName: string;
}

export interface PdfTextContent {
  items: PdfTextItem[];
}

// ---- Engine job spec / progress shapes (main-only mirror of the IPC types).
//      We re-derive these so the engine doesn't depend on the IPC layer for
//      its core types. Conversion happens in the handler. -------------------

export type PerFormatSpec =
  | { format: 'docx'; pageSize: 'letter' | 'a4' | 'auto' }
  | { format: 'xlsx' }
  | { format: 'pptx' }
  | { format: 'png'; dpi: number }
  | { format: 'jpeg'; dpi: number; quality: number }
  | { format: 'tiff'; dpi: number; multiPage: boolean };

export interface ExportJobSpec {
  jobId: number;
  docHash: string;
  /** pdf-lib + pdfjs bytes (read-only on the source). */
  sourceBytes: Uint8Array;
  pageCount: number;
  format: ExportFormat;
  qualityTier: ExportQualityTier | 'n/a';
  pageRange: { start: number; end: number };
  includeAnnotations: boolean;
  outputPath: string;
  perFormat: PerFormatSpec;
}

export interface InternalProgressEvent {
  phase:
    | 'starting'
    | 'extracting-text'
    | 'detecting-tables'
    | 'extracting-images'
    | 'rasterizing'
    | 'writing-output'
    | 'completed'
    | 'cancelled'
    | 'failed';
  pageIndex?: number;
  totalPages?: number;
  bytesWritten?: number;
  totalBytesEstimate?: number | null;
  pagesCompleted?: number;
  error?: string;
}
