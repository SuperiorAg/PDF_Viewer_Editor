// Focused migration test: 0009_phase7.5.sql idempotency + upgrade path.
//
// Verifies:
//   1. Fresh DB: 0001..0009 apply clean, schema_migrations.version = 9.
//   2. DB already at 0008: 0009 applies and bumps watermark to 9, no errors.
//   3. Replay: running 0009's SQL a second time is a no-op (idempotent).
//
// Per the Wave 2 brief acceptance: migration MUST apply clean on a fresh DB
// AND on a DB already at the previous migration.

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from './migrate';
import { loadMigrationsForTests } from './test-support';

describe('migrations / 0009 phase 7.5', () => {
  let db: BetterSqlite3.Database;
  const migrations = loadMigrationsForTests();
  const head = Math.max(...migrations.map((m) => m.version));

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('applies clean on a fresh DB', () => {
    const result = runMigrations(db, migrations);
    expect(result.currentVersion).toBe(head);
    // The new tables exist.
    const stmt = db.prepare<[string], { count: number }>(
      `SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?`,
    );
    for (const tbl of [
      'stamps_library',
      'find_history',
      'action_wizard_scripts',
      'compare_sessions',
      'tts_voice_prefs',
      'accessibility_check_history',
      'accessibility_edit_session',
    ]) {
      const r = stmt.get(tbl);
      expect(r?.count).toBe(1);
    }
  });

  it('applies clean on a DB already at 0008 (incremental upgrade)', () => {
    // Stop at v8 first.
    const upTo0008 = migrations.filter((m) => m.version <= 8);
    const first = runMigrations(db, upTo0008);
    expect(first.currentVersion).toBe(8);

    // Now apply the full set; the runner should pick up where it left off and
    // only apply 0009.
    const second = runMigrations(db, migrations);
    expect(second.currentVersion).toBe(head);
    expect(second.applied).toEqual([9]);

    // Schema watermark is at v9 (or higher if future migrations land later).
    const v = db
      .prepare<[], { v: number }>(`SELECT MAX(version) AS v FROM schema_migrations`)
      .get();
    expect(v?.v).toBe(head);
  });

  it('seeds the ten built-in stamps after upgrade', () => {
    runMigrations(db, migrations);
    const r = db
      .prepare<
        [],
        { count: number }
      >(`SELECT COUNT(*) AS count FROM stamps_library WHERE builtin_key IS NOT NULL`)
      .get();
    expect(r?.count).toBeGreaterThanOrEqual(10);
  });

  it('seeds the ten Phase 7.5 settings keys after upgrade', () => {
    runMigrations(db, migrations);
    const keys = [
      'find.maxHistoryPerDoc',
      'find.maxHistoryTotal',
      'compare.sessionMaxBytes',
      'compare.sessionTtlDays',
      'accessibility.editSessionTtlDays',
      'accessibility.checkHistoryPerDoc',
      'tts.defaultRate',
      'tts.defaultPitch',
      'stamps.recentLimit',
      'actionWizard.maxRecordingOps',
    ];
    for (const key of keys) {
      const row = db
        .prepare<[string], { value: string }>(`SELECT value FROM app_settings WHERE key = ?`)
        .get(key);
      expect(row?.value).toBeDefined();
    }
  });

  it('does not duplicate built-ins on a re-exec of 0009 SQL (INSERT OR IGNORE)', () => {
    runMigrations(db, migrations);
    const before = db
      .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM stamps_library`)
      .get();

    const m9 = migrations.find((m) => m.version === 9);
    expect(m9).toBeDefined();
    // Replay 0009's SQL directly. Every CREATE TABLE / CREATE INDEX uses
    // IF NOT EXISTS; every INSERT uses OR IGNORE. So a replay is a no-op.
    db.exec(m9!.sql);

    const after = db
      .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM stamps_library`)
      .get();
    expect(after?.count).toBe(before?.count);
  });

  it('does not clobber user-customized settings on 0009 replay', () => {
    runMigrations(db, migrations);
    // User customizes.
    db.prepare(`UPDATE app_settings SET value = ? WHERE key = ?`).run(
      '99',
      'find.maxHistoryPerDoc',
    );

    // Replay 0009 — INSERT OR IGNORE must not overwrite the customized value.
    const m9 = migrations.find((m) => m.version === 9);
    db.exec(m9!.sql);

    const row = db
      .prepare<[string], { value: string }>(`SELECT value FROM app_settings WHERE key = ?`)
      .get('find.maxHistoryPerDoc');
    expect(row?.value).toBe('99');
  });
});
