// XLSX writer (Phase 6, export-engine.md §5)
//
// Library: `exceljs` (MIT, ^4.4.0) — already in deps from Phase 3 mail merge.
// Phase 6 uses the WRITE side of the same library.
//
// SCOPE (P6-L-3):
//   - One worksheet per detected TableRegion named `Page<N>_Table<M>`
//     (truncated to Excel's 31-char sheet-name limit).
//   - Cell text from cell content; numeric coercion via Number(text) after
//     stripping common thousands separators.
//   - Simple alignment: left for text, right for numeric.
//   - layout-preserving tier adds a `Text_PageN` sheet per page with non-table
//     paragraphs; text-only tier emits ONE `PageN` sheet per page with all text.
//
// DEFAULT INCLUDE-ANNOTATIONS = false (P6-L-8): cells are data, not visual.
// If the modal user opts in, an `Annotations` sheet is appended with
// [Page, Kind, Text] columns.
//
// DISCIPLINE (conventions §17.5):
//   - Library injection mirrors the docx writer pattern so tests don't need
//     a full exceljs Workbook. Production wires `exceljs` directly.

import type { ExtractedDocument, ExtractedPage, TableRegion } from '../types.js';

// ---- Library-shape -----------------------------------------------------------

export interface XlsxSheetSpec {
  name: string;
  rows: Array<Array<string | number>>;
  /** Per-column alignment (length = columns). Optional. */
  columnAlignments?: Array<'left' | 'right'>;
}

export interface XlsxWorkbookSpec {
  sheets: XlsxSheetSpec[];
}

export interface XlsxLibrary {
  /** Compose the typed workbook spec into an XLSX byte buffer. */
  compose(spec: XlsxWorkbookSpec): Promise<Uint8Array>;
}

// ---- Writer surface ---------------------------------------------------------

export interface XlsxWriteOptions {
  includeAnnotations: boolean;
  qualityTier: 'text-only' | 'layout-preserving';
}

export interface XlsxWriter {
  write(doc: ExtractedDocument, opts: XlsxWriteOptions): Promise<Uint8Array>;
}

export interface XlsxWriterStats {
  paragraphsExtracted: number;
  tablesDetected: number;
  imagesEmbedded: number;
}

// ---- Helpers ----------------------------------------------------------------

function safeSheetName(name: string): string {
  // Excel sheet name limit is 31 chars; also forbids [ ] : * ? / \
  const cleaned = name.replace(/[[\]:*?/\\]/g, '_');
  return cleaned.slice(0, 31);
}

function coerceCellValue(text: string): string | number {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  const stripped = trimmed.replace(/,/g, '');
  // Match a strict numeric (positive/negative integer or decimal); tolerate
  // thousands separators but not currency symbols.
  if (/^-?\d+(\.\d+)?$/.test(stripped)) {
    const n = Number(stripped);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return text;
}

function isInsideAnyTable(
  rect: { x: number; y: number; w: number; h: number } | null,
  tables: TableRegion[],
): boolean {
  if (rect === null) return false;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  for (const t of tables) {
    if (t.rect === null) continue;
    if (
      cx >= t.rect.x &&
      cx <= t.rect.x + t.rect.w &&
      cy >= t.rect.y &&
      cy <= t.rect.y + t.rect.h
    ) {
      return true;
    }
  }
  return false;
}

function tableToSheet(table: TableRegion, sheetName: string): XlsxSheetSpec {
  const rows: Array<Array<string | number>> = table.cells.map((row) =>
    row.map((cell) => coerceCellValue(cell.text)),
  );
  // Per-column alignment: right if every non-empty value in the column is
  // numeric; else left.
  const columnAlignments: Array<'left' | 'right'> = [];
  for (let c = 0; c < table.columns; c++) {
    let allNumeric = true;
    let any = false;
    for (const row of rows) {
      const v = row[c];
      if (v === '' || v === undefined) continue;
      any = true;
      if (typeof v !== 'number') {
        allNumeric = false;
        break;
      }
    }
    columnAlignments.push(any && allNumeric ? 'right' : 'left');
  }
  return { name: sheetName, rows, columnAlignments };
}

function textPageSheet(
  page: ExtractedPage,
  pageNum: number,
  qualityTier: 'text-only' | 'layout-preserving',
): XlsxSheetSpec | null {
  if (!page.text) return null;
  if (qualityTier === 'text-only') {
    return {
      name: safeSheetName(`Page${pageNum}`),
      rows: page.text.paragraphs.map((p) => [p.text]),
    };
  }
  // layout-preserving — non-table text only
  const rows: Array<Array<string | number>> = [];
  for (const p of page.text.paragraphs) {
    if (isInsideAnyTable(p.rect, page.tables)) continue;
    rows.push([p.text]);
  }
  if (rows.length === 0) return null;
  return {
    name: safeSheetName(`Text_Page${pageNum}`),
    rows,
  };
}

export function createXlsxWriter(library: XlsxLibrary): XlsxWriter & {
  stats: XlsxWriterStats;
} {
  const stats: XlsxWriterStats = {
    paragraphsExtracted: 0,
    tablesDetected: 0,
    imagesEmbedded: 0,
  };
  return {
    stats,
    async write(doc, opts) {
      const sheets: XlsxSheetSpec[] = [];

      let pageNum = 0;
      for (const page of doc.pages) {
        pageNum += 1;

        // Tables ALWAYS emitted on layout-preserving; on text-only, skipped.
        if (opts.qualityTier === 'layout-preserving') {
          page.tables.forEach((table, idx) => {
            sheets.push(tableToSheet(table, safeSheetName(`Page${pageNum}_Table${idx + 1}`)));
            stats.tablesDetected += 1;
          });
        }

        const textSheet = textPageSheet(page, pageNum, opts.qualityTier);
        if (textSheet) {
          sheets.push(textSheet);
          stats.paragraphsExtracted += textSheet.rows.length;
        }
      }

      // Annotations sheet (opt-in for xlsx).
      if (opts.includeAnnotations) {
        const rows: Array<Array<string | number>> = [];
        rows.push(['Page', 'Kind', 'Text']);
        let pn = 0;
        for (const page of doc.pages) {
          pn += 1;
          for (const ann of page.annotations) {
            if (ann.text === null) continue;
            rows.push([pn, ann.kind, ann.text]);
          }
        }
        if (rows.length > 1) {
          sheets.push({ name: safeSheetName('Annotations'), rows });
        }
      }

      if (sheets.length === 0) {
        // Always emit at least ONE sheet so exceljs doesn't reject an empty
        // workbook. The placeholder records the export ran without content.
        sheets.push({ name: 'Empty', rows: [['(no content extracted)']] });
      }

      return library.compose({ sheets });
    },
  };
}
