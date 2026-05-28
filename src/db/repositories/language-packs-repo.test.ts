import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import {
  createLanguagePacksRepo,
  type LanguagePacksRepo,
  type UpsertLanguagePackInput,
} from './language-packs-repo';

// ============================================================
// Fixture builders
// ============================================================

function makePackInput(overrides: Partial<UpsertLanguagePackInput> = {}): UpsertLanguagePackInput {
  return {
    lang: 'eng',
    source: 'bundled',
    file_path: 'C:\\Users\\ahudson\\AppData\\Roaming\\pdf-viewer-editor\\tessdata\\eng.traineddata',
    size_bytes: 12345678,
    sha256: 'f'.repeat(64),
    installed_at: 1716307200000,
    last_used_at: null,
    ...overrides,
  };
}

describe('language-packs-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: LanguagePacksRepo;

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createLanguagePacksRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================
  // Schema verification
  // ============================================================

  describe('schema migration', () => {
    it('reports schema_version >= 5 after migrations apply', () => {
      const row = db
        .prepare<[], { v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
        .get();
      expect(row?.v).toBeGreaterThanOrEqual(5);
    });

    it('creates language_packs with the canonical column set', () => {
      const cols = db
        .prepare<[], { name: string }>(`PRAGMA table_info(language_packs)`)
        .all()
        .map((r) => r.name)
        .sort();
      expect(cols).toEqual(
        [
          'file_path',
          'installed_at',
          'lang',
          'last_used_at',
          'sha256',
          'size_bytes',
          'source',
        ].sort(),
      );
    });

    it('creates idx_language_packs_source', () => {
      const idx = db
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'language_packs'`,
        )
        .all()
        .map((r) => r.name);
      expect(idx).toEqual(expect.arrayContaining(['idx_language_packs_source']));
    });

    it('enforces source CHECK constraint at SQL level', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO language_packs (lang, source, file_path, size_bytes,
              sha256, installed_at, last_used_at)
              VALUES ('xxx', 'corrupted', '/p', 1, 'a', 1, NULL)`,
          )
          .run(),
      ).toThrowError(/CHECK constraint failed/);
    });

    it('enforces lang PRIMARY KEY uniqueness at SQL level', () => {
      repo.upsert(makePackInput({ lang: 'spa' }));
      // Raw INSERT (not upsert) — should fail on PRIMARY KEY collision.
      expect(() =>
        db
          .prepare(
            `INSERT INTO language_packs (lang, source, file_path, size_bytes,
              sha256, installed_at, last_used_at)
              VALUES ('spa', 'downloaded', '/p', 1, 'a', 1, NULL)`,
          )
          .run(),
      ).toThrowError(/UNIQUE constraint failed/);
    });
  });

  // ============================================================
  // upsert (insert path)
  // ============================================================

  describe('upsert (insert)', () => {
    it('inserts a pack and round-trips every column', () => {
      repo.upsert(makePackInput());
      const row = repo.get('eng');
      expect(row).not.toBeNull();
      expect(row?.lang).toBe('eng');
      expect(row?.source).toBe('bundled');
      expect(row?.size_bytes).toBe(12345678);
      expect(row?.sha256).toBe('f'.repeat(64));
      expect(row?.installed_at).toBe(1716307200000);
      expect(row?.last_used_at).toBeNull();
    });

    it('returns the SQL NULL for last_used_at (not the string "null")', () => {
      repo.upsert(makePackInput({ lang: 'fra' }));
      const raw = db
        .prepare<
          { lang: string },
          { last_used_at: number | null }
        >('SELECT last_used_at FROM language_packs WHERE lang = @lang')
        .get({ lang: 'fra' });
      expect(raw?.last_used_at).toBeNull();
    });

    it('rejects empty lang', () => {
      expect(() => repo.upsert(makePackInput({ lang: '' }))).toThrowError(
        /lang must be a non-empty string/,
      );
    });

    it('rejects lang that does not match the regex', () => {
      expect(() => repo.upsert(makePackInput({ lang: 'english' }))).toThrowError(/lang must match/);
      expect(() => repo.upsert(makePackInput({ lang: 'e' }))).toThrowError(/lang must match/);
      expect(() => repo.upsert(makePackInput({ lang: '123' }))).toThrowError(/lang must match/);
    });

    it('accepts variant suffix langs (chi_tra, eng_old)', () => {
      repo.upsert(makePackInput({ lang: 'chi_tra' }));
      expect(repo.get('chi_tra')?.lang).toBe('chi_tra');
    });

    it('rejects invalid source value', () => {
      expect(() =>
        // @ts-expect-error — runtime guard test
        repo.upsert(makePackInput({ source: 'cloud' })),
      ).toThrowError(/source must be/);
    });

    it('rejects empty file_path', () => {
      expect(() => repo.upsert(makePackInput({ file_path: '' }))).toThrowError(/file_path/);
    });

    it('rejects non-64-hex sha256', () => {
      expect(() => repo.upsert(makePackInput({ sha256: 'short' }))).toThrowError(/sha256/);
      expect(() => repo.upsert(makePackInput({ sha256: 'g'.repeat(64) }))).toThrowError(/sha256/); // 'g' is not hex
    });

    it('rejects negative size_bytes', () => {
      expect(() => repo.upsert(makePackInput({ size_bytes: -1 }))).toThrowError(/size_bytes/);
    });

    it('rejects negative installed_at', () => {
      expect(() => repo.upsert(makePackInput({ installed_at: -1 }))).toThrowError(/installed_at/);
    });
  });

  // ============================================================
  // upsert (replace path)
  // ============================================================

  describe('upsert (replace)', () => {
    it('replaces all non-key columns on lang collision', () => {
      repo.upsert(
        makePackInput({
          lang: 'spa',
          source: 'downloaded',
          file_path: '/path/A',
          size_bytes: 1000,
          sha256: 'a'.repeat(64),
          installed_at: 1000,
        }),
      );
      repo.upsert(
        makePackInput({
          lang: 'spa',
          source: 'bundled',
          file_path: '/path/B',
          size_bytes: 2000,
          sha256: 'b'.repeat(64),
          installed_at: 2000,
          last_used_at: 5000,
        }),
      );
      const row = repo.get('spa');
      expect(row?.source).toBe('bundled');
      expect(row?.file_path).toBe('/path/B');
      expect(row?.size_bytes).toBe(2000);
      expect(row?.sha256).toBe('b'.repeat(64));
      expect(row?.installed_at).toBe(2000);
      expect(row?.last_used_at).toBe(5000);
    });
  });

  // ============================================================
  // list + get
  // ============================================================

  describe('list', () => {
    it('returns [] when empty', () => {
      expect(repo.list()).toEqual([]);
    });

    it('returns all installed packs ordered installed_at DESC', () => {
      repo.upsert(makePackInput({ lang: 'eng', installed_at: 1000 }));
      repo.upsert(makePackInput({ lang: 'spa', installed_at: 3000, source: 'downloaded' }));
      repo.upsert(makePackInput({ lang: 'fra', installed_at: 2000, source: 'downloaded' }));

      const langs = repo.list().map((r) => r.lang);
      expect(langs).toEqual(['spa', 'fra', 'eng']);
    });
  });

  describe('get', () => {
    it('returns null for unknown lang', () => {
      expect(repo.get('zzz')).toBeNull();
    });

    it('rejects empty lang', () => {
      expect(() => repo.get('')).toThrowError(/non-empty/);
    });
  });

  // ============================================================
  // remove
  // ============================================================

  describe('remove', () => {
    it('removes a downloaded pack and returns ok', () => {
      repo.upsert(makePackInput({ lang: 'spa', source: 'downloaded' }));
      expect(repo.remove('spa')).toEqual({ ok: true });
      expect(repo.get('spa')).toBeNull();
    });

    it('refuses to remove a bundled pack', () => {
      repo.upsert(makePackInput({ lang: 'eng', source: 'bundled' }));
      expect(repo.remove('eng')).toEqual({
        ok: false,
        error: 'bundled_protected',
      });
      // Pack still present.
      expect(repo.get('eng')).not.toBeNull();
    });

    it('returns not_found for an absent lang', () => {
      expect(repo.remove('xyz')).toEqual({ ok: false, error: 'not_found' });
    });

    it('rejects invalid lang code', () => {
      expect(() => repo.remove('not-a-lang!!!')).toThrowError(/lang must match/);
    });
  });

  // ============================================================
  // touchLastUsed
  // ============================================================

  describe('touchLastUsed', () => {
    it('sets last_used_at when the row exists', () => {
      repo.upsert(makePackInput({ lang: 'eng' }));
      expect(repo.touchLastUsed('eng', 9999)).toBe(true);
      expect(repo.get('eng')?.last_used_at).toBe(9999);
    });

    it('returns false for absent lang', () => {
      expect(repo.touchLastUsed('xyz', 1000)).toBe(false);
    });

    it('overwrites prior last_used_at', () => {
      repo.upsert(makePackInput({ lang: 'eng', last_used_at: 1000 }));
      repo.touchLastUsed('eng', 2000);
      expect(repo.get('eng')?.last_used_at).toBe(2000);
    });

    it('rejects negative timestamp', () => {
      repo.upsert(makePackInput({ lang: 'eng' }));
      expect(() => repo.touchLastUsed('eng', -1)).toThrowError(/when/);
    });
  });

  // ============================================================
  // SQL-injection resistance
  // ============================================================

  describe('SQL-injection resistance', () => {
    // Note: lang is validated against /^[a-z]{2,3}(_[a-z]+)?$/i so most
    // adversarial payloads bounce at the validator boundary. We test the
    // file_path + sha256 string columns instead — those are stored verbatim
    // and need binding-safe escaping. sha256 is 64-hex only, so we test it
    // with an in-bounds adversarial string (64 chars but containing escape
    // attempts won't pass the hex check). file_path accepts arbitrary text.
    const PAYLOADS = [
      "'; DROP TABLE language_packs; --",
      "x' OR '1'='1",
      "x' UNION SELECT * FROM schema_migrations; --",
      'x"; DELETE FROM language_packs; --',
      "x'); DROP TABLE schema_migrations; --",
      'x\x00\nDROP TABLE language_packs;',
    ];

    it.each(PAYLOADS)(
      'preserves table + roundtrips payload %j in file_path column',
      (payload: string) => {
        repo.upsert(makePackInput({ lang: 'eng', file_path: payload }));
        expect(repo.get('eng')?.file_path).toBe(payload);

        const tables = db
          .prepare<
            [],
            { name: string }
          >(`SELECT name FROM sqlite_master WHERE type='table' AND name='language_packs'`)
          .all();
        expect(tables).toHaveLength(1);
        const migrations = db
          .prepare<[], { v: number }>('SELECT MAX(version) AS v FROM schema_migrations')
          .get();
        expect(migrations?.v).toBeGreaterThanOrEqual(5);
      },
    );

    it('validator rejects lang with quote-and-comment payload', () => {
      expect(() =>
        repo.upsert(makePackInput({ lang: "'; DROP TABLE language_packs; --" })),
      ).toThrowError(/lang must match/);
      // Table still present (validator gate fired before any SQL ran).
      const tables = db
        .prepare<
          [],
          { name: string }
        >(`SELECT name FROM sqlite_master WHERE type='table' AND name='language_packs'`)
        .all();
      expect(tables).toHaveLength(1);
    });
  });

  // ============================================================
  // Cross-method integration
  // ============================================================

  describe('cross-method integration', () => {
    it('upsert -> list -> touchLastUsed -> remove flow', () => {
      repo.upsert(makePackInput({ lang: 'eng', source: 'bundled' }));
      repo.upsert(makePackInput({ lang: 'spa', source: 'downloaded' }));

      expect(repo.list()).toHaveLength(2);
      repo.touchLastUsed('spa', 8888);
      expect(repo.get('spa')?.last_used_at).toBe(8888);
      expect(repo.remove('spa')).toEqual({ ok: true });
      expect(repo.list()).toHaveLength(1);
      // Bundled pack untouched.
      expect(repo.get('eng')).not.toBeNull();
    });
  });
});
