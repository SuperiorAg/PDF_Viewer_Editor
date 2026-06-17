import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import {
  createAccessibilityCheckHistoryRepo,
  type AccessibilityCheckHistoryRepo,
  type InsertAccessibilityCheckInput,
} from './accessibility-check-history-repo';

describe('accessibility-check-history-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: AccessibilityCheckHistoryRepo;

  const baseInput: InsertAccessibilityCheckInput = {
    doc_hash: 'docA',
    ran_at: 1000,
    results_json: '[]',
    pass_count: 5,
    warn_count: 1,
    fail_count: 0,
    shipped_rule_count: 10,
  };

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createAccessibilityCheckHistoryRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('insert', () => {
    it('inserts a row and round-trips counts + JSON', () => {
      const id = repo.insert(baseInput);
      const row = repo.getById(id);
      expect(row?.doc_hash).toBe('docA');
      expect(row?.ran_at).toBe(1000);
      expect(row?.pass_count).toBe(5);
      expect(row?.warn_count).toBe(1);
      expect(row?.fail_count).toBe(0);
      expect(row?.shipped_rule_count).toBe(10);
      expect(row?.results_json).toBe('[]');
    });

    it('preserves results_json byte-for-byte', () => {
      const json = '[{"id":"H1","status":"pass"},{"id":"ALT","status":"fail"}]';
      const id = repo.insert({ ...baseInput, results_json: json });
      expect(repo.getById(id)?.results_json).toBe(json);
    });

    it('rejects sums exceeding shipped_rule_count', () => {
      expect(() =>
        repo.insert({
          ...baseInput,
          pass_count: 5,
          warn_count: 3,
          fail_count: 4,
          shipped_rule_count: 10,
        }),
      ).toThrowError(/cannot exceed/);
    });

    it('rejects negative counts', () => {
      expect(() => repo.insert({ ...baseInput, pass_count: -1 })).toThrowError(/pass_count/);
    });

    it('rejects empty doc_hash', () => {
      expect(() => repo.insert({ ...baseInput, doc_hash: '' })).toThrowError(/doc_hash/);
    });

    it('allows pass+warn+fail < shipped_rule_count (rules not yet evaluated)', () => {
      const id = repo.insert({
        ...baseInput,
        pass_count: 2,
        warn_count: 0,
        fail_count: 0,
        shipped_rule_count: 10,
      });
      expect(repo.getById(id)).not.toBeNull();
    });
  });

  describe('listByDocHash', () => {
    it('returns rows ordered ran_at DESC', () => {
      repo.insert({ ...baseInput, ran_at: 1000 });
      repo.insert({ ...baseInput, ran_at: 3000 });
      repo.insert({ ...baseInput, ran_at: 2000 });

      const order = repo.listByDocHash('docA').map((r) => r.ran_at);
      expect(order).toEqual([3000, 2000, 1000]);
    });

    it('filters by doc_hash (no cross-doc bleed)', () => {
      repo.insert({ ...baseInput, doc_hash: 'docA' });
      repo.insert({ ...baseInput, doc_hash: 'docB' });
      expect(repo.listByDocHash('docA')).toHaveLength(1);
      expect(repo.listByDocHash('docB')).toHaveLength(1);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        repo.insert({ ...baseInput, ran_at: 100 + i });
      }
      expect(repo.listByDocHash('docA', 3)).toHaveLength(3);
    });
  });

  describe('trimForDocHash', () => {
    it('keeps the N most recent rows per doc', () => {
      for (let i = 0; i < 5; i++) {
        repo.insert({ ...baseInput, ran_at: 100 + i });
      }
      expect(repo.trimForDocHash('docA', 3)).toBe(2);
      const kept = repo.listByDocHash('docA').map((r) => r.ran_at);
      expect(kept).toEqual([104, 103, 102]);
    });

    it('does not touch other doc_hashes', () => {
      for (let i = 0; i < 5; i++) {
        repo.insert({ ...baseInput, doc_hash: 'docA', ran_at: 100 + i });
      }
      repo.insert({ ...baseInput, doc_hash: 'docB', ran_at: 999 });
      repo.trimForDocHash('docA', 2);
      expect(repo.listByDocHash('docB')).toHaveLength(1);
    });

    it('rejects non-positive max', () => {
      expect(() => repo.trimForDocHash('docA', 0)).toThrowError(/max/);
    });
  });

  describe('deleteForDocHash', () => {
    it('removes all rows for the doc', () => {
      repo.insert({ ...baseInput, doc_hash: 'docA' });
      repo.insert({ ...baseInput, doc_hash: 'docA', ran_at: 2000 });
      repo.insert({ ...baseInput, doc_hash: 'docB' });

      expect(repo.deleteForDocHash('docA')).toBe(2);
      expect(repo.listByDocHash('docA')).toEqual([]);
      expect(repo.listByDocHash('docB')).toHaveLength(1);
    });

    it('returns 0 when no rows match', () => {
      expect(repo.deleteForDocHash('nope')).toBe(0);
    });
  });
});
