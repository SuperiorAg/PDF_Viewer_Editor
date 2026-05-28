import { describe, expect, it, vi } from 'vitest';

import { handleFsReadPdf, type FsReadPdfDeps } from './fs-read-pdf.js';
import { expectErr, expectOk } from './test-support.js';

function makeDeps(overrides: Partial<FsReadPdfDeps> = {}): FsReadPdfDeps {
  return {
    readFile: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50])),
    statFile: vi.fn().mockResolvedValue({ size: 10 }),
    computeFileHash: vi.fn().mockResolvedValue('b'.repeat(64)),
    loadPdfMetadata: vi.fn().mockResolvedValue({ pageCount: 5, warnings: [] }),
    registerHandle: vi.fn().mockReturnValue({ handle: 7 }),
    recordRecent: vi.fn(),
    sanitizePath: (raw: unknown) => (typeof raw === 'string' ? raw : null),
    getMaxFileSizeBytes: () => 1024 * 1024,
    ...overrides,
  };
}

describe('handleFsReadPdf', () => {
  it('rejects empty droppedPath', async () => {
    const res = await handleFsReadPdf({ droppedPath: '' }, makeDeps());
    expectErr(res, 'path_rejected');
  });

  it('rejects when sanitizer returns null', async () => {
    const deps = makeDeps({ sanitizePath: () => null });
    const res = await handleFsReadPdf({ droppedPath: '../etc/passwd' }, deps);
    expectErr(res, 'path_rejected');
  });

  it('rejects when file is too large', async () => {
    const deps = makeDeps({
      statFile: vi.fn().mockResolvedValue({ size: 9999 }),
      getMaxFileSizeBytes: () => 100,
    });
    const res = await handleFsReadPdf({ droppedPath: 'C:/x.pdf' }, deps);
    expectErr(res, 'too_large');
  });

  it('returns invalid_pdf when metadata throws', async () => {
    const deps = makeDeps({
      loadPdfMetadata: vi.fn().mockRejectedValue(new Error('bad pdf')),
    });
    const res = await handleFsReadPdf({ droppedPath: 'C:/x.pdf' }, deps);
    expectErr(res, 'invalid_pdf');
  });

  it('succeeds and returns handle on a valid drop', async () => {
    const value = expectOk(await handleFsReadPdf({ droppedPath: 'C:/x.pdf' }, makeDeps()));
    expect(value.handle).toBe(7);
    expect(value.pageCount).toBe(5);
  });
});
