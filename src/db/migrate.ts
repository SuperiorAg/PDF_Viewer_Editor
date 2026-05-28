// Migration runner.
//
// Reads MAX(schema_migrations.version), then applies every numbered SQL file in
// migrations/ whose version is greater. Each migration runs inside its own
// transaction so a partial failure rolls back cleanly and the version row is
// never recorded (see migrations/README.md "Rollback" + docs/data-models.md §6.3).
//
// The runner is path-injected (migrationsDir + readFile fn) so it is testable
// without Electron or a real filesystem. The production caller in
// src/db/connection.ts plugs in node:fs.

import type BetterSqlite3 from 'better-sqlite3';

// ============================================================
// Public API
// ============================================================

export interface MigrationFile {
  /** Sequential version number parsed from the filename (e.g. 0001 → 1). */
  version: number;
  /** Original filename, kept for error messages. */
  filename: string;
  /** Raw SQL contents — the runner executes this verbatim inside a transaction. */
  sql: string;
}

export interface MigrationResult {
  /** Versions actually applied during this run (empty if already up-to-date). */
  applied: number[];
  /** Highest version present in schema_migrations after the run. */
  currentVersion: number;
}

/**
 * Apply every migration whose version is greater than the current watermark.
 *
 * The `schema_migrations` table is created lazily on first call so the very
 * first migration (0001_init.sql) doesn't have to bootstrap it itself — that
 * keeps each migration file focused on a single concern.
 */
export function runMigrations(
  db: BetterSqlite3.Database,
  migrations: MigrationFile[],
): MigrationResult {
  ensureMigrationsTable(db);

  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  assertContiguousVersions(sorted);

  const currentVersionStmt = db.prepare<[], { v: number | null }>(
    'SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations',
  );
  const recordStmt = db.prepare<{ version: number; applied_at: number }>(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (@version, @applied_at)',
  );

  const startingRow = currentVersionStmt.get();
  let watermark = startingRow?.v ?? 0;
  const applied: number[] = [];

  for (const m of sorted) {
    if (m.version <= watermark) continue;

    // Each migration is its own transaction. If anything throws inside,
    // the entire batch (DDL + version row) rolls back atomically.
    const apply = db.transaction(() => {
      db.exec(m.sql);
      recordStmt.run({ version: m.version, applied_at: Date.now() });
    });

    try {
      apply();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Migration ${m.filename} (version ${String(m.version)}) failed: ${message}`);
    }

    watermark = m.version;
    applied.push(m.version);
  }

  return { applied, currentVersion: watermark };
}

// ============================================================
// Helpers
// ============================================================

function ensureMigrationsTable(db: BetterSqlite3.Database): void {
  // Idempotent — the 0001 migration also declares this table with the same shape.
  // Doing it here too means a brand-new database can record the very first migration
  // without ordering pain.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
}

function assertContiguousVersions(sorted: MigrationFile[]): void {
  for (let i = 0; i < sorted.length; i++) {
    const expected = i + 1;
    const file = sorted[i];
    // noUncheckedIndexedAccess: file may be undefined per TS — defensive guard.
    if (!file) {
      throw new Error(`Internal: missing migration at index ${String(i)}`);
    }
    if (file.version !== expected) {
      throw new Error(
        `Migration version gap: expected ${String(expected)} but found ${String(file.version)} (${file.filename})`,
      );
    }
  }
}

/**
 * Parse the version number out of a migration filename.
 *
 * Accepts `0001_init.sql`, `0001-init.sql`, `1_init.sql`. Rejects anything that
 * doesn't start with at least one digit.
 */
export function parseVersionFromFilename(filename: string): number {
  const match = /^(\d+)/.exec(filename);
  if (!match || !match[1]) {
    throw new Error(`Migration filename must start with a version number: ${filename}`);
  }
  return Number.parseInt(match[1], 10);
}
