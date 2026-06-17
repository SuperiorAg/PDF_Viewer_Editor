// Find history repository.
//
// Backs the B3 Find/Search autocomplete + the `find:*` IPC handlers (David
// Phase 7.5). Per-doc cap (default 20) + global cap (default 200) are enforced
// at write time via the housekeeping helpers — same posture as Phase 5 OCR
// cleanup (lifecycle lives in the repo / bridge, NOT in SQL triggers).
//
// Canonical reference: docs/data-models.md §13.3.
//
// Privacy posture (data-models §13.3): `query` strings can contain document
// content fragments. NEVER cross-doc shared. NEVER included in telemetry
// (Phase 7 §12.4 ring buffer is in-memory only). Stored locally only.
//
// Method surface:
//   * upsert(input)               — INSERT or refresh last_used_at on the
//                                    UNIQUE(file_hash, query, case_sensitive,
//                                    whole_word) tuple. Returns id.
//   * listByFileHash(hash, limit?) — most-recent first per (composite) index.
//   * clearForFileHash(hash)      — bulk delete; returns rows removed.
//   * clearAll()                  — bulk delete; returns rows removed.
//   * trimForFileHash(hash, max)  — keep the `max` most-recent rows per doc;
//                                    delete the rest. Returns rows removed.
//                                    (Renderer-side housekeeping per §13.3.)
//   * trimGlobal(max)             — keep the `max` most-recent rows total;
//                                    delete the rest. Returns rows removed.

import type BetterSqlite3 from 'better-sqlite3';

import type { FindHistoryRow } from '../types';

// ============================================================
// Public shape
// ============================================================

export interface UpsertFindHistoryInput {
  file_hash: string;
  query: string;
  /** Defaults to false. */
  case_sensitive?: boolean;
  /** Defaults to false. */
  whole_word?: boolean;
  /** Optional override; defaults to Date.now() at write time. */
  last_used_at?: number;
}

export interface FindHistoryRepo {
  upsert(input: UpsertFindHistoryInput): number;
  listByFileHash(fileHash: string, limit?: number): FindHistoryRow[];
  clearForFileHash(fileHash: string): number;
  clearAll(): number;
  trimForFileHash(fileHash: string, max: number): number;
  trimGlobal(max: number): number;
}

// ============================================================
// Factory
// ============================================================

const SELECT_COLUMNS = `id, file_hash, query, case_sensitive, whole_word, last_used_at`;
const DEFAULT_LIST_LIMIT = 20;

export function createFindHistoryRepo(db: BetterSqlite3.Database): FindHistoryRepo {
  const upsertStmt = db.prepare<{
    file_hash: string;
    query: string;
    case_sensitive: 0 | 1;
    whole_word: 0 | 1;
    last_used_at: number;
  }>(
    `INSERT INTO find_history (file_hash, query, case_sensitive, whole_word, last_used_at)
       VALUES (@file_hash, @query, @case_sensitive, @whole_word, @last_used_at)
       ON CONFLICT (file_hash, query, case_sensitive, whole_word) DO UPDATE SET
         last_used_at = excluded.last_used_at`,
  );

  const selectIdStmt = db.prepare<
    { file_hash: string; query: string; case_sensitive: 0 | 1; whole_word: 0 | 1 },
    { id: number }
  >(
    `SELECT id FROM find_history
      WHERE file_hash = @file_hash
        AND query = @query
        AND case_sensitive = @case_sensitive
        AND whole_word = @whole_word
      LIMIT 1`,
  );

  const listByFileHashStmt = db.prepare<{ file_hash: string; limit: number }, FindHistoryRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM find_history
      WHERE file_hash = @file_hash
      ORDER BY last_used_at DESC, id DESC
      LIMIT @limit`,
  );

  const clearForFileHashStmt = db.prepare<{ file_hash: string }>(
    `DELETE FROM find_history WHERE file_hash = @file_hash`,
  );

  const clearAllStmt = db.prepare(`DELETE FROM find_history`);

  // Keep the N most recent per file_hash, delete the rest.
  // The subquery picks the IDs to keep; the DELETE removes everything else for
  // the same file_hash.
  const trimForFileHashStmt = db.prepare<{ file_hash: string; max: number }>(
    `DELETE FROM find_history
      WHERE file_hash = @file_hash
        AND id NOT IN (
          SELECT id FROM find_history
           WHERE file_hash = @file_hash
           ORDER BY last_used_at DESC, id DESC
           LIMIT @max
        )`,
  );

  // Keep the N most recent globally, delete the rest.
  const trimGlobalStmt = db.prepare<{ max: number }>(
    `DELETE FROM find_history
      WHERE id NOT IN (
        SELECT id FROM find_history
         ORDER BY last_used_at DESC, id DESC
         LIMIT @max
      )`,
  );

  return {
    upsert(input: UpsertFindHistoryInput): number {
      assertNonEmptyString(input.file_hash, 'file_hash');
      assertNonEmptyString(input.query, 'query');
      const payload = {
        file_hash: input.file_hash,
        query: input.query,
        case_sensitive: (input.case_sensitive ? 1 : 0) as 0 | 1,
        whole_word: (input.whole_word ? 1 : 0) as 0 | 1,
        last_used_at: input.last_used_at ?? Date.now(),
      };

      // ON CONFLICT DO UPDATE: lastInsertRowid is unreliable across SQLite
      // versions on the UPDATE branch (Wave 20 ocr-results lesson). Always
      // follow the upsert with a SELECT by the unique tuple.
      const txn = db.transaction((): number => {
        upsertStmt.run(payload);
        const row = selectIdStmt.get({
          file_hash: payload.file_hash,
          query: payload.query,
          case_sensitive: payload.case_sensitive,
          whole_word: payload.whole_word,
        });
        if (!row) {
          throw new Error(
            `upsert post-condition violated: row not found for file_hash=${payload.file_hash}, query="${payload.query}"`,
          );
        }
        return row.id;
      });
      return txn();
    },

    listByFileHash(fileHash: string, limit: number = DEFAULT_LIST_LIMIT): FindHistoryRow[] {
      assertNonEmptyString(fileHash, 'file_hash');
      const safeLimit =
        Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIST_LIMIT;
      return listByFileHashStmt.all({ file_hash: fileHash, limit: safeLimit });
    },

    clearForFileHash(fileHash: string): number {
      assertNonEmptyString(fileHash, 'file_hash');
      return clearForFileHashStmt.run({ file_hash: fileHash }).changes;
    },

    clearAll(): number {
      return clearAllStmt.run().changes;
    },

    trimForFileHash(fileHash: string, max: number): number {
      assertNonEmptyString(fileHash, 'file_hash');
      assertPositiveInt(max, 'max');
      return trimForFileHashStmt.run({ file_hash: fileHash, max }).changes;
    },

    trimGlobal(max: number): number {
      assertPositiveInt(max, 'max');
      return trimGlobalStmt.run({ max }).changes;
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

function assertPositiveInt(n: number, label: string): void {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}
