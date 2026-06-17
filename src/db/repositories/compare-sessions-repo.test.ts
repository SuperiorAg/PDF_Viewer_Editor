import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import {
  createCompareSessionsRepo,
  type CompareSessionsRepo,
  type InsertCompareSessionInput,
} from './compare-sessions-repo';

describe('compare-sessions-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: CompareSessionsRepo;

  const baseInput: InsertCompareSessionInput = {
    baseline_file_hash: 'hashA',
    modified_file_hash: 'hashB',
    baseline_path: 'C:\\a.pdf',
    modified_path: 'C:\\b.pdf',
    baseline_page_count: 10,
    modified_page_count: 12,
  };

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createCompareSessionsRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('insert', () => {
    it('inserts with sensible defaults for JSON + counts', () => {
      const id = repo.insert({ ...baseInput, created_at: 1000 });
      const row = repo.getById(id);
      expect(row).not.toBeNull();
      expect(row?.baseline_file_hash).toBe('hashA');
      expect(row?.modified_file_hash).toBe('hashB');
      expect(row?.baseline_page_count).toBe(10);
      expect(row?.modified_page_count).toBe(12);
      expect(row?.per_page_text_baseline_json).toBe('{}');
      expect(row?.per_page_text_modified_json).toBe('{}');
      expect(row?.per_page_diff_json).toBe('{}');
      expect(row?.per_page_visual_diff_json).toBe('{}');
      expect(row?.total_pages_with_diff).toBe(0);
      expect(row?.inserted_spans).toBe(0);
      expect(row?.deleted_spans).toBe(0);
      expect(row?.last_diff_computed_at).toBeNull();
      expect(row?.created_at).toBe(1000);
    });

    it('preserves JSON columns byte-for-byte', () => {
      const json = '{"0":{"textDiffSpans":[]}}';
      const id = repo.insert({
        ...baseInput,
        per_page_diff_json: json,
        per_page_text_baseline_json: '{"0":"hello"}',
      });
      const row = repo.getById(id);
      expect(row?.per_page_diff_json).toBe(json);
      expect(row?.per_page_text_baseline_json).toBe('{"0":"hello"}');
    });

    it('accepts last_diff_computed_at as null and round-trips it', () => {
      const id = repo.insert({ ...baseInput, last_diff_computed_at: null });
      expect(repo.getById(id)?.last_diff_computed_at).toBeNull();
    });

    it('accepts a numeric last_diff_computed_at', () => {
      const id = repo.insert({ ...baseInput, last_diff_computed_at: 5000 });
      expect(repo.getById(id)?.last_diff_computed_at).toBe(5000);
    });

    it('rejects empty file_hash', () => {
      expect(() => repo.insert({ ...baseInput, baseline_file_hash: '' })).toThrowError(
        /baseline_file_hash/,
      );
    });

    it('rejects negative page counts', () => {
      expect(() => repo.insert({ ...baseInput, baseline_page_count: -1 })).toThrowError(
        /baseline_page_count/,
      );
    });
  });

  describe('update', () => {
    it('updates only the provided patch keys (no clobber of untouched columns)', () => {
      const id = repo.insert({
        ...baseInput,
        per_page_text_baseline_json: '{"orig":1}',
      });
      const changed = repo.update(id, {
        per_page_diff_json: '{"1":{"textDiffSpans":["a"]}}',
        total_pages_with_diff: 1,
      });
      expect(changed).toBe(1);

      const row = repo.getById(id);
      expect(row?.per_page_diff_json).toBe('{"1":{"textDiffSpans":["a"]}}');
      expect(row?.total_pages_with_diff).toBe(1);
      // Untouched: original baseline JSON survives.
      expect(row?.per_page_text_baseline_json).toBe('{"orig":1}');
    });

    it('updates last_diff_computed_at from null to a number', () => {
      const id = repo.insert({ ...baseInput });
      repo.update(id, { last_diff_computed_at: 8000 });
      expect(repo.getById(id)?.last_diff_computed_at).toBe(8000);
    });

    it('updates last_diff_computed_at back to null (anti-sentinel discipline)', () => {
      const id = repo.insert({ ...baseInput, last_diff_computed_at: 8000 });
      repo.update(id, { last_diff_computed_at: null });
      expect(repo.getById(id)?.last_diff_computed_at).toBeNull();
    });

    it('returns 0 changes when the patch is empty', () => {
      const id = repo.insert({ ...baseInput });
      expect(repo.update(id, {})).toBe(0);
    });

    it('returns 0 changes when the id is unknown', () => {
      expect(repo.update(999999, { per_page_diff_json: '{}' })).toBe(0);
    });
  });

  describe('listRecent', () => {
    it('returns rows ordered by created_at DESC', () => {
      const id1 = repo.insert({ ...baseInput, created_at: 1000 });
      const id2 = repo.insert({ ...baseInput, created_at: 3000 });
      const id3 = repo.insert({ ...baseInput, created_at: 2000 });

      const recent = repo.listRecent();
      expect(recent.map((r) => r.id)).toEqual([id2, id3, id1]);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        repo.insert({ ...baseInput, created_at: 100 + i });
      }
      expect(repo.listRecent(3)).toHaveLength(3);
    });
  });

  describe('deleteById / deleteOlderThan', () => {
    it('deleteById removes the row', () => {
      const id = repo.insert({ ...baseInput });
      expect(repo.deleteById(id)).toBe(1);
      expect(repo.getById(id)).toBeNull();
    });

    it('deleteById returns 0 for an unknown id', () => {
      expect(repo.deleteById(999999)).toBe(0);
    });

    it('deleteOlderThan removes rows with created_at < cutoff', () => {
      repo.insert({ ...baseInput, created_at: 1000 });
      repo.insert({ ...baseInput, created_at: 2000 });
      repo.insert({ ...baseInput, created_at: 3000 });

      // Cutoff at 2500: removes the first two.
      expect(repo.deleteOlderThan(2500)).toBe(2);
      const remaining = repo.listRecent();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.created_at).toBe(3000);
    });

    it('deleteOlderThan rejects negative cutoff', () => {
      expect(() => repo.deleteOlderThan(-1)).toThrowError(/cutoffMs/);
    });
  });
});
