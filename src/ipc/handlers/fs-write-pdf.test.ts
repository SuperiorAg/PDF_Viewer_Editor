import { describe, expect, it, vi } from 'vitest';

import { handleFsWritePdf, type FsWritePdfDeps } from './fs-write-pdf.js';
import { expectErr, expectOk } from './test-support.js';

function makeDeps(overrides: Partial<FsWritePdfDeps> = {}): FsWritePdfDeps {
  return {
    consumeDestinationToken: vi.fn().mockReturnValue({
      token: 'tok',
      path: 'C:/out.pdf',
      displayName: 'out.pdf',
    }),
    getDocument: vi.fn().mockReturnValue({ bytes: new Uint8Array([1, 2, 3]), path: 'C:/in.pdf' }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    computeBufferHash: vi.fn().mockReturnValue('c'.repeat(64)),
    ...overrides,
  };
}

describe('handleFsWritePdf', () => {
  it('rejects missing destinationToken', async () => {
    const res = await handleFsWritePdf(
      {
        handle: 1,
        destinationToken: '',
        payload: { kind: 'bytes', bytes: new Uint8Array([1]) },
      },
      makeDeps(),
    );
    expectErr(res, 'invalid_payload');
  });

  it('rejects non-int handle', async () => {
    const res = await handleFsWritePdf(
      {
        handle: 1.5,
        destinationToken: 'tok',
        payload: { kind: 'bytes', bytes: new Uint8Array([1]) },
      },
      makeDeps(),
    );
    expectErr(res, 'invalid_payload');
  });

  it('returns token_expired when token unknown', async () => {
    const deps = makeDeps({ consumeDestinationToken: vi.fn().mockReturnValue(null) });
    const res = await handleFsWritePdf(
      {
        handle: 1,
        destinationToken: 'gone',
        payload: { kind: 'bytes', bytes: new Uint8Array([1]) },
      },
      deps,
    );
    expectErr(res, 'token_expired');
  });

  it('writes bytes payload and returns hash + count', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ writeFile });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const value = expectOk(
      await handleFsWritePdf(
        { handle: 1, destinationToken: 'tok', payload: { kind: 'bytes', bytes } },
        deps,
      ),
    );
    expect(value.bytesWritten).toBe(4);
    expect(value.newFileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(writeFile).toHaveBeenCalledWith('C:/out.pdf', bytes);
  });

  it('rejects ops payload when no applyOpsToBytes is wired (Phase 1 stub)', async () => {
    const res = await handleFsWritePdf(
      {
        handle: 1,
        destinationToken: 'tok',
        payload: {
          kind: 'ops',
          originalHandle: 2,
          ops: [],
          annotations: [],
        },
      },
      makeDeps(),
    );
    expectErr(res, 'invalid_payload');
  });

  it('maps ENOSPC to disk_full', async () => {
    const err = new Error('ENOSPC') as NodeJS.ErrnoException;
    err.code = 'ENOSPC';
    const deps = makeDeps({ writeFile: vi.fn().mockRejectedValue(err) });
    const res = await handleFsWritePdf(
      {
        handle: 1,
        destinationToken: 'tok',
        payload: { kind: 'bytes', bytes: new Uint8Array([1]) },
      },
      deps,
    );
    expectErr(res, 'disk_full');
  });
});
