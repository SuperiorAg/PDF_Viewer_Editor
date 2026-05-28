import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import { createOcrJobsRepo } from './ocr-jobs-repo';
import {
  createOcrResultsRepo,
  type InsertOcrResultInput,
  type OcrResultsRepo,
} from './ocr-results-repo';

// ============================================================
// Fixture builders
// ============================================================

function makeOcrJob(db: BetterSqlite3.Database, overrides: { doc_hash?: string } = {}): number {
  const jobs = createOcrJobsRepo(db);
  return jobs.insert({
    doc_hash: overrides.doc_hash ?? 'a'.repeat(64),
    page_range_start: 0,
    page_range_end: 4,
    langs: 'eng',
    preprocess_json: JSON.stringify({
      deskew: true,
      denoise: false,
      contrastBoost: false,
    }),
    status: 'completed',
    started_at: 1716307200000,
    invalidated_signatures: 0,
  });
}

function makeWordsJson(count = 3): string {
  const words = Array.from({ length: count }, (_, i) => ({
    text: `word${String(i + 1)}`,
    confidence: 85 + i,
    imgRect: { x0: i * 100, y0: 10, x1: i * 100 + 80, y1: 30 },
    pdfRect: null, // late-init nullable per data-models §10.6
  }));
  return JSON.stringify(words);
}

function makeResultInput(
  jobId: number,
  overrides: Partial<InsertOcrResultInput> = {},
): InsertOcrResultInput {
  return {
    job_id: jobId,
    page_index: 0,
    total_words: 3,
    low_confidence_words: 0,
    mean_confidence: 86.0,
    words_json: makeWordsJson(3),
    img_width_px: 2550,
    img_height_px: 3300,
    duration_ms: 1234,
    ...overrides,
  };
}

describe('ocr-results-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: OcrResultsRepo;
  let jobId: number;

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createOcrResultsRepo(db);
    jobId = makeOcrJob(db);
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================
  // Schema verification
  // ============================================================

  describe('schema migration', () => {
    it('creates ocr_results with the canonical column set', () => {
      const cols = db
        .prepare<[], { name: string }>(`PRAGMA table_info(ocr_results)`)
        .all()
        .map((r) => r.name)
        .sort();
      expect(cols).toEqual(
        [
          'created_at',
          'duration_ms',
          'id',
          'img_height_px',
          'img_width_px',
          'job_id',
          'low_confidence_words',
          'mean_confidence',
          'page_index',
          'total_words',
          'words_json',
        ].sort(),
      );
    });

    it('creates idx_ocr_results_job_id', () => {
      const idx = db
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ocr_results'`,
        )
        .all()
        .map((r) => r.name);
      expect(idx).toEqual(expect.arrayContaining(['idx_ocr_results_job_id']));
    });

    it('enforces UNIQUE(job_id, page_index) at SQL level', () => {
      repo.insert(makeResultInput(jobId, { page_index: 5 }));
      expect(() =>
        // Raw SQL collision — confirms the UNIQUE constraint is wired.
        db
          .prepare(
            `INSERT INTO ocr_results (job_id, page_index, total_words,
              low_confidence_words, mean_confidence, words_json,
              img_width_px, img_height_px, duration_ms, created_at)
              VALUES (@job_id, 5, 1, 0, 90.0, '[]', 100, 100, 1, 1)`,
          )
          .run({ job_id: jobId }),
      ).toThrowError(/UNIQUE constraint failed/);
    });

    it('enforces FK to ocr_jobs at SQL level (foreign_keys=ON)', () => {
      // The connection has PRAGMA foreign_keys = ON; an INSERT with an
      // unknown job_id should fail.
      expect(() =>
        db
          .prepare(
            `INSERT INTO ocr_results (job_id, page_index, total_words,
              low_confidence_words, mean_confidence, words_json,
              img_width_px, img_height_px, duration_ms, created_at)
              VALUES (424242, 0, 1, 0, 90.0, '[]', 100, 100, 1, 1)`,
          )
          .run(),
      ).toThrowError(/FOREIGN KEY constraint failed/);
    });
  });

  // ============================================================
  // insert
  // ============================================================

  describe('insert', () => {
    it('inserts a row and returns id (ok variant)', () => {
      const res = repo.insert(makeResultInput(jobId));
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.id).toBeGreaterThan(0);
    });

    it('round-trips every field', () => {
      const input = makeResultInput(jobId, {
        page_index: 7,
        total_words: 42,
        low_confidence_words: 3,
        mean_confidence: 88.5,
        img_width_px: 1700,
        img_height_px: 2200,
        duration_ms: 567,
      });
      const res = repo.insert(input);
      if (!res.ok) throw new Error('expected ok');
      const row = repo.getByJobAndPage(jobId, 7);
      expect(row?.page_index).toBe(7);
      expect(row?.total_words).toBe(42);
      expect(row?.low_confidence_words).toBe(3);
      expect(row?.mean_confidence).toBeCloseTo(88.5);
      expect(row?.img_width_px).toBe(1700);
      expect(row?.img_height_px).toBe(2200);
      expect(row?.duration_ms).toBe(567);
    });

    it('preserves words_json byte-for-byte', () => {
      const payload =
        '[{"text":"a","confidence":90,"imgRect":{"x0":0,"y0":0,"x1":10,"y1":10},"pdfRect":null}]';
      const res = repo.insert(makeResultInput(jobId, { words_json: payload }));
      if (!res.ok) throw new Error('expected ok');
      const row = repo.getByJobAndPage(jobId, 0);
      expect(row?.words_json).toBe(payload);
    });

    it('returns duplicate on UNIQUE(job_id, page_index) collision', () => {
      const a = repo.insert(makeResultInput(jobId, { page_index: 2 }));
      const b = repo.insert(makeResultInput(jobId, { page_index: 2 }));
      expect(a).toMatchObject({ ok: true });
      expect(b).toEqual({ ok: false, error: 'duplicate' });
    });

    it('rejects job_id 0 or negative', () => {
      expect(() => repo.insert(makeResultInput(0))).toThrowError(/Invalid job_id/);
    });

    it('rejects negative page_index', () => {
      expect(() => repo.insert(makeResultInput(jobId, { page_index: -1 }))).toThrowError(
        /page_index/,
      );
    });

    it('rejects out-of-range mean_confidence', () => {
      expect(() => repo.insert(makeResultInput(jobId, { mean_confidence: 150 }))).toThrowError(
        /mean_confidence/,
      );
      expect(() => repo.insert(makeResultInput(jobId, { mean_confidence: -5 }))).toThrowError(
        /mean_confidence/,
      );
    });

    it('rejects low_confidence_words > total_words', () => {
      expect(() =>
        repo.insert(makeResultInput(jobId, { total_words: 5, low_confidence_words: 10 })),
      ).toThrowError(/low_confidence_words .* must be <= total_words/);
    });

    it('rejects non-positive image dims', () => {
      expect(() => repo.insert(makeResultInput(jobId, { img_width_px: 0 }))).toThrowError(
        /img_width_px/,
      );
      expect(() => repo.insert(makeResultInput(jobId, { img_height_px: -10 }))).toThrowError(
        /img_height_px/,
      );
    });

    it('rejects non-string words_json', () => {
      expect(() =>
        repo.insert(
          // @ts-expect-error — runtime guard test
          makeResultInput(jobId, { words_json: { not: 'a string' } }),
        ),
      ).toThrowError(/words_json must be a string/);
    });

    it('FK violation surfaces as SQL error for unknown job_id', () => {
      expect(() => repo.insert(makeResultInput(424242))).toThrowError(
        /FOREIGN KEY constraint failed/,
      );
    });
  });

  // ============================================================
  // upsert — idempotency
  // ============================================================

  describe('upsert', () => {
    it('inserts when no row exists', () => {
      const id = repo.upsert(makeResultInput(jobId, { page_index: 3 }));
      expect(id).toBeGreaterThan(0);
      expect(repo.getByJobAndPage(jobId, 3)?.id).toBe(id);
    });

    it('replaces non-key columns on (job_id, page_index) collision', () => {
      const first = repo.upsert(
        makeResultInput(jobId, {
          page_index: 0,
          total_words: 5,
          mean_confidence: 70,
          words_json: '[]',
        }),
      );
      const second = repo.upsert(
        makeResultInput(jobId, {
          page_index: 0,
          total_words: 99,
          mean_confidence: 95,
          words_json: makeWordsJson(10),
        }),
      );
      expect(first).toBe(second);
      const row = repo.getByJobAndPage(jobId, 0);
      expect(row?.total_words).toBe(99);
      expect(row?.mean_confidence).toBeCloseTo(95);
      expect(JSON.parse(row?.words_json ?? '[]')).toHaveLength(10);
    });
  });

  // ============================================================
  // listByJobId + getByJobAndPage + deleteByJobId
  // ============================================================

  describe('listByJobId', () => {
    it('returns [] for a job with no results', () => {
      expect(repo.listByJobId(jobId)).toEqual([]);
    });

    it('orders by page_index ASC', () => {
      repo.insert(makeResultInput(jobId, { page_index: 2 }));
      repo.insert(makeResultInput(jobId, { page_index: 0 }));
      repo.insert(makeResultInput(jobId, { page_index: 1 }));
      const rows = repo.listByJobId(jobId);
      expect(rows.map((r) => r.page_index)).toEqual([0, 1, 2]);
    });

    it('filters to the requested job only', () => {
      const other = makeOcrJob(db, { doc_hash: 'b'.repeat(64) });
      repo.insert(makeResultInput(jobId, { page_index: 0 }));
      repo.insert(makeResultInput(other, { page_index: 0 }));
      expect(repo.listByJobId(jobId)).toHaveLength(1);
      expect(repo.listByJobId(other)).toHaveLength(1);
    });
  });

  describe('getByJobAndPage', () => {
    it('returns null for unknown pair', () => {
      expect(repo.getByJobAndPage(jobId, 99)).toBeNull();
    });

    it('returns the row for an inserted pair', () => {
      repo.insert(makeResultInput(jobId, { page_index: 4 }));
      expect(repo.getByJobAndPage(jobId, 4)?.page_index).toBe(4);
    });

    it('rejects bad ids', () => {
      expect(() => repo.getByJobAndPage(0, 0)).toThrowError(/Invalid jobId/);
      expect(() => repo.getByJobAndPage(jobId, -1)).toThrowError(/pageIndex/);
    });
  });

  describe('deleteByJobId', () => {
    it('removes all rows for the job and returns count', () => {
      repo.insert(makeResultInput(jobId, { page_index: 0 }));
      repo.insert(makeResultInput(jobId, { page_index: 1 }));
      repo.insert(makeResultInput(jobId, { page_index: 2 }));
      expect(repo.deleteByJobId(jobId)).toBe(3);
      expect(repo.listByJobId(jobId)).toEqual([]);
    });

    it('returns 0 for a job with no results', () => {
      expect(repo.deleteByJobId(jobId)).toBe(0);
    });

    it('leaves sibling jobs intact', () => {
      const other = makeOcrJob(db, { doc_hash: 'c'.repeat(64) });
      repo.insert(makeResultInput(jobId, { page_index: 0 }));
      repo.insert(makeResultInput(other, { page_index: 0 }));
      repo.deleteByJobId(jobId);
      expect(repo.listByJobId(other)).toHaveLength(1);
    });
  });

  // ============================================================
  // JSON round-trip (boundary contract with David's bridge)
  // ============================================================

  describe('JSON round-trip (words_json)', () => {
    it('round-trips an OcrWord[] payload including pdfRect=null', () => {
      const words = [
        {
          text: 'Hello',
          confidence: 92.5,
          imgRect: { x0: 100, y0: 200, x1: 180, y1: 230 },
          pdfRect: null, // late-init nullable per data-models §10.6
        },
        {
          text: 'World',
          confidence: 88.0,
          imgRect: { x0: 200, y0: 200, x1: 280, y1: 230 },
          pdfRect: { x: 100, y: 700, width: 80, height: 30 },
        },
      ];
      const json = JSON.stringify(words);
      const res = repo.insert(makeResultInput(jobId, { words_json: json }));
      if (!res.ok) throw new Error('expected ok');
      const row = repo.getByJobAndPage(jobId, 0);
      const decoded = JSON.parse(row?.words_json ?? '[]') as typeof words;
      expect(decoded).toEqual(words);
      expect(decoded[0]?.pdfRect).toBeNull();
      expect(decoded[1]?.pdfRect).toEqual({
        x: 100,
        y: 700,
        width: 80,
        height: 30,
      });
    });
  });

  // ============================================================
  // SQL-injection resistance
  // ============================================================

  describe('SQL-injection resistance', () => {
    const PAYLOADS = [
      "'; DROP TABLE ocr_results; --",
      "x' OR '1'='1",
      "x' UNION SELECT * FROM schema_migrations; --",
      'x"; DELETE FROM ocr_results; --',
      "x'); DROP TABLE schema_migrations; --",
      'x\x00\nDROP TABLE ocr_results;',
    ];

    it.each(PAYLOADS)(
      'preserves table + roundtrips payload %j in words_json column',
      (payload: string) => {
        const res = repo.insert(makeResultInput(jobId, { words_json: payload }));
        if (!res.ok) throw new Error('expected ok');

        const row = repo.getByJobAndPage(jobId, 0);
        expect(row?.words_json).toBe(payload);

        // Schema still intact.
        const tables = db
          .prepare<
            [],
            { name: string }
          >(`SELECT name FROM sqlite_master WHERE type='table' AND name='ocr_results'`)
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
  // Cascade from ocr_jobs
  // ============================================================

  describe('ON DELETE CASCADE from ocr_jobs', () => {
    it('clears per-page results when the parent job is deleted', () => {
      repo.insert(makeResultInput(jobId, { page_index: 0 }));
      repo.insert(makeResultInput(jobId, { page_index: 1 }));
      expect(repo.listByJobId(jobId)).toHaveLength(2);
      db.prepare('DELETE FROM ocr_jobs WHERE id = ?').run(jobId);
      expect(repo.listByJobId(jobId)).toEqual([]);
    });
  });
});
