import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import { createOcrJobsRepo, type InsertOcrJobInput, type OcrJobsRepo } from './ocr-jobs-repo';

// ============================================================
// Fixture builders
// ============================================================

function makeQueuedInput(overrides: Partial<InsertOcrJobInput> = {}): InsertOcrJobInput {
  return {
    doc_hash: 'a'.repeat(64),
    page_range_start: 0,
    page_range_end: 4,
    langs: 'eng',
    preprocess_json: JSON.stringify({
      deskew: true,
      denoise: false,
      contrastBoost: false,
    }),
    status: 'queued',
    started_at: 1716307200000,
    invalidated_signatures: 0,
    ...overrides,
  };
}

describe('ocr-jobs-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: OcrJobsRepo;

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createOcrJobsRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================
  // Schema verification (smoke test that migration 0005 ran)
  // ============================================================

  describe('schema migration', () => {
    it('reports schema_version >= 5 after migrations apply', () => {
      const row = db
        .prepare<[], { v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
        .get();
      expect(row?.v).toBeGreaterThanOrEqual(5);
    });

    it('creates ocr_jobs with the canonical column set', () => {
      const cols = db
        .prepare<[], { name: string }>(`PRAGMA table_info(ocr_jobs)`)
        .all()
        .map((r) => r.name)
        .sort();
      expect(cols).toEqual(
        [
          'completed_at',
          'created_at',
          'doc_hash',
          'error_message',
          'id',
          'invalidated_signatures',
          'langs',
          'mean_confidence',
          'page_range_end',
          'page_range_start',
          'preprocess_json',
          'started_at',
          'status',
          'total_words',
        ].sort(),
      );
    });

    it('creates the doc_hash + status + started_at indexes', () => {
      const idx = db
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ocr_jobs'`,
        )
        .all()
        .map((r) => r.name);
      expect(idx).toEqual(expect.arrayContaining(['idx_ocr_jobs_doc_hash']));
      expect(idx).toEqual(expect.arrayContaining(['idx_ocr_jobs_status']));
      expect(idx).toEqual(expect.arrayContaining(['idx_ocr_jobs_started_at']));
    });

    it('enforces status CHECK constraint at SQL level', () => {
      // Raw insert with an invalid status string — should detonate at SQL.
      expect(() =>
        db
          .prepare(
            `INSERT INTO ocr_jobs (doc_hash, page_range_start, page_range_end,
              langs, preprocess_json, status, started_at, invalidated_signatures,
              created_at)
              VALUES ('x', 0, 1, 'eng', '{}', 'not_a_status', 1, 0, 1)`,
          )
          .run(),
      ).toThrowError(/CHECK constraint failed/);
    });

    it('enforces invalidated_signatures CHECK constraint (only 0|1)', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO ocr_jobs (doc_hash, page_range_start, page_range_end,
              langs, preprocess_json, status, started_at, invalidated_signatures,
              created_at)
              VALUES ('x', 0, 1, 'eng', '{}', 'queued', 1, 7, 1)`,
          )
          .run(),
      ).toThrowError(/CHECK constraint failed/);
    });
  });

  // ============================================================
  // insert
  // ============================================================

  describe('insert', () => {
    it('inserts a queued job and returns a positive id', () => {
      const id = repo.insert(makeQueuedInput());
      expect(id).toBeGreaterThan(0);
      const row = repo.get(id);
      expect(row?.status).toBe('queued');
      expect(row?.langs).toBe('eng');
      expect(row?.completed_at).toBeNull();
      expect(row?.mean_confidence).toBeNull();
      expect(row?.total_words).toBeNull();
      expect(row?.error_message).toBeNull();
      expect(row?.invalidated_signatures).toBe(0);
    });

    it('preserves preprocess_json byte-for-byte (no re-encode)', () => {
      const payload = '{\n  "deskew": true,\n  "denoise": false\n}';
      const id = repo.insert(makeQueuedInput({ preprocess_json: payload }));
      expect(repo.get(id)?.preprocess_json).toBe(payload);
    });

    it('defaults created_at to Date.now()', () => {
      const before = Date.now();
      const id = repo.insert(makeQueuedInput());
      const after = Date.now();
      const row = repo.get(id);
      expect(row?.created_at).toBeGreaterThanOrEqual(before);
      expect(row?.created_at).toBeLessThanOrEqual(after);
    });

    it('allows multi-lang langs string ("eng+spa+fra")', () => {
      const id = repo.insert(makeQueuedInput({ langs: 'eng+spa+fra' }));
      expect(repo.get(id)?.langs).toBe('eng+spa+fra');
    });

    it('rejects empty doc_hash', () => {
      expect(() => repo.insert(makeQueuedInput({ doc_hash: '' }))).toThrowError(
        /doc_hash must be a non-empty string/,
      );
    });

    it('rejects empty langs', () => {
      expect(() => repo.insert(makeQueuedInput({ langs: '' }))).toThrowError(
        /langs must be a non-empty string/,
      );
    });

    it('rejects empty preprocess_json', () => {
      expect(() => repo.insert(makeQueuedInput({ preprocess_json: '' }))).toThrowError(
        /preprocess_json/,
      );
    });

    it('rejects negative page_range_start', () => {
      expect(() => repo.insert(makeQueuedInput({ page_range_start: -1 }))).toThrowError(
        /page_range_start/,
      );
    });

    it('rejects page_range_end < page_range_start', () => {
      expect(() =>
        repo.insert(makeQueuedInput({ page_range_start: 5, page_range_end: 2 })),
      ).toThrowError(/page_range_end .* must be >= page_range_start/);
    });

    it('rejects invalid status', () => {
      expect(() =>
        // @ts-expect-error — runtime guard test
        repo.insert(makeQueuedInput({ status: 'bogus' })),
      ).toThrowError(/status must be one of/);
    });

    it('rejects invalid invalidated_signatures', () => {
      expect(() =>
        // @ts-expect-error — runtime guard test
        repo.insert(makeQueuedInput({ invalidated_signatures: 2 })),
      ).toThrowError(/invalidated_signatures must be 0 or 1/);
    });

    it('rejects negative started_at', () => {
      expect(() => repo.insert(makeQueuedInput({ started_at: -1 }))).toThrowError(/started_at/);
    });
  });

  // ============================================================
  // updateStatus — lifecycle transitions
  // ============================================================

  describe('updateStatus', () => {
    it('transitions queued -> running with status only', () => {
      const id = repo.insert(makeQueuedInput());
      expect(repo.updateStatus(id, { status: 'running' })).toBe(true);
      const row = repo.get(id);
      expect(row?.status).toBe('running');
      // Completion fields untouched.
      expect(row?.completed_at).toBeNull();
      expect(row?.mean_confidence).toBeNull();
    });

    it('transitions running -> completed with all watermark fields', () => {
      const id = repo.insert(makeQueuedInput());
      repo.updateStatus(id, { status: 'running' });
      const ok = repo.updateStatus(id, {
        status: 'completed',
        completed_at: 1716307260000,
        mean_confidence: 89.4,
        total_words: 1247,
      });
      expect(ok).toBe(true);
      const row = repo.get(id);
      expect(row?.status).toBe('completed');
      expect(row?.completed_at).toBe(1716307260000);
      expect(row?.mean_confidence).toBeCloseTo(89.4);
      expect(row?.total_words).toBe(1247);
    });

    it('transitions running -> failed with error_message', () => {
      const id = repo.insert(makeQueuedInput());
      repo.updateStatus(id, { status: 'running' });
      const ok = repo.updateStatus(id, {
        status: 'failed',
        completed_at: 1716307260000,
        error_message: 'worker crashed',
      });
      expect(ok).toBe(true);
      const row = repo.get(id);
      expect(row?.status).toBe('failed');
      expect(row?.error_message).toBe('worker crashed');
      // mean_confidence + total_words untouched.
      expect(row?.mean_confidence).toBeNull();
    });

    it('transitions running -> cancelled with timestamp only', () => {
      const id = repo.insert(makeQueuedInput());
      repo.updateStatus(id, { status: 'running' });
      repo.updateStatus(id, {
        status: 'cancelled',
        completed_at: 1716307260000,
      });
      expect(repo.get(id)?.status).toBe('cancelled');
    });

    it('transitions completed -> superseded_by_undo', () => {
      const id = repo.insert(makeQueuedInput());
      repo.updateStatus(id, {
        status: 'completed',
        completed_at: 1716307260000,
        mean_confidence: 90,
        total_words: 100,
      });
      repo.updateStatus(id, { status: 'superseded_by_undo' });
      const row = repo.get(id);
      expect(row?.status).toBe('superseded_by_undo');
      // Prior watermark preserved (COALESCE pattern).
      expect(row?.completed_at).toBe(1716307260000);
      expect(row?.mean_confidence).toBe(90);
      expect(row?.total_words).toBe(100);
    });

    it('partial update preserves untouched fields', () => {
      const id = repo.insert(makeQueuedInput());
      repo.updateStatus(id, {
        status: 'completed',
        completed_at: 1000,
        mean_confidence: 85,
        total_words: 500,
      });
      // Single-field update — only error_message lands.
      repo.updateStatus(id, { status: 'failed', error_message: 'retroactive' });
      const row = repo.get(id);
      expect(row?.status).toBe('failed');
      expect(row?.error_message).toBe('retroactive');
      expect(row?.completed_at).toBe(1000);
      expect(row?.mean_confidence).toBe(85);
      expect(row?.total_words).toBe(500);
    });

    it('returns false for missing id', () => {
      expect(repo.updateStatus(424242, { status: 'running' })).toBe(false);
    });

    it('rejects invalid id', () => {
      expect(() => repo.updateStatus(0, { status: 'running' })).toThrowError(/Invalid id/);
    });

    it('rejects invalid status', () => {
      const id = repo.insert(makeQueuedInput());
      expect(() =>
        // @ts-expect-error — runtime guard test
        repo.updateStatus(id, { status: 'wat' }),
      ).toThrowError(/status must be one of/);
    });

    it('rejects out-of-range mean_confidence on update', () => {
      const id = repo.insert(makeQueuedInput());
      expect(() =>
        repo.updateStatus(id, { status: 'completed', mean_confidence: 150 }),
      ).toThrowError(/mean_confidence/);
    });
  });

  // ============================================================
  // listByDocHash + listByStatus + listAll + countAll
  // ============================================================

  describe('listByDocHash', () => {
    it('returns [] for unknown hash', () => {
      expect(repo.listByDocHash('nope')).toEqual([]);
    });

    it('filters by doc_hash ordered started_at DESC', () => {
      repo.insert(makeQueuedInput({ doc_hash: 'd1', started_at: 1000 }));
      repo.insert(makeQueuedInput({ doc_hash: 'd1', started_at: 3000 }));
      repo.insert(makeQueuedInput({ doc_hash: 'd1', started_at: 2000 }));
      repo.insert(makeQueuedInput({ doc_hash: 'd2', started_at: 4000 }));

      const rows = repo.listByDocHash('d1');
      expect(rows.map((r) => r.started_at)).toEqual([3000, 2000, 1000]);
      expect(rows.every((r) => r.doc_hash === 'd1')).toBe(true);
    });
  });

  describe('listByStatus', () => {
    it('filters by status', () => {
      const a = repo.insert(makeQueuedInput({ doc_hash: 'a' }));
      const b = repo.insert(makeQueuedInput({ doc_hash: 'b' }));
      repo.updateStatus(a, { status: 'running' });
      repo.updateStatus(b, {
        status: 'completed',
        completed_at: 1,
        mean_confidence: 80,
        total_words: 50,
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

  describe('listAll + countAll', () => {
    beforeEach(() => {
      repo.insert(makeQueuedInput({ doc_hash: 'd1', started_at: 1000 }));
      const r2 = repo.insert(makeQueuedInput({ doc_hash: 'd1', started_at: 2000 }));
      repo.updateStatus(r2, {
        status: 'completed',
        completed_at: 2500,
        mean_confidence: 90,
        total_words: 100,
      });
      const r3 = repo.insert(makeQueuedInput({ doc_hash: 'd2', started_at: 3000 }));
      repo.updateStatus(r3, { status: 'failed', completed_at: 3500, error_message: 'oops' });
    });

    it('returns all when no filters', () => {
      expect(repo.listAll({})).toHaveLength(3);
      expect(repo.countAll({})).toBe(3);
    });

    it('filters by doc_hash', () => {
      expect(repo.listAll({ doc_hash: 'd1' })).toHaveLength(2);
      expect(repo.countAll({ doc_hash: 'd1' })).toBe(2);
    });

    it('filters by status', () => {
      expect(repo.listAll({ status: 'failed' })).toHaveLength(1);
      expect(repo.countAll({ status: 'failed' })).toBe(1);
    });

    it('filters by since/until window', () => {
      const rows = repo.listAll({ since: 1500, until: 2500 });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.started_at).toBe(2000);
    });

    it('combines doc_hash + status', () => {
      const rows = repo.listAll({ doc_hash: 'd1', status: 'completed' });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('completed');
    });

    it('honors limit + offset for pagination', () => {
      const page1 = repo.listAll({}, 2, 0);
      const page2 = repo.listAll({}, 2, 2);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
      // Pages don't overlap.
      const allIds = new Set([...page1.map((r) => r.id), ...page2.map((r) => r.id)]);
      expect(allIds.size).toBe(3);
    });
  });

  // ============================================================
  // delete + cascade
  // ============================================================

  describe('delete', () => {
    it('removes by id and returns true', () => {
      const id = repo.insert(makeQueuedInput());
      expect(repo.delete(id)).toBe(true);
      expect(repo.get(id)).toBeNull();
    });

    it('returns false for missing id', () => {
      expect(repo.delete(424242)).toBe(false);
    });

    it('cascades to ocr_results via FK ON DELETE CASCADE', () => {
      const jobId = repo.insert(makeQueuedInput());
      // Hand-roll a results row directly via SQL to verify the cascade contract
      // without taking a dependency on the results repo from this test file.
      db.prepare(
        `INSERT INTO ocr_results (job_id, page_index, total_words,
          low_confidence_words, mean_confidence, words_json,
          img_width_px, img_height_px, duration_ms, created_at)
          VALUES (@job_id, 0, 5, 1, 80.0, '[]', 1000, 1500, 250, @created_at)`,
      ).run({ job_id: jobId, created_at: Date.now() });

      const countBefore = db
        .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM ocr_results')
        .get();
      expect(countBefore?.c).toBe(1);

      repo.delete(jobId);

      const countAfter = db
        .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM ocr_results')
        .get();
      expect(countAfter?.c).toBe(0);
    });
  });

  // ============================================================
  // SQL-injection resistance
  //
  // Wave 13.5 + Wave 17 lesson: real adversarial payloads through every TEXT
  // column AND every string parameter on every read method. After each
  // payload the table is still intact and the row is retrievable verbatim.
  // ============================================================

  describe('SQL-injection resistance', () => {
    const PAYLOADS = [
      "'; DROP TABLE ocr_jobs; --",
      "x' OR '1'='1",
      "x' UNION SELECT * FROM schema_migrations; --",
      'x"; DELETE FROM ocr_jobs; --',
      "x'); DROP TABLE schema_migrations; --",
      'x\x00\nDROP TABLE ocr_jobs;',
    ];

    it.each(PAYLOADS)(
      'preserves table + roundtrips payload %j across every TEXT column',
      (payload: string) => {
        // Insert with the payload in every TEXT column.
        const id = repo.insert(
          makeQueuedInput({
            doc_hash: payload,
            langs: payload,
            preprocess_json: payload,
          }),
        );

        // Updates touch error_message too.
        repo.updateStatus(id, {
          status: 'failed',
          completed_at: 1,
          error_message: payload,
        });

        // Read back via every string-taking method.
        const row = repo.get(id);
        expect(row?.doc_hash).toBe(payload);
        expect(row?.langs).toBe(payload);
        expect(row?.preprocess_json).toBe(payload);
        expect(row?.error_message).toBe(payload);

        expect(repo.listByDocHash(payload)).toHaveLength(1);
        expect(repo.listAll({ doc_hash: payload })).toHaveLength(1);
        expect(repo.countAll({ doc_hash: payload })).toBe(1);

        // Schema still intact.
        const tables = db
          .prepare<
            [],
            { name: string }
          >(`SELECT name FROM sqlite_master WHERE type='table' AND name='ocr_jobs'`)
          .all();
        expect(tables).toHaveLength(1);
        const migrations = db
          .prepare<[], { v: number }>('SELECT MAX(version) AS v FROM schema_migrations')
          .get();
        expect(migrations?.v).toBeGreaterThanOrEqual(5);
      },
    );
  });

  // ============================================================
  // JSON round-trip
  // ============================================================

  describe('JSON round-trip (preprocess_json)', () => {
    it('round-trips a realistic PreprocessOptions payload verbatim', () => {
      const payload = JSON.stringify({
        deskew: true,
        denoise: true,
        contrastBoost: false,
      });
      const id = repo.insert(makeQueuedInput({ preprocess_json: payload }));
      const row = repo.get(id);
      expect(row?.preprocess_json).toBe(payload);
      // Bridge contract — parse on demand.
      const parsed = JSON.parse(row?.preprocess_json ?? 'null') as Record<string, boolean>;
      expect(parsed).toEqual({
        deskew: true,
        denoise: true,
        contrastBoost: false,
      });
    });
  });
});
