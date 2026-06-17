// Tests for the pdf:extractPages IPC handler.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import { handlePdfExtractPages, type PdfExtractPagesDeps } from './pdf-extract-pages.js';
import { expectErr, expectOk } from './test-support.js';

async function makePdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) doc.addPage([100, 100]);
  return doc.save();
}

function makeDeps(overrides: Partial<PdfExtractPagesDeps> = {}): PdfExtractPagesDeps {
  return {
    getBytes: () => null,
    consumeDestinationToken: () => ({ token: 't', path: 'C:/out.pdf', displayName: 'out.pdf' }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    computeBufferHash: () => 'hash-stub',
    ...overrides,
  };
}

describe('handlePdfExtractPages', () => {
  it('rejects malformed payload', async () => {
    const res = await handlePdfExtractPages({}, makeDeps());
    expectErr(res, 'invalid_payload');
  });

  it('rejects unknown handle', async () => {
    const res = await handlePdfExtractPages(
      {
        handle: 1,
        pages: { start: 0, end: 0 },
        destinationToken: 'tok',
      },
      makeDeps({ getBytes: () => null }),
    );
    expectErr(res, 'handle_not_found');
  });

  it('rejects expired/unknown token with token_expired', async () => {
    const bytes = await makePdf(2);
    const res = await handlePdfExtractPages(
      {
        handle: 1,
        pages: { start: 0, end: 0 },
        destinationToken: 'tok',
      },
      makeDeps({
        getBytes: () => bytes,
        consumeDestinationToken: () => null,
      }),
    );
    expectErr(res, 'token_expired');
  });

  it('writes extracted bytes to the resolved path on success', async () => {
    const bytes = await makePdf(3);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const res = await handlePdfExtractPages(
      {
        handle: 1,
        pages: { start: 0, end: 1 },
        destinationToken: 'tok',
      },
      makeDeps({
        getBytes: () => bytes,
        writeFile,
        computeBufferHash: () => 'abc',
      }),
    );
    const v = expectOk(res);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0]![0]).toBe('C:/out.pdf');
    expect(v.outputFileHash).toBe('abc');
    expect(v.bytesWritten).toBeGreaterThan(0);
  });

  it('surfaces fs_write_failed when writeFile throws', async () => {
    const bytes = await makePdf(2);
    const res = await handlePdfExtractPages(
      {
        handle: 1,
        pages: { start: 0, end: 0 },
        destinationToken: 'tok',
      },
      makeDeps({
        getBytes: () => bytes,
        writeFile: vi.fn().mockRejectedValue(new Error('disk full')),
      }),
    );
    expectErr(res, 'fs_write_failed');
  });

  it('maps engine page_out_of_range', async () => {
    const bytes = await makePdf(1);
    const res = await handlePdfExtractPages(
      {
        handle: 1,
        pages: { start: 0, end: 5 },
        destinationToken: 'tok',
      },
      makeDeps({ getBytes: () => bytes }),
    );
    expectErr(res, 'page_out_of_range');
  });
});
