-- ============================================================
-- 0009_phase7.5.sql — Phase 7.5 (Bucket B parity + Bucket C accessibility/TTS)
--
-- Canonical reference: docs/data-models.md §13 (Phase 7.5 amendment, Riley
-- 2026-06-17) + docs/project-plan.md §2 Wave 2 (Marcus). If this file and any
-- of those docs disagree, the doc wins; open a Marcus-approved amendment to
-- update both.
--
-- Adds (Phase 7.5) — purely additive, ZERO ALTER on any prior Phase 1-7.4
-- table or column. Per data-models §13.1.
--
--   Tables (7 — note count discrepancy with §13.1 header "Six new tables"; see
--   "Open question" comment block at end of this header):
--     * stamps_library                — B7 Stamps. Built-in + user stamps.
--     * find_history                  — B3 Find. Recent queries per doc hash.
--     * action_wizard_scripts         — B9 Action Wizard. Saved action scripts.
--     * compare_sessions              — B2 Compare Files. Per-pair diff cache.
--     * tts_voice_prefs               — C1 Read Aloud. Per-locale voice prefs.
--     * accessibility_check_history   — C6 Accessibility Checker. Recent runs.
--     * accessibility_edit_session    — C3-C5 structure-tree side-table.
--
--   Indexes (10):
--     * idx_stamps_library_last_used_at      (DESC; recently used panel)
--     * idx_stamps_library_kind              (text/image filter)
--     * idx_find_history_file_hash_last_used (composite; per-doc recency)
--     * idx_action_wizard_scripts_last_run_at(DESC; recently used picker)
--     * idx_compare_sessions_created_at      (DESC; recents list + GC scan)
--     * idx_accessibility_check_history_doc_hash_ran_at (composite; per-doc
--                                              latest + trend)
--     (tts_voice_prefs uses the composite PK; no secondary index needed.)
--     (accessibility_edit_session.doc_hash UNIQUE covers its dominant query.)
--
--   Settings keys (10) via INSERT OR IGNORE INTO app_settings(key, value).
--   Per data-models §13.9.
--
--   Built-in stamp seeds (10) via INSERT OR IGNORE INTO stamps_library
--   keyed on the UNIQUE `builtin_key` column. `image_path` for built-ins
--   stores the BUILTIN:<key> placeholder per data-models §13.2 — the engine
--   resolves it at read time via process.resourcesPath + '/stamps/<key>.png'
--   so the built-ins survive moves of the install directory.
--
-- IMPORTANT (table-name slip, reaffirmed for the FOURTH time after Wave 24 +
-- Wave 28a + Wave B1): data-models §13.9 spec text writes the INSERT against
-- a table named "settings", but the actual canonical table name created by
-- Phase 1 (0001_init.sql) is `app_settings`. The INSERT OR IGNORE below uses
-- the real table name. Documented for any future amendment that copies the
-- spec verbatim.
--
-- The schema_migrations(version=9, applied_at=...) row is written by the
-- runner (src/db/migrate.ts) inside the wrapping transaction — matching the
-- 0001..0008 convention. Including an explicit INSERT here would PRIMARY
-- KEY-conflict the runner's record on every retry (cf. Wave 7/12/16/20/24/
-- 28a/B1 takeaways).
--
-- No SQL foreign keys (data-models §13.12). The renderer owns lifecycle
-- (close doc -> repo cleanup). This matches Phase 7 and avoids cascade-
-- delete surprises on doc close.
--
-- Anti-sentinel discipline (data-models §13.11; the four-times-bitten
-- 2026-05-26 lesson, reaffirmed in 0007/0008): every "not yet known"
-- timestamp is NULLABLE. NULL = "never". NO sentinel 0. Repo + bridge
-- pattern-match on null, NEVER on a magic value.
--
-- Idempotency: every CREATE TABLE / CREATE INDEX uses IF NOT EXISTS; every
-- INSERT seed uses INSERT OR IGNORE. The migration safely no-ops if a row
-- happens to be present from a prior partial run (in practice the runner's
-- transaction-rollback means partial runs cannot exist — the watermark only
-- advances when the entire SQL file commits — but defense in depth.)
--
-- Forward-only per migrations/README.md "Rollback".
--
-- ============================================================
-- Open question for Marcus (Phase 7.5 Wave 2):
--   data-models §13.1 says "Six new tables + their indexes + zero ALTERs"
--   but §13.2-§13.8 describe SEVEN tables (the seventh being
--   `accessibility_edit_session` for C3-C5 structure-tree work).
--   project-plan.md §2 Wave 2 lists six tables. Shipping ALL SEVEN here
--   because §13.8 is part of the v9 migration overview and the C3-C5 work
--   in Wave 5b depends on the side-table being present. If Marcus wants
--   to defer `accessibility_edit_session` to a later migration, file an
--   amendment and Ravi will drop the CREATE + index here.
-- ============================================================


-- ============================================================
-- stamps_library — B7 Stamps (data-models §13.2)
--
-- User-defined + built-in stamp library. Built-in entries (Approved /
-- Confidential / Draft / Sample / Reviewed / etc.) are seeded by INSERT OR
-- IGNORE so re-runs don't duplicate. User-added stamps insert at runtime
-- with builtin_key=NULL.
--
-- `image_path` for built-ins stores a BUILTIN:<key> placeholder token; the
-- engine resolves at read time via process.resourcesPath + '/stamps/<key>.png'.
-- Per-row PNG bytes are NOT in SQLite (data-models §13.2 honesty note).
--
-- Index intent:
--   * idx_stamps_library_last_used_at — "Recently used stamps" panel.
--   * idx_stamps_library_kind         — text/image filter in library UI.
-- ============================================================
CREATE TABLE IF NOT EXISTS stamps_library (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- NULL for user stamps; UNIQUE non-null for built-ins so INSERT OR IGNORE
  -- on the seed below idempotently no-ops if a row already exists.
  builtin_key   TEXT UNIQUE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('text', 'image')),
  -- Present when kind='text'; the stamp's rendered text. Zod at IPC enforces
  -- "non-null when kind='text'" (data-models §13.11); SQL allows both shapes.
  text_value    TEXT,
  -- Absolute path (or BUILTIN:<key> placeholder for built-ins) when
  -- kind='image'. Same SQL-vs-zod posture as text_value.
  image_path    TEXT,
  width_pt      REAL NOT NULL,
  height_pt     REAL NOT NULL,
  -- #RRGGBB; only meaningful for kind='text'. NULL for image stamps.
  color         TEXT,
  created_at    INTEGER NOT NULL,
  -- Nullable + late-init: NULL = never used. NO sentinel 0 (anti-sentinel).
  last_used_at  INTEGER,
  use_count     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_stamps_library_last_used_at
  ON stamps_library (last_used_at DESC);

CREATE INDEX IF NOT EXISTS idx_stamps_library_kind
  ON stamps_library (kind);

-- Built-in stamp seeds. INSERT OR IGNORE keyed on UNIQUE(builtin_key) so
-- re-runs idempotently no-op. The created_at uses 0 here as a deterministic
-- seed marker (data-models §13.2 calls these "ships with the app"); the
-- engine never compares created_at for built-ins (it filters by builtin_key
-- IS NOT NULL).
--
-- Width/height defaults match Adobe's standard rubber-stamp footprint
-- (~144x36 pt, the "STATUS" stamps). Color is the rubber-stamp red.
--
-- image_path uses the BUILTIN:<key> placeholder (data-models §13.2). The
-- main-process stamp renderer resolves at read time, so a moved install
-- directory keeps working.
INSERT OR IGNORE INTO stamps_library
    (builtin_key, name, kind, text_value, image_path, width_pt, height_pt, color, created_at, last_used_at, use_count)
  VALUES
    ('builtin:approved',     'stamps.builtin.approved',     'text',  'APPROVED',     NULL, 144, 36, '#C2272D', 0, NULL, 0),
    ('builtin:confidential', 'stamps.builtin.confidential', 'text',  'CONFIDENTIAL', NULL, 180, 36, '#C2272D', 0, NULL, 0),
    ('builtin:draft',        'stamps.builtin.draft',        'text',  'DRAFT',        NULL, 120, 36, '#C2272D', 0, NULL, 0),
    ('builtin:sample',       'stamps.builtin.sample',       'text',  'SAMPLE',       NULL, 120, 36, '#C2272D', 0, NULL, 0),
    ('builtin:reviewed',     'stamps.builtin.reviewed',     'text',  'REVIEWED',     NULL, 144, 36, '#C2272D', 0, NULL, 0),
    ('builtin:received',     'stamps.builtin.received',     'text',  'RECEIVED',     NULL, 144, 36, '#C2272D', 0, NULL, 0),
    ('builtin:paid',         'stamps.builtin.paid',         'text',  'PAID',         NULL, 108, 36, '#1F7A1F', 0, NULL, 0),
    ('builtin:void',         'stamps.builtin.void',         'text',  'VOID',         NULL, 108, 36, '#C2272D', 0, NULL, 0),
    ('builtin:final',        'stamps.builtin.final',        'text',  'FINAL',        NULL, 108, 36, '#1F7A1F', 0, NULL, 0),
    ('builtin:not-approved', 'stamps.builtin.not-approved', 'text',  'NOT APPROVED', NULL, 180, 36, '#C2272D', 0, NULL, 0);


-- ============================================================
-- find_history — B3 Find/Search (data-models §13.3)
--
-- Recent search queries per file_hash. Per-doc cap (20) + total cap (200)
-- are enforced at WRITE TIME by a renderer-side housekeeping pass — NOT by
-- SQL triggers (same posture as Phase 5 ocr_jobs cleanup: lifecycle lives
-- in the bridge, not in DDL).
--
-- UNIQUE(file_hash, query, case_sensitive, whole_word): re-running an
-- identical search bumps last_used_at via repo upsert, doesn't duplicate.
--
-- Privacy note (data-models §13.3): query strings can contain doc content
-- fragments. NEVER cross-doc shared. NEVER included in telemetry (Phase 7
-- §12.4 ring buffer is in-memory only). Stored locally.
--
-- Index intent: composite (file_hash, last_used_at DESC) covers the
-- dominant query "last 5 searches for this doc" with a single index scan.
-- ============================================================
CREATE TABLE IF NOT EXISTS find_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- No SQL FK (data-models §13.12) — soft reference; renderer-controlled
  -- lifecycle (close doc -> repo cleanup if desired).
  file_hash       TEXT    NOT NULL,
  query           TEXT    NOT NULL,
  -- 0/1 boolean stored as integer per Phase 1 convention.
  case_sensitive  INTEGER NOT NULL DEFAULT 0 CHECK (case_sensitive IN (0, 1)),
  whole_word      INTEGER NOT NULL DEFAULT 0 CHECK (whole_word     IN (0, 1)),
  last_used_at    INTEGER NOT NULL,
  UNIQUE (file_hash, query, case_sensitive, whole_word)
);

CREATE INDEX IF NOT EXISTS idx_find_history_file_hash_last_used
  ON find_history (file_hash, last_used_at DESC);


-- ============================================================
-- action_wizard_scripts — B9 Action Wizard (data-models §13.4)
--
-- Saved action scripts the user has recorded. The script body lives as a
-- JSON blob (`v1.actionScript` per architecture §4.6). Repo stores TEXT
-- verbatim — the bridge owns parse/serialize (data-models §13.10).
--
-- UNIQUE(name) per data-models §13.4: prevents accidental overwrite via the
-- picker. The repo surface returns a discriminated union ('name_in_use')
-- rather than throwing on the SQLite UNIQUE violation (Wave 12/16/20/24
-- precedent — bridge maps repo result to IPC Result without string-matching
-- better-sqlite3 errors).
--
-- schema_version starts at 1; future engine breakage triggers a new
-- schema_version + an upgrade pass (data-models §13.4 R5 migration test).
--
-- Index intent: idx_action_wizard_scripts_last_run_at DESC powers the
-- "Recently used scripts" picker.
-- ============================================================
CREATE TABLE IF NOT EXISTS action_wizard_scripts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL UNIQUE,
  schema_version  INTEGER NOT NULL CHECK (schema_version >= 1),
  -- JSON-encoded {schemaVersion, name, createdAt, ops}. Repo stores verbatim.
  script_json     TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  -- Nullable + late-init: NULL = never run. NO sentinel 0.
  last_run_at     INTEGER,
  run_count       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_action_wizard_scripts_last_run_at
  ON action_wizard_scripts (last_run_at DESC);


-- ============================================================
-- compare_sessions — B2 Compare Files (data-models §13.5)
--
-- One row per open compare session. Per-page diff cache lives in two big
-- JSON columns to keep the row addressable + the schema flat (data-models
-- §13.5 explicitly chose flat over a per-page child table — small N).
--
-- Bounded growth (data-models §13.5 AR4 mitigation):
--   1. Startup GC deletes rows where created_at < (now - 7 days). Enforced
--      by the renderer-side housekeeping pass on app launch.
--   2. Per-row size cap (~5 MB total JSON) enforced at WRITE TIME by the
--      bridge. Over-cap sessions truncate per_page_visual_diff_json first
--      (largest column).
--
-- last_diff_computed_at is nullable + late-init (NULL = no per-page diff
-- computed yet). NO sentinel 0.
--
-- Index intent: idx_compare_sessions_created_at DESC powers the recents
-- list AND the GC scan ("rows older than 7 days").
-- ============================================================
CREATE TABLE IF NOT EXISTS compare_sessions (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  baseline_file_hash            TEXT    NOT NULL,
  modified_file_hash            TEXT    NOT NULL,
  -- Absolute paths (renderer-validated). Bridge can strip to display name
  -- before crossing the IPC boundary if conventions §17.2 ever requires;
  -- Phase 7.5 design (data-models §13.5) keeps them in the renderer DTO.
  baseline_path                 TEXT    NOT NULL,
  modified_path                 TEXT    NOT NULL,
  baseline_page_count           INTEGER NOT NULL CHECK (baseline_page_count >= 0),
  modified_page_count           INTEGER NOT NULL CHECK (modified_page_count >= 0),
  -- JSON map pageIndex -> string. Repo stores verbatim.
  per_page_text_baseline_json   TEXT    NOT NULL DEFAULT '{}',
  per_page_text_modified_json   TEXT    NOT NULL DEFAULT '{}',
  -- JSON map pageIndex -> {textDiffSpans, visualDiffPixelCount?}.
  per_page_diff_json            TEXT    NOT NULL DEFAULT '{}',
  -- JSON map pageIndex -> base64 PNG (lazy; only pages user opened visual
  -- diff for). Largest column; first truncation target on size-cap hit.
  per_page_visual_diff_json     TEXT    NOT NULL DEFAULT '{}',
  total_pages_with_diff         INTEGER NOT NULL DEFAULT 0,
  inserted_spans                INTEGER NOT NULL DEFAULT 0,
  deleted_spans                 INTEGER NOT NULL DEFAULT 0,
  -- Nullable + late-init: NULL = no per-page diff yet. NO sentinel 0.
  last_diff_computed_at         INTEGER,
  created_at                    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compare_sessions_created_at
  ON compare_sessions (created_at DESC);


-- ============================================================
-- tts_voice_prefs — C1 Read Aloud (data-models §13.6)
--
-- Per-locale preferred voice + rate + pitch. One row per (locale, engine).
-- Composite PRIMARY KEY covers the dominant query "what's my preferred
-- voice for en-US on this OS?" — NO secondary index needed.
--
-- engine_name CHECK ('sapi'|'say'|'espeak') matches the three platform
-- adapters (Windows / macOS / Linux fallback per Wave 5a brief).
--
-- preferred_voice_id is nullable + late-init: NULL until the user picks
-- a voice (anti-sentinel; data-models §13.6).
--
-- rate/pitch range 0.5..2.0 enforced by zod at IPC (data-models §13.11);
-- SQL DEFAULTs to 1.0 (no-op modulation).
-- ============================================================
CREATE TABLE IF NOT EXISTS tts_voice_prefs (
  locale              TEXT    NOT NULL,
  engine_name         TEXT    NOT NULL CHECK (engine_name IN ('sapi', 'say', 'espeak')),
  -- Nullable + late-init: NULL = user has not picked a voice yet.
  preferred_voice_id  TEXT,
  rate                REAL    NOT NULL DEFAULT 1.0,
  pitch               REAL    NOT NULL DEFAULT 1.0,
  updated_at          INTEGER NOT NULL,
  PRIMARY KEY (locale, engine_name)
);


-- ============================================================
-- accessibility_check_history — C6 Accessibility Checker (data-models §13.7)
--
-- Recent rule-set results per doc hash. One row per check run. The repo
-- stores results_json as TEXT — the bridge parses to
-- AccessibilityRuleResult[] at the IPC boundary (data-models §13.10).
--
-- Materialized counts (pass_count / warn_count / fail_count) avoid having
-- to parse + filter results_json for the dominant UI summary query
-- (data-models §13.7 "fast UI summary").
--
-- shipped_rule_count snapshots how many rules existed at check time
-- (data-models §13.7 honest disclosure). A later wave that adds rules
-- doesn't retroactively change the historical entry's denominator.
--
-- Cap (data-models §13.7): keep the 10 most recent runs per doc, enforced
-- by renderer-side housekeeping after each successful run.
--
-- Index intent: composite (doc_hash, ran_at DESC) covers "latest run for
-- this doc" + the trend view with a single index scan.
-- ============================================================
CREATE TABLE IF NOT EXISTS accessibility_check_history (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_hash            TEXT    NOT NULL,
  ran_at              INTEGER NOT NULL,
  -- JSON-encoded AccessibilityRuleResult[]. Repo stores verbatim.
  results_json        TEXT    NOT NULL,
  pass_count          INTEGER NOT NULL CHECK (pass_count >= 0),
  warn_count          INTEGER NOT NULL CHECK (warn_count >= 0),
  fail_count          INTEGER NOT NULL CHECK (fail_count >= 0),
  shipped_rule_count  INTEGER NOT NULL CHECK (shipped_rule_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_accessibility_check_history_doc_hash_ran_at
  ON accessibility_check_history (doc_hash, ran_at DESC);


-- ============================================================
-- accessibility_edit_session — C3-C5 structure-tree side-table
-- (data-models §13.8; the Phase 7.5 distinguished design P7.5-L-5)
--
-- Edits to the structure tree accumulate here during a session; on Save
-- they materialize to the in-PDF /StructTreeRoot. Survives app crash so
-- the user does not lose work.
--
-- UNIQUE(doc_hash) per data-models §13.8: one session per open doc. Repo
-- upsert pattern (same as form_templates / ocr_results) — NO secondary
-- index needed (the UNIQUE index covers the lookup).
--
-- has_existing_tags is a 0/1 snapshot of the doc's state on session open
-- (drives save-as-copy default per data-models §13.8). CHECK guard.
--
-- Lifecycle (architecture §4.8):
--   1. Renderer opens on first pdf:setStructTree / setReadingOrder /
--      setAltText for a given doc.
--   2. Renderer updates incrementally on subsequent calls.
--   3. Main process deletes on successful Save (after materialization).
--   4. Startup GC: rows with updated_at < (now - 14 days) get deleted with
--      a one-time banner ("Discarded stale accessibility edit session").
--
-- Privacy / size (data-models §13.8 AR2 mitigation): the side-table stores
-- STRUCTURE only (tag types, parent refs, mcid pointers, alt-text strings
-- the user types). It does NOT store page content bytes. Wave 5b includes
-- a unit test verifying row size is bounded.
-- ============================================================
CREATE TABLE IF NOT EXISTS accessibility_edit_session (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_hash                 TEXT    NOT NULL UNIQUE,
  -- JSON-encoded StructTreeNode root. Repo stores verbatim.
  struct_tree_json         TEXT    NOT NULL,
  -- JSON-encoded ReadingOrderEntry[]. Repo stores verbatim.
  reading_order_json       TEXT    NOT NULL DEFAULT '[]',
  -- JSON map structNodeId -> {altText, actualText}. Repo stores verbatim.
  alt_text_overrides_json  TEXT    NOT NULL DEFAULT '{}',
  has_existing_tags        INTEGER NOT NULL CHECK (has_existing_tags IN (0, 1)),
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);


-- ============================================================
-- Phase 7.5 settings seeds (data-models §13.9).
--
-- 10 new keys, all defaulted via INSERT OR IGNORE so a user who upgrades
-- from a Phase 7.4 build keeps any value they have already customized. The
-- migration MUST NOT use INSERT OR REPLACE — that would clobber user
-- preferences (Phase 1 convention).
--
-- Values are JSON-encoded TEXT (Phase 1 convention; settings-repo.ts parses
-- on read). Numbers are bare; the JSON null literal is bare ('null').
--
-- Reaffirmed for the FOURTH time: data-models §13.9 spec text writes
-- `INSERT OR IGNORE INTO settings (...)` but the canonical Phase-1 table is
-- `app_settings`. The INSERT below uses the real table name. The slip
-- pattern is now a known doc-vs-code drift class (Wave 24/28a/B1).
-- ============================================================
INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('find.maxHistoryPerDoc',             '20'),
  ('find.maxHistoryTotal',              '200'),
  ('compare.sessionMaxBytes',           '5242880'),   -- 5 MB
  ('compare.sessionTtlDays',            '7'),
  ('accessibility.editSessionTtlDays',  '14'),
  ('accessibility.checkHistoryPerDoc',  '10'),
  ('tts.defaultRate',                   '1.0'),
  ('tts.defaultPitch',                  '1.0'),
  ('stamps.recentLimit',                '12'),
  ('actionWizard.maxRecordingOps',      '5000');      -- hard cap to prevent runaway recordings
