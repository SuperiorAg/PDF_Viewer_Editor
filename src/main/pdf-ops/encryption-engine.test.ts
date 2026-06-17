// Unit tests for the Phase 7.5 Wave 5 B8 encryption engine.
//
// Tests use the QpdfRunner test seam — NO real qpdf binary is invoked. The
// runner spy records argv + stdin so we can assert the engine builds the
// correct CLI invocation and routes outputs correctly.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import {
  removePasswordProtection,
  setPasswordProtection,
  type QpdfRunResult,
  type QpdfRunner,
} from './encryption-engine.js';

const baseline = {
  print: true,
  modify: false,
  copy: true,
  annotate: false,
  fillForms: false,
  extract: true,
  assemble: false,
  printHighRes: true,
};

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('test');
  doc.addPage([100, 100]);
  return doc.save();
}

interface RunnerSpy {
  runner: QpdfRunner;
  calls: Array<{ args: string[]; stdin: Uint8Array }>;
}

function makeRunner(impl: (args: string[], stdin: Uint8Array) => QpdfRunResult): RunnerSpy {
  const calls: RunnerSpy['calls'] = [];
  return {
    calls,
    runner: {
      async run(args, stdin) {
        calls.push({ args, stdin });
        return impl(args, stdin);
      },
    },
  };
}

describe('setPasswordProtection', () => {
  it('rejects empty bytes', async () => {
    const res = await setPasswordProtection(
      {
        pdfBytes: new Uint8Array(0),
        openPassword: 'pwd',
        permissionsPassword: 'owner',
        permissions: baseline,
        algorithm: 'aes-256',
      },
      { runner: makeRunner(() => ({ exitCode: 0, stdout: new Uint8Array(), stderr: '' })).runner },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects empty owner password (qpdf would reject)', async () => {
    const bytes = await makePdf();
    const res = await setPasswordProtection(
      {
        pdfBytes: bytes,
        openPassword: null,
        permissionsPassword: null,
        permissions: baseline,
        algorithm: 'aes-256',
      },
      { runner: makeRunner(() => ({ exitCode: 0, stdout: new Uint8Array(), stderr: '' })).runner },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('password_too_short');
  });

  it('surfaces engine_unavailable when binary path missing AND no runner injected', async () => {
    const bytes = await makePdf();
    const res = await setPasswordProtection(
      {
        pdfBytes: bytes,
        openPassword: 'open',
        permissionsPassword: 'owner',
        permissions: baseline,
        algorithm: 'aes-256',
      },
      // explicit non-existent path; no runner injected.
      { qpdfBinaryPath: 'C:/nonexistent/qpdf-binary-that-does-not-exist.exe' },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('engine_unavailable');
  });

  it('happy path: spawns runner and returns encrypted bytes', async () => {
    const bytes = await makePdf();
    const fakeEncrypted = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // "%PDF-1"
    const spy = makeRunner(() => ({ exitCode: 0, stdout: fakeEncrypted, stderr: '' }));

    const res = await setPasswordProtection(
      {
        pdfBytes: bytes,
        openPassword: 'open-pwd',
        permissionsPassword: 'owner-pwd',
        permissions: baseline,
        algorithm: 'aes-256',
      },
      { runner: spy.runner },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Output bytes are whatever qpdf wrote to stdout.
    expect(res.value.bytes).toEqual(fakeEncrypted);

    // Spy recorded one call with the right argv shape.
    expect(spy.calls).toHaveLength(1);
    const call = spy.calls[0]!;
    expect(call.args[0]).toBe('--encrypt');
    expect(call.args[1]).toBe('open-pwd'); // user password
    expect(call.args[2]).toBe('owner-pwd'); // owner password
    expect(call.args[3]).toBe('256'); // key length
    expect(call.args).toContain('--');
    expect(call.args).toContain('-');
    expect(call.args).toContain('--use-aes=y');

    // Stdin should be the input pdf bytes.
    expect(call.stdin).toEqual(bytes);

    // Honest warning surfaced.
    expect(res.value.warnings.length).toBeGreaterThan(0);
  });

  it('maps qpdf "password too short" stderr to password_too_short', async () => {
    const bytes = await makePdf();
    const spy = makeRunner(() => ({
      exitCode: 2,
      stdout: new Uint8Array(),
      stderr: 'qpdf: password too short for 256-bit key',
    }));
    const res = await setPasswordProtection(
      {
        pdfBytes: bytes,
        openPassword: 'x',
        permissionsPassword: 'x',
        permissions: baseline,
        algorithm: 'aes-256',
      },
      { runner: spy.runner },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('password_too_short');
  });

  it('maps a generic qpdf nonzero exit to engine_failed AND sanitizes stderr paths', async () => {
    const bytes = await makePdf();
    const spy = makeRunner(() => ({
      exitCode: 2,
      stdout: new Uint8Array(),
      stderr: 'qpdf: error writing C:\\Users\\victim\\secret.pdf — invalid syntax',
    }));
    const res = await setPasswordProtection(
      {
        pdfBytes: bytes,
        openPassword: 'open',
        permissionsPassword: 'owner',
        permissions: baseline,
        algorithm: 'aes-128',
      },
      { runner: spy.runner },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('engine_failed');
      // Path stripped from message.
      expect(res.message).not.toContain('C:\\Users\\victim');
      expect(res.message).toContain('<path>');
    }
  });
});

describe('removePasswordProtection', () => {
  it('rejects empty bytes', async () => {
    const res = await removePasswordProtection(
      { pdfBytes: new Uint8Array(0), ownerPassword: 'p' },
      { runner: makeRunner(() => ({ exitCode: 0, stdout: new Uint8Array(), stderr: '' })).runner },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('maps wrong-password stderr to wrong_password', async () => {
    const bytes = await makePdf();
    const spy = makeRunner(() => ({
      exitCode: 2,
      stdout: new Uint8Array(),
      stderr: 'qpdf: invalid password',
    }));
    const res = await removePasswordProtection(
      { pdfBytes: bytes, ownerPassword: 'wrong' },
      { runner: spy.runner },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('wrong_password');
  });

  it('happy path: returns decrypted bytes', async () => {
    const bytes = await makePdf();
    const fakeDecrypted = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const spy = makeRunner(() => ({ exitCode: 0, stdout: fakeDecrypted, stderr: '' }));
    const res = await removePasswordProtection(
      { pdfBytes: bytes, ownerPassword: 'good' },
      { runner: spy.runner },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.bytes).toEqual(fakeDecrypted);
    // Argv shape: --password=, --decrypt, --, -, -.
    const call = spy.calls[0]!;
    expect(call.args[0]).toBe('--password=good');
    expect(call.args).toContain('--decrypt');
  });
});
