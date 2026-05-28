// Phase 3 data-source parsers for the mail-merge wizard.
//
// Contract: `docs/form-engine.md §8` (Riley, Wave 11).
//
// Two parsers behind one normalized result shape:
//   - CSV via a built-in RFC 4180 tokenizer (no external dep required so
//     this module stays usable in tests + golden-bytes runs while Diego's
//     wave brings `csv-parse` into package.json).
//   - Excel via `exceljs` (already on the Wave 12 wishlist; dynamic-import so
//     the module loads on machines where the dep hasn't been installed yet
//     — the wizard surfaces a clean error rather than the test suite crashing
//     at import time).
//
// Pure functions. No FS, no DB, no logging.

import type { Result } from '../../shared/result.js';
import { fail, ok } from '../../shared/result.js';

export type ParseDataSourceError = 'invalid_data_source';

export interface ParseDataSourceOk {
  headers: string[];
  rows: Array<Record<string, string>>;
  warnings: string[];
}

export type ParseDataSourceResult = Result<ParseDataSourceOk, ParseDataSourceError>;

// ============================================================================
// CSV — built-in RFC 4180 parser
// ============================================================================

const CSV_BOM = '﻿';

export interface ParseCsvOptions {
  delimiter?: ',' | ';' | '\t';
  /** When true, strip a UTF-8 BOM from the input. Default true. */
  stripBom?: boolean;
}

export function parseCsv(bytes: Uint8Array, options: ParseCsvOptions = {}): ParseDataSourceResult {
  const delimiter = options.delimiter ?? ',';
  const stripBom = options.stripBom ?? true;

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch (e) {
    return fail<ParseDataSourceError>(
      'invalid_data_source',
      `UTF-8 decode threw: ${(e as Error).message}`,
    );
  }

  if (stripBom && text.startsWith(CSV_BOM)) text = text.slice(1);

  const records = tokenizeCsv(text, delimiter);
  const warnings: string[] = [];

  if (records.length === 0) {
    return fail<ParseDataSourceError>('invalid_data_source', 'CSV has no rows');
  }
  const headerRow = records[0];
  if (!headerRow || headerRow.length === 0) {
    return fail<ParseDataSourceError>('invalid_data_source', 'CSV missing header row');
  }
  const headers = headerRow.map((h) => h.trim());
  // Dedupe-with-suffix in the unlikely event of repeated headers.
  const seen = new Set<string>();
  for (let i = 0; i < headers.length; i += 1) {
    const h = headers[i] ?? '';
    if (seen.has(h)) {
      let n = 2;
      while (seen.has(`${h}_${n}`)) n += 1;
      headers[i] = `${h}_${n}`;
      warnings.push(`Renamed duplicate header '${h}' -> '${headers[i]}'`);
    }
    seen.add(headers[i] ?? '');
  }

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < records.length; i += 1) {
    const cells = records[i];
    if (!cells) continue;
    // Ragged rows: fall through (missing trailing cells become empty strings).
    if (cells.length === 1 && cells[0] === '') continue; // skip totally blank rows
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j += 1) {
      const k = headers[j] ?? '';
      row[k] = cells[j] ?? '';
    }
    rows.push(row);
  }
  return ok({ headers, rows, warnings });
}

/**
 * RFC 4180 tokenizer. Handles:
 *   - quoted fields ("foo,bar" stays one cell)
 *   - escaped quotes inside quoted fields (""")
 *   - CRLF and LF line endings (and lone CR for ancient mac files)
 *   - trailing newline (no spurious empty record)
 *   - any of `,` `;` `\t` as delimiter
 */
function tokenizeCsv(text: string, delim: string): string[][] {
  const records: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    // Not inside quotes
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delim) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\r') {
      // Normalize CRLF + lone CR: end the row, swallow optional \n.
      row.push(cell);
      cell = '';
      records.push(row);
      row = [];
      if (text[i + 1] === '\n') i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      cell = '';
      records.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  // EOF — flush the in-flight cell/row unless the input ended with a newline
  // (in which case row=[] and cell='').
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    records.push(row);
  }
  return records;
}

// ============================================================================
// Excel — dynamic-import exceljs (Phase 3 wishlist dep)
// ============================================================================

export async function parseExcel(bytes: Uint8Array): Promise<ParseDataSourceResult> {
  type ExcelJsModule = {
    Workbook: new () => {
      xlsx: { load: (b: Uint8Array | Buffer | ArrayBuffer) => Promise<void> };
      worksheets: Array<{
        getRow: (n: number) => { values: unknown[] };
        eachRow: (
          opts: { includeEmpty?: boolean },
          cb: (row: { getCell: (n: number) => { text: string } }, rowNumber: number) => void,
        ) => void;
      }>;
    };
  };
  let ExcelJS: ExcelJsModule;
  try {
    // The package may not be installed yet (David Wave 12 flagged as a
    // missing-dep blocker in the build report); fail with an actionable
    // error so the wizard step 2 surfaces the right toast.
    // Dynamic import via an indirect specifier so the TS resolver doesn't
    // require the package to be installed at typecheck time. The runtime
    // failure path is the actionable error below.
    const specifier = 'exceljs';
    const mod = (await import(/* @vite-ignore */ specifier)) as unknown as
      | ExcelJsModule
      | { default: ExcelJsModule };
    ExcelJS = 'default' in mod ? mod.default : mod;
  } catch (e) {
    return fail<ParseDataSourceError>(
      'invalid_data_source',
      `Excel parser unavailable: ${(e as Error).message} — install 'exceljs' to enable XLSX mail-merge`,
    );
  }

  const warnings: string[] = [];
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch (e) {
    return fail<ParseDataSourceError>(
      'invalid_data_source',
      `xlsx parse threw: ${(e as Error).message}`,
    );
  }
  if (workbook.worksheets.length === 0) {
    return fail<ParseDataSourceError>('invalid_data_source', 'workbook has no sheets');
  }
  if (workbook.worksheets.length > 1) {
    warnings.push(
      `Workbook has ${workbook.worksheets.length} sheets; using sheet 1 only (Phase 3 limitation)`,
    );
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return fail<ParseDataSourceError>('invalid_data_source', 'sheet 1 missing');
  }
  const headerRow = sheet.getRow(1).values as unknown[];
  // exceljs row-values starts at index 1 (index 0 is empty); slice + stringify.
  const headers = headerRow.slice(1).map((v) => String(v ?? '').trim());
  const rows: Array<Record<string, string>> = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      const cell = row.getCell(i + 1);
      obj[headers[i] ?? ''] = String(cell.text ?? '');
    }
    rows.push(obj);
  });
  return ok({ headers, rows, warnings });
}

// ============================================================================
// Convenience wrapper used by the mail-merge runner / preview channel
// ============================================================================

export async function parseDataSource(
  src:
    | { kind: 'csv'; bytes: Uint8Array; delimiter?: ',' | ';' | '\t' }
    | { kind: 'xlsx'; bytes: Uint8Array },
): Promise<ParseDataSourceResult> {
  if (src.kind === 'csv') {
    const opts: ParseCsvOptions = {};
    if (src.delimiter !== undefined) opts.delimiter = src.delimiter;
    return parseCsv(src.bytes, opts);
  }
  if (src.kind === 'xlsx') return parseExcel(src.bytes);
  return fail<ParseDataSourceError>('invalid_data_source', 'unknown data source kind');
}
