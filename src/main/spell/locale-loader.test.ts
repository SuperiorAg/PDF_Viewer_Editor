// Tests for SpellLocaleLoader (Phase 7.5 Wave 6 — B14 lazy locale load).

import type { NSpellInstance, NSpellDictionary } from 'nspell';
import { describe, expect, it, vi } from 'vitest';

import { SpellLocaleLoader, SPELL_LOCALES, availableSpellLocaleIds } from './locale-loader.js';

function fakeInstance(): NSpellInstance {
  return {
    correct: () => true,
    suggest: () => [],
    spell: () => ({ correct: true, forbidden: false, warn: false }),
    add: () => fakeInstance(),
    remove: () => fakeInstance(),
  };
}

describe('SPELL_LOCALES descriptor table', () => {
  it('lists en-US as available', () => {
    const en = SPELL_LOCALES.find((l) => l.id === 'en-US');
    expect(en).toBeDefined();
    expect(en!.available).toBe(true);
  });

  it('lists es-ES as unavailable with a specific reason (P7.5-L-10 honesty)', () => {
    const es = SPELL_LOCALES.find((l) => l.id === 'es-ES');
    expect(es).toBeDefined();
    expect(es!.available).toBe(false);
    expect(es!.reason).toMatch(/GPL/i);
    expect(es!.reason).toMatch(/Hunspell/);
  });
});

describe('availableSpellLocaleIds', () => {
  it('returns only the available locale ids', () => {
    const set = availableSpellLocaleIds();
    expect(set.has('en-US')).toBe(true);
    expect(set.has('es-ES')).toBe(false);
  });
});

describe('SpellLocaleLoader', () => {
  it('rejects unavailable locales with locale_not_available', async () => {
    const loader = new SpellLocaleLoader({
      loadEnUsDictionary: async () => ({ aff: new Uint8Array(), dic: new Uint8Array() }),
      buildEngine: () => fakeInstance(),
    });
    const r = await loader.loadEngine('es-ES');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('locale_not_available');
  });

  it('loads en-US lazily on first call', async () => {
    const dictLoader = vi.fn(
      async (): Promise<NSpellDictionary> => ({ aff: new Uint8Array(), dic: new Uint8Array() }),
    );
    const builder = vi.fn(() => fakeInstance());
    const loader = new SpellLocaleLoader({
      loadEnUsDictionary: dictLoader,
      buildEngine: builder,
    });
    const r1 = await loader.loadEngine('en-US');
    expect(r1.ok).toBe(true);
    expect(dictLoader).toHaveBeenCalledTimes(1);
    expect(builder).toHaveBeenCalledTimes(1);

    // Cached on second call.
    const r2 = await loader.loadEngine('en-US');
    expect(r2.ok).toBe(true);
    expect(dictLoader).toHaveBeenCalledTimes(1);
    expect(builder).toHaveBeenCalledTimes(1);
  });

  it('reports dictionary_load_failed and clears the cache on failure', async () => {
    let throwOnce = true;
    const dictLoader = vi.fn(async (): Promise<NSpellDictionary> => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error('disk-read-failed');
      }
      return { aff: new Uint8Array(), dic: new Uint8Array() };
    });
    const loader = new SpellLocaleLoader({
      loadEnUsDictionary: dictLoader,
      buildEngine: () => fakeInstance(),
    });
    const r1 = await loader.loadEngine('en-US');
    expect(r1.ok).toBe(false);
    if (r1.ok) return;
    expect(r1.error).toBe('dictionary_load_failed');

    // Subsequent call retries (cache cleared).
    const r2 = await loader.loadEngine('en-US');
    expect(r2.ok).toBe(true);
    expect(dictLoader).toHaveBeenCalledTimes(2);
  });
});
