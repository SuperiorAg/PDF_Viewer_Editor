// Compare sessions repository.
//
// Backs the B2 Compare Files cache + the `compare:*` IPC handlers (David
// Phase 7.5). One row per (baseline_file_hash, modified_file_hash) pair,
// recreated when the user opens a new compare session.
//
// Canonical reference: docs/data-models.md §13.5.
//
// JSON columns: every `*_json` column is stored as TEXT verbatim. The bridge
// parses to the renderer-side maps at the IPC boundary (data-models §13.10
// `CompareSession` shape). Repo NEVER parses (Wave 12/16/20/24 precedent).
//
// Bounded growth (data-models §13.5 AR4):
//   1. Startup GC: deleteOlderThan(cutoffMs) — renderer calls on launch.
//   2. Per-row size cap: enforced at WRITE TIME by the bridge before passing
//      the JSON into the repo; the repo does NOT police row size (single-
//      responsibility — it's a SQL layer, not a content validator).
//
// Method surface:
//   * insert(input)             — INSERT a new session. Returns the new id.
//   * update(id, partial)       — UPDATE a subset of mutable columns
//                                  (per_page_*_json + counts + last_diff_
//                                  computed_at). Returns rows affected.
//   * getById(id)               — single row, or null.
//   * listRecent(limit?)        — most-recent first, capped.
//   * deleteById(id)            — DELETE; returns rows removed (0 if not found).
//   * deleteOlderThan(cutoffMs) — DELETE WHERE created_at < cutoffMs;
//                                  returns rows removed.

import type BetterSqlite3 from 'better-sqlite3';

import type { CompareSessionRow } from '../types';

// ============================================================
// Public shape
// ============================================================

export interface InsertCompareSessionInput {
  baseline_file_hash: string;
  modified_file_hash: string;
  baseline_path: string;
  modified_path: string;
  baseline_page_count: number;
  modified_page_count: number;
  /** Optional; defaults to '{}'. */
  per_page_text_baseline_json?: string;
  per_page_text_modified_json?: string;
  per_page_diff_json?: string;
  per_page_visual_diff_json?: string;
  total_pages_with_diff?: number;
  inserted_spans?: number;
  deleted_spans?: number;
  /** Optional; defaults to NULL (no diff computed yet). */
  last_diff_computed_at?: number | null;
  /** Optional override; defaults to Date.now(). */
  created_at?: number;
}

/**
 * Subset of CompareSessionRow that update() accepts. Patch shape; only the
 * provided fields are written.
 */
export interface UpdateCompareSessionInput {
  per_page_text_baseline_json?: string;
  per_page_text_modified_json?: string;
  per_page_diff_json?: string;
  per_page_visual_diff_json?: string;
  total_pages_with_diff?: number;
  inserted_spans?: number;
  deleted_spans?: number;
  last_diff_computed_at?: number | null;
}

export interface CompareSessionsRepo {
  insert(input: InsertCompareSessionInput): number;
  update(id: number, patch: UpdateCompareSessionInput): number;
  getById(id: number): CompareSessionRow | null;
  listRecent(limit?: number): CompareSessionRow[];
  deleteById(id: number): number;
  deleteOlderThan(cutoffMs: number): number;
}

// ============================================================
// Factory
// ============================================================

const SELECT_COLUMNS = `
  id, baseline_file_hash, modified_file_hash, baseline_path, modified_path,
  baseline_page_count, modified_page_count,
  per_page_text_baseline_json, per_page_text_modified_json,
  per_page_diff_json, per_page_visual_diff_json,
  total_pages_with_diff, inserted_spans, deleted_spans,
  last_diff_computed_at, created_at
`;

const DEFAULT_RECENT_LIMIT = 20;

export function createCompareSessionsRepo(db: BetterSqlite3.Database): CompareSessionsRepo {
  const insertStmt = db.prepare<{
    baseline_file_hash: string;
    modified_file_hash: string;
    baseline_path: string;
    modified_path: string;
    baseline_page_count: number;
    modified_page_count: number;
    per_page_text_baseline_json: string;
    per_page_text_modified_json: string;
    per_page_diff_json: string;
    per_page_visual_diff_json: string;
    total_pages_with_diff: number;
    inserted_spans: number;
    deleted_spans: number;
    last_diff_computed_at: number | null;
    created_at: number;
  }>(
    `INSERT INTO compare_sessions
        (baseline_file_hash, modified_file_hash, baseline_path, modified_path,
         baseline_page_count, modified_page_count,
         per_page_text_baseline_json, per_page_text_modified_json,
         per_page_diff_json, per_page_visual_diff_json,
         total_pages_with_diff, inserted_spans, deleted_spans,
         last_diff_computed_at, created_at)
       VALUES
        (@baseline_file_hash, @modified_file_hash, @baseline_path, @modified_path,
         @baseline_page_count, @modified_page_count,
         @per_page_text_baseline_json, @per_page_text_modified_json,
         @per_page_diff_json, @per_page_visual_diff_json,
         @total_pages_with_diff, @inserted_spans, @deleted_spans,
         @last_diff_computed_at, @created_at)`,
  );

  const getByIdStmt = db.prepare<{ id: number }, CompareSessionRow>(
    `SELECT ${SELECT_COLUMNS} FROM compare_sessions WHERE id = @id LIMIT 1`,
  );

  const listRecentStmt = db.prepare<{ limit: number }, CompareSessionRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM compare_sessions
      ORDER BY created_at DESC, id DESC
      LIMIT @limit`,
  );

  const deleteByIdStmt = db.prepare<{ id: number }>(`DELETE FROM compare_sessions WHERE id = @id`);

  const deleteOlderThanStmt = db.prepare<{ cutoff: number }>(
    `DELETE FROM compare_sessions WHERE created_at < @cutoff`,
  );

  return {
    insert(input: InsertCompareSessionInput): number {
      assertInsertPayload(input);

      const result = insertStmt.run({
        baseline_file_hash: input.baseline_file_hash,
        modified_file_hash: input.modified_file_hash,
        baseline_path: input.baseline_path,
        modified_path: input.modified_path,
        baseline_page_count: input.baseline_page_count,
        modified_page_count: input.modified_page_count,
        per_page_text_baseline_json: input.per_page_text_baseline_json ?? '{}',
        per_page_text_modified_json: input.per_page_text_modified_json ?? '{}',
        per_page_diff_json: input.per_page_diff_json ?? '{}',
        per_page_visual_diff_json: input.per_page_visual_diff_json ?? '{}',
        total_pages_with_diff: input.total_pages_with_diff ?? 0,
        inserted_spans: input.inserted_spans ?? 0,
        deleted_spans: input.deleted_spans ?? 0,
        last_diff_computed_at: input.last_diff_computed_at ?? null,
        created_at: input.created_at ?? Date.now(),
      });
      const rowid = result.lastInsertRowid;
      return typeof rowid === 'bigint' ? Number(rowid) : rowid;
    },

    update(id: number, patch: UpdateCompareSessionInput): number {
      assertValidId(id, 'id');

      // Build SET clauses dynamically from the patch keys so a small patch
      // doesn't overwrite untouched columns. Whitelisted keys only — never
      // splice user input into SQL.
      const sets: string[] = [];
      const params: Record<string, unknown> = { id };

      const whitelist: ReadonlyArray<keyof UpdateCompareSessionInput> = [
        'per_page_text_baseline_json',
        'per_page_text_modified_json',
        'per_page_diff_json',
        'per_page_visual_diff_json',
        'total_pages_with_diff',
        'inserted_spans',
        'deleted_spans',
        'last_diff_computed_at',
      ];

      for (const key of whitelist) {
        if (patch[key] !== undefined) {
          sets.push(`${key} = @${key}`);
          params[key] = patch[key];
        }
      }

      if (sets.length === 0) {
        return 0;
      }

      // Prepared on the fly (the dynamic SET list precludes a single cached
      // prepared statement). The session-update call rate is low (a few per
      // user-session at most), so the per-call prepare cost is fine.
      const stmt = db.prepare(`UPDATE compare_sessions SET ${sets.join(', ')} WHERE id = @id`);
      return stmt.run(params).changes;
    },

    getById(id: number): CompareSessionRow | null {
      assertValidId(id, 'id');
      return getByIdStmt.get({ id }) ?? null;
    },

    listRecent(limit: number = DEFAULT_RECENT_LIMIT): CompareSessionRow[] {
      const safeLimit =
        Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_RECENT_LIMIT;
      return listRecentStmt.all({ limit: safeLimit });
    },

    deleteById(id: number): number {
      assertValidId(id, 'id');
      return deleteByIdStmt.run({ id }).changes;
    },

    deleteOlderThan(cutoffMs: number): number {
      if (!Number.isFinite(cutoffMs) || cutoffMs < 0) {
        throw new Error('cutoffMs must be a non-negative ms epoch');
      }
      return deleteOlderThanStmt.run({ cutoff: cutoffMs }).changes;
    },
  };
}

// ============================================================
// Validators
// ============================================================

function assertInsertPayload(input: InsertCompareSessionInput): void {
  assertNonEmptyString(input.baseline_file_hash, 'baseline_file_hash');
  assertNonEmptyString(input.modified_file_hash, 'modified_file_hash');
  assertNonEmptyString(input.baseline_path, 'baseline_path');
  assertNonEmptyString(input.modified_path, 'modified_path');
  assertNonNegativeInt(input.baseline_page_count, 'baseline_page_count');
  assertNonNegativeInt(input.modified_page_count, 'modified_page_count');
  if (
    input.total_pages_with_diff !== undefined &&
    (!Number.isInteger(input.total_pages_with_diff) || input.total_pages_with_diff < 0)
  ) {
    throw new Error('total_pages_with_diff must be a non-negative integer');
  }
  if (
    input.inserted_spans !== undefined &&
    (!Number.isInteger(input.inserted_spans) || input.inserted_spans < 0)
  ) {
    throw new Error('inserted_spans must be a non-negative integer');
  }
  if (
    input.deleted_spans !== undefined &&
    (!Number.isInteger(input.deleted_spans) || input.deleted_spans < 0)
  ) {
    throw new Error('deleted_spans must be a non-negative integer');
  }
  if (
    input.last_diff_computed_at !== undefined &&
    input.last_diff_computed_at !== null &&
    (!Number.isFinite(input.last_diff_computed_at) || input.last_diff_computed_at < 0)
  ) {
    throw new Error('last_diff_computed_at must be a non-negative ms epoch or null');
  }
}

function assertNonEmptyString(s: unknown, label: string): void {
  if (typeof s !== 'string' || s.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertNonNegativeInt(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function assertValidId(id: number, label: string): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${label}: ${String(id)} (must be positive integer)`);
  }
}
