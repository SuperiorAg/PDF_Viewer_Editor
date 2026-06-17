import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import { createFindHistoryRepo, type FindHistoryRepo } from './find-history-repo';

describe('find-history-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: FindHistoryRepo;

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createFindHistoryRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('upsert', () => {
    it('inserts a new row and returns the id', () => {
      const id = repo.upsert({ file_hash: 'abc', query: 'hello', last_used_at: 1000 });
      expect(id).toBeGreaterThan(0);
      const rows = repo.listByFileHash('abc');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.query).toBe('hello');
      expect(rows[0]?.case_sensitive).toBe(0);
      expect(rows[0]?.whole_word).toBe(0);
      expect(rows[0]?.last_used_at).toBe(1000);
    });

    it('coerces case_sensitive / whole_word booleans to 0/1', () => {
      const id = repo.upsert({
        file_hash: 'abc',
        query: 'hello',
        case_sensitive: true,
        whole_word: false,
        last_used_at: 1000,
      });
      const row = repo.listByFileHash('abc').find((r) => r.id === id);
      expect(row?.case_sensitive).toBe(1);
      expect(row?.whole_word).toBe(0);
    });

    it('bumps last_used_at on a duplicate (UNIQUE collision)', () => {
      const id1 = repo.upsert({ file_hash: 'abc', query: 'hello', last_used_at: 1000 });
      const id2 = repo.upsert({ file_hash: 'abc', query: 'hello', last_used_at: 2000 });
      expect(id1).toBe(id2);
      const rows = repo.listByFileHash('abc');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.last_used_at).toBe(2000);
    });

    it('treats different flags as separate rows', () => {
      repo.upsert({
        file_hash: 'abc',
        query: 'hello',
        case_sensitive: false,
        whole_word: false,
        last_used_at: 1000,
      });
      repo.upsert({
        file_hash: 'abc',
        query: 'hello',
        case_sensitive: true,
        whole_word: false,
        last_used_at: 1001,
      });
      repo.upsert({
        file_hash: 'abc',
        query: 'hello',
        case_sensitive: false,
        whole_word: true,
        last_used_at: 1002,
      });
      expect(repo.listByFileHash('abc')).toHaveLength(3);
    });

    it('defaults last_used_at to Date.now() when omitted', () => {
      const before = Date.now();
      repo.upsert({ file_hash: 'abc', query: 'hello' });
      const after = Date.now();
      const row = repo.listByFileHash('abc')[0];
      expect(row?.last_used_at).toBeGreaterThanOrEqual(before);
      expect(row?.last_used_at).toBeLessThanOrEqual(after);
    });

    it('rejects empty file_hash and empty query', () => {
      expect(() => repo.upsert({ file_hash: '', query: 'x' })).toThrowError(/file_hash/);
      expect(() => repo.upsert({ file_hash: 'x', query: '' })).toThrowError(/query/);
    });
  });

  describe('listByFileHash', () => {
    it('returns rows ordered last_used_at DESC', () => {
      repo.upsert({ file_hash: 'abc', query: 'old', last_used_at: 1000 });
      repo.upsert({ file_hash: 'abc', query: 'new', last_used_at: 3000 });
      repo.upsert({ file_hash: 'abc', query: 'mid', last_used_at: 2000 });

      const queries = repo.listByFileHash('abc').map((r) => r.query);
      expect(queries).toEqual(['new', 'mid', 'old']);
    });

    it('filters by file_hash (no cross-doc bleed)', () => {
      repo.upsert({ file_hash: 'abc', query: 'a', last_used_at: 1000 });
      repo.upsert({ file_hash: 'xyz', query: 'b', last_used_at: 1000 });
      expect(repo.listByFileHash('abc').map((r) => r.query)).toEqual(['a']);
      expect(repo.listByFileHash('xyz').map((r) => r.query)).toEqual(['b']);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        repo.upsert({
          file_hash: 'abc',
          query: `q${String(i)}`,
          last_used_at: 100 + i,
        });
      }
      expect(repo.listByFileHash('abc', 3)).toHaveLength(3);
    });
  });

  describe('clearForFileHash / clearAll', () => {
    it('clearForFileHash deletes only the matching rows', () => {
      repo.upsert({ file_hash: 'abc', query: 'a', last_used_at: 1000 });
      repo.upsert({ file_hash: 'xyz', query: 'b', last_used_at: 1000 });
      expect(repo.clearForFileHash('abc')).toBe(1);
      expect(repo.listByFileHash('abc')).toEqual([]);
      expect(repo.listByFileHash('xyz')).toHaveLength(1);
    });

    it('clearAll wipes everything', () => {
      repo.upsert({ file_hash: 'abc', query: 'a', last_used_at: 1000 });
      repo.upsert({ file_hash: 'xyz', query: 'b', last_used_at: 1000 });
      expect(repo.clearAll()).toBe(2);
      expect(repo.listByFileHash('abc')).toEqual([]);
      expect(repo.listByFileHash('xyz')).toEqual([]);
    });
  });

  describe('trimForFileHash', () => {
    it('keeps the N most recent rows per file_hash', () => {
      for (let i = 0; i < 5; i++) {
        repo.upsert({
          file_hash: 'abc',
          query: `q${String(i)}`,
          last_used_at: 100 + i,
        });
      }
      // Should delete the oldest 2; keep the 3 most recent (q4 / q3 / q2).
      expect(repo.trimForFileHash('abc', 3)).toBe(2);
      const kept = repo.listByFileHash('abc').map((r) => r.query);
      expect(kept).toEqual(['q4', 'q3', 'q2']);
    });

    it('is a no-op when row count <= max', () => {
      repo.upsert({ file_hash: 'abc', query: 'a', last_used_at: 1000 });
      expect(repo.trimForFileHash('abc', 5)).toBe(0);
    });

    it('does not touch other file_hashes', () => {
      for (let i = 0; i < 5; i++) {
        repo.upsert({
          file_hash: 'abc',
          query: `q${String(i)}`,
          last_used_at: 100 + i,
        });
      }
      repo.upsert({ file_hash: 'xyz', query: 'x', last_used_at: 1000 });
      repo.trimForFileHash('abc', 2);
      expect(repo.listByFileHash('xyz')).toHaveLength(1);
    });

    it('rejects non-positive max', () => {
      expect(() => repo.trimForFileHash('abc', 0)).toThrowError(/max/);
      expect(() => repo.trimForFileHash('abc', -1)).toThrowError(/max/);
    });
  });

  describe('trimGlobal', () => {
    it('keeps the N most recent rows globally', () => {
      repo.upsert({ file_hash: 'abc', query: 'a', last_used_at: 1000 });
      repo.upsert({ file_hash: 'abc', query: 'b', last_used_at: 2000 });
      repo.upsert({ file_hash: 'xyz', query: 'c', last_used_at: 3000 });
      repo.upsert({ file_hash: 'xyz', query: 'd', last_used_at: 4000 });

      expect(repo.trimGlobal(2)).toBe(2);

      const allRemaining = [
        ...repo.listByFileHash('abc').map((r) => r.query),
        ...repo.listByFileHash('xyz').map((r) => r.query),
      ];
      // The two newest globally were c (xyz) and d (xyz).
      expect(allRemaining.sort()).toEqual(['c', 'd']);
    });

    it('is a no-op when row count <= max', () => {
      repo.upsert({ file_hash: 'abc', query: 'a', last_used_at: 1000 });
      expect(repo.trimGlobal(10)).toBe(0);
    });
  });

  describe('SQL injection guard', () => {
    it('binds parameters rather than splicing', () => {
      const naughty = "abc'; DROP TABLE find_history; --";
      repo.upsert({ file_hash: naughty, query: 'q', last_used_at: 1000 });
      expect(repo.listByFileHash(naughty)).toHaveLength(1);
    });
  });
});
