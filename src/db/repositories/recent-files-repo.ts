// Recent-files repository.
//
// Backs the `recents:*` IPC channels (docs/api-contracts.md §4) and the
// recent_files table (docs/data-models.md §2). Pure functions over a
// better-sqlite3 Database — no Electron API access, no singleton ownership.
//
// Caller contract: `path` strings are TRUSTED at this layer. David's main-process
// handlers sanitize them via src/main/security/path-sanitizer.ts before they
// reach the repo. The repo uses prepared statements regardless, so even an
// unsanitized path cannot SQL-inject; the policy note is for reviewers.

import type BetterSqlite3 from 'better-sqlite3';

import type { RecentFileRow } from '../types';

// ============================================================
// Public shape
// ============================================================

export interface UpsertRecentFileInput {
  path: string;
  display_name: string;
  file_hash: string;
  /** Optional override; defaults to Date.now() at write time. */
  last_opened_at?: number;
}

export interface RecentFilesRepo {
  /** Most-recently-opened first; capped at `limit`. */
  list(limit?: number): RecentFileRow[];

  /**
   * Insert-or-update by path. If the row exists we bump last_opened_at and
   * refresh the hash/display name (hash can change if the file was edited
   * outside the app; display name can change on rename).
   */
  upsert(input: UpsertRecentFileInput): void;

  /** Remove every row. Returns count deleted. */
  clear(): number;

  /** Lookup by exact path; returns null if not present. */
  getByPath(path: string): RecentFileRow | null;
}

// ============================================================
// Factory
// ============================================================

const DEFAULT_LIMIT = 20;

export function createRecentFilesRepo(db: BetterSqlite3.Database): RecentFilesRepo {
  // Prepared statements cached once per repo instance.
  // (data-models §5: "Prepared statements cached in repository constructors.")
  const listStmt = db.prepare<{ limit: number }, RecentFileRow>(
    `SELECT path, last_opened_at, file_hash, display_name
       FROM recent_files
      ORDER BY last_opened_at DESC
      LIMIT @limit`,
  );

  const getByPathStmt = db.prepare<{ path: string }, RecentFileRow>(
    `SELECT path, last_opened_at, file_hash, display_name
       FROM recent_files
      WHERE path = @path`,
  );

  // ON CONFLICT update: bump last_opened_at + refresh hash/display_name.
  // Uses SQLite's UPSERT (3.24+, far below better-sqlite3's bundled version).
  const upsertStmt = db.prepare<{
    path: string;
    last_opened_at: number;
    file_hash: string;
    display_name: string;
  }>(
    `INSERT INTO recent_files (path, last_opened_at, file_hash, display_name)
       VALUES (@path, @last_opened_at, @file_hash, @display_name)
       ON CONFLICT(path) DO UPDATE SET
         last_opened_at = excluded.last_opened_at,
         file_hash      = excluded.file_hash,
         display_name   = excluded.display_name`,
  );

  const clearStmt = db.prepare('DELETE FROM recent_files');

  return {
    list(limit: number = DEFAULT_LIMIT): RecentFileRow[] {
      const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT;
      return listStmt.all({ limit: safeLimit });
    },

    upsert(input: UpsertRecentFileInput): void {
      upsertStmt.run({
        path: input.path,
        last_opened_at: input.last_opened_at ?? Date.now(),
        file_hash: input.file_hash,
        display_name: input.display_name,
      });
    },

    clear(): number {
      const result = clearStmt.run();
      return result.changes;
    },

    getByPath(path: string): RecentFileRow | null {
      return getByPathStmt.get({ path }) ?? null;
    },
  };
}
