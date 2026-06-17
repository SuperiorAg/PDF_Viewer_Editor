// TTS voice preferences repository.
//
// Backs the C1 Read Aloud voice picker + the `tts:*` IPC handlers (David
// Phase 7.5 Wave 5a). One row per (locale, engine_name) — the composite
// PRIMARY KEY covers the dominant query "what's my preferred voice for
// en-US on this OS?".
//
// Canonical reference: docs/data-models.md §13.6.
//
// `preferred_voice_id` is nullable + late-init: NULL until the user picks
// a voice. NO sentinel empty-string for "not set" (anti-sentinel,
// data-models §13.11).
//
// `rate` / `pitch` range 0.5..2.0 is enforced HERE at the repo layer
// (validation surface; the zod schema at IPC enforces it too — defense in
// depth, same pattern as Wave 5 OCR confidence range).
//
// Method surface:
//   * upsert(input)             — INSERT OR REPLACE on (locale, engine).
//                                  Updates updated_at to now. Returns the row.
//   * getByKey(locale, engine)  — single row, or null.
//   * listByLocale(locale)      — rows for a locale across all engines.
//   * listAll()                 — all rows, ordered (locale, engine).
//   * deleteByKey(locale, engine) — DELETE; returns rows removed.

import type BetterSqlite3 from 'better-sqlite3';

import type { TtsEngineName, TtsVoicePrefRow } from '../types';

// ============================================================
// Public shape
// ============================================================

export interface UpsertTtsVoicePrefInput {
  locale: string;
  engine_name: TtsEngineName;
  /** NULL = clear the picked voice. */
  preferred_voice_id: string | null;
  /** 0.5..2.0. Defaults to 1.0. */
  rate?: number;
  /** 0.5..2.0. Defaults to 1.0. */
  pitch?: number;
  /** Optional override; defaults to Date.now(). */
  updated_at?: number;
}

export interface TtsVoicePrefsRepo {
  upsert(input: UpsertTtsVoicePrefInput): TtsVoicePrefRow;
  getByKey(locale: string, engine: TtsEngineName): TtsVoicePrefRow | null;
  listByLocale(locale: string): TtsVoicePrefRow[];
  listAll(): TtsVoicePrefRow[];
  deleteByKey(locale: string, engine: TtsEngineName): number;
}

// ============================================================
// Factory
// ============================================================

const SELECT_COLUMNS = `locale, engine_name, preferred_voice_id, rate, pitch, updated_at`;
const VALID_ENGINES: readonly TtsEngineName[] = ['sapi', 'say', 'espeak'];

const RATE_MIN = 0.5;
const RATE_MAX = 2.0;

export function createTtsVoicePrefsRepo(db: BetterSqlite3.Database): TtsVoicePrefsRepo {
  // INSERT OR REPLACE keyed on the composite PK. SQLite "OR REPLACE" deletes
  // any existing row with the same PK before inserting — same semantics as a
  // PostgreSQL UPSERT for a single-key PK.
  const upsertStmt = db.prepare<{
    locale: string;
    engine_name: TtsEngineName;
    preferred_voice_id: string | null;
    rate: number;
    pitch: number;
    updated_at: number;
  }>(
    `INSERT INTO tts_voice_prefs
        (locale, engine_name, preferred_voice_id, rate, pitch, updated_at)
       VALUES
        (@locale, @engine_name, @preferred_voice_id, @rate, @pitch, @updated_at)
       ON CONFLICT (locale, engine_name) DO UPDATE SET
         preferred_voice_id = excluded.preferred_voice_id,
         rate               = excluded.rate,
         pitch              = excluded.pitch,
         updated_at         = excluded.updated_at`,
  );

  const getByKeyStmt = db.prepare<{ locale: string; engine_name: TtsEngineName }, TtsVoicePrefRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM tts_voice_prefs
      WHERE locale = @locale AND engine_name = @engine_name
      LIMIT 1`,
  );

  const listByLocaleStmt = db.prepare<{ locale: string }, TtsVoicePrefRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM tts_voice_prefs
      WHERE locale = @locale
      ORDER BY engine_name ASC`,
  );

  const listAllStmt = db.prepare<[], TtsVoicePrefRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM tts_voice_prefs
      ORDER BY locale ASC, engine_name ASC`,
  );

  const deleteByKeyStmt = db.prepare<{ locale: string; engine_name: TtsEngineName }>(
    `DELETE FROM tts_voice_prefs WHERE locale = @locale AND engine_name = @engine_name`,
  );

  return {
    upsert(input: UpsertTtsVoicePrefInput): TtsVoicePrefRow {
      assertNonEmptyString(input.locale, 'locale');
      assertEngine(input.engine_name);

      const rate = input.rate ?? 1.0;
      const pitch = input.pitch ?? 1.0;
      assertInRange(rate, RATE_MIN, RATE_MAX, 'rate');
      assertInRange(pitch, RATE_MIN, RATE_MAX, 'pitch');

      if (
        input.preferred_voice_id !== null &&
        (typeof input.preferred_voice_id !== 'string' || input.preferred_voice_id.length === 0)
      ) {
        throw new Error('preferred_voice_id must be a non-empty string or null');
      }

      const txn = db.transaction((): TtsVoicePrefRow => {
        upsertStmt.run({
          locale: input.locale,
          engine_name: input.engine_name,
          preferred_voice_id: input.preferred_voice_id,
          rate,
          pitch,
          updated_at: input.updated_at ?? Date.now(),
        });
        const row = getByKeyStmt.get({
          locale: input.locale,
          engine_name: input.engine_name,
        });
        if (!row) {
          throw new Error(
            `upsert post-condition violated: tts_voice_prefs row not found for (${input.locale}, ${input.engine_name})`,
          );
        }
        return row;
      });
      return txn();
    },

    getByKey(locale: string, engine: TtsEngineName): TtsVoicePrefRow | null {
      assertNonEmptyString(locale, 'locale');
      assertEngine(engine);
      return getByKeyStmt.get({ locale, engine_name: engine }) ?? null;
    },

    listByLocale(locale: string): TtsVoicePrefRow[] {
      assertNonEmptyString(locale, 'locale');
      return listByLocaleStmt.all({ locale });
    },

    listAll(): TtsVoicePrefRow[] {
      return listAllStmt.all();
    },

    deleteByKey(locale: string, engine: TtsEngineName): number {
      assertNonEmptyString(locale, 'locale');
      assertEngine(engine);
      return deleteByKeyStmt.run({ locale, engine_name: engine }).changes;
    },
  };
}

// ============================================================
// Validators
// ============================================================

function assertNonEmptyString(s: unknown, label: string): void {
  if (typeof s !== 'string' || s.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertEngine(engine: unknown): asserts engine is TtsEngineName {
  if (typeof engine !== 'string' || !(VALID_ENGINES as readonly string[]).includes(engine)) {
    throw new Error(
      `engine_name must be one of: ${VALID_ENGINES.join(', ')} (got ${String(engine)})`,
    );
  }
}

function assertInRange(n: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label} must be in [${String(min)}, ${String(max)}] (got ${String(n)})`);
  }
}
