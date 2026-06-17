// Accessibility check-history repository.
//
// Backs the C6 Accessibility Checker recent-runs surface + the
// `accessibility:*` IPC handlers (David Phase 7.5 Wave 5a). One row per
// check run.
//
// Canonical reference: docs/data-models.md §13.7.
//
// JSON column: `results_json` is stored as TEXT verbatim. The bridge parses
// to `AccessibilityRuleResult[]` at the IPC boundary (data-models §13.10).
// Repo NEVER parses (Wave 12/16/20/24 precedent).
//
// `shipped_rule_count` snapshots the rule count at check time (data-models
// §13.7 honest disclosure). A later wave that adds rules does NOT
// retroactively change the historical entry's denominator.
//
// Cap (data-models §13.7): keep the 10 most recent runs per doc, enforced
// by the renderer-side housekeeping pass via `trimForDocHash(docHash, max)`
// after each successful run — same posture as find_history.
//
// Method surface:
//   * insert(input)                  — INSERT a new run. Returns the new id.
//   * listByDocHash(docHash, limit?) — most-recent first per (composite)
//                                       index.
//   * getById(id)                    — single row, or null.
//   * deleteForDocHash(docHash)      — bulk delete; returns rows removed.
//   * trimForDocHash(docHash, max)   — keep the `max` most-recent rows per
//                                       doc; delete the rest. Returns rows
//                                       removed.

import type BetterSqlite3 from 'better-sqlite3';

import type { AccessibilityCheckHistoryRow } from '../types';

// ============================================================
// Public shape
// ============================================================

export interface InsertAccessibilityCheckInput {
  doc_hash: string;
  ran_at: number;
  /** JSON-encoded AccessibilityRuleResult[]. Repo stores verbatim. */
  results_json: string;
  pass_count: number;
  warn_count: number;
  fail_count: number;
  shipped_rule_count: number;
}

export interface AccessibilityCheckHistoryRepo {
  insert(input: InsertAccessibilityCheckInput): number;
  listByDocHash(docHash: string, limit?: number): AccessibilityCheckHistoryRow[];
  getById(id: number): AccessibilityCheckHistoryRow | null;
  deleteForDocHash(docHash: string): number;
  trimForDocHash(docHash: string, max: number): number;
}

// ============================================================
// Factory
// ============================================================

const SELECT_COLUMNS = `
  id, doc_hash, ran_at, results_json,
  pass_count, warn_count, fail_count, shipped_rule_count
`;

const DEFAULT_LIST_LIMIT = 10;

export function createAccessibilityCheckHistoryRepo(
  db: BetterSqlite3.Database,
): AccessibilityCheckHistoryRepo {
  const insertStmt = db.prepare<{
    doc_hash: string;
    ran_at: number;
    results_json: string;
    pass_count: number;
    warn_count: number;
    fail_count: number;
    shipped_rule_count: number;
  }>(
    `INSERT INTO accessibility_check_history
        (doc_hash, ran_at, results_json,
         pass_count, warn_count, fail_count, shipped_rule_count)
       VALUES
        (@doc_hash, @ran_at, @results_json,
         @pass_count, @warn_count, @fail_count, @shipped_rule_count)`,
  );

  const listByDocHashStmt = db.prepare<
    { doc_hash: string; limit: number },
    AccessibilityCheckHistoryRow
  >(
    `SELECT ${SELECT_COLUMNS}
       FROM accessibility_check_history
      WHERE doc_hash = @doc_hash
      ORDER BY ran_at DESC, id DESC
      LIMIT @limit`,
  );

  const getByIdStmt = db.prepare<{ id: number }, AccessibilityCheckHistoryRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM accessibility_check_history
      WHERE id = @id
      LIMIT 1`,
  );

  const deleteForDocHashStmt = db.prepare<{ doc_hash: string }>(
    `DELETE FROM accessibility_check_history WHERE doc_hash = @doc_hash`,
  );

  const trimForDocHashStmt = db.prepare<{ doc_hash: string; max: number }>(
    `DELETE FROM accessibility_check_history
      WHERE doc_hash = @doc_hash
        AND id NOT IN (
          SELECT id FROM accessibility_check_history
           WHERE doc_hash = @doc_hash
           ORDER BY ran_at DESC, id DESC
           LIMIT @max
        )`,
  );

  return {
    insert(input: InsertAccessibilityCheckInput): number {
      assertInsertPayload(input);
      const result = insertStmt.run({
        doc_hash: input.doc_hash,
        ran_at: input.ran_at,
        results_json: input.results_json,
        pass_count: input.pass_count,
        warn_count: input.warn_count,
        fail_count: input.fail_count,
        shipped_rule_count: input.shipped_rule_count,
      });
      const rowid = result.lastInsertRowid;
      return typeof rowid === 'bigint' ? Number(rowid) : rowid;
    },

    listByDocHash(
      docHash: string,
      limit: number = DEFAULT_LIST_LIMIT,
    ): AccessibilityCheckHistoryRow[] {
      assertNonEmptyString(docHash, 'doc_hash');
      const safeLimit =
        Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIST_LIMIT;
      return listByDocHashStmt.all({ doc_hash: docHash, limit: safeLimit });
    },

    getById(id: number): AccessibilityCheckHistoryRow | null {
      assertValidId(id, 'id');
      return getByIdStmt.get({ id }) ?? null;
    },

    deleteForDocHash(docHash: string): number {
      assertNonEmptyString(docHash, 'doc_hash');
      return deleteForDocHashStmt.run({ doc_hash: docHash }).changes;
    },

    trimForDocHash(docHash: string, max: number): number {
      assertNonEmptyString(docHash, 'doc_hash');
      assertPositiveInt(max, 'max');
      return trimForDocHashStmt.run({ doc_hash: docHash, max }).changes;
    },
  };
}

// ============================================================
// Validators
// ============================================================

function assertInsertPayload(input: InsertAccessibilityCheckInput): void {
  assertNonEmptyString(input.doc_hash, 'doc_hash');
  if (!Number.isFinite(input.ran_at) || input.ran_at < 0) {
    throw new Error('ran_at must be a non-negative ms epoch');
  }
  if (typeof input.results_json !== 'string') {
    throw new Error('results_json must be a string (JSON-encoded results)');
  }
  assertNonNegativeInt(input.pass_count, 'pass_count');
  assertNonNegativeInt(input.warn_count, 'warn_count');
  assertNonNegativeInt(input.fail_count, 'fail_count');
  assertNonNegativeInt(input.shipped_rule_count, 'shipped_rule_count');
  const summed = input.pass_count + input.warn_count + input.fail_count;
  if (summed > input.shipped_rule_count) {
    throw new Error(
      `pass+warn+fail (${String(summed)}) cannot exceed shipped_rule_count (${String(input.shipped_rule_count)})`,
    );
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

function assertPositiveInt(n: number, label: string): void {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertValidId(id: number, label: string): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${label}: ${String(id)} (must be positive integer)`);
  }
}
