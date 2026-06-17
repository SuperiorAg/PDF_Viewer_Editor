// Tests for the pdf:cropPages IPC handler.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import { handlePdfCropPages, type PdfCropPagesDeps } from './pdf-crop-pages.js';
import { expectErr, expectOk } from './test-support.js';

async function makePdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) doc.addPage([200, 300]);
  return doc.save();
}

function makeDeps(overrides: Partial<PdfCropPagesDeps> = {}): PdfCropPagesDeps {
  return {
    getBytes: vi.fn().mockReturnValue(null),
    setBytes: vi.fn(),
    ...overrides,
  };
}

describe('handlePdfCropPages', () => {
  it('rejects malformed payload', async () => {
    const res = await handlePdfCropPages({}, makeDeps());
    expectErr(res, 'invalid_payload');
  });

  it('rejects unknown handle', async () => {
    const res = await handlePdfCropPages(
      {
        handle: 99,
        pages: 'all',
        cropBox: { top: 1, right: 1, bottom: 1, left: 1 },
      },
      makeDeps({ getBytes: () => null }),
    );
    expectErr(res, 'handle_not_found');
  });

  it('successfully crops all pages and refreshes documentStore bytes', async () => {
    const bytes = await makePdf(2);
    const setBytes = vi.fn();
    const res = await handlePdfCropPages(
      {
        handle: 5,
        pages: 'all',
        cropBox: { top: 10, right: 20, bottom: 30, left: 40 },
      },
      makeDeps({ getBytes: () => bytes, setBytes }),
    );
    const v = expectOk(res);
    expect(v.pagesAffected).toBe(2);
    expect(setBytes).toHaveBeenCalledTimes(1);
    expect(setBytes).toHaveBeenCalledWith(5, expect.any(Uint8Array));
  });

  it('maps engine page_out_of_range to handler page_out_of_range', async () => {
    const bytes = await makePdf(1);
    const res = await handlePdfCropPages(
      {
        handle: 1,
        pages: { start: 0, end: 5 },
        cropBox: { top: 1, right: 1, bottom: 1, left: 1 },
      },
      makeDeps({ getBytes: () => bytes }),
    );
    expectErr(res, 'page_out_of_range');
  });

  it("'current' page scope resolves via resolveCurrentPage", async () => {
    const bytes = await makePdf(3);
    const setBytes = vi.fn();
    const res = await handlePdfCropPages(
      {
        handle: 7,
        pages: 'current',
        cropBox: { top: 5, right: 5, bottom: 5, left: 5 },
      },
      makeDeps({
        getBytes: () => bytes,
        setBytes,
        resolveCurrentPage: () => 1,
      }),
    );
    const v2 = expectOk(res);
    expect(v2.pagesAffected).toBe(1);
  });

  it("'current' falls back to page 0 when resolver returns null", async () => {
    const bytes = await makePdf(1);
    const res = await handlePdfCropPages(
      {
        handle: 1,
        pages: 'current',
        cropBox: { top: 5, right: 5, bottom: 5, left: 5 },
      },
      makeDeps({
        getBytes: () => bytes,
        resolveCurrentPage: () => null,
      }),
    );
    expectOk(res);
  });
});
