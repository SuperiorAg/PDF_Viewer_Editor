// Tests for the Phase 7.5 Wave 6 B14 spell-check handlers.

import type { NSpellInstance } from 'nspell';
import { describe, expect, it } from 'vitest';

import { SpellUserDictStore } from '../../main/persistence/spell-user-dict.js';
import { SpellLocaleLoader } from '../../main/spell/locale-loader.js';

import {
  handleSpellAddWordToDictionary,
  handleSpellCheckText,
  handleSpellListLocales,
  handleSpellListUserDictionary,
  handleSpellRemoveWordFromDictionary,
  type SpellHandlersDeps,
} from './spell-handlers.js';

function fakeInstance(correctWords: string[] = ['the', 'quick', 'fox']): NSpellInstance {
  const set = new Set(correctWords);
  return {
    correct(w) {
      return set.has(w);
    },
    suggest(_w) {
      return ['quick', 'quirk'];
    },
    spell(w) {
      return { correct: set.has(w), forbidden: false, warn: false };
    },
    add() {
      return fakeInstance();
    },
    remove() {
      return fakeInstance();
    },
  };
}

const normPath = (p: string): string => p.replace(/\\/g, '/');

function makeInMemUserDictFs(): {
  mkdir: () => Promise<void>;
  readFile: (path: string, enc: string) => Promise<string>;
  writeFile: (path: string, body: string, enc: string) => Promise<void>;
} {
  const files = new Map<string, string>();
  return {
    async mkdir() {
      /* no-op */
    },
    async readFile(rawPath: string): Promise<string> {
      const v = files.get(normPath(rawPath));
      if (v === undefined) {
        const e = new Error('ENOENT');
        (e as NodeJS.ErrnoException).code = 'ENOENT';
        throw e;
      }
      return v;
    },
    async writeFile(rawPath: string, body: string): Promise<void> {
      files.set(normPath(rawPath), body);
    },
  };
}

function makeDeps(overrides: Partial<SpellHandlersDeps> = {}): SpellHandlersDeps {
  const loader =
    overrides.loader ??
    new SpellLocaleLoader({
      loadEnUsDictionary: async () => ({ aff: new Uint8Array(), dic: new Uint8Array() }),
      buildEngine: () => fakeInstance(),
    });
  const userDict =
    overrides.userDict ??
    new SpellUserDictStore({
      baseDir: '/x/userdict',
      availableLocales: new Set(['en-US']),
      fs: makeInMemUserDictFs() as never,
    });
  return { loader, userDict };
}

describe('handleSpellListLocales', () => {
  it('returns the static locale table honestly', () => {
    const r = handleSpellListLocales({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.locales.length).toBeGreaterThanOrEqual(2);
    const en = r.value.locales.find((l) => l.id === 'en-US');
    expect(en).toBeDefined();
    expect(en!.available).toBe(true);
    const es = r.value.locales.find((l) => l.id === 'es-ES');
    expect(es).toBeDefined();
    expect(es!.available).toBe(false);
    // P7.5-L-10: the reason must be present and specific.
    expect(es!.reason).toBeTruthy();
    expect(es!.reason).toMatch(/GPL|MPL|LGPL/i);
  });
});

describe('handleSpellCheckText', () => {
  it('rejects invalid payload', async () => {
    const r = await handleSpellCheckText({ locale: 1, text: 2 }, makeDeps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_payload');
  });

  it('returns locale_not_available for es-ES', async () => {
    const r = await handleSpellCheckText({ locale: 'es-ES', text: 'hola' }, makeDeps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('locale_not_available');
  });

  it('reports misspellings on a happy path', async () => {
    const r = await handleSpellCheckText({ locale: 'en-US', text: 'the quik fox' }, makeDeps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.misspellings.length).toBe(1);
    expect(r.value.misspellings[0]!.word).toBe('quik');
    expect(r.value.misspellings[0]!.suggestions.length).toBeLessThanOrEqual(5);
  });

  it('honors the user dictionary', async () => {
    const deps = makeDeps();
    await deps.userDict.add('en-US', 'superiorag');
    const r = await handleSpellCheckText({ locale: 'en-US', text: 'superiorag is here' }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const flagged = r.value.misspellings.map((m) => m.word);
    expect(flagged).not.toContain('superiorag');
  });
});

describe('handleSpellAddWordToDictionary + remove + list', () => {
  it('rejects invalid payload', async () => {
    const r = await handleSpellAddWordToDictionary({ locale: 'en-US' }, makeDeps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_payload');
  });

  it('rejects unavailable locale', async () => {
    const r = await handleSpellAddWordToDictionary({ locale: 'es-ES', word: 'hola' }, makeDeps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('locale_not_available');
  });

  it('round-trips add -> list -> remove', async () => {
    const deps = makeDeps();
    const a = await handleSpellAddWordToDictionary({ locale: 'en-US', word: 'superiorag' }, deps);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.value.added).toBe(true);

    const list = await handleSpellListUserDictionary({ locale: 'en-US' }, deps);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.words).toEqual(['superiorag']);

    const rem = await handleSpellRemoveWordFromDictionary(
      { locale: 'en-US', word: 'superiorag' },
      deps,
    );
    expect(rem.ok).toBe(true);
    if (!rem.ok) return;
    expect(rem.value.removed).toBe(true);
  });
});
