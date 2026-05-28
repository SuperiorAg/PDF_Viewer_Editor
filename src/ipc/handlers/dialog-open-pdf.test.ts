import { describe, expect, it, vi } from 'vitest';

import { handleDialogOpenPdf, type DialogOpenPdfDeps } from './dialog-open-pdf.js';
import { expectErr, expectOk } from './test-support.js';

function makeDeps(overrides: Partial<DialogOpenPdfDeps> = {}): DialogOpenPdfDeps {
  return {
    showOpenDialog: vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ['C:/Users/test/contract.pdf'],
    }),
    readFile: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])),
    statFile: vi.fn().mockResolvedValue({ size: 10 }),
    computeFileHash: vi.fn().mockResolvedValue('a'.repeat(64)),
    loadPdfMetadata: vi.fn().mockResolvedValue({ pageCount: 3, warnings: [] }),
    registerHandle: vi.fn().mockReturnValue({ handle: 1 }),
    recordRecent: vi.fn(),
    sanitizePath: (raw: unknown) => (typeof raw === 'string' ? raw : null),
    getMaxFileSizeBytes: () => 1024 * 1024,
    ...overrides,
  };
}

describe('handleDialogOpenPdf', () => {
  it('should return user_cancelled when dialog is cancelled', async () => {
    const deps = makeDeps({
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    });
    const res = await handleDialogOpenPdf({}, deps);
    expectErr(res, 'user_cancelled');
  });

  it('should return invalid_pdf when sanitizer rejects the path', async () => {
    const deps = makeDeps({ sanitizePath: () => null });
    const res = await handleDialogOpenPdf({}, deps);
    expectErr(res, 'invalid_pdf');
  });

  it('should return too_large when file exceeds limit', async () => {
    const deps = makeDeps({
      statFile: vi.fn().mockResolvedValue({ size: 999_999_999 }),
      getMaxFileSizeBytes: () => 1024,
    });
    const res = await handleDialogOpenPdf({}, deps);
    expectErr(res, 'too_large');
  });

  it('should return fs_read_failed when readFile throws', async () => {
    const deps = makeDeps({
      readFile: vi.fn().mockRejectedValue(new Error('EACCES')),
    });
    const res = await handleDialogOpenPdf({}, deps);
    expectErr(res, 'fs_read_failed');
  });

  it('should return invalid_pdf when metadata load fails', async () => {
    const deps = makeDeps({
      loadPdfMetadata: vi.fn().mockRejectedValue(new Error('not a pdf')),
    });
    const res = await handleDialogOpenPdf({}, deps);
    expectErr(res, 'invalid_pdf');
  });

  it('should return ok with a handle on success and record in recents', async () => {
    const recordRecent = vi.fn();
    const deps = makeDeps({ recordRecent });
    const value = expectOk(await handleDialogOpenPdf({}, deps));
    expect(value.handle).toBe(1);
    expect(value.pageCount).toBe(3);
    expect(value.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(recordRecent).toHaveBeenCalledTimes(1);
  });
});
