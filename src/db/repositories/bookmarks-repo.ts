// User-bookmarks repository.
//
// Backs the `bookmarks:*` IPC channels (docs/api-contracts.md §6 + §12.5-§12.7)
// and the user_bookmarks table (docs/data-models.md §2 + §7.3). Bookmarks are
// keyed by `file_hash` (not by path) so a renamed/moved file keeps its
// bookmarks (data-models §6.1).
//
// UNIQUE(file_hash, page_index, title) means a redundant upsert that would
// create a duplicate row instead refreshes the existing one. The repo surfaces
// duplicate-detection by returning the existing id rather than failing.
//
// Phase 2 (migrations/0002_phase2_bookmarks.sql) adds:
//   * parent_id   — nesting (NULL = top-level)
//   * sort_order  — sparse integer for sibling ordering
//
// New methods (Phase 2, additive — Phase-1 callers unchanged):
//   * listTree(fileHash)             — hierarchical view, ordered by sort_order then id
//   * move(id, newParentId, newSortOrder) — re-parent + re-order with cycle detection
//   * rename(id, title)              — title-only update (convenience for inline rename)
//
// Cycle detection (move()): walks the parent chain of newParentId up to root;
// if it encounters `id`, the move would create a cycle and is rejected. Per
// api-contracts.md §12.6 this surfaces as `'cycle_detected'` in the IPC layer.

import type BetterSqlite3 from 'better-sqlite3';

import type { BookmarkNodeRow, BookmarkRow } from '../types';

// ============================================================
// Public shape
// ============================================================

export interface UpsertBookmarkInput {
  /** Present → update; absent → insert. */
  id?: number;
  file_hash: string;
  page_index: number;
  title: string;
  /** Optional override; defaults to Date.now() on insert. Ignored on update. */
  created_at?: number;
  /** Phase 2: nullable parent FK. Defaults to NULL (top-level) on insert. */
  parent_id?: number | null;
  /** Phase 2: sibling ordering. Defaults to 0 on insert. */
  sort_order?: number;
}

/**
 * Discriminated result for `move`. We use a result-shape instead of throwing on
 * cycle so the IPC handler can map cleanly to the `'cycle_detected'` error
 * variant (api-contracts.md §12.6) without try/catch acrobatics.
 */
export type MoveBookmarkResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'cycle_detected' | 'invalid_parent' };

export interface BookmarksRepo {
  /** Phase 1 — flat list, ordered by page then created_at. Unchanged. */
  listByFile(fileHash: string): BookmarkRow[];

  /**
   * Insert-or-update (Phase 1 + Phase 2 additive).
   *
   *   * `id` present → UPDATE that row's title, page_index, parent_id, sort_order.
   *   * `id` absent → INSERT. UNIQUE(file_hash, page_index, title) tuple wins:
   *     duplicate inserts return the existing row's id.
   */
  upsert(input: UpsertBookmarkInput): number;

  /** Delete by id. Returns true if a row was removed. Cascades to children via FK. */
  delete(id: number): boolean;

  // ----- Phase 2 -----

  /**
   * Hierarchical view of all bookmarks for a file. Tree assembled in-memory
   * from a single SELECT (O(N) build). Children of each node are sorted by
   * sort_order ASC, with id ASC as a stable tie-break.
   */
  listTree(fileHash: string): BookmarkNodeRow[];

  /**
   * Re-parent and/or re-order a single bookmark. Rejects moves that would
   * create a cycle (newParentId in id's descendant chain) or that target a
   * non-existent parent. See api-contracts.md §12.6.
   */
  move(id: number, newParentId: number | null, newSortOrder: number): MoveBookmarkResult;

  /** Title-only update. Returns true if a row was updated. */
  rename(id: number, title: string): boolean;
}

// ============================================================
// Factory
// ============================================================

export function createBookmarksRepo(db: BetterSqlite3.Database): BookmarksRepo {
  // ---- Phase 1 statements (extended to also project parent_id + sort_order) ----

  const listStmt = db.prepare<{ file_hash: string }, BookmarkRow>(
    `SELECT id, file_hash, page_index, title, created_at, parent_id, sort_order
       FROM user_bookmarks
      WHERE file_hash = @file_hash
      ORDER BY page_index ASC, created_at ASC`,
  );

  const insertStmt = db.prepare<{
    file_hash: string;
    page_index: number;
    title: string;
    created_at: number;
    parent_id: number | null;
    sort_order: number;
  }>(
    `INSERT INTO user_bookmarks (file_hash, page_index, title, created_at, parent_id, sort_order)
       VALUES (@file_hash, @page_index, @title, @created_at, @parent_id, @sort_order)`,
  );

  // Phase-2 update widens to also set parent_id + sort_order. When the caller
  // omits those fields we preserve the existing row's values via COALESCE.
  const updateStmt = db.prepare<{
    id: number;
    page_index: number;
    title: string;
    parent_id: number | null;
    parent_id_supplied: number; // 1 = use @parent_id, 0 = keep existing
    sort_order: number;
    sort_order_supplied: number; // 1 = use @sort_order, 0 = keep existing
  }>(
    `UPDATE user_bookmarks
        SET page_index = @page_index,
            title      = @title,
            parent_id  = CASE WHEN @parent_id_supplied = 1 THEN @parent_id  ELSE parent_id  END,
            sort_order = CASE WHEN @sort_order_supplied = 1 THEN @sort_order ELSE sort_order END
      WHERE id = @id`,
  );

  const findDuplicateStmt = db.prepare<
    { file_hash: string; page_index: number; title: string },
    { id: number }
  >(
    `SELECT id FROM user_bookmarks
      WHERE file_hash = @file_hash
        AND page_index = @page_index
        AND title = @title
      LIMIT 1`,
  );

  const deleteStmt = db.prepare<{ id: number }>(`DELETE FROM user_bookmarks WHERE id = @id`);

  // ---- Phase 2 statements ----

  const listTreeStmt = db.prepare<{ file_hash: string }, BookmarkRow>(
    `SELECT id, file_hash, page_index, title, created_at, parent_id, sort_order
       FROM user_bookmarks
      WHERE file_hash = @file_hash
      ORDER BY sort_order ASC, id ASC`,
  );

  // Cycle-detection helper: fetch a single row's parent_id + file_hash.
  // Used by move() to walk the parent chain in JS without recursive CTE.
  const getParentInfoStmt = db.prepare<
    { id: number },
    { id: number; parent_id: number | null; file_hash: string }
  >(`SELECT id, parent_id, file_hash FROM user_bookmarks WHERE id = @id LIMIT 1`);

  const moveStmt = db.prepare<{
    id: number;
    parent_id: number | null;
    sort_order: number;
  }>(
    `UPDATE user_bookmarks
        SET parent_id  = @parent_id,
            sort_order = @sort_order
      WHERE id = @id`,
  );

  const renameStmt = db.prepare<{ id: number; title: string }>(
    `UPDATE user_bookmarks SET title = @title WHERE id = @id`,
  );

  return {
    listByFile(fileHash: string): BookmarkRow[] {
      return listStmt.all({ file_hash: fileHash });
    },

    upsert(input: UpsertBookmarkInput): number {
      assertValidPageIndex(input.page_index);
      assertNonEmptyTitle(input.title);
      if (input.sort_order !== undefined) assertValidSortOrder(input.sort_order);
      if (input.parent_id !== undefined && input.parent_id !== null) {
        assertValidId(input.parent_id, 'parent_id');
      }

      if (input.id !== undefined) {
        const result = updateStmt.run({
          id: input.id,
          page_index: input.page_index,
          title: input.title,
          parent_id: input.parent_id ?? null,
          parent_id_supplied: input.parent_id !== undefined ? 1 : 0,
          sort_order: input.sort_order ?? 0,
          sort_order_supplied: input.sort_order !== undefined ? 1 : 0,
        });
        if (result.changes === 0) {
          throw new Error(`Bookmark id ${String(input.id)} not found`);
        }
        return input.id;
      }

      // Insert path. Check the UNIQUE tuple first so we can return the existing
      // id instead of throwing on the constraint violation (better UX for the
      // "user pressed Save twice" case).
      const duplicate = findDuplicateStmt.get({
        file_hash: input.file_hash,
        page_index: input.page_index,
        title: input.title,
      });
      if (duplicate) {
        return duplicate.id;
      }

      const result = insertStmt.run({
        file_hash: input.file_hash,
        page_index: input.page_index,
        title: input.title,
        created_at: input.created_at ?? Date.now(),
        parent_id: input.parent_id ?? null,
        sort_order: input.sort_order ?? 0,
      });

      // better-sqlite3 returns lastInsertRowid as number | bigint depending on
      // platform. AUTOINCREMENT integers below 2^53 fit safely in number; we
      // narrow defensively.
      const rowid = result.lastInsertRowid;
      return typeof rowid === 'bigint' ? Number(rowid) : rowid;
    },

    delete(id: number): boolean {
      const result = deleteStmt.run({ id });
      return result.changes > 0;
    },

    listTree(fileHash: string): BookmarkNodeRow[] {
      const rows = listTreeStmt.all({ file_hash: fileHash });
      return buildTree(rows);
    },

    move(id: number, newParentId: number | null, newSortOrder: number): MoveBookmarkResult {
      assertValidId(id, 'id');
      if (newParentId !== null) assertValidId(newParentId, 'newParentId');
      assertValidSortOrder(newSortOrder);

      // Verify the moving row exists and capture its file_hash so we can
      // confirm the new parent (if any) belongs to the same file.
      const self = getParentInfoStmt.get({ id });
      if (!self) return { ok: false, error: 'not_found' };

      if (newParentId !== null) {
        // Self-as-parent is the trivial cycle case.
        if (newParentId === id) return { ok: false, error: 'cycle_detected' };

        // Parent must exist and belong to the same file_hash.
        const parent = getParentInfoStmt.get({ id: newParentId });
        if (!parent) return { ok: false, error: 'invalid_parent' };
        if (parent.file_hash !== self.file_hash) {
          return { ok: false, error: 'invalid_parent' };
        }

        // Walk the new parent's chain up to the root; if we hit `id` along the
        // way, this move would create a cycle.
        let cursor: number | null = parent.parent_id;
        // Bound the walk defensively against malformed data (any cycle in the
        // existing tree shouldn't exist, but if one does we don't want to spin).
        let guard = 0;
        const MAX_DEPTH = 10_000;
        while (cursor !== null) {
          if (cursor === id) return { ok: false, error: 'cycle_detected' };
          const next = getParentInfoStmt.get({ id: cursor });
          if (!next) break; // dangling FK — unreachable with our schema, but safe
          cursor = next.parent_id;
          guard += 1;
          if (guard > MAX_DEPTH) {
            // Malformed tree — treat as cycle for safety. Should never happen
            // with the FK + cycle-detection invariants enforced here.
            return { ok: false, error: 'cycle_detected' };
          }
        }
      }

      const result = moveStmt.run({
        id,
        parent_id: newParentId,
        sort_order: newSortOrder,
      });
      if (result.changes === 0) return { ok: false, error: 'not_found' };
      return { ok: true };
    },

    rename(id: number, title: string): boolean {
      assertValidId(id, 'id');
      assertNonEmptyTitle(title);
      const result = renameStmt.run({ id, title });
      return result.changes > 0;
    },
  };
}

// ============================================================
// Tree assembly
// ============================================================

/**
 * Assemble a flat list of rows (already ordered by sort_order ASC, id ASC) into
 * a forest of BookmarkNodeRow. O(N) — one pass to index by id, one pass to wire
 * up children. Orphaned rows (parent_id refers to a missing/foreign id) are
 * treated as root-level so the tree stays well-formed.
 */
function buildTree(rows: BookmarkRow[]): BookmarkNodeRow[] {
  const byId = new Map<number, BookmarkNodeRow>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }

  const roots: BookmarkNodeRow[] = [];
  for (const row of rows) {
    const node = byId.get(row.id);
    if (!node) continue; // unreachable; we just inserted it
    if (row.parent_id === null) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(row.parent_id);
    if (parent) {
      parent.children.push(node);
    } else {
      // Dangling parent (e.g. CASCADE race or cross-file id) — promote to root
      // so the consumer still gets the node. The FK + cycle-detection in move()
      // should prevent this in practice.
      roots.push(node);
    }
  }
  return roots;
}

// ============================================================
// Validators
// ============================================================

function assertValidPageIndex(pageIndex: number): void {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new Error(`Invalid page_index: ${String(pageIndex)} (must be non-negative integer)`);
  }
}

function assertNonEmptyTitle(title: string): void {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new Error('Bookmark title must be a non-empty string');
  }
}

function assertValidSortOrder(sortOrder: number): void {
  if (!Number.isInteger(sortOrder)) {
    throw new Error(`Invalid sort_order: ${String(sortOrder)} (must be integer)`);
  }
}

function assertValidId(id: number, label: string): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${label}: ${String(id)} (must be positive integer)`);
  }
}
