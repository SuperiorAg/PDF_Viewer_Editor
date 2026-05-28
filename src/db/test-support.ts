// Test-only helper that builds a fresh in-memory database with the canonical
// migration applied. Imported by the *.test.ts files under repositories/ so
// they don't each have to re-implement the bootstrap.
//
// This file is intentionally not under any explicit "test-only" guard — Vitest's
// default include pattern picks up `*.test.ts` and ignores plain modules, so
// production bundles won't accidentally include it as long as the build config
// excludes `*test-support*` from the main-process entry tree. Diego (Wave 3)
// adds the exclude pattern to the esbuild config.

import fs from 'node:fs';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';

import { type MigrationFile, parseVersionFromFilename, runMigrations } from './migrate';

/**
 * Load every `*.sql` file under <repoRoot>/migrations and return them as
 * MigrationFile[]. The repo root is resolved by walking up from this file
 * until we find a `migrations` directory; this keeps the helper insensitive
 * to where Vitest is invoked from.
 */
export function loadMigrationsForTests(): MigrationFile[] {
  const migrationsDir = findMigrationsDir();
  const filenames = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();

  return filenames.map<MigrationFile>((filename) => ({
    version: parseVersionFromFilename(filename),
    filename,
    sql: fs.readFileSync(path.join(migrationsDir, filename), 'utf8'),
  }));
}

/**
 * Spin up a fresh `:memory:` database with all migrations applied. Tests should
 * dispose the returned db in afterEach to avoid leaking connections.
 */
export function makeTestDatabase(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrationsForTests());
  return db;
}

function findMigrationsDir(): string {
  // Walk up from this file's directory until we find <ancestor>/migrations.
  // __dirname-style resolution via import.meta.url would require ESM gymnastics;
  // we just probe process.cwd() and a few likely parents.
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '..', '..'),
  ];
  for (const root of candidates) {
    const candidate = path.join(root, 'migrations');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  throw new Error(
    `Could not locate migrations/ relative to cwd=${process.cwd()}; checked: ${candidates.join(', ')}`,
  );
}
