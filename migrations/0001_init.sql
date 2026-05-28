-- ============================================================
-- 0001_init.sql — initial schema for PDF_Viewer_Editor
--
-- Canonical reference: docs/data-models.md §2. If this file and that doc
-- disagree, the doc wins; open a Marcus-approved amendment to update both.
--
-- Conventions:
--   * Every *_at column stores milliseconds since Unix epoch (Date.now()).
--   * Settings values are JSON-encoded TEXT; the repo layer parses.
--   * File-hash strategy: SHA-256(first 64 KiB of file || ASCII string of file size), hex lowercase.
--   * Schema is forward-only; no rollback. Failures inside a migration roll back
--     the wrapping transaction so the version row is never written and the next
--     launch retries (docs/data-models.md §6.3).
-- ============================================================

-- Migration tracking. Migration runner uses MAX(version) to find the watermark.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- Recently opened files. Keyed by absolute path (OS-normalized by main process).
-- file_hash mirrors the open-document hash so reorder/rename can still find prior
-- bookmarks even after a path change.
CREATE TABLE IF NOT EXISTS recent_files (
  path           TEXT PRIMARY KEY,
  last_opened_at INTEGER NOT NULL,
  file_hash      TEXT    NOT NULL,
  display_name   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recent_files_last_opened_at
  ON recent_files (last_opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_recent_files_file_hash
  ON recent_files (file_hash);

-- Application settings (key/value, JSON-serialized values).
-- Key registry lives in docs/data-models.md §2.3 and src/db/types.ts.
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- User-authored bookmarks. Keyed by file_hash (not path) so a renamed/moved
-- file keeps its bookmarks (data-models §6.1).
-- UNIQUE constraint blocks accidental duplicates from the same fileHash+page+title.
CREATE TABLE IF NOT EXISTS user_bookmarks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_hash  TEXT    NOT NULL,
  page_index INTEGER NOT NULL CHECK (page_index >= 0),
  title      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (file_hash, page_index, title)
);

CREATE INDEX IF NOT EXISTS idx_user_bookmarks_file_hash
  ON user_bookmarks (file_hash);
