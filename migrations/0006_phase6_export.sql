-- ============================================================
-- 0006_phase6_export.sql — Phase 6 Export to Office / image formats
--
-- Canonical reference: docs/data-models.md §11 (Phase 6 amendment) +
-- docs/architecture-phase-6.md §3.3 (export_jobs table) +
-- docs/export-engine.md §8 (job lifecycle). If this file and any of those
-- docs disagree, the doc wins; open a Marcus-approved amendment to update
-- both.
--
-- Adds (Phase 6):
--   * export_jobs — one row per export run (queued / running / completed /
--                   cancelled / failed); doubles as in-progress tracking +
--                   historical audit. Per data-models §11.2.
--   * 17 settings keys via INSERT OR IGNORE INTO app_settings(key, value).
--     Per data-models §11.6 + §11.10.
--
-- No new column on any prior Phase 1-5 table. Phase 6 is purely additive:
-- one new table + index trio + settings-key seeds. The signature_audit_log
-- column added by 0005 is NOT touched (Phase 6 export is read-only on the
-- source — see conventions §17.1).
--
-- Indexes (data-models §11.2):
--   * idx_export_jobs_doc_hash   — filter by current open file
--   * idx_export_jobs_status     — "running" / "failed" surfaces
--   * idx_export_jobs_format     — Exports sidebar per-format grouping
--
-- The schema_migrations(version=6, applied_at=...) row is written by the
-- runner (src/db/migrate.ts) inside the wrapping transaction — matching the
-- 0001 + 0002 + 0003 + 0004 + 0005 convention. Including an explicit INSERT
-- here would PRIMARY KEY-conflict the runner's record on every retry (cf.
-- Wave 7 / 12 / 16 / 20 takeaways).
--
-- IMPORTANT: the data-models §11.6 spec text refers to the settings table as
-- "settings" but the actual canonical table name in Phase 1 (0001_init.sql)
-- is `app_settings`. The INSERT OR IGNORE statements below use the real table
-- name. Documented for any future amendment that copies the spec verbatim.
--
-- Anti-sentinel discipline (data-models §11.5; Phase 4.1.1 + Phase 5 reaffirmed):
-- every "not yet known" column is NULLABLE — `dpi`, `jpeg_quality`,
-- `multi_page_tiff`, `completed_at`, `duration_ms`, `output_size_bytes`,
-- `paragraphs_extracted`, `tables_detected`, `images_embedded`,
-- `error_message`. NO `-1` or `0` "unknown" sentinels. Consumers pattern-match
-- on NULL, never on a magic value.
--
-- Forward-only per migrations/README.md "Rollback".
-- ============================================================

-- export_jobs: one row per export run.
--
-- Column shape mirrors docs/data-models.md §11.2 verbatim — Ravi's repo +
-- David's bridge depend on the column names not drifting from the spec.
--
-- `doc_hash`             — SHA-256 of the source doc bytes at export time
--                          (mirrors the doc_hash semantic in ocr_jobs and
--                          signature_audit_log). Soft reference; NO FK
--                          (data-models §11.8 — exports survive doc-row
--                          deletion).
-- `format`               — 6-valued discriminant (docx / xlsx / pptx /
--                          png / jpeg / tiff). CHECK guard.
-- `quality_tier`         — 'text-only' | 'layout-preserving' | 'n/a'.
--                          'n/a' is the valid value for image formats;
--                          office formats are always 'text-only' or
--                          'layout-preserving'. CHECK guard.
-- `page_range_start/end` — inclusive 0-based page indices.
-- `include_annotations`  — 0/1; CHECK guard. Bridge converts to boolean.
-- `dpi`                  — non-null only for image formats; range
--                          enforced by repo + IPC handler (data-models
--                          §11.9), NOT by SQL CHECK (range CHECKs are
--                          fragile across SQLite versions).
-- `jpeg_quality`         — REAL; non-null only when format='jpeg'.
-- `multi_page_tiff`      — 0/1; non-null only when format='tiff'.
-- `output_path`          — absolute path on disk. MAIN-ONLY — the bridge
--                          strips this to basename + last-folder for the
--                          renderer-facing DTO (data-models §11.5 +
--                          conventions §17.2).
-- `output_size_bytes`    — populated on status='completed'; NULL otherwise.
--                          Anti-sentinel: no -1 / 0 for unknown.
-- `status`               — five-valued discriminant. 'superseded_by_undo'
--                          (Phase 5 ocr_jobs) is NOT applicable here —
--                          export is not an edit, conventions §17.1
--                          read-only-on-source rule.
-- `started_at`           — ms epoch; set at INSERT (queued time).
-- `completed_at`         — ms epoch; NULL until terminal status.
-- `duration_ms`          — INTEGER; NULL until terminal. Repo sets
--                          completed_at - started_at when status moves to
--                          a terminal value with a duration supplied.
-- `pages_processed`      — DEFAULT 0; bumped as each page completes.
--                          Drives renderer progress when per-second
--                          progress events are throttled.
-- `paragraphs_extracted` / `tables_detected` / `images_embedded`
--                        — NULL for image formats AND until done. Office
--                          summary text "3 pages -> 47 paragraphs, 2
--                          tables, 5 images embedded" reads these on
--                          status='completed'.
-- `error_message`        — non-null only when status='failed'. Truncated
--                          to 2048 chars at the IPC boundary before insert
--                          (data-models §11.9).
-- `created_at`           — ms epoch (defaulted by repo to Date.now()).
CREATE TABLE IF NOT EXISTS export_jobs (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_hash                 TEXT    NOT NULL,
  format                   TEXT    NOT NULL
                           CHECK (format IN ('docx', 'xlsx', 'pptx',
                                             'png', 'jpeg', 'tiff')),
  quality_tier             TEXT    NOT NULL
                           CHECK (quality_tier IN ('text-only',
                                                   'layout-preserving',
                                                   'n/a')),
  page_range_start         INTEGER NOT NULL,
  page_range_end           INTEGER NOT NULL,
  include_annotations      INTEGER NOT NULL DEFAULT 1
                           CHECK (include_annotations IN (0, 1)),
  dpi                      INTEGER,
  jpeg_quality             REAL,
  multi_page_tiff          INTEGER
                           CHECK (multi_page_tiff IS NULL
                                  OR multi_page_tiff IN (0, 1)),
  output_path              TEXT    NOT NULL,
  output_size_bytes        INTEGER,
  status                   TEXT    NOT NULL
                           CHECK (status IN ('queued', 'running',
                                             'completed', 'cancelled',
                                             'failed')),
  started_at               INTEGER NOT NULL,
  completed_at             INTEGER,
  duration_ms              INTEGER,
  pages_processed          INTEGER NOT NULL DEFAULT 0,
  paragraphs_extracted     INTEGER,
  tables_detected          INTEGER,
  images_embedded          INTEGER,
  error_message            TEXT,
  created_at               INTEGER NOT NULL
);

-- Doc-hash filter for the "Exports on the file currently open" sidebar.
CREATE INDEX IF NOT EXISTS idx_export_jobs_doc_hash
  ON export_jobs (doc_hash);

-- Status filter for "running" / "failed" surfaces.
CREATE INDEX IF NOT EXISTS idx_export_jobs_status
  ON export_jobs (status);

-- Format filter for the Exports sidebar per-format grouping.
CREATE INDEX IF NOT EXISTS idx_export_jobs_format
  ON export_jobs (format);


-- ============================================================
-- Phase 6 settings seeds (data-models §11.6 + §11.10).
--
-- 17 new keys, all defaulted via INSERT OR IGNORE so user-customized values
-- survive upgrade. The migration must NOT use INSERT OR REPLACE — that
-- would clobber user preferences (Phase 1 convention).
--
-- Values are JSON-encoded TEXT (Phase 1 convention; settings-repo.ts parses
-- on read). Strings get double-quoted ('"layout-preserving"'); numbers and
-- booleans are bare ('150', 'true', 'false').
-- ============================================================

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('export.docx.qualityTier',          '"layout-preserving"'),
  ('export.docx.pageSize',             '"auto"'),
  ('export.docx.includeAnnotations',   'true'),
  ('export.xlsx.qualityTier',          '"text-only"'),
  ('export.xlsx.includeAnnotations',   'false'),
  ('export.pptx.qualityTier',          '"layout-preserving"'),
  ('export.pptx.includeAnnotations',   'true'),
  ('export.image.format',              '"png"'),
  ('export.image.dpi',                 '150'),
  ('export.image.jpegQuality',         '0.9'),
  ('export.image.multiPageTiff',       'false'),
  ('export.image.includeAnnotations',  'true'),
  ('export.layout.lineEpsilonPt',      '2'),
  ('export.layout.paragraphBreakRatio','1.5'),
  ('export.layout.headingRatio',       '1.3'),
  ('export.layout.columnGapPt',        '40'),
  ('export.maxQueueSize',              '50');
