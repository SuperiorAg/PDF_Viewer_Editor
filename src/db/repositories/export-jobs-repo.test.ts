// @vitest-environment node

import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadMigrationsForTests, makeTestDatabase } from '../test-support';

import {
  createExportJobsRepo,
  type ExportJobsRepo,
  type InsertExportJobInput,
} from './export-jobs-repo';

// ============================================================
// Fixture builders
// ============================================================

function makeOfficeQueuedInput(
  overrides: Partial<InsertExportJobInput> = {},
): InsertExportJobInput {
  return {
    doc_hash: 'a'.repeat(64),
    format: 'docx',
    quality_tier: 'layout-preserving',
    page_range_start: 0,
    page_range_end: 4,
    include_annotations: 1,
    output_path: 'C:\\out\\contract.docx',
    status: 'queued',
    started_at: 1716307200000,
    ...overrides,
  };
}

function makeImageQueuedInput(overrides: Partial<InsertExportJobInput> = {}): InsertExportJobInput {
  return {
    doc_hash: 'b'.repeat(64),
    format: 'png',
    quality_tier: 'n/a',
    page_range_start: 0,
    page_range_end: 2,
    include_annotations: 1,
    dpi: 150,
    output_path: 'C:\\out\\page-1.png',
    status: 'queued',
    started_at: 1716307200000,
    ...overrides,
  };
}

describe('export-jobs-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: ExportJobsRepo;

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createExportJobsRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================
  // Schema verification (smoke test that migration 0006 ran)
  // ============================================================

  describe('schema migration', () => {
    it('reports schema_version >= 6 after migrations apply', () => {
      const row = db
        .prepare<[], { v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
        .get();
      expect(row?.v).toBeGreaterThanOrEqual(6);
    });

    it('reports schema_version == the latest migration file (current head)', () => {
      // Self-updating head check: assert MAX(version) equals the highest
      // version among the loaded migration files, NOT a hardcoded phase number.
      // A literal `.toBe(6)` here bakes in a Phase-6 expiry that breaks the
      // moment any later phase ships a migration (Phase 7's 0007 did exactly
      // that). The watermark only ever increases — tie the expectation to the
      // migration set, not a constant (Wave 16 takeaway #2, .learnings).
      const head = Math.max(...loadMigrationsForTests().map((m) => m.version));
      const row = db
        .prepare<[], { v: number }>('SELECT MAX(version) AS v FROM schema_migrations')
        .get();
      expect(row?.v).toBe(head);
    });

    it('creates export_jobs with the canonical column set', () => {
      const cols = db
        .prepare<[], { name: string }>(`PRAGMA table_info(export_jobs)`)
        .all()
        .map((r) => r.name)
        .sort();
      expect(cols).toEqual(
        [
          'completed_at',
          'created_at',
          'doc_hash',
          'dpi',
          'duration_ms',
          'error_message',
          'format',
          'id',
          'images_embedded',
          'include_annotations',
          'jpeg_quality',
          'multi_page_tiff',
          'output_path',
          'output_size_bytes',
          'page_range_end',
          'page_range_start',
          'pages_processed',
          'paragraphs_extracted',
          'quality_tier',
          'started_at',
          'status',
          'tables_detected',
        ].sort(),
      );
    });

    it('creates the doc_hash + status + format indexes', () => {
      const idx = db
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'export_jobs'`,
        )
        .all()
        .map((r) => r.name);
      expect(idx).toEqual(expect.arrayContaining(['idx_export_jobs_doc_hash']));
      expect(idx).toEqual(expect.arrayContaining(['idx_export_jobs_status']));
      expect(idx).toEqual(expect.arrayContaining(['idx_export_jobs_format']));
    });

    it('enforces format CHECK constraint at SQL level', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO export_jobs (doc_hash, format, quality_tier, page_range_start,
              page_range_end, include_annotations, output_path, status, started_at,
              pages_processed, created_at)
              VALUES ('x', 'bogus_fmt', 'n/a', 0, 1, 1, '/p', 'queued', 1, 0, 1)`,
          )
          .run(),
      ).toThrowError(/CHECK constraint failed/);
    });

    it('enforces quality_tier CHECK constraint at SQL level', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO export_jobs (doc_hash, format, quality_tier, page_range_start,
              page_range_end, include_annotations, output_path, status, started_at,
              pages_processed, created_at)
              VALUES ('x', 'docx', 'wat', 0, 1, 1, '/p', 'queued', 1, 0, 1)`,
          )
          .run(),
      ).toThrowError(/CHECK constraint failed/);
    });

    it('enforces status CHECK constraint at SQL level', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO export_jobs (doc_hash, format, quality_tier, page_range_start,
              page_range_end, include_annotations, output_path, status, started_at,
              pages_processed, created_at)
              VALUES ('x', 'docx', 'text-only', 0, 1, 1, '/p', 'not_a_status', 1, 0, 1)`,
          )
          .run(),
      ).toThrowError(/CHECK constraint failed/);
    });

    it('rejects superseded_by_undo status (Phase 5 value not applicable to exports)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO export_jobs (doc_hash, format, quality_tier, page_range_start,
              page_range_end, include_annotations, output_path, status, started_at,
              pages_processed, created_at)
              VALUES ('x', 'docx', 'text-only', 0, 1, 1, '/p', 'superseded_by_undo', 1, 0, 1)`,
          )
          .run(),
      ).toThrowError(/CHECK constraint failed/);
    });

    it('enforces include_annotations CHECK constraint (only 0|1)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO export_jobs (doc_hash, format, quality_tier, page_range_start,
              page_range_end, include_annotations, output_path, status, started_at,
              pages_processed, created_at)
              VALUES ('x', 'docx', 'text-only', 0, 1, 7, '/p', 'queued', 1, 0, 1)`,
          )
          .run(),
      ).toThrowError(/CHECK constraint failed/);
    });

    it('enforces multi_page_tiff CHECK constraint (only NULL|0|1)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO export_jobs (doc_hash, format, quality_tier, page_range_start,
              page_range_end, include_annotations, multi_page_tiff, output_path, status,
              started_at, pages_processed, created_at)
              VALUES ('x', 'tiff', 'n/a', 0, 1, 1, 5, '/p', 'queued', 1, 0, 1)`,
          )
          .run(),
      ).toThrowError(/CHECK constraint failed/);
    });

    it('allows NULL for nullable late-init columns (anti-sentinel discipline)', () => {
      // Direct SQL insert with NULL across every nullable column — should succeed.
      const result = db
        .prepare(
          `INSERT INTO export_jobs (doc_hash, format, quality_tier, page_range_start,
            page_range_end, include_annotations, dpi, jpeg_quality, multi_page_tiff,
            output_path, output_size_bytes, status, started_at, completed_at,
            duration_ms, pages_processed, paragraphs_extracted, tables_detected,
            images_embedded, error_message, created_at)
            VALUES ('x', 'docx', 'text-only', 0, 1, 1, NULL, NULL, NULL, '/p', NULL,
                    'queued', 1, NULL, NULL, 0, NULL, NULL, NULL, NULL, 1)`,
        )
        .run();
      expect(result.changes).toBe(1);
    });
  });

  // ============================================================
  // Settings seeds (Phase 6 §11.10 — 17 INSERT OR IGNORE)
  // ============================================================

  describe('settings seeds (Phase 6 §11.10)', () => {
    it('seeds all 17 Phase 6 export.* keys via INSERT OR IGNORE', () => {
      const row = db
        .prepare<
          [],
          { c: number }
        >(`SELECT COUNT(*) AS c FROM app_settings WHERE key LIKE 'export.%'`)
        .get();
      expect(row?.c).toBeGreaterThanOrEqual(17);
    });

    it('seeds export.docx.qualityTier with "layout-preserving" default', () => {
      const row = db
        .prepare<{ k: string }, { value: string }>(`SELECT value FROM app_settings WHERE key = @k`)
        .get({ k: 'export.docx.qualityTier' });
      expect(row?.value).toBe('"layout-preserving"');
    });

    it('seeds export.xlsx.qualityTier with "text-only" default (per Q-D)', () => {
      const row = db
        .prepare<{ k: string }, { value: string }>(`SELECT value FROM app_settings WHERE key = @k`)
        .get({ k: 'export.xlsx.qualityTier' });
      expect(row?.value).toBe('"text-only"');
    });

    it('seeds export.image.dpi with 150 default', () => {
      const row = db
        .prepare<{ k: string }, { value: string }>(`SELECT value FROM app_settings WHERE key = @k`)
        .get({ k: 'export.image.dpi' });
      expect(row?.value).toBe('150');
    });

    it('seeds export.maxQueueSize with 50 default', () => {
      const row = db
        .prepare<{ k: string }, { value: string }>(`SELECT value FROM app_settings WHERE key = @k`)
        .get({ k: 'export.maxQueueSize' });
      expect(row?.value).toBe('50');
    });
  });

  // ============================================================
  // insert — empty + happy paths + validation
  // ============================================================

  describe('insert', () => {
    it('starts with empty list', () => {
      expect(repo.listRecent()).toEqual([]);
      expect(repo.listInProgress()).toEqual([]);
      expect(repo.listByDocHash('any')).toEqual([]);
      expect(repo.listByStatus('queued')).toEqual([]);
    });

    it('inserts a queued docx job and returns a positive id', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      expect(id).toBeGreaterThan(0);
      const row = repo.get(id);
      expect(row?.status).toBe('queued');
      expect(row?.format).toBe('docx');
      expect(row?.quality_tier).toBe('layout-preserving');
      expect(row?.include_annotations).toBe(1);
      expect(row?.completed_at).toBeNull();
      expect(row?.duration_ms).toBeNull();
      expect(row?.output_size_bytes).toBeNull();
      expect(row?.error_message).toBeNull();
      expect(row?.paragraphs_extracted).toBeNull();
      expect(row?.tables_detected).toBeNull();
      expect(row?.images_embedded).toBeNull();
      expect(row?.pages_processed).toBe(0);
      // Image fields are NULL for office formats.
      expect(row?.dpi).toBeNull();
      expect(row?.jpeg_quality).toBeNull();
      expect(row?.multi_page_tiff).toBeNull();
    });

    it('inserts a queued png job with dpi populated', () => {
      const id = repo.insert(makeImageQueuedInput());
      const row = repo.get(id);
      expect(row?.format).toBe('png');
      expect(row?.quality_tier).toBe('n/a');
      expect(row?.dpi).toBe(150);
      expect(row?.jpeg_quality).toBeNull();
      expect(row?.multi_page_tiff).toBeNull();
    });

    it('inserts a queued jpeg job with jpeg_quality populated', () => {
      const id = repo.insert(
        makeImageQueuedInput({
          format: 'jpeg',
          dpi: 200,
          jpeg_quality: 0.85,
          output_path: 'C:\\out\\page-1.jpg',
        }),
      );
      const row = repo.get(id);
      expect(row?.format).toBe('jpeg');
      expect(row?.dpi).toBe(200);
      expect(row?.jpeg_quality).toBeCloseTo(0.85);
      expect(row?.multi_page_tiff).toBeNull();
    });

    it('inserts a queued tiff job with multi_page_tiff populated', () => {
      const id = repo.insert(
        makeImageQueuedInput({
          format: 'tiff',
          dpi: 300,
          multi_page_tiff: 1,
          output_path: 'C:\\out\\all.tif',
        }),
      );
      const row = repo.get(id);
      expect(row?.format).toBe('tiff');
      expect(row?.dpi).toBe(300);
      expect(row?.multi_page_tiff).toBe(1);
      expect(row?.jpeg_quality).toBeNull();
    });

    it('defaults created_at to Date.now()', () => {
      const before = Date.now();
      const id = repo.insert(makeOfficeQueuedInput());
      const after = Date.now();
      const row = repo.get(id);
      expect(row?.created_at).toBeGreaterThanOrEqual(before);
      expect(row?.created_at).toBeLessThanOrEqual(after);
    });

    it('rejects empty doc_hash', () => {
      expect(() => repo.insert(makeOfficeQueuedInput({ doc_hash: '' }))).toThrowError(
        /doc_hash must be a non-empty string/,
      );
    });

    it('rejects empty output_path', () => {
      expect(() => repo.insert(makeOfficeQueuedInput({ output_path: '' }))).toThrowError(
        /output_path must be a non-empty string/,
      );
    });

    it('rejects invalid format', () => {
      expect(() =>
        // @ts-expect-error — runtime guard test
        repo.insert(makeOfficeQueuedInput({ format: 'bogus' })),
      ).toThrowError(/format must be one of/);
    });

    it('rejects invalid quality_tier', () => {
      expect(() =>
        // @ts-expect-error — runtime guard test
        repo.insert(makeOfficeQueuedInput({ quality_tier: 'huh' })),
      ).toThrowError(/quality_tier must be one of/);
    });

    it('rejects invalid status', () => {
      expect(() =>
        // @ts-expect-error — runtime guard test
        repo.insert(makeOfficeQueuedInput({ status: 'bogus' })),
      ).toThrowError(/status must be one of/);
    });

    it('rejects negative page_range_start', () => {
      expect(() => repo.insert(makeOfficeQueuedInput({ page_range_start: -1 }))).toThrowError(
        /page_range_start/,
      );
    });

    it('rejects page_range_end < page_range_start', () => {
      expect(() =>
        repo.insert(makeOfficeQueuedInput({ page_range_start: 5, page_range_end: 2 })),
      ).toThrowError(/page_range_end .* must be >= page_range_start/);
    });

    it('rejects invalid include_annotations', () => {
      expect(() =>
        // @ts-expect-error — runtime guard test
        repo.insert(makeOfficeQueuedInput({ include_annotations: 2 })),
      ).toThrowError(/include_annotations must be 0 or 1/);
    });

    it('rejects invalid dpi (non-positive)', () => {
      expect(() => repo.insert(makeImageQueuedInput({ dpi: 0 }))).toThrowError(
        /dpi must be a positive integer/,
      );
    });

    it('rejects jpeg_quality out of (0, 1]', () => {
      expect(() =>
        repo.insert(makeImageQueuedInput({ format: 'jpeg', jpeg_quality: 1.5 })),
      ).toThrowError(/jpeg_quality must be a number in/);
    });

    it('rejects invalid multi_page_tiff value', () => {
      expect(() =>
        // @ts-expect-error — runtime guard test
        repo.insert(makeImageQueuedInput({ format: 'tiff', multi_page_tiff: 9 })),
      ).toThrowError(/multi_page_tiff must be 0 or 1/);
    });

    it('rejects negative started_at', () => {
      expect(() => repo.insert(makeOfficeQueuedInput({ started_at: -1 }))).toThrowError(
        /started_at/,
      );
    });

    it('truncates error_message to 2048 chars on insert', () => {
      const huge = 'x'.repeat(5000);
      const id = repo.insert(
        makeOfficeQueuedInput({
          status: 'failed',
          completed_at: 2000,
          duration_ms: 1000,
          error_message: huge,
        }),
      );
      const row = repo.get(id);
      expect(row?.error_message?.length).toBe(2048);
    });
  });

  // ============================================================
  // updateStatus — lifecycle transitions
  // ============================================================

  describe('updateStatus / markRunning / markCompleted / markCancelled / markFailed', () => {
    it('transitions queued -> running via markRunning', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      expect(repo.markRunning(id)).toBe(true);
      const row = repo.get(id);
      expect(row?.status).toBe('running');
      // Completion fields untouched.
      expect(row?.completed_at).toBeNull();
      expect(row?.duration_ms).toBeNull();
    });

    it('transitions running -> completed via markCompleted (office)', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      repo.markRunning(id);
      // Bump pages_processed via updateProgress first to simulate streaming.
      repo.updateProgress(id, { pages_processed: 5 });
      const ok = repo.markCompleted(id, {
        completed_at: 1716307260000,
        duration_ms: 60000,
        output_size_bytes: 245678,
        paragraphs_extracted: 47,
        tables_detected: 2,
        images_embedded: 5,
      });
      expect(ok).toBe(true);
      const row = repo.get(id);
      expect(row?.status).toBe('completed');
      expect(row?.completed_at).toBe(1716307260000);
      expect(row?.duration_ms).toBe(60000);
      expect(row?.output_size_bytes).toBe(245678);
      expect(row?.paragraphs_extracted).toBe(47);
      expect(row?.tables_detected).toBe(2);
      expect(row?.images_embedded).toBe(5);
      // pages_processed preserved from prior updateProgress call.
      expect(row?.pages_processed).toBe(5);
    });

    it('transitions running -> completed via markCompleted (image, no stats)', () => {
      const id = repo.insert(makeImageQueuedInput());
      repo.markRunning(id);
      repo.updateProgress(id, { pages_processed: 3 });
      const ok = repo.markCompleted(id, {
        completed_at: 1716307260000,
        duration_ms: 5000,
        output_size_bytes: 102400,
      });
      expect(ok).toBe(true);
      const row = repo.get(id);
      expect(row?.status).toBe('completed');
      // Image formats have NULL content stats throughout.
      expect(row?.paragraphs_extracted).toBeNull();
      expect(row?.tables_detected).toBeNull();
      expect(row?.images_embedded).toBeNull();
    });

    it('transitions running -> failed via markFailed', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      repo.markRunning(id);
      const ok = repo.markFailed(id, 'writer crashed', 1716307260000, 12345);
      expect(ok).toBe(true);
      const row = repo.get(id);
      expect(row?.status).toBe('failed');
      expect(row?.error_message).toBe('writer crashed');
      expect(row?.completed_at).toBe(1716307260000);
      expect(row?.duration_ms).toBe(12345);
      // Office stats untouched.
      expect(row?.paragraphs_extracted).toBeNull();
    });

    it('transitions running -> cancelled via markCancelled', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      repo.markRunning(id);
      repo.markCancelled(id, { completed_at: 1716307260000, duration_ms: 3000 });
      const row = repo.get(id);
      expect(row?.status).toBe('cancelled');
      expect(row?.completed_at).toBe(1716307260000);
      expect(row?.duration_ms).toBe(3000);
      // error_message untouched on cancel.
      expect(row?.error_message).toBeNull();
    });

    it('partial updateStatus preserves untouched fields (COALESCE)', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      repo.markCompleted(id, {
        completed_at: 1000,
        duration_ms: 500,
        output_size_bytes: 9999,
        paragraphs_extracted: 12,
      });
      // Subsequent status-only update must not stomp completed_at / size / stats.
      repo.updateStatus(id, { status: 'failed', error_message: 'retroactive' });
      const row = repo.get(id);
      expect(row?.status).toBe('failed');
      expect(row?.error_message).toBe('retroactive');
      expect(row?.completed_at).toBe(1000);
      expect(row?.duration_ms).toBe(500);
      expect(row?.output_size_bytes).toBe(9999);
      expect(row?.paragraphs_extracted).toBe(12);
    });

    it('truncates error_message on updateStatus / markFailed (2048 char cap)', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      repo.markRunning(id);
      const huge = 'y'.repeat(3000);
      repo.markFailed(id, huge, 1, 1);
      const row = repo.get(id);
      expect(row?.error_message?.length).toBe(2048);
    });

    it('returns false for missing id on updateStatus', () => {
      expect(repo.updateStatus(424242, { status: 'running' })).toBe(false);
    });

    it('rejects invalid id on updateStatus', () => {
      expect(() => repo.updateStatus(0, { status: 'running' })).toThrowError(/Invalid id/);
    });

    it('rejects invalid status on updateStatus', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      expect(() =>
        // @ts-expect-error — runtime guard test
        repo.updateStatus(id, { status: 'wat' }),
      ).toThrowError(/status must be one of/);
    });

    it('rejects empty errorMessage on markFailed', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      expect(() => repo.markFailed(id, '', 1, 1)).toThrowError(
        /errorMessage must be a non-empty string/,
      );
    });
  });

  // ============================================================
  // updateProgress
  // ============================================================

  describe('updateProgress', () => {
    it('bumps pages_processed without touching content stats', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      repo.updateProgress(id, { pages_processed: 3 });
      const row = repo.get(id);
      expect(row?.pages_processed).toBe(3);
      expect(row?.paragraphs_extracted).toBeNull();
      expect(row?.tables_detected).toBeNull();
      expect(row?.images_embedded).toBeNull();
    });

    it('updates content stats incrementally', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      repo.updateProgress(id, {
        pages_processed: 1,
        paragraphs_extracted: 10,
        tables_detected: 1,
        images_embedded: 2,
      });
      const row1 = repo.get(id);
      expect(row1?.paragraphs_extracted).toBe(10);
      // Subsequent partial update: only pages_processed + tables move.
      repo.updateProgress(id, { pages_processed: 2, tables_detected: 3 });
      const row2 = repo.get(id);
      expect(row2?.pages_processed).toBe(2);
      expect(row2?.tables_detected).toBe(3);
      // Paragraphs + images preserved.
      expect(row2?.paragraphs_extracted).toBe(10);
      expect(row2?.images_embedded).toBe(2);
    });

    it('updates output_size_bytes during streaming write', () => {
      const id = repo.insert(makeImageQueuedInput());
      repo.updateProgress(id, { pages_processed: 1, output_size_bytes: 10000 });
      repo.updateProgress(id, { pages_processed: 2, output_size_bytes: 25000 });
      const row = repo.get(id);
      expect(row?.output_size_bytes).toBe(25000);
    });

    it('returns false for missing id', () => {
      expect(repo.updateProgress(424242, { pages_processed: 1 })).toBe(false);
    });

    it('rejects negative pages_processed', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      expect(() => repo.updateProgress(id, { pages_processed: -1 })).toThrowError(
        /pages_processed must be a non-negative integer/,
      );
    });
  });

  // ============================================================
  // listByDocHash + listByStatus + listRecent + listInProgress
  // ============================================================

  describe('listByDocHash', () => {
    it('returns [] for unknown hash', () => {
      expect(repo.listByDocHash('nope')).toEqual([]);
    });

    it('filters by doc_hash ordered started_at DESC', () => {
      repo.insert(makeOfficeQueuedInput({ doc_hash: 'd1', started_at: 1000 }));
      repo.insert(makeOfficeQueuedInput({ doc_hash: 'd1', started_at: 3000 }));
      repo.insert(makeOfficeQueuedInput({ doc_hash: 'd1', started_at: 2000 }));
      repo.insert(makeOfficeQueuedInput({ doc_hash: 'd2', started_at: 4000 }));

      const rows = repo.listByDocHash('d1');
      expect(rows.map((r) => r.started_at)).toEqual([3000, 2000, 1000]);
      expect(rows.every((r) => r.doc_hash === 'd1')).toBe(true);
    });

    it('honors limit + offset for pagination', () => {
      for (let i = 0; i < 5; i++) {
        repo.insert(makeOfficeQueuedInput({ doc_hash: 'p', started_at: 1000 + i }));
      }
      const page1 = repo.listByDocHash('p', 2, 0);
      const page2 = repo.listByDocHash('p', 2, 2);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      const all = new Set([...page1.map((r) => r.id), ...page2.map((r) => r.id)]);
      expect(all.size).toBe(4);
    });
  });

  describe('listByStatus', () => {
    it('filters by status', () => {
      const a = repo.insert(makeOfficeQueuedInput({ doc_hash: 'a' }));
      const b = repo.insert(makeOfficeQueuedInput({ doc_hash: 'b' }));
      repo.markRunning(a);
      repo.markCompleted(b, {
        completed_at: 1,
        duration_ms: 1,
        output_size_bytes: 100,
      });

      const running = repo.listByStatus('running');
      expect(running).toHaveLength(1);
      expect(running[0]?.doc_hash).toBe('a');

      const completed = repo.listByStatus('completed');
      expect(completed).toHaveLength(1);
      expect(completed[0]?.doc_hash).toBe('b');

      expect(repo.listByStatus('queued')).toEqual([]);
    });
  });

  describe('listRecent', () => {
    it('orders by started_at DESC across all docs and statuses', () => {
      repo.insert(makeOfficeQueuedInput({ doc_hash: 'd1', started_at: 1000 }));
      const r2 = repo.insert(makeOfficeQueuedInput({ doc_hash: 'd2', started_at: 2000 }));
      repo.markCompleted(r2, {
        completed_at: 2500,
        duration_ms: 500,
        output_size_bytes: 1234,
      });
      const r3 = repo.insert(makeImageQueuedInput({ doc_hash: 'd3', started_at: 3000 }));
      repo.markRunning(r3);

      const rows = repo.listRecent();
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.started_at)).toEqual([3000, 2000, 1000]);
    });

    it('honors limit', () => {
      for (let i = 0; i < 10; i++) {
        repo.insert(makeOfficeQueuedInput({ started_at: 1000 + i }));
      }
      expect(repo.listRecent(5)).toHaveLength(5);
    });
  });

  describe('listInProgress', () => {
    it('returns union of queued + running rows ordered DESC', () => {
      const q1 = repo.insert(makeOfficeQueuedInput({ started_at: 1000 }));
      const q2 = repo.insert(makeOfficeQueuedInput({ started_at: 3000 }));
      const r1 = repo.insert(makeImageQueuedInput({ started_at: 2000 }));
      repo.markRunning(r1);
      // Terminal jobs are excluded.
      const c1 = repo.insert(makeOfficeQueuedInput({ started_at: 4000 }));
      repo.markCompleted(c1, { completed_at: 5000, duration_ms: 1000, output_size_bytes: 1 });
      const f1 = repo.insert(makeOfficeQueuedInput({ started_at: 5000 }));
      repo.markFailed(f1, 'nope', 6000, 1000);

      const rows = repo.listInProgress();
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.id)).toEqual([q2, r1, q1]);
      expect(rows.every((r) => r.status === 'queued' || r.status === 'running')).toBe(true);
    });

    it('returns [] when no in-progress rows', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      repo.markCompleted(id, {
        completed_at: 1,
        duration_ms: 1,
        output_size_bytes: 1,
      });
      expect(repo.listInProgress()).toEqual([]);
    });
  });

  // ============================================================
  // delete (no cascade — FK-less per data-models §11.8)
  // ============================================================

  describe('delete', () => {
    it('removes by id and returns true', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      expect(repo.delete(id)).toBe(true);
      expect(repo.get(id)).toBeNull();
    });

    it('returns false for missing id', () => {
      expect(repo.delete(424242)).toBe(false);
    });

    it('does NOT cascade to other tables (FK-less; data-models §11.8)', () => {
      // Insert an export job referencing a doc_hash that also has bookmarks +
      // recent_files rows. Deleting the export job must NOT touch those tables.
      const docHash = 'shared'.padEnd(64, '0');
      db.prepare(
        `INSERT INTO recent_files (path, last_opened_at, file_hash, display_name)
          VALUES ('/x', 1, @h, 'x.pdf')`,
      ).run({ h: docHash });
      db.prepare(
        `INSERT INTO user_bookmarks (file_hash, page_index, title, created_at)
          VALUES (@h, 0, 'top', 1)`,
      ).run({ h: docHash });
      const id = repo.insert(makeOfficeQueuedInput({ doc_hash: docHash }));
      repo.delete(id);

      const rf = db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM recent_files').get();
      const bm = db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM user_bookmarks').get();
      expect(rf?.c).toBe(1);
      expect(bm?.c).toBe(1);
    });
  });

  // ============================================================
  // SQL-injection resistance
  //
  // Wave 13.5 + Wave 17 + Wave 20 lesson: real adversarial payloads through
  // every TEXT column AND every string parameter on every read method. After
  // each payload the table is still intact and the row is retrievable verbatim.
  // ============================================================

  describe('SQL-injection resistance', () => {
    const PAYLOADS = [
      "'; DROP TABLE export_jobs; --",
      "x' OR '1'='1",
      "x' UNION SELECT * FROM schema_migrations; --",
      'x"; DELETE FROM export_jobs; --',
      "x'); DROP TABLE schema_migrations; --",
      'x\x00\nDROP TABLE export_jobs;',
    ];

    it.each(PAYLOADS)(
      'preserves table + roundtrips payload %j across every TEXT column',
      (payload: string) => {
        // Insert with the payload in every TEXT column the repo accepts.
        const id = repo.insert(
          makeOfficeQueuedInput({
            doc_hash: payload,
            output_path: payload,
          }),
        );

        // Updates touch error_message too.
        repo.markRunning(id);
        repo.markFailed(id, payload, 1, 1);

        // Read back via every method that touches the row.
        const row = repo.get(id);
        expect(row?.doc_hash).toBe(payload);
        expect(row?.output_path).toBe(payload);
        // error_message round-trip — truncate-only, no SQL parse.
        expect(row?.error_message).toBe(payload);

        // List methods accepting strings must roundtrip without SQL parse.
        expect(repo.listByDocHash(payload)).toHaveLength(1);

        // Schema still intact.
        const tables = db
          .prepare<
            [],
            { name: string }
          >(`SELECT name FROM sqlite_master WHERE type='table' AND name='export_jobs'`)
          .all();
        expect(tables).toHaveLength(1);
        const migrations = db
          .prepare<[], { v: number }>('SELECT MAX(version) AS v FROM schema_migrations')
          .get();
        // Injection payload must not have tampered with the migration head.
        // Assert `>= 6` rather than `== 6` so this guard does not carry a
        // Phase-6 expiry (Wave 16 takeaway #2): the head only ever increases,
        // and "unchanged by injection" is fully proven by it still being at
        // (or above) the migrated floor.
        expect(migrations?.v).toBeGreaterThanOrEqual(6);

        // The schema_migrations table is also intact — UNION payload couldn't
        // exfiltrate or modify it.
        const sm = db
          .prepare<
            [],
            { name: string }
          >(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
          .all();
        expect(sm).toHaveLength(1);
      },
    );

    it('round-trips embedded JSON-like payload in output_path (boundary discipline)', () => {
      // The bridge strips output_path before crossing IPC; the repo nevertheless
      // must not interpret quoted segments.
      const payload = '{"injected": "value", "drop": "table"}';
      const id = repo.insert(makeOfficeQueuedInput({ output_path: payload }));
      expect(repo.get(id)?.output_path).toBe(payload);
    });
  });

  // ============================================================
  // Idempotency — re-applying the migration to a populated DB is a no-op
  // ============================================================

  describe('migration idempotency', () => {
    it('re-running migrations on a populated DB does not duplicate rows', () => {
      const id = repo.insert(makeOfficeQueuedInput());
      const beforeCount = db
        .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM export_jobs')
        .get();

      // Re-run the migrations against the same db. IF NOT EXISTS guards +
      // runner watermark must skip; INSERT OR IGNORE for settings must
      // preserve existing values.
      // (Direct simulation: re-exec the CREATE TABLE / CREATE INDEX statements
      //  to assert IF NOT EXISTS guards hold.)
      expect(() =>
        db.exec(`
          CREATE TABLE IF NOT EXISTS export_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT);
          CREATE INDEX IF NOT EXISTS idx_export_jobs_doc_hash ON export_jobs (doc_hash);
        `),
      ).not.toThrow();

      const afterCount = db
        .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM export_jobs')
        .get();
      expect(afterCount?.c).toBe(beforeCount?.c);
      expect(repo.get(id)).not.toBeNull();
    });

    it('re-running setting seeds preserves user-customized values', () => {
      // Simulate a user setting export.image.dpi = 300, then re-running the
      // seed: INSERT OR IGNORE must NOT clobber.
      db.prepare(`UPDATE app_settings SET value = '300' WHERE key = @k`).run({
        k: 'export.image.dpi',
      });
      db.exec(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('export.image.dpi', '150')`);
      const row = db
        .prepare<{ k: string }, { value: string }>(`SELECT value FROM app_settings WHERE key = @k`)
        .get({ k: 'export.image.dpi' });
      expect(row?.value).toBe('300'); // preserved, NOT clobbered
    });
  });
});
