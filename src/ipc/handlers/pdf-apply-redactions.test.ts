// pdf:applyRedactions handler unit tests (Phase 7.4 B1, Riley §7.1).
//
// Scope:
//   - zod payload-boundary errors (invalid_payload)
//   - handle resolution (handle_not_found)
//   - empty-redactions guard (no_redactions)
//   - PAdES gate (signed_pdf_requires_confirm) — Riley §5.2
//   - PAdES backref call on success (Riley §5.3)
//   - engine error mapping (page_out_of_range, rect_invalid, rasterize_failed,
//     engine_failed, output_too_large)
//
// The engine itself is unit-tested in redact-engine.test.ts; here we mock it
// so the handler-level invariants stay isolated.

import { PDFDocument, PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import { fail, ok } from '../../shared/result.js';
import type { PdfApplyRedactionsRequest, PdfApplyRedactionsResponse } from '../contracts.js';

import { handlePdfApplyRedactions, type PdfApplyRedactionsDeps } from './pdf-apply-redactions.js';

// ============================================================================
// Synthetic source builders
// ============================================================================

async function buildPlainPdf(pageTexts: string[] = ['ok']): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const _text of pageTexts) {
    doc.addPage([612, 792]);
  }
  return doc.save();
}

/**
 * Build a PDF that carries a PAdES-shaped /Sig widget with a non-empty
 * /V /Contents (the detector's positive-match shape). Mirrors the synthetic
 * shape `detectPriorPadesSignatures` recognises.
 */
async function buildSignedPdf(fieldName: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const ctx = doc.context;
  // Inline signature /V dict with placeholder /Contents (>2 chars).
  const fakeContents = '0'.repeat(64);
  const sigValueDict = ctx.obj({
    Type: PDFName.of('Sig'),
    Filter: PDFName.of('Adobe.PPKLite'),
    SubFilter: PDFName.of('adbe.pkcs7.detached'),
    Contents: PDFHexString.of(fakeContents),
    ByteRange: ctx.obj([0, 100, 200, 300]),
  });
  const sigValueRef = ctx.register(sigValueDict);

  // /Sig widget field — referenced by /AcroForm/Fields and an empty page
  // annotation list (the detector reads from form.getFields()).
  const sigWidget = ctx.obj({
    FT: PDFName.of('Sig'),
    T: PDFString.of(fieldName),
    V: sigValueRef,
    Kids: ctx.obj([]),
    P: doc.getPage(0).ref,
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    Rect: ctx.obj([0, 0, 0, 0]),
  });
  const sigWidgetRef = ctx.register(sigWidget);

  const acroForm = ctx.obj({
    Fields: ctx.obj([sigWidgetRef]),
    SigFlags: 3,
  });
  doc.catalog.set(PDFName.of('AcroForm'), acroForm);

  return doc.save();
}

// ============================================================================
// Dep builders
// ============================================================================

const ONE_BY_ONE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x00, 0x00, 0x00, 0x00, 0x3b, 0x7e, 0x9b,
  0x55, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

interface HarnessOptions {
  bytes: Uint8Array;
  docHash?: string;
  engineOverride?: PdfApplyRedactionsDeps['engine'];
  signatureAuditRedaction?: PdfApplyRedactionsDeps['signatureAuditRedaction'];
}

function buildDeps(opts: HarnessOptions): PdfApplyRedactionsDeps & {
  capturedSetBytes: Array<Uint8Array>;
  capturedAuditCalls: Array<{ docHash: string; fields: string[] }>;
} {
  const capturedSetBytes: Uint8Array[] = [];
  const capturedAuditCalls: Array<{ docHash: string; fields: string[] }> = [];
  const auditBridge =
    opts.signatureAuditRedaction === undefined
      ? {
          markInvalidatedByRedaction(docHash: string, fields: string[]): number {
            capturedAuditCalls.push({ docHash, fields });
            return fields.length;
          },
        }
      : opts.signatureAuditRedaction;

  return {
    capturedSetBytes,
    capturedAuditCalls,
    getBytes: () => opts.bytes,
    setBytes: (_h, b) => {
      capturedSetBytes.push(b);
    },
    getDocHash: () => opts.docHash ?? 'doc-hash-123',
    rasterizePageByHandle: async () => ONE_BY_ONE_PNG,
    drawBlackRectsOnPng: async (png) => png,
    ...(opts.engineOverride !== undefined ? { engine: opts.engineOverride } : {}),
    signatureAuditRedaction: auditBridge,
    defaultRasterDpi: 200,
    now: () => 1_734_220_800_000,
  };
}

function expectErr(
  res: PdfApplyRedactionsResponse,
  err: string,
): { error: string; message: string; details?: Record<string, unknown> } {
  if (res.ok) throw new Error(`expected ${err}, got ok`);
  expect(res.error).toBe(err);
  return res;
}

// ============================================================================
// Tests
// ============================================================================

describe('handlePdfApplyRedactions', () => {
  describe('payload validation', () => {
    it('returns invalid_payload on missing handle', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      const res = await handlePdfApplyRedactions(
        { redactions: [{ pageIndex: 0, x: 0, y: 0, width: 50, height: 50 }] },
        deps,
      );
      expectErr(res, 'invalid_payload');
    });

    it('returns invalid_payload on non-array redactions', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      const res = await handlePdfApplyRedactions({ handle: 1, redactions: 'nope' }, deps);
      expectErr(res, 'invalid_payload');
    });

    it('returns invalid_payload on extra keys (strict)', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      const res = await handlePdfApplyRedactions(
        {
          handle: 1,
          redactions: [{ pageIndex: 0, x: 0, y: 0, width: 50, height: 50 }],
          extraKey: 'reject',
        },
        deps,
      );
      expectErr(res, 'invalid_payload');
    });

    it('returns invalid_payload on negative pageIndex', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      const res = await handlePdfApplyRedactions(
        { handle: 1, redactions: [{ pageIndex: -1, x: 0, y: 0, width: 50, height: 50 }] },
        deps,
      );
      expectErr(res, 'invalid_payload');
    });
  });

  describe('handle resolution', () => {
    it('returns handle_not_found when getBytes returns null', async () => {
      const deps = buildDeps({ bytes: new Uint8Array() });
      deps.getBytes = () => null;
      const res = await handlePdfApplyRedactions(
        { handle: 1, redactions: [{ pageIndex: 0, x: 0, y: 0, width: 50, height: 50 }] },
        deps,
      );
      expectErr(res, 'handle_not_found');
    });
  });

  describe('empty redactions', () => {
    it('returns no_redactions on empty redactions[]', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      const res = await handlePdfApplyRedactions({ handle: 1, redactions: [] }, deps);
      expectErr(res, 'no_redactions');
    });
  });

  describe('PAdES gate (Riley §5.2)', () => {
    it('returns signed_pdf_requires_confirm when signatures present + no confirm flag', async () => {
      const bytes = await buildSignedPdf('SigField1');
      const deps = buildDeps({ bytes });
      // The engine must NOT be called.
      let engineCalled = false;
      deps.engine = async () => {
        engineCalled = true;
        return ok({ bytes: new Uint8Array(), pagesRedacted: 0, rectsApplied: 0, warnings: [] });
      };
      const res = await handlePdfApplyRedactions(
        { handle: 1, redactions: [{ pageIndex: 0, x: 0, y: 0, width: 50, height: 50 }] },
        deps,
      );
      const err = expectErr(res, 'signed_pdf_requires_confirm');
      expect(engineCalled).toBe(false);
      expect((err.details as { fields: string[] }).fields).toEqual(['SigField1']);
    });

    it('proceeds when signatures present + confirm flag is true', async () => {
      const bytes = await buildSignedPdf('SigField1');
      const deps = buildDeps({ bytes });
      let engineCalled = false;
      deps.engine = async () => {
        engineCalled = true;
        return ok({
          bytes: new Uint8Array([1, 2, 3]),
          pagesRedacted: 1,
          rectsApplied: 1,
          warnings: [],
        });
      };
      const res = await handlePdfApplyRedactions(
        {
          handle: 1,
          redactions: [{ pageIndex: 0, x: 0, y: 0, width: 50, height: 50 }],
          invalidatesSignaturesConfirmed: true,
        },
        deps,
      );
      expect(res.ok).toBe(true);
      expect(engineCalled).toBe(true);
      if (res.ok) {
        expect(res.value.invalidatedSignatures).toBe(true);
        expect(res.value.invalidatedSignatureFields).toEqual(['SigField1']);
      }
    });

    it('proceeds on unsigned doc without confirm flag (no PAdES present)', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      deps.engine = async () =>
        ok({
          bytes: new Uint8Array([1, 2, 3]),
          pagesRedacted: 1,
          rectsApplied: 1,
          warnings: [],
        });
      const res = await handlePdfApplyRedactions(
        { handle: 1, redactions: [{ pageIndex: 0, x: 0, y: 0, width: 50, height: 50 }] },
        deps,
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.invalidatedSignatures).toBe(false);
        expect(res.value.invalidatedSignatureFields).toEqual([]);
      }
    });
  });

  describe('audit-log backref (Riley §5.3)', () => {
    it('calls signatureAuditRedaction.markInvalidatedByRedaction on signed doc Apply', async () => {
      const bytes = await buildSignedPdf('Sig1');
      const deps = buildDeps({ bytes, docHash: 'doc-hash-abc' });
      deps.engine = async () =>
        ok({
          bytes: new Uint8Array([9, 9]),
          pagesRedacted: 1,
          rectsApplied: 1,
          warnings: [],
        });
      const res = await handlePdfApplyRedactions(
        {
          handle: 1,
          redactions: [{ pageIndex: 0, x: 0, y: 0, width: 50, height: 50 }],
          invalidatesSignaturesConfirmed: true,
        },
        deps,
      );
      expect(res.ok).toBe(true);
      expect(deps.capturedAuditCalls.length).toBe(1);
      expect(deps.capturedAuditCalls[0]!.docHash).toBe('doc-hash-abc');
      expect(deps.capturedAuditCalls[0]!.fields).toEqual(['Sig1']);
    });

    it('does NOT call the bridge on unsigned-doc Apply', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      deps.engine = async () =>
        ok({
          bytes: new Uint8Array([1, 2]),
          pagesRedacted: 1,
          rectsApplied: 1,
          warnings: [],
        });
      const res = await handlePdfApplyRedactions(
        { handle: 1, redactions: [{ pageIndex: 0, x: 0, y: 0, width: 50, height: 50 }] },
        deps,
      );
      expect(res.ok).toBe(true);
      expect(deps.capturedAuditCalls.length).toBe(0);
    });

    it('tolerates bridge==null (parallel-wave skew)', async () => {
      const bytes = await buildSignedPdf('Sig1');
      const deps = buildDeps({ bytes, signatureAuditRedaction: null });
      deps.engine = async () =>
        ok({
          bytes: new Uint8Array([1, 2]),
          pagesRedacted: 1,
          rectsApplied: 1,
          warnings: [],
        });
      const res = await handlePdfApplyRedactions(
        {
          handle: 1,
          redactions: [{ pageIndex: 0, x: 0, y: 0, width: 50, height: 50 }],
          invalidatesSignaturesConfirmed: true,
        },
        deps,
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        // The handler still reports invalidatedSignatures=true and the
        // field list — the bridge's absence only affects DB persistence.
        expect(res.value.invalidatedSignatures).toBe(true);
        expect(res.value.invalidatedSignatureFields).toEqual(['Sig1']);
      }
    });

    it('tolerates bridge.markInvalidatedByRedaction throwing', async () => {
      const bytes = await buildSignedPdf('Sig1');
      const deps = buildDeps({
        bytes,
        signatureAuditRedaction: {
          markInvalidatedByRedaction() {
            throw new Error('synthetic DB failure');
          },
        },
      });
      deps.engine = async () =>
        ok({
          bytes: new Uint8Array([1]),
          pagesRedacted: 1,
          rectsApplied: 1,
          warnings: [],
        });
      const res = await handlePdfApplyRedactions(
        {
          handle: 1,
          redactions: [{ pageIndex: 0, x: 0, y: 0, width: 50, height: 50 }],
          invalidatesSignaturesConfirmed: true,
        },
        deps,
      );
      // Best-effort: handler still returns ok.
      expect(res.ok).toBe(true);
    });
  });

  describe('engine error mapping', () => {
    it('maps engine page_out_of_range → handler page_out_of_range', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      deps.engine = async () => fail('page_out_of_range', 'pi 5 >= 1');
      const res = await handlePdfApplyRedactions(
        { handle: 1, redactions: [{ pageIndex: 5, x: 0, y: 0, width: 10, height: 10 }] },
        deps,
      );
      expectErr(res, 'page_out_of_range');
    });

    it('maps engine rect_invalid → handler rect_invalid', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      deps.engine = async () => fail('rect_invalid', 'zero area');
      const res = await handlePdfApplyRedactions(
        { handle: 1, redactions: [{ pageIndex: 0, x: 0, y: 0, width: 0, height: 0 }] },
        deps,
      );
      expectErr(res, 'rect_invalid');
    });

    it('maps engine rasterize_failed → handler rasterize_failed', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      deps.engine = async () => fail('rasterize_failed', 'pdfjs threw');
      const res = await handlePdfApplyRedactions(
        { handle: 1, redactions: [{ pageIndex: 0, x: 0, y: 0, width: 10, height: 10 }] },
        deps,
      );
      expectErr(res, 'rasterize_failed');
    });

    it('maps engine output_too_large → handler output_too_large', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      deps.engine = async () => fail('output_too_large', '300 MB');
      const res = await handlePdfApplyRedactions(
        { handle: 1, redactions: [{ pageIndex: 0, x: 0, y: 0, width: 10, height: 10 }] },
        deps,
      );
      expectErr(res, 'output_too_large');
    });

    it('maps engine engine_failed → handler engine_failed', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      deps.engine = async () => fail('engine_failed', 'oops');
      const res = await handlePdfApplyRedactions(
        { handle: 1, redactions: [{ pageIndex: 0, x: 0, y: 0, width: 10, height: 10 }] },
        deps,
      );
      expectErr(res, 'engine_failed');
    });

    it('wraps engine THROW (not fail) as engine_failed', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      deps.engine = async () => {
        throw new Error('boom');
      };
      const res = await handlePdfApplyRedactions(
        { handle: 1, redactions: [{ pageIndex: 0, x: 0, y: 0, width: 10, height: 10 }] },
        deps,
      );
      expectErr(res, 'engine_failed');
    });
  });

  describe('success path', () => {
    it('updates document-store bytes + returns value', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      const outBytes = new Uint8Array([7, 7, 7]);
      deps.engine = async () =>
        ok({
          bytes: outBytes,
          pagesRedacted: 1,
          rectsApplied: 1,
          warnings: ['Re-run OCR'],
        });
      const req: PdfApplyRedactionsRequest = {
        handle: 1,
        redactions: [{ pageIndex: 0, x: 0, y: 0, width: 50, height: 50 }],
      };
      const res = await handlePdfApplyRedactions(req, deps);
      expect(res.ok).toBe(true);
      expect(deps.capturedSetBytes.length).toBe(1);
      expect(deps.capturedSetBytes[0]).toBe(outBytes);
      if (res.ok) {
        expect(res.value.bytes).toBe(outBytes);
        expect(res.value.pagesRedacted).toBe(1);
        expect(res.value.rectsApplied).toBe(1);
        expect(res.value.warnings).toEqual(['Re-run OCR']);
      }
    });

    it('forwards request.rasterDpi to the engine', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      const seen = vi.fn();
      deps.engine = async (opts) => {
        seen(opts.rasterDpi);
        return ok({
          bytes: new Uint8Array(),
          pagesRedacted: 0,
          rectsApplied: 0,
          warnings: [],
        });
      };
      await handlePdfApplyRedactions(
        {
          handle: 1,
          redactions: [{ pageIndex: 0, x: 0, y: 0, width: 50, height: 50 }],
          rasterDpi: 144,
        },
        deps,
      );
      expect(seen).toHaveBeenCalledWith(144);
    });

    it('falls back to defaultRasterDpi when rasterDpi omitted', async () => {
      const bytes = await buildPlainPdf();
      const deps = buildDeps({ bytes });
      deps.defaultRasterDpi = 250;
      const seen = vi.fn();
      deps.engine = async (opts) => {
        seen(opts.rasterDpi);
        return ok({
          bytes: new Uint8Array(),
          pagesRedacted: 0,
          rectsApplied: 0,
          warnings: [],
        });
      };
      await handlePdfApplyRedactions(
        { handle: 1, redactions: [{ pageIndex: 0, x: 0, y: 0, width: 50, height: 50 }] },
        deps,
      );
      expect(seen).toHaveBeenCalledWith(250);
    });
  });

  describe('pdf_load_failed', () => {
    it('returns pdf_load_failed on garbage bytes (PAdES probe load fails)', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const deps = buildDeps({ bytes });
      const res = await handlePdfApplyRedactions(
        { handle: 1, redactions: [{ pageIndex: 0, x: 0, y: 0, width: 10, height: 10 }] },
        deps,
      );
      expectErr(res, 'pdf_load_failed');
    });
  });
});

// Keep PDFDict reference alive (used implicitly via the synthetic builder).
void PDFDict;
