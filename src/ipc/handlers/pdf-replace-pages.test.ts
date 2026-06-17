// Tests for the pdf:replacePages IPC handler.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import { handlePdfReplacePages, type PdfReplacePagesDeps } from './pdf-replace-pages.js';
import { expectErr, expectOk } from './test-support.js';

async function makePdf(count: number, prefix = 100): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) doc.addPage([prefix + i, 200]);
  return doc.save();
}

function makeDeps(overrides: Partial<PdfReplacePagesDeps> = {}): PdfReplacePagesDeps {
  return {
    getBytes: () => null,
    setBytes: vi.fn(),
    readFile: vi.fn().mockResolvedValue(new Uint8Array(0)),
    sanitizePath: (raw) => (typeof raw === 'string' ? raw : null),
    ...overrides,
  };
}

describe('handlePdfReplacePages', () => {
  it('rejects malformed payload', async () => {
    const res = await handlePdfReplacePages({}, makeDeps());
    expectErr(res, 'invalid_payload');
  });

  it('rejects unknown handle', async () => {
    const res = await handlePdfReplacePages(
      {
        handle: 1,
        targetPages: { start: 0, end: 0 },
        sourcePath: 'C:/src.pdf',
        sourcePages: { start: 0, end: 0 },
      },
      makeDeps({ getBytes: () => null }),
    );
    expectErr(res, 'handle_not_found');
  });

  it('rejects path that fails sanitization', async () => {
    const targetBytes = await makePdf(2);
    const res = await handlePdfReplacePages(
      {
        handle: 1,
        targetPages: { start: 0, end: 0 },
        sourcePath: 'badpath',
        sourcePages: { start: 0, end: 0 },
      },
      makeDeps({
        getBytes: () => targetBytes,
        sanitizePath: () => null,
      }),
    );
    expectErr(res, 'source_invalid_pdf');
  });

  it('surfaces source_invalid_pdf when readFile throws', async () => {
    const targetBytes = await makePdf(2);
    const res = await handlePdfReplacePages(
      {
        handle: 1,
        targetPages: { start: 0, end: 0 },
        sourcePath: 'C:/src.pdf',
        sourcePages: { start: 0, end: 0 },
      },
      makeDeps({
        getBytes: () => targetBytes,
        readFile: vi.fn().mockRejectedValue(new Error('not found')),
      }),
    );
    expectErr(res, 'source_invalid_pdf');
  });

  it('successfully replaces a range and refreshes documentStore bytes', async () => {
    const targetBytes = await makePdf(3);
    const sourceBytes = await makePdf(2, 500);
    const setBytes = vi.fn();
    const res = await handlePdfReplacePages(
      {
        handle: 7,
        targetPages: { start: 1, end: 1 },
        sourcePath: 'C:/src.pdf',
        sourcePages: { start: 0, end: 1 },
      },
      makeDeps({
        getBytes: () => targetBytes,
        readFile: async () => sourceBytes,
        setBytes,
      }),
    );
    const v = expectOk(res);
    expect(v.pagesReplaced).toBe(1);
    expect(setBytes).toHaveBeenCalledWith(7, expect.any(Uint8Array));
  });

  it('maps engine target_page_out_of_range', async () => {
    const targetBytes = await makePdf(2);
    const sourceBytes = await makePdf(2);
    const res = await handlePdfReplacePages(
      {
        handle: 1,
        targetPages: { start: 0, end: 5 },
        sourcePath: 'C:/src.pdf',
        sourcePages: { start: 0, end: 0 },
      },
      makeDeps({
        getBytes: () => targetBytes,
        readFile: async () => sourceBytes,
      }),
    );
    expectErr(res, 'page_out_of_range');
  });

  it('maps engine source_page_out_of_range', async () => {
    const targetBytes = await makePdf(2);
    const sourceBytes = await makePdf(1);
    const res = await handlePdfReplacePages(
      {
        handle: 1,
        targetPages: { start: 0, end: 0 },
        sourcePath: 'C:/src.pdf',
        sourcePages: { start: 0, end: 5 },
      },
      makeDeps({
        getBytes: () => targetBytes,
        readFile: async () => sourceBytes,
      }),
    );
    expectErr(res, 'source_page_out_of_range');
  });
});
