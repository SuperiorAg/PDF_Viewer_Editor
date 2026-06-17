// Accessibility edit-session repository (C3-C5 side-table).
//
// Backs the in-progress structure-tree authoring buffer (data-models §13.8).
// One row per open doc. The row is written incrementally as the user edits;
// on Save the main process materializes to /StructTreeRoot and deletes the
// row.
//
// Canonical reference: docs/data-models.md §13.8.
//
// JSON columns: every `*_json` column is stored as TEXT verbatim. The bridge
// parses to the renderer-side shapes (data-models §13.10
// `AccessibilityEditSession`). Repo NEVER parses.
//
// Lifecycle (architecture §4.8):
//   1. Renderer opens the session on first pdf:setStructTree /
//      setReadingOrder / setAltText for a given doc -> upsertOnOpen.
//   2. Renderer updates incrementally -> update.
//   3. Main process deletes on successful Save -> deleteByDocHash.
//   4. Startup GC: deleteOlderThan(cutoffMs) — renderer calls with
//      (now - 14 days) on launch.
//
// Method surface:
//   * upsertOnOpen(input)        — INSERT OR IGNORE if no session exists;
//                                   returns existing or new row.
//   * update(docHash, patch)     — UPDATE the mutable JSON columns +
//                                   updated_at. Returns rows affected.
//   * getByDocHash(docHash)      — single row, or null.
//   * deleteByDocHash(docHash)   — DELETE; returns rows removed.
//   * deleteOlderThan(cutoffMs)  — bulk GC; returns rows removed.

import type BetterSqlite3 from 'better-sqlite3';

import type { AccessibilityEditSessionRow } from '../types';

// ============================================================
// Public shape
// ============================================================

export interface UpsertOnOpenInput {
  doc_hash: string;
  /** JSON-encoded StructTreeNode root. */
  struct_tree_json: string;
  /** Defaults to '[]'. */
  reading_order_json?: string;
  /** Defaults to '{}'. */
  alt_text_overrides_json?: string;
  /** 0/1 snapshot of the doc's tagged-state at session open. */
  has_existing_tags: 0 | 1 | boolean;
  /** Optional override; defaults to Date.now(). */
  created_at?: number;
  updated_at?: number;
}

export interface UpdateAccessibilityEditSessionInput {
  struct_tree_json?: string;
  reading_order_json?: string;
  alt_text_overrides_json?: string;
  /** Optional override; defaults to Date.now(). */
  updated_at?: number;
}

export interface AccessibilityEditSessionRepo {
  upsertOnOpen(input: UpsertOnOpenInput): AccessibilityEditSessionRow;
  update(docHash: string, patch: UpdateAccessibilityEditSessionInput): number;
  getByDocHash(docHash: string): AccessibilityEditSessionRow | null;
  deleteByDocHash(docHash: string): number;
  deleteOlderThan(cutoffMs: number): number;
}

// ============================================================
// Factory
// ============================================================

const SELECT_COLUMNS = `
  id, doc_hash, struct_tree_json, reading_order_json, alt_text_overrides_json,
  has_existing_tags, created_at, updated_at
`;

export function createAccessibilityEditSessionRepo(
  db: BetterSqlite3.Database,
): AccessibilityEditSessionRepo {
  // INSERT OR IGNORE on UNIQUE(doc_hash) — if a session already exists, leave
  // it untouched (the renderer might be re-opening the same doc).
  const insertStmt = db.prepare<{
    doc_hash: string;
    struct_tree_json: string;
    reading_order_json: string;
    alt_text_overrides_json: string;
    has_existing_tags: 0 | 1;
    created_at: number;
    updated_at: number;
  }>(
    `INSERT OR IGNORE INTO accessibility_edit_session
        (doc_hash, struct_tree_json, reading_order_json, alt_text_overrides_json,
         has_existing_tags, created_at, updated_at)
       VALUES
        (@doc_hash, @struct_tree_json, @reading_order_json, @alt_text_overrides_json,
         @has_existing_tags, @created_at, @updated_at)`,
  );

  const getByDocHashStmt = db.prepare<{ doc_hash: string }, AccessibilityEditSessionRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM accessibility_edit_session
      WHERE doc_hash = @doc_hash
      LIMIT 1`,
  );

  const deleteByDocHashStmt = db.prepare<{ doc_hash: string }>(
    `DELETE FROM accessibility_edit_session WHERE doc_hash = @doc_hash`,
  );

  const deleteOlderThanStmt = db.prepare<{ cutoff: number }>(
    `DELETE FROM accessibility_edit_session WHERE updated_at < @cutoff`,
  );

  return {
    upsertOnOpen(input: UpsertOnOpenInput): AccessibilityEditSessionRow {
      assertNonEmptyString(input.doc_hash, 'doc_hash');
      assertNonEmptyString(input.struct_tree_json, 'struct_tree_json');

      const hasExistingTags: 0 | 1 = input.has_existing_tags ? 1 : 0;
      const now = Date.now();

      const txn = db.transaction((): AccessibilityEditSessionRow => {
        insertStmt.run({
          doc_hash: input.doc_hash,
          struct_tree_json: input.struct_tree_json,
          reading_order_json: input.reading_order_json ?? '[]',
          alt_text_overrides_json: input.alt_text_overrides_json ?? '{}',
          has_existing_tags: hasExistingTags,
          created_at: input.created_at ?? now,
          updated_at: input.updated_at ?? now,
        });

        const row = getByDocHashStmt.get({ doc_hash: input.doc_hash });
        if (!row) {
          throw new Error(
            `upsertOnOpen post-condition violated: row not found for doc_hash=${input.doc_hash}`,
          );
        }
        return row;
      });
      return txn();
    },

    update(docHash: string, patch: UpdateAccessibilityEditSessionInput): number {
      assertNonEmptyString(docHash, 'doc_hash');

      const sets: string[] = [];
      const params: Record<string, unknown> = { doc_hash: docHash };

      const whitelist: ReadonlyArray<keyof UpdateAccessibilityEditSessionInput> = [
        'struct_tree_json',
        'reading_order_json',
        'alt_text_overrides_json',
      ];

      for (const key of whitelist) {
        if (patch[key] !== undefined) {
          sets.push(`${key} = @${key}`);
          params[key] = patch[key];
        }
      }

      // updated_at always bumps when an update lands.
      if (sets.length > 0) {
        sets.push(`updated_at = @updated_at`);
        params['updated_at'] = patch.updated_at ?? Date.now();
      } else {
        return 0;
      }

      const stmt = db.prepare(
        `UPDATE accessibility_edit_session SET ${sets.join(', ')} WHERE doc_hash = @doc_hash`,
      );
      return stmt.run(params).changes;
    },

    getByDocHash(docHash: string): AccessibilityEditSessionRow | null {
      assertNonEmptyString(docHash, 'doc_hash');
      return getByDocHashStmt.get({ doc_hash: docHash }) ?? null;
    },

    deleteByDocHash(docHash: string): number {
      assertNonEmptyString(docHash, 'doc_hash');
      return deleteByDocHashStmt.run({ doc_hash: docHash }).changes;
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

function assertNonEmptyString(s: unknown, label: string): void {
  if (typeof s !== 'string' || s.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}
