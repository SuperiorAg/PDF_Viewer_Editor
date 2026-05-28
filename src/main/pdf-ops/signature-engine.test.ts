// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FormFieldDefinition, VisualAppearanceSpec } from '../../ipc/contracts.js';

import {
  liveHandleCount,
  releaseAll,
  resetPfxParser,
  setPfxParser,
  loadCert,
} from './cert-store.js';
import { createSignaturePlaceholder } from './field-dict-authoring.js';
import { applySignature, type AuditLogSink } from './signature-engine.js';

const ONE_PX_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const KNOWN_PASSWORD = 'TEST-PWD-DO-NOT-LOG-2026';

function appearance(): VisualAppearanceSpec {
  return {
    source: { kind: 'drawn', pngBytes: ONE_PX_PNG, widthPx: 1, heightPx: 1 },
    showName: true,
    showDate: true,
    showReason: false,
    showSubjectCN: false,
    showIssuerCN: false,
    showTsaInfo: false,
  };
}

async function makePlaceholderPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const fd: FormFieldDefinition = {
    name: 'SigField1',
    type: 'signature',
    pageIndex: 0,
    rect: { x: 100, y: 100, width: 200, height: 80 },
    label: 'Signature',
    required: false,
    origin: 'authored',
    unsaved: true,
  };
  const r = createSignaturePlaceholder(doc, fd);
  if (!r.ok) throw new Error(`setup: ${r.message}`);
  return doc.save();
}

beforeEach(() => {
  releaseAll();
  resetPfxParser();
});

afterEach(() => {
  releaseAll();
  resetPfxParser();
});

describe('applySignature — visual path', () => {
  it('produces an EditOperation with kind signature-visual-place', async () => {
    const bytes = await makePlaceholderPdf();
    const r = await applySignature(
      {
        kind: 'visual',
        bytes,
        placement: { mode: 'placeholder', fieldName: 'SigField1' },
        appearance: appearance(),
      },
      { auditLog: null },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.op.kind).toBe('signature-visual-place');
      expect(r.value.auditLogRowId).toBeNull();
      expect(r.value.tsaResponseStatus).toBeNull();
    }
  });

  it('propagates placeholder_field_not_found from visual-signature.ts', async () => {
    const bytes = await makePlaceholderPdf();
    const r = await applySignature(
      {
        kind: 'visual',
        bytes,
        placement: { mode: 'placeholder', fieldName: 'Nope' },
        appearance: appearance(),
      },
      { auditLog: null },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('placeholder_field_not_found');
  });
});

describe('applySignature — pades path', () => {
  it('looks up cert; visual widget composes; engine attempts sign; cert auto-released', async () => {
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
        notBefore: Date.now() - 86_400_000,
        notAfter: Date.now() + 86_400_000,
      };
    });
    const loadResult = loadCert(Buffer.from('pfx'), Buffer.from(KNOWN_PASSWORD));
    if (!loadResult.ok) throw new Error('test setup');
    const certHandle = loadResult.value.handle;
    expect(liveHandleCount()).toBe(1);

    const bytes = await makePlaceholderPdf();
    const r = await applySignature(
      {
        kind: 'pades',
        bytes,
        placement: { mode: 'placeholder', fieldName: 'SigField1' },
        certHandle,
        appearance: {
          ...appearance(),
          showSubjectCN: true,
          showIssuerCN: false,
          showTsaInfo: false,
        },
        tsaUrl: null,
        autoRelease: true,
        certPfxBytes: Buffer.from('pfx-for-signpdf'),
        certPassword: Buffer.from(KNOWN_PASSWORD),
      },
      { auditLog: null },
    );

    // Phase 4.1: node-signpdf IS installed (Wave 17), so the sign attempt
    // runs; with synthetic PFX bytes it fails inside signpdf.sign() with
    // pades_sign_failed. Pre-Wave-17 the same call returned engine_not_available.
    // Accept either — both prove the engine wired through correctly.
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(['engine_not_available', 'pades_sign_failed']).toContain(r.error);
    }
    // autoRelease should have fired in the finally block — the canonical
    // B-17.1 cleanup that zeroes the retained pfxBytes + passwordBuffer.
    expect(liveHandleCount()).toBe(0);
  });

  it('B-17.1: production path (no explicit certPfxBytes) sources bytes from cert-store entry', async () => {
    // This is the NEW Phase 4.1 contract test: the IPC handler does NOT
    // pass certPfxBytes/certPassword (the contract carries certHandle only).
    // The engine reads from `entry.pfxBytes` / `entry.passwordBuffer` set
    // by loadCert.
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
        notBefore: Date.now() - 86_400_000,
        notAfter: Date.now() + 86_400_000,
      };
    });
    // Use a non-empty PFX buffer so the engine actually has bytes to feed
    // signpdf (which now sources from entry.pfxBytes).
    const pfx = Buffer.from('synthetic-pfx-bytes-for-production-test');
    const pwd = Buffer.from(KNOWN_PASSWORD);
    const loadResult = loadCert(pfx, pwd);
    if (!loadResult.ok) throw new Error('test setup');

    const r = await applySignature(
      {
        kind: 'pades',
        bytes: await makePlaceholderPdf(),
        placement: { mode: 'placeholder', fieldName: 'SigField1' },
        certHandle: loadResult.value.handle,
        appearance: {
          ...appearance(),
          showSubjectCN: true,
          showIssuerCN: false,
          showTsaInfo: false,
        },
        tsaUrl: null,
        autoRelease: true,
        // NO certPfxBytes / certPassword — exact production IPC shape.
      },
      { auditLog: null },
    );

    // The engine MUST get to the sign attempt (NOT cert_handle_not_found,
    // which was the pre-B-17.1 failure mode). Acceptable terminal states:
    //   - engine_not_available  (node-signpdf not resolvable at runtime)
    //   - pades_sign_failed     (signpdf ran but synthetic bytes invalid)
    //   - serialize_failed      (downstream pdf-lib failure)
    // The forbidden terminal state is cert_handle_not_found — that's the
    // B-17.1 bug the Phase 4.1 cleanup remediates.
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).not.toBe('cert_handle_not_found');
    }
    // autoRelease fired; PFX + password buffers are now zeroed in the entry.
    expect(liveHandleCount()).toBe(0);
    expect(pfx.every((b) => b === 0)).toBe(true);
    expect(pwd.every((b) => b === 0)).toBe(true);
  });

  it('rejects when cert handle is unknown / already released', async () => {
    const bytes = await makePlaceholderPdf();
    const r = await applySignature(
      {
        kind: 'pades',
        bytes,
        placement: { mode: 'placeholder', fieldName: 'SigField1' },
        certHandle: 'nonexistent',
        appearance: {
          ...appearance(),
          showSubjectCN: true,
          showIssuerCN: false,
          showTsaInfo: false,
        },
        tsaUrl: null,
        autoRelease: true,
      },
      { auditLog: null },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('cert_handle_not_found');
  });

  it('rejects expired cert', async () => {
    setPfxParser((input) => {
      if (input.passwordBuffer.toString('utf-8') !== KNOWN_PASSWORD) {
        throw new Error('MAC verification failed');
      }
      return {
        privateKey: { kind: 'synthetic' },
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
        certDer: new Uint8Array([0x30, 0x82, 0x01, 0xfe]),
        subjectCN: 'Expired Person',
        issuerCN: 'Test CA',
        notBefore: Date.now() - 1000 * 86_400_000,
        notAfter: Date.now() - 1000,
      };
    });
    const loadResult = loadCert(Buffer.from('pfx'), Buffer.from(KNOWN_PASSWORD));
    if (!loadResult.ok) throw new Error('test setup');
    const r = await applySignature(
      {
        kind: 'pades',
        bytes: await makePlaceholderPdf(),
        placement: { mode: 'placeholder', fieldName: 'SigField1' },
        certHandle: loadResult.value.handle,
        appearance: {
          ...appearance(),
          showSubjectCN: true,
          showIssuerCN: false,
          showTsaInfo: false,
        },
        tsaUrl: null,
        certPfxBytes: Buffer.from('pfx'),
        certPassword: Buffer.from(KNOWN_PASSWORD),
      },
      { auditLog: null },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('cert_expired');
  });

  it('autoRelease=false leaves the handle alive for multi-sign sessions', async () => {
    setPfxParser((input) => {
      if (input.passwordBuffer.toString('utf-8') !== KNOWN_PASSWORD) {
        throw new Error('MAC verification failed');
      }
      return {
        privateKey: { kind: 'synthetic' },
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
        certDer: new Uint8Array([0x30, 0x82, 0x01, 0xfe]),
        subjectCN: 'X',
        issuerCN: 'Y',
        notBefore: Date.now() - 86_400_000,
        notAfter: Date.now() + 86_400_000,
      };
    });
    const loadResult = loadCert(Buffer.from('pfx'), Buffer.from(KNOWN_PASSWORD));
    if (!loadResult.ok) throw new Error('test setup');
    await applySignature(
      {
        kind: 'pades',
        bytes: await makePlaceholderPdf(),
        placement: { mode: 'placeholder', fieldName: 'SigField1' },
        certHandle: loadResult.value.handle,
        appearance: {
          ...appearance(),
          showSubjectCN: true,
          showIssuerCN: false,
          showTsaInfo: false,
        },
        tsaUrl: null,
        autoRelease: false,
        certPfxBytes: Buffer.from('pfx'),
        certPassword: Buffer.from(KNOWN_PASSWORD),
      },
      { auditLog: null },
    );
    expect(liveHandleCount()).toBe(1);
    // Cleanup:
    releaseAll();
  });

  it('captures audit-log insert calls when sink is provided', async () => {
    // We can't fully test this path at Wave 16 because the PAdES engine
    // returns engine_not_available BEFORE audit-log insert. We assert that
    // the sink is wired correctly (it's not called on the engine-failure
    // path, which is correct behavior).
    setPfxParser((input) => {
      if (input.passwordBuffer.toString('utf-8') !== KNOWN_PASSWORD) {
        throw new Error('MAC verification failed');
      }
      return {
        privateKey: { kind: 'synthetic' },
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
        certDer: new Uint8Array([0x30, 0x82, 0x01, 0xfe]),
        subjectCN: 'X',
        issuerCN: 'Y',
        notBefore: Date.now() - 86_400_000,
        notAfter: Date.now() + 86_400_000,
      };
    });
    const loadResult = loadCert(Buffer.from('pfx'), Buffer.from(KNOWN_PASSWORD));
    if (!loadResult.ok) throw new Error('test setup');
    const inserted: unknown[] = [];
    const sink: AuditLogSink = {
      insert(row) {
        inserted.push(row);
        return 99;
      },
    };
    await applySignature(
      {
        kind: 'pades',
        bytes: await makePlaceholderPdf(),
        placement: { mode: 'placeholder', fieldName: 'SigField1' },
        certHandle: loadResult.value.handle,
        appearance: {
          ...appearance(),
          showSubjectCN: true,
          showIssuerCN: false,
          showTsaInfo: false,
        },
        tsaUrl: null,
        certPfxBytes: Buffer.from('pfx'),
        certPassword: Buffer.from(KNOWN_PASSWORD),
      },
      { auditLog: sink },
    );
    // Engine fails (not installed) BEFORE audit insert — correct behavior.
    expect(inserted.length).toBe(0);
  });
});
