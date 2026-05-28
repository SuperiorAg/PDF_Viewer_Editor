// Language-packs repository.
//
// Backs the `ocr:listLanguagePacks`, `ocr:installLanguagePack`,
// `ocr:removeLanguagePack` IPC channels (api-contracts §16 + ocr-engine.md §4)
// on the language_packs table (data-models.md §10.4 + §10.8 + §10.9).
//
// Method surface (data-models §10.9):
//   * upsert(pack)               — insert-or-replace by lang (PRIMARY KEY)
//   * list()                     — all installed packs
//   * get(lang)                  — single row, or null
//   * remove(lang)               — refuses to remove source='bundled'
//   * touchLastUsed(lang, when)  — bump last_used_at after a successful OCR run
//
// Boundary discipline (data-models §10.1 + §10.8): the `file_path` column is
// MAIN-ONLY. The bridge strips it from the renderer-facing `LanguagePackDto`.
// This module is main-only by file ownership (`src/db/**` is Ravi/main); the
// caller (David's bridge) owns the IPC boundary scrub. The repo returns the
// full row including file_path — anything else would constrain the main-side
// language-pack manager that needs the path to spawn Tesseract.
//
// `remove(source='bundled')` policy: bundled packs ship with the app binary
// (eng.traineddata.gz packaged via electron-builder extraResources per
// phase-5-plan.md). Removing the database row would leave the bundle on disk
// orphaned + readd-fail (next launch's "register bundled" path would conflict
// on PRIMARY KEY). We refuse here and surface as the `bundled_protected`
// boolean result; the bridge maps to the api-contracts error code.

import type BetterSqlite3 from 'better-sqlite3';

import type { LanguagePackRow, OcrLanguagePackSource } from '../types';

// ============================================================
// Public shape
// ============================================================

/**
 * Upsert payload. All columns required — there are no nullable fields except
 * `last_used_at` which the repo controls via touchLastUsed.
 *
 * `lang` is the PRIMARY KEY; an upsert with an existing `lang` REPLACES every
 * non-key column. For mid-life updates (e.g. moving a pack from 'downloaded'
 * to 'bundled' after a rebuild), call `upsert` with the new metadata.
 */
export interface UpsertLanguagePackInput {
  lang: string;
  source: OcrLanguagePackSource;
  /** Absolute path; main-only. NEVER export across IPC. */
  file_path: string;
  size_bytes: number;
  /** 64-hex pack hash; the language-pack manager verifies on every load. */
  sha256: string;
  /** ms epoch. */
  installed_at: number;
  /** ms epoch; nullable. Default null on first insert; touched by touchLastUsed. */
  last_used_at?: number | null;
}

/**
 * Discriminated remove result. The 'bundled_protected' variant prevents the
 * caller from orphaning the on-disk bundled pack; the 'not_found' variant
 * surfaces idempotency-friendly behavior (re-removal of an absent pack).
 */
export type RemoveLanguagePackResult =
  | { ok: true }
  | { ok: false; error: 'bundled_protected' | 'not_found' };

export interface LanguagePacksRepo {
  /** Insert-or-replace by `lang` (PRIMARY KEY). */
  upsert(input: UpsertLanguagePackInput): void;

  /** All installed packs, ordered installed_at DESC (most-recent first). */
  list(): LanguagePackRow[];

  /** Lookup by lang code (PRIMARY KEY). Null if not found. */
  get(lang: string): LanguagePackRow | null;

  /**
   * Remove a non-bundled pack. Returns a discriminated union so the bridge
   * can map the protected-bundle path to a typed IPC error code without
   * peeking inside the repo. Idempotent for downloaded packs (re-remove is
   * `not_found`).
   */
  remove(lang: string): RemoveLanguagePackResult;

  /**
   * Update `last_used_at` to `when`. Returns true if the row exists. Called
   * by the OCR engine on every successful run that loads the pack —
   * drives LRU-style eviction candidates for Phase 5.2 disk-pressure
   * management.
   */
  touchLastUsed(lang: string, when: number): boolean;
}

// ============================================================
// Factory
// ============================================================

// Lang code regex matches data-models §10.12: ISO 639-2/3 letter, optionally
// suffixed with a Tesseract variant like '_tra'. Case-insensitive at the
// validator boundary; the DB stores whatever case the caller supplies, with
// the contract that callers normalize lowercase at the bridge.
const LANG_CODE_REGEX = /^[a-z]{2,3}(_[a-z]+)?$/i;

export function createLanguagePacksRepo(db: BetterSqlite3.Database): LanguagePacksRepo {
  const upsertStmt = db.prepare<{
    lang: string;
    source: string;
    file_path: string;
    size_bytes: number;
    sha256: string;
    installed_at: number;
    last_used_at: number | null;
  }>(
    `INSERT INTO language_packs
        (lang, source, file_path, size_bytes, sha256, installed_at, last_used_at)
      VALUES
        (@lang, @source, @file_path, @size_bytes, @sha256, @installed_at, @last_used_at)
      ON CONFLICT (lang) DO UPDATE SET
        source       = excluded.source,
        file_path    = excluded.file_path,
        size_bytes   = excluded.size_bytes,
        sha256       = excluded.sha256,
        installed_at = excluded.installed_at,
        last_used_at = excluded.last_used_at`,
  );

  const listStmt = db.prepare<[], LanguagePackRow>(
    `SELECT lang, source, file_path, size_bytes, sha256, installed_at, last_used_at
       FROM language_packs
      ORDER BY installed_at DESC, lang ASC`,
  );

  const getStmt = db.prepare<{ lang: string }, LanguagePackRow>(
    `SELECT lang, source, file_path, size_bytes, sha256, installed_at, last_used_at
       FROM language_packs
      WHERE lang = @lang
      LIMIT 1`,
  );

  const deleteStmt = db.prepare<{ lang: string }>(`DELETE FROM language_packs WHERE lang = @lang`);

  const touchStmt = db.prepare<{ lang: string; last_used_at: number }>(
    `UPDATE language_packs
        SET last_used_at = @last_used_at
      WHERE lang = @lang`,
  );

  return {
    upsert(input: UpsertLanguagePackInput): void {
      assertLangCode(input.lang);
      assertSource(input.source);
      assertNonEmptyString(input.file_path, 'file_path');
      assertNonNegativeInt(input.size_bytes, 'size_bytes');
      assertSha256(input.sha256);
      assertValidTimestamp(input.installed_at, 'installed_at');
      assertOptionalTimestamp(input.last_used_at ?? null, 'last_used_at');

      upsertStmt.run({
        lang: input.lang,
        source: input.source,
        file_path: input.file_path,
        size_bytes: input.size_bytes,
        sha256: input.sha256,
        installed_at: input.installed_at,
        last_used_at: input.last_used_at ?? null,
      });
    },

    list(): LanguagePackRow[] {
      return listStmt.all();
    },

    get(lang: string): LanguagePackRow | null {
      assertLangCode(lang);
      return getStmt.get({ lang }) ?? null;
    },

    remove(lang: string): RemoveLanguagePackResult {
      assertLangCode(lang);

      // Wrap the check + delete in a transaction so the bundled-guard is
      // race-free against a concurrent upsert. Main-process is single-
      // threaded but a future preload-side caller would benefit.
      const txn = db.transaction((): RemoveLanguagePackResult => {
        const existing = getStmt.get({ lang });
        if (!existing) {
          return { ok: false, error: 'not_found' };
        }
        if (existing.source === 'bundled') {
          return { ok: false, error: 'bundled_protected' };
        }
        const result = deleteStmt.run({ lang });
        if (result.changes === 0) {
          // Race: someone deleted between getStmt and deleteStmt. Treat as
          // not_found (idempotency-friendly).
          return { ok: false, error: 'not_found' };
        }
        return { ok: true };
      });

      return txn();
    },

    touchLastUsed(lang: string, when: number): boolean {
      assertLangCode(lang);
      assertValidTimestamp(when, 'when');
      const result = touchStmt.run({ lang, last_used_at: when });
      return result.changes > 0;
    },
  };
}

// ============================================================
// Validators
// ============================================================

function assertLangCode(lang: string): void {
  if (typeof lang !== 'string' || lang.length === 0) {
    throw new Error('lang must be a non-empty string');
  }
  if (!LANG_CODE_REGEX.test(lang)) {
    throw new Error(`lang must match /^[a-z]{2,3}(_[a-z]+)?$/i (got ${JSON.stringify(lang)})`);
  }
}

function assertSource(s: OcrLanguagePackSource): void {
  if (s !== 'bundled' && s !== 'downloaded') {
    throw new Error(`source must be 'bundled' | 'downloaded' (got ${String(s)})`);
  }
}

function assertNonEmptyString(s: string, label: string): void {
  if (typeof s !== 'string' || s.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertNonNegativeInt(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function assertSha256(s: string): void {
  if (typeof s !== 'string' || !/^[0-9a-f]{64}$/i.test(s)) {
    throw new Error(`sha256 must be a 64-hex-character string (got ${JSON.stringify(s)})`);
  }
}

function assertValidTimestamp(n: number, label: string): void {
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label} must be a non-negative finite number (ms epoch)`);
  }
}

function assertOptionalTimestamp(n: number | null, label: string): void {
  if (n === null) return;
  assertValidTimestamp(n, label);
}
