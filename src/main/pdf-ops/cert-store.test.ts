// @vitest-environment node
//
// Wave 16 — Cert-store discipline tests.
//
// These tests EXERCISE the real production loadCert / releaseHandle /
// releaseAll path. They use a synthetic PFX parser (injected via setPfxParser)
// because node-forge is not installed at Wave 16 — Diego adds it in Wave 17.
// The synthetic parser produces a known cert shape; the lifecycle, buffer-
// zeroing, and storage are 100% the production code path.
//
// Wave 13.5 anti-pattern guard (conventions §15.3): we DO NOT stub
// `loadCert` itself; we exercise its actual finally-block + entry storage.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type PfxParseInput,
  type PfxParseOutput,
  type PfxParser,
  getEntry,
  liveHandleCount,
  loadCert,
  releaseAll,
  releaseHandle,
  resetPfxParser,
  setPfxParser,
} from './cert-store.js';

// ---------------------------------------------------------------------------
// Synthetic parser used by every test below. Returns a deterministic cert.
// `passwordBuffer` and `pfxBytes` are read-only here; cert-store zeroes them
// in its own finally block (which these tests verify).
// ---------------------------------------------------------------------------

const KNOWN_PASSWORD = 'TEST-PWD-DO-NOT-LOG-2026';

function makeHappyParser(opts?: { isExpired?: boolean }): PfxParser {
  return (input: PfxParseInput): PfxParseOutput => {
    // Sanity: verify the parser sees the same buffers the caller built.
    if (input.pfxBytes.byteLength === 0) throw new Error('empty pfx');
    if (input.passwordBuffer.byteLength === 0) throw new Error('empty pwd');
    // The synthetic parser ASSERTS the password is the known one (the
    // synthetic PFX is "encrypted" with KNOWN_PASSWORD). Any mismatch
    // throws a wrong-password-looking error.
    const pwd = input.passwordBuffer.toString('utf-8');
    if (pwd !== KNOWN_PASSWORD) {
      throw new Error('MAC verification failed');
    }
    const notBefore = opts?.isExpired
      ? Date.now() - 365 * 24 * 3600 * 1000 * 5
      : Date.now() - 24 * 3600 * 1000;
    const notAfter = opts?.isExpired
      ? Date.now() - 24 * 3600 * 1000
      : Date.now() + 365 * 24 * 3600 * 1000;
    return {
      privateKey: { kind: 'synthetic-key' },
      privateKeyPem:
        '-----BEGIN PRIVATE KEY-----\nSYNTHETIC-KEY-FOR-TESTS-ONLY\n-----END PRIVATE KEY-----',
      certDer: new Uint8Array([0x30, 0x82, 0x01, 0xfe, ...new Array(20).fill(0)]),
      subjectCN: 'Test Subject',
      issuerCN: 'Test Issuer',
      notBefore,
      notAfter,
    };
  };
}

beforeEach(() => {
  releaseAll();
  resetPfxParser();
});

afterEach(() => {
  releaseAll();
  resetPfxParser();
});

describe('cert-store.loadCert — happy path', () => {
  it('returns a handle + cert metadata on a valid PFX', () => {
    setPfxParser(makeHappyParser());
    const pfx = Buffer.from('synthetic-pfx-bytes');
    const pwd = Buffer.from(KNOWN_PASSWORD, 'utf-8');

    const r = loadCert(pfx, pwd);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.handle).toMatch(/^[0-9a-f-]{36}$/);
      expect(r.value.subjectCN).toBe('Test Subject');
      expect(r.value.issuerCN).toBe('Test Issuer');
      expect(r.value.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(r.value.isExpired).toBe(false);
    }
  });

  it('B-17.1 (Phase 4.1): on happy load, ownership transfers — buffers live on the entry until release', () => {
    setPfxParser(makeHappyParser());
    const pfx = Buffer.from('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const pwd = Buffer.from(KNOWN_PASSWORD, 'utf-8');
    // Snapshot identity references — used to assert post-release zeroing.
    const pfxRef = pfx;
    const pwdRef = pwd;

    const r = loadCert(pfx, pwd);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // POST-LOAD: buffers are NOT yet zeroed (B-17.1 remediation — engine
    // needs them for signpdf.sign). They live on the entry until release.
    const entry = getEntry(r.value.handle);
    expect(entry).not.toBeNull();
    if (!entry) return;
    expect(entry.pfxBytes).toBe(pfxRef);
    expect(entry.passwordBuffer).toBe(pwdRef);
    // Buffer content is intact, NOT zeroed yet.
    expect(pfxRef.some((b) => b !== 0)).toBe(true);
    expect(pwdRef.some((b) => b !== 0)).toBe(true);

    // POST-RELEASE: now they are zeroed. This is the canonical zeroer.
    releaseHandle(r.value.handle);
    expect(pfxRef.every((b) => b === 0)).toBe(true);
    expect(pwdRef.every((b) => b === 0)).toBe(true);
    // Sentinel string from conventions §15.4 must NOT be reconstructible.
    expect(pwdRef.toString('utf-8')).not.toContain('TEST-PWD');
  });

  it('releaseAll also zeroes retained buffers', () => {
    setPfxParser(makeHappyParser());
    const pfx = Buffer.from('synthetic-pfx-bytes');
    const pwd = Buffer.from(KNOWN_PASSWORD, 'utf-8');
    const r = loadCert(pfx, pwd);
    expect(r.ok).toBe(true);

    // Buffers still populated.
    expect(pfx.some((b) => b !== 0)).toBe(true);
    expect(pwd.some((b) => b !== 0)).toBe(true);

    releaseAll();
    expect(pfx.every((b) => b === 0)).toBe(true);
    expect(pwd.every((b) => b === 0)).toBe(true);
  });

  it('returns expired metadata when cert is expired', () => {
    setPfxParser(makeHappyParser({ isExpired: true }));
    const pfx = Buffer.from('synthetic-pfx-bytes');
    const pwd = Buffer.from(KNOWN_PASSWORD, 'utf-8');

    const r = loadCert(pfx, pwd);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.isExpired).toBe(true);
  });
});

describe('cert-store.loadCert — failure paths zero the buffers anyway', () => {
  it('wrong_password: zeroes buffers even though parser threw', () => {
    setPfxParser(makeHappyParser()); // expects KNOWN_PASSWORD
    const pfx = Buffer.from('synthetic-pfx-bytes');
    const pwd = Buffer.from('wrong-password', 'utf-8');

    const r = loadCert(pfx, pwd);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('wrong_password');
    expect(pfx.every((b) => b === 0)).toBe(true);
    expect(pwd.every((b) => b === 0)).toBe(true);
    expect(liveHandleCount()).toBe(0);
  });

  it('parser_not_installed: surfaces a clear error without poisoning anything', () => {
    // No parser registered (default factory throws parser_not_installed).
    const pfx = Buffer.from('synthetic-pfx-bytes');
    const pwd = Buffer.from(KNOWN_PASSWORD, 'utf-8');

    const r = loadCert(pfx, pwd);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('parser_not_installed');
      expect(r.message).toContain('Wave 17');
    }
    expect(pfx.every((b) => b === 0)).toBe(true);
    expect(pwd.every((b) => b === 0)).toBe(true);
  });

  it('pfx_decode_failed: arbitrary parser throw zeroes buffers', () => {
    setPfxParser(() => {
      throw new Error('totally unexpected garbage from parser');
    });
    const pfx = Buffer.from('synthetic-pfx-bytes');
    const pwd = Buffer.from(KNOWN_PASSWORD, 'utf-8');

    const r = loadCert(pfx, pwd);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('pfx_decode_failed');
    expect(pfx.every((b) => b === 0)).toBe(true);
    expect(pwd.every((b) => b === 0)).toBe(true);
  });

  it('pfx_no_private_key: parser returns empty PEM string', () => {
    setPfxParser(
      (): PfxParseOutput => ({
        privateKey: null,
        privateKeyPem: '',
        certDer: new Uint8Array([1, 2, 3]),
        subjectCN: 'X',
        issuerCN: 'Y',
        notBefore: Date.now() - 1000,
        notAfter: Date.now() + 1000,
      }),
    );
    const pfx = Buffer.from('synthetic-pfx-bytes');
    const pwd = Buffer.from(KNOWN_PASSWORD, 'utf-8');

    const r = loadCert(pfx, pwd);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('pfx_no_private_key');
    expect(pfx.every((b) => b === 0)).toBe(true);
    expect(pwd.every((b) => b === 0)).toBe(true);
  });

  it('pfx_no_cert: parser returns empty certDer', () => {
    setPfxParser(
      (): PfxParseOutput => ({
        privateKey: { ok: true },
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
        certDer: new Uint8Array(0),
        subjectCN: 'X',
        issuerCN: 'Y',
        notBefore: Date.now() - 1000,
        notAfter: Date.now() + 1000,
      }),
    );
    const pfx = Buffer.from('synthetic-pfx-bytes');
    const pwd = Buffer.from(KNOWN_PASSWORD, 'utf-8');

    const r = loadCert(pfx, pwd);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('pfx_no_cert');
    expect(pwd.every((b) => b === 0)).toBe(true);
  });
});

describe('cert-store.releaseHandle', () => {
  it('happy path: load + release + getEntry returns null', () => {
    setPfxParser(makeHappyParser());
    const r = loadCert(Buffer.from('p'), Buffer.from(KNOWN_PASSWORD));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(getEntry(r.value.handle)).not.toBeNull();
    const releasedFirst = releaseHandle(r.value.handle);
    expect(releasedFirst).toBe(true);
    expect(getEntry(r.value.handle)).toBeNull();
  });

  it('idempotent: second release returns false but does not throw', () => {
    setPfxParser(makeHappyParser());
    const r = loadCert(Buffer.from('p'), Buffer.from(KNOWN_PASSWORD));
    if (!r.ok) throw new Error('test setup');

    releaseHandle(r.value.handle);
    const second = releaseHandle(r.value.handle);
    expect(second).toBe(false);
  });

  it('zeroes the PEM string field on release (narrows R-W15-A window)', () => {
    setPfxParser(makeHappyParser());
    const r = loadCert(Buffer.from('p'), Buffer.from(KNOWN_PASSWORD));
    if (!r.ok) throw new Error('test setup');

    const entry = getEntry(r.value.handle);
    expect(entry).not.toBeNull();
    if (!entry) return;
    // Hold a reference to the PEM string-field object's identity
    expect(entry.privateKeyPem.length).toBeGreaterThan(0);

    releaseHandle(r.value.handle);

    // After release, the PEM was set to '' before deletion.
    expect(entry.privateKeyPem).toBe('');
    expect(entry.privateKey).toBeNull();
    expect(entry.fingerprint).toBe('');
  });

  it('release of a missing handle returns false silently', () => {
    expect(releaseHandle('nonexistent-handle')).toBe(false);
  });
});

describe('cert-store.releaseAll', () => {
  it('releases every handle and returns the count', () => {
    setPfxParser(makeHappyParser());
    const a = loadCert(Buffer.from('a'), Buffer.from(KNOWN_PASSWORD));
    const b = loadCert(Buffer.from('b'), Buffer.from(KNOWN_PASSWORD));
    const c = loadCert(Buffer.from('c'), Buffer.from(KNOWN_PASSWORD));
    expect(a.ok && b.ok && c.ok).toBe(true);
    expect(liveHandleCount()).toBe(3);

    const n = releaseAll();

    expect(n).toBe(3);
    expect(liveHandleCount()).toBe(0);
  });

  it('safe to call when no handles exist (returns 0)', () => {
    expect(releaseAll()).toBe(0);
  });
});

describe('cert-store — no logging / no side effects (Wave 17 Julian discipline)', () => {
  it('does not log the password — captured via console.log spy', () => {
    setPfxParser(makeHappyParser());
    const logCapture: string[] = [];
    const originalLog = console.log;
    const originalErr = console.error;
    const originalWarn = console.warn;
    console.log = (...args: unknown[]) => logCapture.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => logCapture.push(args.map(String).join(' '));
    console.warn = (...args: unknown[]) => logCapture.push(args.map(String).join(' '));
    try {
      loadCert(Buffer.from('p'), Buffer.from(KNOWN_PASSWORD));
      loadCert(Buffer.from('p'), Buffer.from('wrong-password'));
    } finally {
      console.log = originalLog;
      console.error = originalErr;
      console.warn = originalWarn;
    }
    for (const line of logCapture) {
      expect(line).not.toContain('TEST-PWD');
      expect(line).not.toContain('wrong-password');
      expect(line.toLowerCase()).not.toContain('privatekey');
    }
  });
});
