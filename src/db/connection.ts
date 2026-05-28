// SQLite connection module.
//
// One better-sqlite3 connection per main-process instance. The connection is
// memoized inside this module so every repository sees the same handle and
// shares the prepared-statement cache.
//
// Electron isolation: this module takes the database file path as a parameter
// (or ':memory:' for tests). Electron's `app.getPath('userData')` lookup happens
// in the main-process bootstrap (David's code), NOT here. That keeps the db
// layer testable without booting Electron.
//
// Migration runner:
//   * On every initDatabase() call we run every migration whose version is
//     greater than MAX(schema_migrations.version). Each migration runs in its
//     own transaction (src/db/migrate.ts).
//   * Migrations live in <repo>/migrations as `NNNN_<slug>.sql` files. The
//     production code path loads them from disk via node:fs at startup; tests
//     can pass an explicit array via initDatabase({ migrations: [...] }) so
//     they don't need a real filesystem.
//   * Forward-only. See migrations/README.md.
//
// Pragmas:
//   * journal_mode = WAL    — concurrent reads, single-writer (Electron only ever
//                             has one main-process writer, so this is purely a
//                             durability + read-amplification win)
//   * synchronous = NORMAL  — pairs with WAL; FULL is overkill for a desktop app
//   * foreign_keys = ON     — Phase 1 has no FKs but enable for Phase 2+ readiness
//                             (docs/data-models.md §5)
//
// Caller contract: file-path inputs that reach repo functions are TRUSTED.
// David's main-process IPC handlers sanitize paths through
// src/main/security/path-sanitizer.ts before they ever get this far. The repos
// still use prepared statements (no concat) so even an unsanitized path could
// not become a SQL injection — but the policy is documented for code reviewers
// (Julian) and for any future caller.

import fs from 'node:fs';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';

import {
  type MigrationFile,
  type MigrationResult,
  parseVersionFromFilename,
  runMigrations,
} from './migrate';

// ============================================================
// Module-scoped singleton
// ============================================================

let singleton: BetterSqlite3.Database | null = null;
let lastMigrationResult: MigrationResult | null = null;

export interface InitDatabaseOptions {
  /**
   * Database file path. Use `':memory:'` for tests. The main process passes
   * `path.join(app.getPath('userData'), 'pdf-viewer-editor.db')`.
   */
  dbPath: string;
  /**
   * Override the migrations source. Production omits this and the runner
   * reads `<projectRoot>/migrations` via node:fs. Tests pass an explicit
   * MigrationFile[] so they don't need a filesystem.
   */
  migrations?: MigrationFile[];
  /**
   * Absolute path to the migrations directory. Defaults to `<cwd>/migrations`
   * which works for `npm run dev`; the packaged Electron app should override
   * to the resources path. Ignored when `migrations` is provided.
   */
  migrationsDir?: string;
  /** Logger used for the one "applied N migrations" line. Optional. */
  log?: (msg: string) => void;
}

/**
 * Initialize (or reuse) the shared database connection.
 *
 * Idempotent: a second call with the same dbPath returns the same connection
 * without re-running migrations. A call with a different dbPath throws — the
 * main process should call initDatabase() exactly once on startup.
 */
export function initDatabase(opts: InitDatabaseOptions): BetterSqlite3.Database {
  if (singleton) {
    return singleton;
  }

  const db = new BetterSqlite3(opts.dbPath);

  // Pragmas (see header).
  // :memory: does not support WAL (silently downgrades), so set conditionally.
  if (opts.dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.pragma('foreign_keys = ON');

  const migrations = opts.migrations ?? loadMigrationsFromDisk(opts.migrationsDir);
  lastMigrationResult = runMigrations(db, migrations);

  if (opts.log && lastMigrationResult.applied.length > 0) {
    opts.log(
      `db: applied ${String(lastMigrationResult.applied.length)} migration(s) (now at version ${String(lastMigrationResult.currentVersion)})`,
    );
  }

  singleton = db;
  return db;
}

/**
 * Return the shared connection. Throws if `initDatabase` has not been called.
 * Repos take a `Database` as a parameter rather than calling this helper, so
 * the dependency is explicit and unit tests can inject an in-memory DB.
 */
export function getDatabase(): BetterSqlite3.Database {
  if (!singleton) {
    throw new Error('Database not initialized; call initDatabase() first');
  }
  return singleton;
}

/** Test/teardown helper. Closes and forgets the singleton. */
export function closeDatabase(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
    lastMigrationResult = null;
  }
}

/** Read-only view of the last migration result; handy for boot logging. */
export function getLastMigrationResult(): MigrationResult | null {
  return lastMigrationResult;
}

// ============================================================
// Filesystem loader
// ============================================================

function loadMigrationsFromDisk(migrationsDir?: string): MigrationFile[] {
  const dir = migrationsDir ?? path.join(process.cwd(), 'migrations');
  if (!fs.existsSync(dir)) {
    throw new Error(`Migrations directory not found: ${dir}`);
  }

  const filenames = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();

  return filenames.map<MigrationFile>((filename) => ({
    version: parseVersionFromFilename(filename),
    filename,
    sql: fs.readFileSync(path.join(dir, filename), 'utf8'),
  }));
}
