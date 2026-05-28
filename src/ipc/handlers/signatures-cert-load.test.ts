// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resetPfxParser,
  setPfxParser,
  releaseAll,
  liveHandleCount,
} from '../../main/pdf-ops/cert-store.js';

import { handleSignaturesCertLoad } from './signatures-cert-load.js';
import { handleSignaturesCertRelease } from './signatures-cert-release.js';

const KNOWN_PASSWORD = 'TEST-PWD-DO-NOT-LOG-2026';

beforeEach(() => {
  releaseAll();
  resetPfxParser();
  setPfxParser((input) => {
    if (input.passwordBuffer.toString('utf-8') !== KNOWN_PASSWORD) {
      throw new Error('MAC verification failed');
    }
    return {
      privateKey: { kind: 'synthetic' },
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
      certDer: new Uint8Array([0x30, 0x82, 0x01, 0xfe]),
      subjectCN: 'Ada Lovelace',
      issuerCN: 'Test CA',
      notBefore: Date.now() - 24 * 3600 * 1000,
      notAfter: Date.now() + 365 * 24 * 3600 * 1000,
    };
  });
});

afterEach(() => {
  releaseAll();
  resetPfxParser();
});

describe('handleSignaturesCertLoad', () => {
  it('happy path: returns handle + metadata', async () => {
    const r = await handleSignaturesCertLoad({
      pfxBytes: new Uint8Array([1, 2, 3, 4, 5]),
      password: KNOWN_PASSWORD,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.subjectCN).toBe('Ada Lovelace');
      expect(r.value.handle).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('rejects payload that is not a Uint8Array', async () => {
    const r = await handleSignaturesCertLoad({ pfxBytes: 'not-a-buffer', password: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects empty password', async () => {
    const r = await handleSignaturesCertLoad({
      pfxBytes: new Uint8Array([1, 2]),
      password: '',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('wrong_password returned as the documented error variant', async () => {
    const r = await handleSignaturesCertLoad({
      pfxBytes: new Uint8Array([1, 2]),
      password: 'wrong',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('wrong_password');
  });

  it('discipline: parsed-payload password field is overwritten to "" before delegation', async () => {
    // We can't easily peek at the local var, but we CAN observe the
    // parsed-data object never carries the password back. The handler
    // returns ONLY metadata + handle.
    const r = await handleSignaturesCertLoad({
      pfxBytes: new Uint8Array([1, 2]),
      password: KNOWN_PASSWORD,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // None of the response fields contain the password substring.
      const json = JSON.stringify(r.value);
      expect(json).not.toContain('TEST-PWD');
      expect(json).not.toContain(KNOWN_PASSWORD);
    }
  });

  it('parser_not_installed surfaces as pfx_decode_failed with Wave 17 message', async () => {
    resetPfxParser(); // no parser registered
    const r = await handleSignaturesCertLoad({
      pfxBytes: new Uint8Array([1, 2]),
      password: KNOWN_PASSWORD,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('pfx_decode_failed');
      // Important: the message tells the user PAdES is unavailable; doesn't
      // crash, doesn't expose internals.
      expect(r.message.toLowerCase()).not.toContain('parser_not_installed');
      expect(r.message).toContain('not yet installed');
    }
  });
});

describe('handleSignaturesCertRelease', () => {
  it('happy path: release after load', async () => {
    const load = await handleSignaturesCertLoad({
      pfxBytes: new Uint8Array([1, 2]),
      password: KNOWN_PASSWORD,
    });
    if (!load.ok) throw new Error('test setup');
    expect(liveHandleCount()).toBe(1);
    const rel = await handleSignaturesCertRelease({ handle: load.value.handle });
    expect(rel.ok).toBe(true);
    if (rel.ok) expect(rel.value.released).toBe(true);
    expect(liveHandleCount()).toBe(0);
  });

  it('idempotent: second release returns released=false', async () => {
    const load = await handleSignaturesCertLoad({
      pfxBytes: new Uint8Array([1, 2]),
      password: KNOWN_PASSWORD,
    });
    if (!load.ok) throw new Error('test setup');
    await handleSignaturesCertRelease({ handle: load.value.handle });
    const second = await handleSignaturesCertRelease({ handle: load.value.handle });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.released).toBe(false);
  });

  it('rejects empty / non-string handle', async () => {
    const r1 = await handleSignaturesCertRelease({ handle: '' });
    expect(r1.ok).toBe(false);
    const r2 = await handleSignaturesCertRelease({ handle: 42 });
    expect(r2.ok).toBe(false);
  });
});
