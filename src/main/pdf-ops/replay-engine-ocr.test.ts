// @vitest-environment node
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { EditOperation } from '../../ipc/contracts.js';

import { replay } from './replay-engine.js';

// ============================================================================
// Phase 5 — replay-engine OCR + PAdES interaction
//
// Mirrors the Phase 4.1 H-17.3 abort-on-edit-after-sign pattern. The replay
// engine ABORTS with `ocr_invalidates_pades_signature` if an OCR op with
// `invalidatesSignatures: false` is fed into a doc that carries a prior
// PAdES signature.
//
// See `architecture-phase-5.md §4.8` + `ocr-engine.md §8.4`.
// ============================================================================

async function makeSignedPdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const form = doc.getForm();
  const sig = form.createTextField('SignatureExisting');
  sig.addToPage(doc.getPage(0), { x: 50, y: 50, width: 100, height: 30 });
  // Mutate the acroField to /FT Sig + /V with non-empty Contents.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acro: any = (sig as unknown as { acroField: { dict: unknown } }).acroField;
  acro.dict.set(PDFName.of('FT'), PDFName.of('Sig'));
  const vDict = doc.context.obj({
    Contents: PDFHexString.of('aabbccdd'.repeat(16)),
  });
  acro.dict.set(PDFName.of('V'), vDict);
  return await doc.save();
}

async function makeUnsignedPdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return await doc.save();
}

describe('replay-engine + OCR PAdES discipline (Phase 5)', () => {
  it('replays an OCR op WITHOUT a PAdES signature without aborting', async () => {
    const bytes = await makeUnsignedPdfBytes();
    const ops: EditOperation[] = [
      {
        kind: 'ocr-text-behind-applied',
        meta: { ts: Date.now(), undoable: true, operationId: 'op-1' },
        jobId: 1,
        pageRange: { start: 0, end: 0 },
        langs: ['eng'],
        meanConfidence: 80,
        totalWordsRecognized: 5,
        invalidatesSignatures: false,
      },
    ];
    const r = await replay({
      originalBytes: bytes,
      ops,
      annotations: [],
      jobId: 'test-job',
    });
    expect(r.ok).toBe(true);
  });

  it('ABORTS with ocr_invalidates_pades_signature when prior PAdES + invalidatesSignatures:false', async () => {
    const bytes = await makeSignedPdfBytes();
    const ops: EditOperation[] = [
      {
        kind: 'ocr-text-behind-applied',
        meta: { ts: Date.now(), undoable: true, operationId: 'op-1' },
        jobId: 5,
        pageRange: { start: 0, end: 0 },
        langs: ['eng'],
        meanConfidence: 80,
        totalWordsRecognized: 5,
        invalidatesSignatures: false, // CLAIMS no invalidation — but doc HAS a sig
      },
    ];
    const r = await replay({
      originalBytes: bytes,
      ops,
      annotations: [],
      jobId: 'test-job',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('ocr_invalidates_pades_signature');
      expect(r.message).toMatch(/job #5/);
    }
  });

  it('PASSES when prior PAdES + invalidatesSignatures:true (user confirmed at modal)', async () => {
    const bytes = await makeSignedPdfBytes();
    const ops: EditOperation[] = [
      {
        kind: 'ocr-text-behind-applied',
        meta: { ts: Date.now(), undoable: true, operationId: 'op-1' },
        jobId: 7,
        pageRange: { start: 0, end: 0 },
        langs: ['eng'],
        meanConfidence: 80,
        totalWordsRecognized: 5,
        invalidatesSignatures: true, // ACKNOWLEDGED at modal time
      },
    ];
    const r = await replay({
      originalBytes: bytes,
      ops,
      annotations: [],
      jobId: 'test-job',
    });
    expect(r.ok).toBe(true);
  });

  it('ABORTS with pades_invalidated_by_subsequent_edit when PAdES sign followed by OCR op', async () => {
    // Phase 4 H-17.3 discipline still applies — and Phase 5 extends the
    // mutator-detection list to INCLUDE ocr-text-behind-applied. So an op
    // sequence of [PAdES-sign, OCR] aborts.
    const bytes = await makeUnsignedPdfBytes();
    const ops: EditOperation[] = [
      {
        kind: 'signature-pades-applied',
        meta: { ts: Date.now(), undoable: true, operationId: 'sign-1' },
        placement: { mode: 'placeholder', fieldName: 'Sig1' },
        certFingerprint: 'a'.repeat(64),
        signerSubjectCN: 'CN=Test',
        signerIssuerCN: 'CN=CA',
        signedAt: Date.now(),
        tsaUrl: null,
        auditLogRowId: 1,
        placeholderFieldName: 'Sig1',
      },
      {
        kind: 'ocr-text-behind-applied',
        meta: { ts: Date.now(), undoable: true, operationId: 'op-1' },
        jobId: 9,
        pageRange: { start: 0, end: 0 },
        langs: ['eng'],
        meanConfidence: 80,
        totalWordsRecognized: 5,
        invalidatesSignatures: false,
      },
    ];
    const r = await replay({
      originalBytes: bytes,
      ops,
      annotations: [],
      jobId: 'test-job',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Detected at the Phase 4 mutator-check (the PAdES sign happened
      // FIRST; the subsequent OCR op is now a mutator).
      expect(r.error).toBe('pades_invalidated_by_subsequent_edit');
    }
  });

  it('inverse op ocr-text-behind-removed is recognized in the per-op fold', async () => {
    const bytes = await makeUnsignedPdfBytes();
    const ops: EditOperation[] = [
      {
        kind: 'ocr-text-behind-removed',
        meta: { ts: Date.now(), undoable: true, operationId: 'op-undo' },
        before: {
          jobId: 1,
          pageRange: { start: 0, end: 0 },
          langs: ['eng'],
          meanConfidence: 80,
          totalWordsRecognized: 5,
        },
      },
    ];
    const r = await replay({
      originalBytes: bytes,
      ops,
      annotations: [],
      jobId: 'test-job-undo',
    });
    expect(r.ok).toBe(true);
  });
});
