import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import { createSettingsRepo, type SettingsRepo } from './settings-repo';

describe('settings-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: SettingsRepo;

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createSettingsRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should return null for an unset key', () => {
    expect(repo.get('recents.maxItems')).toBeNull();
  });

  it('should round-trip a number setting', () => {
    repo.set('recents.maxItems', 50);
    expect(repo.get('recents.maxItems')).toBe(50);
  });

  it('should round-trip a boolean setting', () => {
    repo.set('export.showWarningsToast', false);
    expect(repo.get('export.showWarningsToast')).toBe(false);

    repo.set('export.showWarningsToast', true);
    expect(repo.get('export.showWarningsToast')).toBe(true);
  });

  it('should round-trip a string-union setting', () => {
    repo.set('export.defaultEngine', 'chromium');
    expect(repo.get('export.defaultEngine')).toBe('chromium');

    repo.set('export.defaultEngine', 'pdf-lib');
    expect(repo.get('export.defaultEngine')).toBe('pdf-lib');
  });

  it('should overwrite on repeated set for the same key', () => {
    repo.set('theme', 'light');
    repo.set('theme', 'dark');
    expect(repo.get('theme')).toBe('dark');
  });

  it('should throw on an unknown key in get()', () => {
    expect(() =>
      // Cast for the negative test: we deliberately pass a string outside the union.
      repo.get('bogus.key' as unknown as 'recents.maxItems'),
    ).toThrowError(/Unknown setting key/);
  });

  it('should throw on an unknown key in set()', () => {
    expect(() => repo.set('bogus.key' as unknown as 'recents.maxItems', 1)).toThrowError(
      /Unknown setting key/,
    );
  });

  it('should return only set keys from getAll()', () => {
    repo.set('recents.maxItems', 25);
    repo.set('theme', 'dark');

    const all = repo.getAll();
    // Phase 6 (0006_phase6_export.sql) seeds 17 `export.*` keys via
    // INSERT OR IGNORE. The user-set keys must round-trip; the seeded
    // defaults are also present. Use a partial-match instead of strict
    // equality so future phases that seed additional defaults don't
    // false-flag this test.
    expect(all).toMatchObject({
      'recents.maxItems': 25,
      theme: 'dark',
    });
    // The Phase 6 seeded defaults are visible (smoke check).
    expect(all['export.maxQueueSize']).toBe(50);
    expect(all['export.image.dpi']).toBe(150);
  });

  it('should silently skip unknown keys in storage when calling getAll()', () => {
    // Simulate a future-schema downgrade that left a stray key behind.
    db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`).run(
      'future.feature',
      JSON.stringify({ enabled: true }),
    );
    repo.set('recents.maxItems', 10);

    const all = repo.getAll();
    expect(all['recents.maxItems']).toBe(10);
    expect('future.feature' in all).toBe(false);
  });

  it('should not return corrupt-JSON keys from getAll() but should not throw', () => {
    // Hand-inject a malformed JSON value.
    db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`).run('theme', '{not json');
    repo.set('recents.maxItems', 7);

    const all = repo.getAll();
    expect(all['recents.maxItems']).toBe(7);
    expect('theme' in all).toBe(false);
  });

  it('should serialize values via JSON (string defaults are quoted)', () => {
    repo.set('theme', 'system');
    // Peek at the raw value to verify JSON round-trip happens.
    const row = db
      .prepare<[string], { value: string }>(`SELECT value FROM app_settings WHERE key = ?`)
      .get('theme');
    expect(row?.value).toBe('"system"');
  });

  // ============================================================
  // Phase 7 (0007_phase7_polish.sql) — telemetry / i18n / auto-update.
  // Four settings keys seeded via INSERT OR IGNORE; NO new table
  // (data-models §12.1 + §12.4 — telemetry buffer is in-memory only).
  // ============================================================
  describe('Phase 7 seeded defaults', () => {
    it('seeds telemetry.optIn = false (default OFF — trust-floor obligation #1)', () => {
      // Read directly via the repo: a freshly-migrated db has the seed row.
      expect(repo.get('telemetry.optIn')).toBe(false);
    });

    it('seeds i18n.locale = "en-US" (baseline locale)', () => {
      expect(repo.get('i18n.locale')).toBe('en-US');
    });

    it('seeds update.channel = "manual" (no auto-check vs placeholder)', () => {
      expect(repo.get('update.channel')).toBe('manual');
    });

    it('seeds update.lastCheckedAt = null, NOT a sentinel 0 (anti-sentinel)', () => {
      // The repo distinguishes "never set" (would also be null) from "seeded
      // to JSON null". Peek the raw storage to prove the row exists AND holds
      // the JSON null literal — a sentinel 0 would render "Jan 1, 1970".
      const row = db
        .prepare<[string], { value: string }>(`SELECT value FROM app_settings WHERE key = ?`)
        .get('update.lastCheckedAt');
      expect(row?.value).toBe('null');
      expect(repo.get('update.lastCheckedAt')).toBeNull();
    });

    it('surfaces all four Phase 7 defaults via getAll()', () => {
      const all = repo.getAll();
      expect(all['telemetry.optIn']).toBe(false);
      expect(all['i18n.locale']).toBe('en-US');
      expect(all['update.channel']).toBe('manual');
      // JSON null round-trips to null (present in storage, value null).
      expect(all['update.lastCheckedAt']).toBeNull();
    });

    it('round-trips telemetry.optIn after the user opts in', () => {
      repo.set('telemetry.optIn', true);
      expect(repo.get('telemetry.optIn')).toBe(true);
      repo.set('telemetry.optIn', false);
      expect(repo.get('telemetry.optIn')).toBe(false);
    });

    it('round-trips i18n.locale to the proof locale es-ES', () => {
      repo.set('i18n.locale', 'es-ES');
      expect(repo.get('i18n.locale')).toBe('es-ES');
    });

    it('round-trips update.channel to check-on-launch (opt-in)', () => {
      repo.set('update.channel', 'check-on-launch');
      expect(repo.get('update.channel')).toBe('check-on-launch');
    });

    it('round-trips a real update.lastCheckedAt timestamp (late-init)', () => {
      const now = 1_716_307_200_000;
      repo.set('update.lastCheckedAt', now);
      expect(repo.get('update.lastCheckedAt')).toBe(now);
      // And can return to null (e.g. a reset) without becoming a sentinel.
      repo.set('update.lastCheckedAt', null);
      expect(repo.get('update.lastCheckedAt')).toBeNull();
    });

    it('records the schema watermark at version >= 7', () => {
      // Use >= rather than === so this assertion does not bake in a Phase-7
      // expiry (Wave 16 takeaway: schema watermark only ever increases).
      const row = db
        .prepare<[], { v: number }>(`SELECT MAX(version) AS v FROM schema_migrations`)
        .get();
      expect(row?.v).toBeGreaterThanOrEqual(7);
    });

    it('is idempotent — re-applying 0007 does not clobber a user override', () => {
      // User customizes, then the migration runner re-runs (e.g. next launch).
      // INSERT OR IGNORE must NOT overwrite the user's value.
      repo.set('telemetry.optIn', true);
      db.exec(
        `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('telemetry.optIn', 'false')`,
      );
      expect(repo.get('telemetry.optIn')).toBe(true);
    });
  });

  // ============================================================
  // Phase 7.5 (0009_phase7.5.sql) — Bucket B parity + Bucket C
  // accessibility/TTS. 10 settings keys seeded via INSERT OR IGNORE per
  // data-models §13.9.
  // ============================================================
  describe('Phase 7.5 seeded defaults', () => {
    it('seeds find.maxHistoryPerDoc = 20', () => {
      expect(repo.get('find.maxHistoryPerDoc')).toBe(20);
    });

    it('seeds find.maxHistoryTotal = 200', () => {
      expect(repo.get('find.maxHistoryTotal')).toBe(200);
    });

    it('seeds compare.sessionMaxBytes = 5 MB', () => {
      expect(repo.get('compare.sessionMaxBytes')).toBe(5_242_880);
    });

    it('seeds compare.sessionTtlDays = 7', () => {
      expect(repo.get('compare.sessionTtlDays')).toBe(7);
    });

    it('seeds accessibility.editSessionTtlDays = 14', () => {
      expect(repo.get('accessibility.editSessionTtlDays')).toBe(14);
    });

    it('seeds accessibility.checkHistoryPerDoc = 10', () => {
      expect(repo.get('accessibility.checkHistoryPerDoc')).toBe(10);
    });

    it('seeds tts.defaultRate = 1.0', () => {
      expect(repo.get('tts.defaultRate')).toBe(1.0);
    });

    it('seeds tts.defaultPitch = 1.0', () => {
      expect(repo.get('tts.defaultPitch')).toBe(1.0);
    });

    it('seeds stamps.recentLimit = 12', () => {
      expect(repo.get('stamps.recentLimit')).toBe(12);
    });

    it('seeds actionWizard.maxRecordingOps = 5000', () => {
      expect(repo.get('actionWizard.maxRecordingOps')).toBe(5000);
    });

    it('records the schema watermark at version >= 9', () => {
      const row = db
        .prepare<[], { v: number }>(`SELECT MAX(version) AS v FROM schema_migrations`)
        .get();
      expect(row?.v).toBeGreaterThanOrEqual(9);
    });

    it('is idempotent — re-applying 0009 does not clobber a user override', () => {
      repo.set('find.maxHistoryPerDoc', 99);
      db.exec(
        `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('find.maxHistoryPerDoc', '20')`,
      );
      expect(repo.get('find.maxHistoryPerDoc')).toBe(99);
    });
  });
});
