// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type {
  LanguagePackManager,
  LanguagePackRecord,
} from '../../main/pdf-ops/language-pack-manager.js';

import { handleOcrLanguagePackDownload } from './ocr-download-language-pack.js';

function makeMgr(opts: {
  catalogEntry?: { lang: string; displayName: string; sizeBytes: number; sha256: string } | null;
  downloadResult:
    | {
        ok: true;
        value: LanguagePackRecord;
      }
    | {
        ok: false;
        error:
          | 'lang_not_in_catalog'
          | 'pack_already_installed'
          | 'network_error'
          | 'pack_integrity_failed'
          | 'disk_write_failed'
          | 'cancelled';
        message: string;
      };
}): LanguagePackManager {
  return {
    async list() {
      return { installed: [], downloadable: [] };
    },
    resolve: () => null,
    async download() {
      return opts.downloadResult as never;
    },
    async remove() {
      throw new Error('not used');
    },
    touchLastUsed: () => undefined,
    catalogEntry: () => opts.catalogEntry ?? null,
    getCatalog: () => ({ version: 'test', baseUrl: '', packs: [] }),
  };
}

describe('handleOcrLanguagePackDownload (api-contracts.md §16.7)', () => {
  it('rejects invalid lang shape', async () => {
    const r = await handleOcrLanguagePackDownload(
      { lang: 'BAD!' },
      {
        languagePackManager: makeMgr({
          catalogEntry: null,
          downloadResult: { ok: false, error: 'lang_not_in_catalog', message: 'bad' },
        }),
        languagePacksRepo: null,
        emitProgress: () => undefined,
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects lang_not_in_catalog when entry is null', async () => {
    const events: string[] = [];
    const r = await handleOcrLanguagePackDownload(
      { lang: 'zzz' },
      {
        languagePackManager: makeMgr({
          catalogEntry: null,
          downloadResult: { ok: false, error: 'lang_not_in_catalog', message: '' },
        }),
        languagePacksRepo: null,
        emitProgress: (e) => events.push(e.phase),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('lang_not_in_catalog');
    // No starting event because catalog lookup failed first.
    expect(events).not.toContain('starting');
  });

  it('emits starting + completed events on happy path', async () => {
    const events: string[] = [];
    const happyRecord: LanguagePackRecord = {
      lang: 'spa',
      displayName: 'Spanish',
      source: 'downloaded',
      filePath: '/p/spa.gz', // MUST be stripped at the bridge
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
      installedAt: 1000,
      lastUsedAt: null,
    };
    const r = await handleOcrLanguagePackDownload(
      { lang: 'spa' },
      {
        languagePackManager: makeMgr({
          catalogEntry: {
            lang: 'spa',
            displayName: 'Spanish',
            sizeBytes: 10,
            sha256: 'a'.repeat(64),
          },
          downloadResult: { ok: true, value: happyRecord },
        }),
        languagePacksRepo: null,
        emitProgress: (e) => events.push(e.phase),
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // filePath stripped at bridge.
      expect((r.value.pack as unknown as { filePath?: string }).filePath).toBeUndefined();
      expect(r.value.pack.lang).toBe('spa');
      expect(r.value.pack.source).toBe('downloaded');
    }
    expect(events).toContain('starting');
    expect(events).toContain('verifying');
    expect(events).toContain('completed');
  });

  it('emits failed event + maps pack_integrity_failed', async () => {
    const events: { phase: string }[] = [];
    const r = await handleOcrLanguagePackDownload(
      { lang: 'spa' },
      {
        languagePackManager: makeMgr({
          catalogEntry: {
            lang: 'spa',
            displayName: 'Spanish',
            sizeBytes: 10,
            sha256: 'a'.repeat(64),
          },
          downloadResult: { ok: false, error: 'pack_integrity_failed', message: 'bad hash' },
        }),
        languagePacksRepo: null,
        emitProgress: (e) => events.push({ phase: e.phase }),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('pack_integrity_failed');
    expect(events.find((e) => e.phase === 'failed')).toBeDefined();
  });

  it('persists into language_packs repo when provided', async () => {
    const upsertCalls: unknown[] = [];
    const happyRecord: LanguagePackRecord = {
      lang: 'spa',
      displayName: 'Spanish',
      source: 'downloaded',
      filePath: '/p/spa.gz',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
      installedAt: 1000,
      lastUsedAt: null,
    };
    await handleOcrLanguagePackDownload(
      { lang: 'spa' },
      {
        languagePackManager: makeMgr({
          catalogEntry: {
            lang: 'spa',
            displayName: 'Spanish',
            sizeBytes: 10,
            sha256: 'a'.repeat(64),
          },
          downloadResult: { ok: true, value: happyRecord },
        }),
        languagePacksRepo: {
          upsert: (row) => upsertCalls.push(row),
        },
        emitProgress: () => undefined,
      },
    );
    expect(upsertCalls.length).toBe(1);
    expect((upsertCalls[0] as { lang: string }).lang).toBe('spa');
    expect((upsertCalls[0] as { file_path: string }).file_path).toBe('/p/spa.gz'); // main-only
  });
});
