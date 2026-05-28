// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, beforeEach } from 'vitest';

import type { LanguagePackManager } from '../../main/pdf-ops/language-pack-manager.js';
import {
  createOcrWorkerPool,
  type OcrWorkerPool,
  type TesseractWorkerFactory,
} from '../../main/pdf-ops/ocr-engine.js';

import { handleOcrRunOnDocument } from './ocr-run-on-document.js';

function makeMgr(installed: string[]): LanguagePackManager {
  return {
    async list() {
      return { installed: [], downloadable: [] };
    },
    resolve: (l) => (installed.includes(l) ? `/p/${l}` : null),
    download: async () => {
      throw new Error('not used');
    },
    remove: async () => {
      throw new Error('not used');
    },
    touchLastUsed: () => undefined,
    catalogEntry: () => null,
    getCatalog: () => ({ version: 'test', baseUrl: '', packs: [] }),
  };
}

function makePool(): OcrWorkerPool {
  const factory: TesseractWorkerFactory = {
    async create() {
      return {
        async recognize() {
          return {
            words: [
              { text: 'word1', confidence: 80, bbox: { x0: 10, y0: 10, x1: 50, y1: 30 } },
              { text: 'word2', confidence: 50, bbox: { x0: 60, y0: 10, x1: 100, y1: 30 } },
            ],
            imageWidthPx: 800,
            imageHeightPx: 1000,
          };
        },
        async terminate() {
          // no-op
        },
      };
    },
  };
  return createOcrWorkerPool({
    workerFactory: factory,
    languagePackManager: makeMgr(['eng']),
    maxConcurrentLanguages: 4,
  });
}

async function makeBlankPdfBytes(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([612, 792]);
  return await doc.save();
}

function baseDeps(opts?: {
  bytes?: Uint8Array;
  pageCount?: number;
  ocrJobsCalls?: unknown[];
  signedFields?: string[];
  signatureAuditCalls?: unknown[];
}) {
  const bytesPromise = opts?.bytes ? Promise.resolve(opts.bytes) : makeBlankPdfBytes(2);
  return async (): Promise<Parameters<typeof handleOcrRunOnDocument>[1]> => {
    const bytes = await bytesPromise;
    const ocrJobsCalls: unknown[] = opts?.ocrJobsCalls ?? [];
    const ocrResultsCalls: unknown[] = [];
    const signatureAuditCalls = opts?.signatureAuditCalls ?? [];
    return {
      ocrPool: makePool(),
      languagePackManager: makeMgr(['eng']),
      rasterizePage: async () => new Uint8Array([0xa, 0xb, 0xc]),
      pageDimensions: async () => ({ widthPts: 612, heightPts: 792 }),
      composeSearchablePdf: async (orig) => new Uint8Array([...orig, 0xfe, 0xfe]),
      getBytes: () => bytes,
      getPageCount: () => opts?.pageCount ?? 2,
      getDocHash: () => 'a'.repeat(64),
      setBytes: () => undefined,
      ocrJobsRepo: {
        insert: (row) => {
          ocrJobsCalls.push({ kind: 'insert', row });
          return 7;
        },
        updateStatus: (id, update) => {
          ocrJobsCalls.push({ kind: 'updateStatus', id, update });
          return true;
        },
      },
      ocrResultsRepo: {
        insert: (row) => {
          ocrResultsCalls.push(row);
          return ocrResultsCalls.length;
        },
      },
      signatureAudit: {
        markInvalidatedByOcrJob: (h, fields, jobId) => {
          signatureAuditCalls.push({ h, fields, jobId });
          return fields.length;
        },
      },
      watchdogMs: 5000,
      rasterDpi: 300,
      emitProgress: () => undefined,
    };
  };
}

describe('handleOcrRunOnDocument (api-contracts.md §16.3)', () => {
  beforeEach(() => {
    globalThis.__pdfvOcrActiveJobs?.clear();
  });

  it('rejects invalid payload', async () => {
    const deps = await baseDeps()();
    const r = await handleOcrRunOnDocument({}, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects lang code shape that fails the regex', async () => {
    const deps = await baseDeps()();
    const r = await handleOcrRunOnDocument(
      {
        handle: 1,
        pageRange: { start: 0, end: 1 },
        langs: ['XX!'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects when handle is missing in document store', async () => {
    const deps = await baseDeps()();
    deps.getBytes = () => null;
    const r = await handleOcrRunOnDocument(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('handle_not_found');
  });

  it('rejects page_range_out_of_range when start > end', async () => {
    const deps = await baseDeps()();
    const r = await handleOcrRunOnDocument(
      {
        handle: 1,
        pageRange: { start: 5, end: 1 },
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('page_range_out_of_range');
  });

  it('rejects page_range_out_of_range when end >= pageCount', async () => {
    const deps = await baseDeps({ pageCount: 2 })();
    const r = await handleOcrRunOnDocument(
      {
        handle: 1,
        pageRange: { start: 0, end: 99 },
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('page_range_out_of_range');
  });

  it('rejects language_pack_not_installed', async () => {
    const deps = await baseDeps()();
    deps.languagePackManager = makeMgr([]); // no langs installed
    const r = await handleOcrRunOnDocument(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('language_pack_not_installed');
  });

  it('happy path: returns op with kind=ocr-text-behind-applied + summary', async () => {
    const calls: unknown[] = [];
    const deps = await baseDeps({ ocrJobsCalls: calls })();
    const r = await handleOcrRunOnDocument(
      {
        handle: 1,
        pageRange: { start: 0, end: 1 },
        langs: ['eng'],
        preprocess: { deskew: true, denoise: false, contrastBoost: false },
      },
      deps,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.op.kind).toBe('ocr-text-behind-applied');
      if (r.value.op.kind === 'ocr-text-behind-applied') {
        expect(r.value.op.pageRange).toEqual({ start: 0, end: 1 });
        expect(r.value.op.langs).toEqual(['eng']);
        expect(r.value.op.invalidatesSignatures).toBe(false);
        expect(r.value.op.totalWordsRecognized).toBe(4); // 2 words × 2 pages
      }
      expect(r.value.summary.status).toBe('completed');
      expect(r.value.summary.pageResults).not.toBeNull();
    }
    // ocrJobsRepo inserted + updated.
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('PAdES pre-flight: doc with prior PAdES + no confirm returns signed_pdf_requires_confirm', async () => {
    // Construct a doc with a /Sig field containing /V /Contents > 2 chars.
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const form = doc.getForm();
    const sig = form.createTextField('Signature1');
    sig.addToPage(doc.getPage(0), { x: 50, y: 50, width: 100, height: 30 });
    // Override the field type so detectPriorPadesSignatures sees /FT Sig.
    // pdf-lib doesn't expose a direct createSignatureField; we mutate the
    // acroField dict to /FT /Sig + add a /V dict with /Contents.
    const { PDFName, PDFHexString } = await import('pdf-lib');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const acro: any = (sig as unknown as { acroField: { dict: unknown } }).acroField;
    // Force type /Sig
    acro.dict.set(PDFName.of('FT'), PDFName.of('Sig'));
    // Add /V dict with /Contents hex string
    const vDict = doc.context.obj({
      Contents: PDFHexString.of('aabbccdd'.repeat(4)), // > 2 chars
    });
    acro.dict.set(PDFName.of('V'), vDict);
    // Save and reload so the field is fully baked into the bytes.
    const signedBytes = await doc.save();

    const deps = await baseDeps({ bytes: signedBytes })();
    const r = await handleOcrRunOnDocument(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
        // NO invalidatesSignaturesConfirmed → should reject.
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('signed_pdf_requires_confirm');
      expect(r.details?.fields).toBeDefined();
    }
  });

  it('PAdES with confirm=true proceeds and the op carries invalidatesSignatures=true', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const form = doc.getForm();
    const sig = form.createTextField('Signature1');
    sig.addToPage(doc.getPage(0), { x: 50, y: 50, width: 100, height: 30 });
    const { PDFName, PDFHexString } = await import('pdf-lib');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const acro: any = (sig as unknown as { acroField: { dict: unknown } }).acroField;
    acro.dict.set(PDFName.of('FT'), PDFName.of('Sig'));
    const vDict = doc.context.obj({
      Contents: PDFHexString.of('aabbccdd'.repeat(4)),
    });
    acro.dict.set(PDFName.of('V'), vDict);
    const signedBytes = await doc.save();

    const auditCalls: unknown[] = [];
    const deps = await baseDeps({ bytes: signedBytes, signatureAuditCalls: auditCalls })();
    const r = await handleOcrRunOnDocument(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
        invalidatesSignaturesConfirmed: true,
      },
      deps,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.op.kind).toBe('ocr-text-behind-applied');
      if (r.value.op.kind === 'ocr-text-behind-applied') {
        expect(r.value.op.invalidatesSignatures).toBe(true);
      }
    }
    // signature audit was updated with the OCR job ID.
    expect(auditCalls.length).toBe(1);
    expect((auditCalls[0] as { fields: string[] }).fields).toEqual(['Signature1']);
  });

  it('records job state on failure (mean_confidence + total_words NOT set; error_message set)', async () => {
    const calls: unknown[] = [];
    const deps = await baseDeps({ ocrJobsCalls: calls })();
    deps.composeSearchablePdf = async () => {
      throw new Error('synthetic-compose-fail');
    };
    const r = await handleOcrRunOnDocument(
      {
        handle: 1,
        pageRange: { start: 0, end: 0 },
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('output_serialize_failed');
    // ocrJobsRepo updateStatus was called with a non-completed status.
    const update = calls.find(
      (c) =>
        typeof c === 'object' &&
        c !== null &&
        'kind' in c &&
        (c as { kind: string }).kind === 'updateStatus',
    ) as { kind: string; update: { status: string; error_message?: string } } | undefined;
    expect(update?.update.status).toBe('failed');
    expect(update?.update.error_message).toBeDefined();
  });
});
