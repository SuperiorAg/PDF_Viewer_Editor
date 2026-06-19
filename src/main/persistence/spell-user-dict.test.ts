// Tests for SpellUserDictStore (Phase 7.5 Wave 6 — B14 user dictionary).

import { describe, expect, it } from 'vitest';

import { SpellUserDictStore } from './spell-user-dict.js';

function inMemFs(): {
  files: Map<string, string>;
  fs: {
    mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
    readFile: (path: string, enc: string) => Promise<string>;
    writeFile: (path: string, body: string, enc: string) => Promise<void>;
  };
} {
  const files = new Map<string, string>();
  return {
    files,
    fs: {
      async mkdir() {
        /* no-op */
      },
      async readFile(path: string): Promise<string> {
        const v = files.get(path);
        if (v === undefined) {
          const e = new Error('ENOENT');
          (e as NodeJS.ErrnoException).code = 'ENOENT';
          throw e;
        }
        return v;
      },
      async writeFile(path: string, body: string): Promise<void> {
        files.set(path, body);
      },
    },
  };
}

function make(): SpellUserDictStore {
  const { fs } = inMemFs();
  return new SpellUserDictStore({
    baseDir: '/fake/userData',
    availableLocales: new Set(['en-US']),
    fs: fs as never,
  });
}

describe('SpellUserDictStore', () => {
  it('returns empty list when no file exists yet', async () => {
    const store = make();
    const r = await store.list('en-US');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([]);
  });

  it('rejects locales outside the allowlist', async () => {
    const store = make();
    const r = await store.list('es-ES');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('locale_not_available');
  });

  it('adds, lists, and removes a word', async () => {
    const store = make();
    const a = await store.add('en-US', 'superiorag');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.value.added).toBe(true);

    const list1 = await store.list('en-US');
    expect(list1.ok).toBe(true);
    if (!list1.ok) return;
    expect(list1.value).toEqual(['superiorag']);

    // Idempotent re-add returns added: false.
    const a2 = await store.add('en-US', 'superiorag');
    expect(a2.ok).toBe(true);
    if (!a2.ok) return;
    expect(a2.value.added).toBe(false);

    const rem = await store.remove('en-US', 'superiorag');
    expect(rem.ok).toBe(true);
    if (!rem.ok) return;
    expect(rem.value.removed).toBe(true);

    const list2 = await store.list('en-US');
    expect(list2.ok).toBe(true);
    if (!list2.ok) return;
    expect(list2.value).toEqual([]);

    const rem2 = await store.remove('en-US', 'superiorag');
    expect(rem2.ok).toBe(true);
    if (!rem2.ok) return;
    expect(rem2.value.removed).toBe(false);
  });

  it('rejects invalid words', async () => {
    const store = make();
    const a = await store.add('en-US', '   ');
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(a.error).toBe('invalid_payload');
  });

  it('exposes a synchronous cache after list/add', async () => {
    const store = make();
    expect(store.hasCached('en-US', 'superiorag')).toBe(false);
    await store.add('en-US', 'superiorag');
    expect(store.hasCached('en-US', 'superiorag')).toBe(true);
    expect(store.cachedWords('en-US')).toEqual(['superiorag']);
  });

  it('treats a corrupt JSON file as an empty list', async () => {
    const { files, fs } = inMemFs();
    const store = new SpellUserDictStore({
      baseDir: '/fake/userData',
      availableLocales: new Set(['en-US']),
      fs: fs as never,
    });
    files.set('/fake/userData/spell-user-dict-en-US.json', 'not json {{{');
    const r = await store.list('en-US');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([]);
  });

  it('serializes concurrent writes via the per-locale mutex', async () => {
    const store = make();
    const [a, b, c] = await Promise.all([
      store.add('en-US', 'apple'),
      store.add('en-US', 'banana'),
      store.add('en-US', 'cherry'),
    ]);
    expect(a.ok && b.ok && c.ok).toBe(true);
    const list = await store.list('en-US');
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    // All three landed atomically even under contention.
    expect([...list.value].sort()).toEqual(['apple', 'banana', 'cherry']);
  });
});
