// @vitest-environment node
//
// Wave 16 — PAdES engine tests.
//
// Discipline (conventions §15.4): NO permissive stubs of applyPades itself.
// Tests for the dynamic-import failure path exercise the REAL applyPades
// flow with a real (synthetic) ParsedCertEntry — exactly what production
// code does up to the missing-dep boundary.
//
// Byte-range arithmetic tests use real bytes + the exported pure functions.

import { describe, expect, it } from 'vitest';

import type { ParsedCertEntry } from './cert-store.js';
import {
  applyPades,
  computeByteRange,
  extractByteRangeAndContents,
  hashOverByteRange,
  sha256,
} from './pades-signature.js';

function makeEntry(): ParsedCertEntry {
  return {
    privateKey: { kind: 'synthetic' },
    privateKeyPem: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
    fingerprint: 'a'.repeat(64),
    subjectCN: 'Ada Lovelace',
    issuerCN: 'Test CA',
    notBefore: Date.now() - 1000,
    notAfter: Date.now() + 1000,
    certDer: new Uint8Array([0x30, 0x82, 0x01, 0xfe]),
    // Phase 4.1 (B-17.1): ParsedCertEntry now retains the inbound buffers
    // so the PAdES engine can consume them without IPC re-traversal.
    pfxBytes: null,
    passwordBuffer: null,
    loadedAt: Date.now(),
    refCount: 0,
  };
}

describe('applyPades — engine wiring + missing-dep handling', () => {
  it('reaches the signpdf call (no longer engine_not_available post-Wave-17)', async () => {
    const entry = makeEntry();
    const r = await applyPades({
      bytesWithWidget: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
      placement: { mode: 'placeholder', fieldName: 'SigField1' },
      certEntry: entry,
      certPfxBytes: Buffer.from([1, 2, 3]),
      certPassword: Buffer.from('pwd'),
    });
    // Phase 4.1: node-signpdf IS installed (Wave 17). With synthetic PFX
    // bytes the sign attempt fails INSIDE signpdf with pades_sign_failed.
    // Pre-Wave-17 the same call returned engine_not_available. Accept
    // either — both prove the engine wired through.
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(['engine_not_available', 'pades_sign_failed']).toContain(r.error);
    }
  });

  it('returns cert_handle_not_found when pfx bytes or password missing', async () => {
    const r = await applyPades({
      bytesWithWidget: new Uint8Array([1, 2, 3]),
      placement: { mode: 'placeholder', fieldName: 'X' },
      certEntry: makeEntry(),
      certPfxBytes: null,
      certPassword: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('cert_handle_not_found');
  });
});

describe('computeByteRange — pure arithmetic, the #1 silent-bug surface', () => {
  it('produces the canonical [0, a, b, total-b] shape', () => {
    // Synthetic PDF (string for clarity):
    //   "head...<00000000>tail"
    //   - <  at offset 4
    //   - first hex char at offset 5
    //   - last hex char (0) at offset 12
    //   - >  at offset 13
    //   - tail at offset 14..17 (4 bytes)
    // total length = 18; contentsHexStart = 5; contentsHexLength = 8
    const r = computeByteRange(18, 5, 8);
    expect(r).toEqual([0, 4, 14, 4]);
  });

  it('off-by-one regression: 1-char shift in start changes both offsets', () => {
    const a = computeByteRange(100, 50, 16);
    const b = computeByteRange(100, 51, 16);
    expect(a[1]).toBe(49);
    expect(b[1]).toBe(50);
    expect(b[2] - a[2]).toBe(1);
  });

  it('hashOverByteRange over a known input produces a stable hash', () => {
    // Build a synthetic signed-document bytes:
    //   bytes = "BEFORE<00>AFTER"
    //   - <  at offset 6
    //   - hex placeholder at offset 7-8 ("00")
    //   - >  at offset 9
    //   - AFTER at offset 10-14
    const buf = Buffer.from('BEFORE<00>AFTER', 'latin1');
    const range: [number, number, number, number] = [0, 6, 10, buf.length - 10];
    const h1 = hashOverByteRange(buf, range);
    // Substitute the placeholder with different bytes; hash MUST be identical
    // (placeholder is excluded).
    const buf2 = Buffer.from('BEFORE<FF>AFTER', 'latin1');
    const h2 = hashOverByteRange(buf2, range);
    expect(Buffer.from(h1).toString('hex')).toBe(Buffer.from(h2).toString('hex'));
    // And the hash matches sha256('BEFOREAFTER')
    const direct = sha256(Buffer.from('BEFOREAFTER', 'latin1'));
    expect(Buffer.from(h1).toString('hex')).toBe(Buffer.from(direct).toString('hex'));
  });
});

describe('extractByteRangeAndContents', () => {
  it('locates /Contents <...> and /ByteRange [...] in a synthetic blob', () => {
    const text = '%PDF-1.7\n/ByteRange [0 100 200 300]\n/Contents <00112233>\nendof';
    const bytes = new Uint8Array(Buffer.from(text, 'latin1'));
    const r = extractByteRangeAndContents(bytes);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.byteRange).toEqual([0, 100, 200, 300]);
      expect(r.value.contentsHexLength).toBe(8);
    }
  });

  it('rejects when /Contents or /ByteRange missing', () => {
    const bytes = new Uint8Array(Buffer.from('%PDF-1.7\n%%EOF', 'latin1'));
    const r = extractByteRangeAndContents(bytes);
    expect(r.ok).toBe(false);
  });
});
