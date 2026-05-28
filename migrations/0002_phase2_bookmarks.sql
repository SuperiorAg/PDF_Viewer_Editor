-- ============================================================
-- 0002_phase2_bookmarks.sql — Phase 2 bookmark nesting + ordering
--
-- Canonical reference: docs/data-models.md §7.3. If this file and that doc
-- disagree, the doc wins; open a Marcus-approved amendment to update both.
--
-- Adds:
--   * user_bookmarks.parent_id   INTEGER NULL  — FK to user_bookmarks(id) ON DELETE CASCADE
--                                                 NULL = top-level bookmark
--   * user_bookmarks.sort_order  INTEGER NOT NULL DEFAULT 0
--                                                 lower values sort earlier within a sibling group
--   * idx_user_bookmarks_parent_id  — tree-traversal index
--
-- Migration runner short-circuits via schema_migrations watermark; therefore
-- ALTER TABLE ADD COLUMN is safe (will never re-run for an already-applied
-- version). The CREATE INDEX is still IF NOT EXISTS for defense-in-depth.
--
-- The schema_migrations(version=2, applied_at=...) row is written by the runner
-- (src/db/migrate.ts) inside the wrapping transaction. We deliberately do NOT
-- include the INSERT here to match the 0001_init.sql convention; spec
-- (data-models.md §7.3.1) shows it for illustration only.
--
-- Forward-only per migrations/README.md "Rollback".
-- ============================================================

-- parent_id: nullable foreign key to a parent bookmark. NULL = root-level.
-- ON DELETE CASCADE: removing a parent removes all descendants (data-models §7.3.2).
-- Note: PRAGMA foreign_keys = ON is set in src/db/connection.ts; the cascade
-- only fires when that pragma is active.
ALTER TABLE user_bookmarks
  ADD COLUMN parent_id INTEGER REFERENCES user_bookmarks(id) ON DELETE CASCADE;

-- sort_order: sparse integer (callers use a 1024-step ladder so reorders do not
-- cascade-update siblings). DEFAULT 0 for migration of existing Phase-1 rows;
-- renderer reconciles tie-breaks by id ASC (data-models §7.3.2 + §7.5).
ALTER TABLE user_bookmarks
  ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Tree-traversal index. listTree() reads all rows for a fileHash in one shot,
-- but move()'s cycle-detection walks the parent chain via parent_id lookups —
-- the index keeps that O(depth log N) instead of O(depth N).
CREATE INDEX IF NOT EXISTS idx_user_bookmarks_parent_id
  ON user_bookmarks (parent_id);
