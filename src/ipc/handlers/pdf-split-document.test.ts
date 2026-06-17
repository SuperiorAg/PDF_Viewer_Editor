// Tests for the pdf:splitDocument IPC handler.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import {
  handlePdfSplitDocument,
  type PdfSplitDocumentDeps,
  renderFilenamePattern,
} from './pdf-split-document.js';
import { expectErr, expectOk } from './test-support.js';

async function makePdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) doc.addPage([100, 100]);
  return doc.save();
}

function makeDeps(overrides: Partial<PdfSplitDocumentDeps> = {}): PdfSplitDocumentDeps {
  return {
    getBytes: () => null,
    resolveDestinationDirectory: () => ({
      directory: 'C:/out',
      baseFilename: 'doc',
    }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    joinPath: (d, n) => `${d}/${n}`,
    ...overrides,
  };
}

describe('renderFilenamePattern', () => {
  it('substitutes {base} and zero-pads {index}', () => {
    expect(renderFilenamePattern('{base}-part-{index}.pdf', 'doc', 2)).toBe('doc-part-002.pdf');
  });

  it('passes unknown tokens through unchanged', () => {
    expect(renderFilenamePattern('{base}-{foo}-{index}.pdf', 'd', 1)).toBe('d-{foo}-001.pdf');
  });
});

describe('handlePdfSplitDocument', () => {
  it('rejects malformed payload', async () => {
    const res = await handlePdfSplitDocument({}, makeDeps());
    expectErr(res, 'invalid_payload');
  });

  it('rejects unknown handle', async () => {
    const res = await handlePdfSplitDocument(
      {
        handle: 1,
        strategy: { kind: 'by-page-count', pagesPerFile: 2 },
        destinationDirectoryToken: 'tok',
        filenamePattern: '{base}-{index}.pdf',
      },
      makeDeps({ getBytes: () => null }),
    );
    expectErr(res, 'handle_not_found');
  });

  it('rejects unknown token with token_expired', async () => {
    const bytes = await makePdf(4);
    const res = await handlePdfSplitDocument(
      {
        handle: 1,
        strategy: { kind: 'by-page-count', pagesPerFile: 2 },
        destinationDirectoryToken: 'tok',
        filenamePattern: '{base}-{index}.pdf',
      },
      makeDeps({
        getBytes: () => bytes,
        resolveDestinationDirectory: () => null,
      }),
    );
    expectErr(res, 'token_expired');
  });

  it('writes one file per planned part with the rendered filename', async () => {
    const bytes = await makePdf(5);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const res = await handlePdfSplitDocument(
      {
        handle: 1,
        strategy: { kind: 'by-page-count', pagesPerFile: 2 },
        destinationDirectoryToken: 'tok',
        filenamePattern: '{base}-{index}.pdf',
      },
      makeDeps({ getBytes: () => bytes, writeFile }),
    );
    const v = expectOk(res);
    expect(v.files.length).toBe(3); // 2+2+1
    expect(writeFile).toHaveBeenCalledTimes(3);
    expect(v.files[0]!.path).toBe('C:/out/doc-001.pdf');
    expect(v.files[1]!.pageRange).toEqual({ start: 2, end: 3 });
    // Phase 7.5 Wave 3 carry-over: warnings array is present + empty on a
    // clean split (no outlines on the test fixture).
    expect(v.warnings).toEqual([]);
  });

  it('surfaces no_bookmarks_for_split when source has no outline', async () => {
    const bytes = await makePdf(3);
    const res = await handlePdfSplitDocument(
      {
        handle: 1,
        strategy: { kind: 'by-bookmarks', topLevelOnly: true },
        destinationDirectoryToken: 'tok',
        filenamePattern: '{base}-{index}.pdf',
      },
      makeDeps({ getBytes: () => bytes }),
    );
    expectErr(res, 'no_bookmarks_for_split');
  });

  it('surfaces fs_write_failed when writeFile throws on any part', async () => {
    const bytes = await makePdf(4);
    const res = await handlePdfSplitDocument(
      {
        handle: 1,
        strategy: { kind: 'by-page-count', pagesPerFile: 2 },
        destinationDirectoryToken: 'tok',
        filenamePattern: '{base}-{index}.pdf',
      },
      makeDeps({
        getBytes: () => bytes,
        writeFile: vi.fn().mockRejectedValueOnce(new Error('disk full')),
      }),
    );
    expectErr(res, 'fs_write_failed');
  });
});
