// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { LanguagePackManager } from '../../main/pdf-ops/language-pack-manager.js';
import {
  createOcrWorkerPool,
  type OcrWorkerPool,
  type TesseractWorkerFactory,
} from '../../main/pdf-ops/ocr-engine.js';

import { handleOcrRunOnPage } from './ocr-run-on-page.js';

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
              { text: 'page-word', confidence: 88, bbox: { x0: 10, y0: 10, x1: 50, y1: 30 } },
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

async function makeBlankBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  return await doc.save();
}

function baseDeps() {
  return async (): Promise<Parameters<typeof handleOcrRunOnPage>[1]> => {
    const bytes = await makeBlankBytes();
    return {
      ocrPool: makePool(),
      languagePackManager: makeMgr(['eng']),
      rasterizePage: async () => new Uint8Array([0xa]),
      getBytes: () => bytes,
      getPageCount: () => 2,
      pageDimensions: async () => ({ widthPts: 612, heightPts: 792 }),
      watchdogMs: 5000,
      rasterDpi: 300,
    };
  };
}

describe('handleOcrRunOnPage (api-contracts.md §16.2)', () => {
  it('rejects invalid payload', async () => {
    const deps = await baseDeps()();
    const r = await handleOcrRunOnPage({ handle: 'x', pageIndex: 0 }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects page_out_of_range', async () => {
    const deps = await baseDeps()();
    const r = await handleOcrRunOnPage(
      {
        handle: 1,
        pageIndex: 99,
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('page_out_of_range');
  });

  it('rejects handle_not_found when bytes is null', async () => {
    const deps = await baseDeps()();
    deps.getBytes = () => null;
    const r = await handleOcrRunOnPage(
      {
        handle: 1,
        pageIndex: 0,
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('handle_not_found');
  });

  it('rejects language_pack_not_installed', async () => {
    const deps = await baseDeps()();
    deps.languagePackManager = makeMgr([]); // none
    const r = await handleOcrRunOnPage(
      {
        handle: 1,
        pageIndex: 0,
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('language_pack_not_installed');
  });

  it('happy path: returns pageResult with the recognized word', async () => {
    const deps = await baseDeps()();
    const r = await handleOcrRunOnPage(
      {
        handle: 1,
        pageIndex: 0,
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
      },
      deps,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pageResult.totalWords).toBe(1);
      expect(r.value.pageResult.words[0]!.text).toBe('page-word');
      expect(r.value.pageResult.pageIndex).toBe(0);
      // Nullable-late-init: pdfRect is null at engine output.
      expect(r.value.pageResult.words[0]!.pdfRect).toBeNull();
      expect(r.value.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects pdf_render_failed when rasterizer throws', async () => {
    const deps = await baseDeps()();
    deps.rasterizePage = async () => {
      throw new Error('boom');
    };
    const r = await handleOcrRunOnPage(
      {
        handle: 1,
        pageIndex: 0,
        langs: ['eng'],
        preprocess: { deskew: false, denoise: false, contrastBoost: false },
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('pdf_render_failed');
  });
});
