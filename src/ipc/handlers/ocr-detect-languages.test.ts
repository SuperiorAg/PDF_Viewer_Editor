// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { LanguagePackManager } from '../../main/pdf-ops/language-pack-manager.js';

import { handleOcrDetectLanguages } from './ocr-detect-languages.js';

function makeMgr(installed: number, downloadable: number): LanguagePackManager {
  return {
    async list() {
      return {
        installed: Array.from({ length: installed }).map((_, i) => ({
          lang: `l${i}`,
          displayName: `Lang ${i}`,
          source: i === 0 ? ('bundled' as const) : ('downloaded' as const),
          filePath: `/p/${i}`, // MUST NOT appear in renderer DTO
          sizeBytes: 100 + i,
          sha256: 'x'.repeat(64),
          installedAt: 1000,
          lastUsedAt: null,
        })),
        downloadable: Array.from({ length: downloadable }).map((_, i) => ({
          lang: `d${i}`,
          displayName: `Dl ${i}`,
          sizeBytes: 200,
          sha256: 'y'.repeat(64),
        })),
      };
    },
    resolve: () => null,
    download: async () => {
      throw new Error('unused');
    },
    remove: async () => {
      throw new Error('unused');
    },
    touchLastUsed: () => undefined,
    catalogEntry: () => null,
    getCatalog: () => ({ version: 'test', baseUrl: '', packs: [] }),
  };
}

describe('handleOcrDetectLanguages (api-contracts.md §16.1)', () => {
  it('rejects unknown extra keys (strict zod)', async () => {
    const r = await handleOcrDetectLanguages(
      { unexpected: 'field' },
      {
        languagePackManager: makeMgr(0, 0),
        getSetting: () => null,
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('catalog_load_failed');
  });

  it('returns installed + downloadable from the manager', async () => {
    const r = await handleOcrDetectLanguages(
      {},
      {
        languagePackManager: makeMgr(2, 3),
        getSetting: () => null,
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.installed).toHaveLength(2);
      expect(r.value.downloadable).toHaveLength(3);
      expect(r.value.defaultLang).toBe('eng'); // no setting → default
    }
  });

  it('strips filePath from the renderer-facing DTO (conventions §16.2)', async () => {
    const r = await handleOcrDetectLanguages(
      {},
      {
        languagePackManager: makeMgr(1, 0),
        getSetting: () => null,
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const pack = r.value.installed[0]!;
      expect((pack as unknown as { filePath?: string }).filePath).toBeUndefined();
      expect(pack).toHaveProperty('lang');
      expect(pack).toHaveProperty('source');
      expect(pack).toHaveProperty('sha256');
    }
  });

  it('respects the ocr.defaultLang setting', async () => {
    const r = await handleOcrDetectLanguages(
      {},
      {
        languagePackManager: makeMgr(0, 0),
        getSetting: (k) => (k === 'ocr.defaultLang' ? ('spa' as unknown as never) : null),
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.defaultLang).toBe('spa');
  });

  it('returns catalog_load_failed when manager throws', async () => {
    const mgr: LanguagePackManager = {
      async list() {
        throw new Error('disk-read-fail');
      },
      resolve: () => null,
      download: async () => {
        throw new Error('unused');
      },
      remove: async () => {
        throw new Error('unused');
      },
      touchLastUsed: () => undefined,
      catalogEntry: () => null,
      getCatalog: () => ({ version: 'test', baseUrl: '', packs: [] }),
    };
    const r = await handleOcrDetectLanguages(
      {},
      { languagePackManager: mgr, getSetting: () => null },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('catalog_load_failed');
  });
});
