// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { LanguagePackManager } from '../../main/pdf-ops/language-pack-manager.js';

import { handleOcrLanguagePackRemove } from './ocr-language-pack-remove.js';

function makeMgr(
  removeResult:
    | {
        ok: true;
        value: { removed: boolean };
      }
    | {
        ok: false;
        error: 'pack_not_installed' | 'cannot_remove_bundled' | 'disk_unlink_failed';
        message: string;
      },
): LanguagePackManager {
  return {
    async list() {
      return { installed: [], downloadable: [] };
    },
    resolve: () => null,
    async download() {
      throw new Error('not used');
    },
    async remove() {
      return removeResult as never;
    },
    touchLastUsed: () => undefined,
    catalogEntry: () => null,
    getCatalog: () => ({ version: 'test', baseUrl: '', packs: [] }),
  };
}

describe('handleOcrLanguagePackRemove (api-contracts.md §16.8)', () => {
  it('rejects invalid lang shape', async () => {
    const r = await handleOcrLanguagePackRemove(
      { lang: 'BAD!' },
      {
        languagePackManager: makeMgr({ ok: false, error: 'pack_not_installed', message: '' }),
        languagePacksRepo: null,
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('returns cannot_remove_bundled for the bundled `eng` pack', async () => {
    const r = await handleOcrLanguagePackRemove(
      { lang: 'eng' },
      {
        languagePackManager: makeMgr({
          ok: false,
          error: 'cannot_remove_bundled',
          message: '',
        }),
        languagePacksRepo: null,
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('cannot_remove_bundled');
  });

  it('returns pack_not_installed when not installed', async () => {
    const r = await handleOcrLanguagePackRemove(
      { lang: 'zzz' },
      {
        languagePackManager: makeMgr({
          ok: false,
          error: 'pack_not_installed',
          message: '',
        }),
        languagePacksRepo: null,
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('pack_not_installed');
  });

  it('happy path: removes pack and calls repo cleanup', async () => {
    const repoCalls: string[] = [];
    const r = await handleOcrLanguagePackRemove(
      { lang: 'spa' },
      {
        languagePackManager: makeMgr({ ok: true, value: { removed: true } }),
        languagePacksRepo: {
          remove: (l) => {
            repoCalls.push(l);
            return true;
          },
        },
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.removed).toBe(true);
    expect(repoCalls).toEqual(['spa']);
  });
});
