// Unit tests for the Phase 7.5 Wave 3 B4 Header & Footer engine.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { applyHeaderFooter, substituteTokens } from './header-footer-engine.js';

async function makePdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([200, 300]);
  return doc.save();
}

describe('substituteTokens', () => {
  it('substitutes {page}, {totalPages}, and {date}', () => {
    const out = substituteTokens('Page {page} of {totalPages} ({date})', {
      pageNumber: 3,
      totalPages: 10,
      dateString: '2026-06-17',
    });
    expect(out).toBe('Page 3 of 10 (2026-06-17)');
  });

  it('leaves {totalPages} unsubstituted when null', () => {
    const out = substituteTokens('{page} / {totalPages}', {
      pageNumber: 1,
      totalPages: null,
      dateString: null,
    });
    expect(out).toBe('1 / {totalPages}');
  });
});

describe('applyHeaderFooter', () => {
  it('rejects when neither header nor footer provided', async () => {
    const bytes = await makePdf(1);
    const res = await applyHeaderFooter({
      pdfBytes: bytes,
      target: { kind: 'all' },
      marginTop: 24,
      marginBottom: 24,
      startPageNumber: 1,
      totalPageCountToken: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects out-of-range target', async () => {
    const bytes = await makePdf(2);
    const res = await applyHeaderFooter({
      pdfBytes: bytes,
      target: { kind: 'range', start: 0, end: 9 },
      header: { left: 'L', center: 'C', right: 'R', fontSize: 10 },
      marginTop: 24,
      marginBottom: 24,
      startPageNumber: 1,
      totalPageCountToken: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('page_out_of_range');
  });

  it('applies header with page-number and totalPages tokens', async () => {
    const bytes = await makePdf(3);
    const res = await applyHeaderFooter({
      pdfBytes: bytes,
      target: { kind: 'all' },
      header: { left: 'Doc', center: 'Page {page} of {totalPages}', right: '', fontSize: 10 },
      marginTop: 24,
      marginBottom: 24,
      startPageNumber: 1,
      totalPageCountToken: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.pagesAffected).toBe(3);
      const reload = await PDFDocument.load(res.value.bytes);
      expect(reload.getPageCount()).toBe(3);
    }
  });

  it('applies footer with date substitution', async () => {
    const bytes = await makePdf(2);
    const res = await applyHeaderFooter({
      pdfBytes: bytes,
      target: { kind: 'all' },
      footer: { left: '', center: 'Printed {date}', right: '', fontSize: 8 },
      marginTop: 24,
      marginBottom: 24,
      startPageNumber: 1,
      totalPageCountToken: false,
      dateString: '2026-06-17',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.pagesAffected).toBe(2);
  });

  it('numbers pages relative to the first target page', async () => {
    // 5 pages; apply only to pages 2..4 (0-indexed). The startPageNumber=1
    // means page index 2 gets "1", page index 3 gets "2", page index 4 gets
    // "3". The engine doesn't expose the rendered text directly so we just
    // assert the pagesAffected matches the range.
    const bytes = await makePdf(5);
    const res = await applyHeaderFooter({
      pdfBytes: bytes,
      target: { kind: 'range', start: 2, end: 4 },
      header: { left: '', center: '{page}', right: '', fontSize: 10 },
      marginTop: 24,
      marginBottom: 24,
      startPageNumber: 1,
      totalPageCountToken: false,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.pagesAffected).toBe(3);
  });
});
