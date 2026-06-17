// Tests for the pdf:insertPagesFromFile IPC handler.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import {
  handlePdfInsertPagesFromFile,
  type PdfInsertPagesFromFileDeps,
} from './pdf-insert-pages-from-file.js';
import { expectErr, expectOk } from './test-support.js';

async function makePdf(count: number, prefix = 100): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) doc.addPage([prefix + i, 200]);
  return doc.save();
}

function makeDeps(overrides: Partial<PdfInsertPagesFromFileDeps> = {}): PdfInsertPagesFromFileDeps {
  return {
    getBytes: () => null,
    setBytes: vi.fn(),
    readFile: vi.fn().mockResolvedValue(new Uint8Array(0)),
    sanitizePath: (raw) => (typeof raw === 'string' ? raw : null),
    ...overrides,
  };
}

describe('handlePdfInsertPagesFromFile', () => {
  it('rejects malformed payload', async () => {
    const res = await handlePdfInsertPagesFromFile({}, makeDeps());
    expectErr(res, 'invalid_payload');
  });

  it('rejects unknown handle', async () => {
    const res = await handlePdfInsertPagesFromFile(
      {
        handle: 1,
        sourcePath: 'C:/src.pdf',
        sourcePages: 'all',
        insertAfterPageIndex: 0,
      },
      makeDeps({ getBytes: () => null }),
    );
    expectErr(res, 'handle_not_found');
  });

  it('rejects path that fails sanitization', async () => {
    const target = await makePdf(2);
    const res = await handlePdfInsertPagesFromFile(
      {
        handle: 1,
        sourcePath: 'badpath',
        sourcePages: 'all',
        insertAfterPageIndex: 0,
      },
      makeDeps({
        getBytes: () => target,
        sanitizePath: () => null,
      }),
    );
    expectErr(res, 'source_invalid_pdf');
  });

  it('successfully inserts and updates documentStore bytes', async () => {
    const target = await makePdf(2);
    const source = await makePdf(2, 500);
    const setBytes = vi.fn();
    const res = await handlePdfInsertPagesFromFile(
      {
        handle: 7,
        sourcePath: 'C:/src.pdf',
        sourcePages: 'all',
        insertAfterPageIndex: 0,
      },
      makeDeps({
        getBytes: () => target,
        readFile: async () => source,
        setBytes,
      }),
    );
    const v = expectOk(res);
    expect(v.pagesInserted).toBe(2);
    expect(v.newPageCount).toBe(4);
    expect(setBytes).toHaveBeenCalledWith(7, expect.any(Uint8Array));
  });

  it('honors insertAfterPageIndex=-1 (insert before page 0)', async () => {
    const target = await makePdf(1);
    const source = await makePdf(1, 999);
    const res = await handlePdfInsertPagesFromFile(
      {
        handle: 1,
        sourcePath: 'C:/src.pdf',
        sourcePages: 'all',
        insertAfterPageIndex: -1,
      },
      makeDeps({
        getBytes: () => target,
        readFile: async () => source,
      }),
    );
    expectOk(res);
  });

  it('rejects out-of-range insertAfterPageIndex', async () => {
    const target = await makePdf(1);
    const source = await makePdf(1);
    const res = await handlePdfInsertPagesFromFile(
      {
        handle: 1,
        sourcePath: 'C:/src.pdf',
        sourcePages: 'all',
        insertAfterPageIndex: 99,
      },
      makeDeps({
        getBytes: () => target,
        readFile: async () => source,
      }),
    );
    expectErr(res, 'invalid_payload');
  });

  it('maps engine source_page_out_of_range', async () => {
    const target = await makePdf(2);
    const source = await makePdf(1);
    const res = await handlePdfInsertPagesFromFile(
      {
        handle: 1,
        sourcePath: 'C:/src.pdf',
        sourcePages: { start: 0, end: 5 },
        insertAfterPageIndex: 0,
      },
      makeDeps({
        getBytes: () => target,
        readFile: async () => source,
      }),
    );
    expectErr(res, 'source_page_out_of_range');
  });
});
