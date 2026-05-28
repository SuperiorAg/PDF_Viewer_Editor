// Tests for fs:applyEditOps handler — Phase 2 (Wave 7, David).
//
// This is the headline new IPC channel — it wraps the replay engine +
// atomic temp-rename. Tests verify: payload validation, destination
// resolution (token vs outputPath), error mapping, atomic write + cleanup.

import { describe, expect, it, vi } from 'vitest';

import { handleFsApplyEditOps } from './pdf-apply-edit-ops.js';
import type { FsApplyEditOpsDeps } from './pdf-apply-edit-ops.js';
import { expectErr, expectOk } from './test-support.js';

function makeDeps(overrides: Partial<FsApplyEditOpsDeps> = {}): FsApplyEditOpsDeps {
  const writeFile = vi.fn(async (_p: string, _b: Uint8Array) => {});
  const rename = vi.fn(async (_from: string, _to: string) => {});
  const unlink = vi.fn(async (_p: string) => {});
  return {
    getBytes: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    setBytes: vi.fn(),
    consumeDestinationToken: (_token: string) => ({
      path: 'C:/tmp/out.pdf',
      displayName: 'out.pdf',
    }),
    sanitizePath: (raw: string) => raw,
    writeFile,
    rename,
    unlink,
    computeBufferHash: () => 'a'.repeat(64),
    replay: vi.fn(async () => ({
      ok: true,
      value: {
        newBytes: new Uint8Array([9, 9, 9, 9]),
        warnings: ['hi'],
        engineUsed: 'pdf-lib' as const,
        byteCount: 4,
        durationMs: 1,
        annotationRefAssignments: { a1: 7 },
      },
    })),
    ...overrides,
  };
}

describe('fs:applyEditOps handler', () => {
  it('rejects non-integer handle', async () => {
    const r = await handleFsApplyEditOps(
      { handle: 'bad' as unknown as number, ops: [], annotations: [] },
      makeDeps(),
    );
    expectErr(r, 'invalid_payload');
  });

  it('rejects non-array ops', async () => {
    const r = await handleFsApplyEditOps(
      { handle: 1, ops: 'no' as unknown as never, annotations: [] },
      makeDeps(),
    );
    expectErr(r, 'invalid_payload');
  });

  it('rejects when neither token nor outputPath supplied', async () => {
    const r = await handleFsApplyEditOps({ handle: 1, ops: [], annotations: [] }, makeDeps());
    expectErr(r, 'invalid_payload');
  });

  it('returns token_expired when consumeDestinationToken returns null', async () => {
    const r = await handleFsApplyEditOps(
      { handle: 1, ops: [], annotations: [], destinationToken: 'bad' },
      makeDeps({ consumeDestinationToken: () => null }),
    );
    expectErr(r, 'token_expired');
  });

  it('returns handle_not_found when getBytes returns null', async () => {
    const r = await handleFsApplyEditOps(
      { handle: 1, ops: [], annotations: [], destinationToken: 'tok' },
      makeDeps({ getBytes: () => null }),
    );
    expectErr(r, 'handle_not_found');
  });

  it('happy path: writes, renames, refreshes bytes, returns value', async () => {
    const deps = makeDeps();
    const r = await handleFsApplyEditOps(
      { handle: 1, ops: [], annotations: [], destinationToken: 'tok' },
      deps,
    );
    const value = expectOk(r);
    expect(value.bytesWritten).toBe(4);
    expect(value.annotationRefAssignments).toEqual({ a1: 7 });
    expect(value.warnings).toEqual(['hi']);
    expect(deps.setBytes).toHaveBeenCalledWith(1, expect.any(Uint8Array));
    expect(deps.writeFile).toHaveBeenCalledTimes(1);
    expect(deps.rename).toHaveBeenCalledTimes(1);
  });

  it('cleans up temp file on rename failure', async () => {
    const deps = makeDeps({
      rename: vi.fn(async () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }),
    });
    const r = await handleFsApplyEditOps(
      { handle: 1, ops: [], annotations: [], destinationToken: 'tok' },
      deps,
    );
    expectErr(r, 'fs_write_failed');
    expect(deps.unlink).toHaveBeenCalledTimes(1);
  });

  it('maps ENOSPC to disk_full', async () => {
    const deps = makeDeps({
      writeFile: vi.fn(async () => {
        throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
      }),
    });
    const r = await handleFsApplyEditOps(
      { handle: 1, ops: [], annotations: [], destinationToken: 'tok' },
      deps,
    );
    expectErr(r, 'disk_full');
  });

  it('maps a replay missing_glyph error', async () => {
    const deps = makeDeps({
      replay: vi.fn(async () => ({
        ok: false,
        error: 'missing_glyph',
        message: 'codepoint 0xfc',
      })),
    });
    const r = await handleFsApplyEditOps(
      { handle: 1, ops: [], annotations: [], destinationToken: 'tok' },
      deps,
    );
    expectErr(r, 'missing_glyph');
  });

  it('sanitizes outputPath when supplied (no token)', async () => {
    const sanitize = vi.fn((raw: string) => raw);
    const deps = makeDeps({ sanitizePath: sanitize });
    const r = await handleFsApplyEditOps(
      { handle: 1, ops: [], annotations: [], outputPath: 'C:/foo/out.pdf' },
      deps,
    );
    expect(sanitize).toHaveBeenCalledWith('C:/foo/out.pdf');
    expectOk(r);
  });

  it('rejects an outputPath that fails sanitization', async () => {
    const deps = makeDeps({ sanitizePath: () => null });
    const r = await handleFsApplyEditOps(
      { handle: 1, ops: [], annotations: [], outputPath: '../../../etc/passwd' },
      deps,
    );
    expectErr(r, 'invalid_payload');
  });
});
