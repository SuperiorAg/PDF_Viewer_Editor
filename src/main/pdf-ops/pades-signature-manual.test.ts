// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { ParsedCertEntry } from './cert-store.js';
import { applyPadesManual } from './pades-signature-manual.js';

function makeEntry(): ParsedCertEntry {
  return {
    privateKey: { kind: 'synthetic' },
    privateKeyPem: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
    fingerprint: 'b'.repeat(64),
    subjectCN: 'Bob',
    issuerCN: 'Test CA',
    notBefore: Date.now() - 1000,
    notAfter: Date.now() + 1000,
    certDer: new Uint8Array([0x30, 0x82, 0x01, 0xfe]),
    // Phase 4.1 (B-17.1): new retention fields. Tests that mint synthetic
    // entries leave these null — production loadCert populates them.
    pfxBytes: null,
    passwordBuffer: null,
    loadedAt: Date.now(),
    refCount: 0,
  };
}

describe('applyPadesManual', () => {
  it('returns cert_handle_not_found when PFX bytes missing', async () => {
    const r = await applyPadesManual({
      bytesWithWidget: new Uint8Array([1, 2, 3]),
      placement: { mode: 'placeholder', fieldName: 'X' },
      certEntry: makeEntry(),
      certPfxBytes: null,
      certPassword: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('cert_handle_not_found');
  });

  it("returns engine_not_available when forge isn't installed (Wave 16)", async () => {
    const r = await applyPadesManual({
      bytesWithWidget: new Uint8Array([1, 2, 3, 4]),
      placement: { mode: 'placeholder', fieldName: 'X' },
      certEntry: makeEntry(),
      certPfxBytes: Buffer.from('pfx'),
      certPassword: Buffer.from('pwd'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('engine_not_available');
      // Either the dynamic-import-failed path OR the staged-body path.
      expect(r.message.toLowerCase()).toMatch(/wave 17|signpdf|manual/);
    }
  });
});
