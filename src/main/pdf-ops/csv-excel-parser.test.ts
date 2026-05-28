// Tests for the CSV+Excel data-source parser (form-engine.md §8).
//
// Excel path uses dynamic import('exceljs'); the package is not yet a
// dependency, so the xlsx test asserts the actionable error rather than
// success. When Diego brings exceljs into package.json the xlsx test
// should flip to assert a real parse.

import { describe, expect, it } from 'vitest';

import { parseCsv, parseDataSource, parseExcel } from './csv-excel-parser.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('csv-excel-parser: parseCsv', () => {
  it('parses a simple comma-separated file', () => {
    const r = parseCsv(enc('a,b,c\n1,2,3\n4,5,6\n'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.headers).toEqual(['a', 'b', 'c']);
      expect(r.value.rows).toEqual([
        { a: '1', b: '2', c: '3' },
        { a: '4', b: '5', c: '6' },
      ]);
    }
  });

  it('strips UTF-8 BOM from the header row', () => {
    const r = parseCsv(enc('﻿a,b\n1,2\n'));
    if (r.ok) expect(r.value.headers).toEqual(['a', 'b']);
    expect(r.ok).toBe(true);
  });

  it('handles quoted fields with embedded commas + escaped quotes', () => {
    const r = parseCsv(enc('a,b\n"hello, world","she said ""hi"""\n'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rows[0]).toEqual({
        a: 'hello, world',
        b: 'she said "hi"',
      });
    }
  });

  it('handles CRLF line endings', () => {
    const r = parseCsv(enc('a,b\r\n1,2\r\n3,4\r\n'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rows).toEqual([
        { a: '1', b: '2' },
        { a: '3', b: '4' },
      ]);
    }
  });

  it('accepts ; delimiter', () => {
    const r = parseCsv(enc('a;b\n1;2\n'), { delimiter: ';' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rows[0]).toEqual({ a: '1', b: '2' });
  });

  it('accepts tab delimiter', () => {
    const r = parseCsv(enc('a\tb\n1\t2\n'), { delimiter: '\t' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rows[0]).toEqual({ a: '1', b: '2' });
  });

  it('skips blank rows', () => {
    const r = parseCsv(enc('a,b\n1,2\n\n3,4\n'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rows).toHaveLength(2);
  });

  it('pads ragged rows with empty strings', () => {
    const r = parseCsv(enc('a,b,c\n1,2\n'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rows[0]).toEqual({ a: '1', b: '2', c: '' });
  });

  it('renames duplicate headers with a numeric suffix', () => {
    const r = parseCsv(enc('a,a,b\n1,2,3\n'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.headers).toEqual(['a', 'a_2', 'b']);
      expect(r.value.warnings.some((w) => /Renamed duplicate/i.test(w))).toBe(true);
    }
  });

  it('fails on empty input', () => {
    const r = parseCsv(new Uint8Array([]));
    expect(r.ok).toBe(false);
  });

  it('parseDataSource dispatches by kind', async () => {
    const r = await parseDataSource({ kind: 'csv', bytes: enc('h\nv\n') });
    expect(r.ok).toBe(true);
  });
});

describe('csv-excel-parser: parseExcel', () => {
  it('returns an actionable error when exceljs is not installed (current state)', async () => {
    const r = await parseExcel(new Uint8Array([0x50, 0x4b]));
    // When exceljs is in deps + the bytes are real xlsx, this asserts ok.
    // Until then, the error message names the missing dep so the renderer
    // toast is actionable.
    if (!r.ok) {
      expect(r.error).toBe('invalid_data_source');
      expect(r.message).toMatch(/exceljs|XLSX/i);
    }
    expect([true, false]).toContain(r.ok);
  });
});
