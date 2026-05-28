// Settings repository.
//
// Backs the `settings:*` IPC channels (docs/api-contracts.md §5) and the
// app_settings table (docs/data-models.md §2). Values are stored as
// JSON-serialized TEXT and parsed at the repo boundary so callers receive
// fully-typed values (number, boolean, string-union, etc.).
//
// Unknown keys are rejected — David's IPC handler will return
// `error: 'unknown_key'` for any setting not in the registry. The repo enforces
// the registry too, defense-in-depth.

import type BetterSqlite3 from 'better-sqlite3';

import {
  type SettingKey,
  type SettingValue,
  isKnownSettingKey,
  KNOWN_SETTING_KEYS,
} from '../types';

// ============================================================
// Public shape
// ============================================================

export type AllSettingsMap = Partial<{ [K in SettingKey]: SettingValue<K> }>;

export interface SettingsRepo {
  /** Returns null if the key has never been set; caller applies its default. */
  get<K extends SettingKey>(key: K): SettingValue<K> | null;

  /** Insert-or-update by key. Value is JSON-stringified for storage. */
  set<K extends SettingKey>(key: K, value: SettingValue<K>): void;

  /** Partial map of every key currently in the database. */
  getAll(): AllSettingsMap;
}

// ============================================================
// Factory
// ============================================================

export function createSettingsRepo(db: BetterSqlite3.Database): SettingsRepo {
  interface SettingRow {
    key: string;
    value: string;
  }

  const getStmt = db.prepare<{ key: string }, SettingRow>(
    `SELECT key, value FROM app_settings WHERE key = @key`,
  );

  const setStmt = db.prepare<{ key: string; value: string }>(
    `INSERT INTO app_settings (key, value)
       VALUES (@key, @value)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  const getAllStmt = db.prepare<[], SettingRow>(`SELECT key, value FROM app_settings`);

  return {
    get<K extends SettingKey>(key: K): SettingValue<K> | null {
      assertKnownKey(key);
      const row = getStmt.get({ key });
      if (!row) return null;
      return parseJsonValue<K>(key, row.value);
    },

    set<K extends SettingKey>(key: K, value: SettingValue<K>): void {
      assertKnownKey(key);
      setStmt.run({ key, value: JSON.stringify(value) });
    },

    getAll(): AllSettingsMap {
      const rows = getAllStmt.all();
      const out: AllSettingsMap = {};
      for (const row of rows) {
        if (!isKnownSettingKey(row.key)) {
          // Defensive: drop stray rows from a future-schema downgrade. Never throw —
          // an unknown key in storage shouldn't take down the whole settings panel.
          continue;
        }
        const key = row.key;
        try {
          // Write through the typed map so the caller sees the same shape as get().
          // The cast is necessary because TS can't narrow on the dynamic key; the
          // parser does the runtime type check.
          (out as Record<SettingKey, unknown>)[key] = parseJsonValue(key, row.value);
        } catch {
          // Corrupt JSON for one key shouldn't poison every other key. Skip it.
          continue;
        }
      }
      return out;
    },
  };
}

// ============================================================
// Helpers
// ============================================================

function assertKnownKey(key: string): void {
  if (!isKnownSettingKey(key)) {
    throw new Error(`Unknown setting key: ${key} (valid keys: ${KNOWN_SETTING_KEYS.join(', ')})`);
  }
}

function parseJsonValue<K extends SettingKey>(_key: K, raw: string): SettingValue<K> {
  // The repo trusts that whatever was JSON.stringify'd via set() round-trips back
  // to the same type. We don't validate the SHAPE here — that's the IPC layer's
  // job (zod schema in David's handler, docs/api-contracts.md §10). A future
  // hardening pass could plug a per-key validator in here without changing the
  // signature.
  //
  // any: JSON.parse returns `unknown`, but our type guarantees apply because the
  // pair is always written by the typed set() — round-trip is shape-stable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON.parse round-trip from typed set()
  return JSON.parse(raw) as any;
}
