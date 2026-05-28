import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import { createRecentFilesRepo, type RecentFilesRepo } from './recent-files-repo';

describe('recent-files-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: RecentFilesRepo;

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createRecentFilesRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should return an empty list on a fresh database', () => {
    expect(repo.list()).toEqual([]);
  });

  it('should insert and retrieve a row via upsert + getByPath', () => {
    repo.upsert({
      path: 'C:\\docs\\contract.pdf',
      display_name: 'contract.pdf',
      file_hash: 'abc123',
      last_opened_at: 1000,
    });

    const row = repo.getByPath('C:\\docs\\contract.pdf');
    expect(row).toEqual({
      path: 'C:\\docs\\contract.pdf',
      display_name: 'contract.pdf',
      file_hash: 'abc123',
      last_opened_at: 1000,
    });
  });

  it('should return null from getByPath for an unknown path', () => {
    expect(repo.getByPath('C:\\nope.pdf')).toBeNull();
  });

  it('should bump last_opened_at and refresh hash/display_name on re-upsert', () => {
    repo.upsert({
      path: 'C:\\a.pdf',
      display_name: 'a.pdf',
      file_hash: 'hash-v1',
      last_opened_at: 1000,
    });
    repo.upsert({
      path: 'C:\\a.pdf',
      display_name: 'a-renamed.pdf',
      file_hash: 'hash-v2',
      last_opened_at: 2000,
    });

    const row = repo.getByPath('C:\\a.pdf');
    expect(row?.last_opened_at).toBe(2000);
    expect(row?.file_hash).toBe('hash-v2');
    expect(row?.display_name).toBe('a-renamed.pdf');

    // Still only one row (upsert, not duplicate).
    expect(repo.list()).toHaveLength(1);
  });

  it('should return list ordered by last_opened_at DESC', () => {
    repo.upsert({
      path: 'C:\\old.pdf',
      display_name: 'old.pdf',
      file_hash: 'h1',
      last_opened_at: 100,
    });
    repo.upsert({
      path: 'C:\\new.pdf',
      display_name: 'new.pdf',
      file_hash: 'h2',
      last_opened_at: 300,
    });
    repo.upsert({
      path: 'C:\\mid.pdf',
      display_name: 'mid.pdf',
      file_hash: 'h3',
      last_opened_at: 200,
    });

    const list = repo.list();
    expect(list.map((r) => r.path)).toEqual(['C:\\new.pdf', 'C:\\mid.pdf', 'C:\\old.pdf']);
  });

  it('should respect the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      repo.upsert({
        path: `C:\\file-${String(i)}.pdf`,
        display_name: `file-${String(i)}.pdf`,
        file_hash: `h${String(i)}`,
        last_opened_at: 100 + i,
      });
    }

    expect(repo.list(2)).toHaveLength(2);
    expect(repo.list(2)[0]?.path).toBe('C:\\file-4.pdf');
  });

  it('should default last_opened_at to now when omitted', () => {
    const before = Date.now();
    repo.upsert({ path: 'C:\\x.pdf', display_name: 'x.pdf', file_hash: 'h' });
    const after = Date.now();

    const row = repo.getByPath('C:\\x.pdf');
    expect(row).not.toBeNull();
    expect(row?.last_opened_at).toBeGreaterThanOrEqual(before);
    expect(row?.last_opened_at).toBeLessThanOrEqual(after);
  });

  it('should clear all rows and return the count removed', () => {
    repo.upsert({ path: 'C:\\a.pdf', display_name: 'a', file_hash: 'h1' });
    repo.upsert({ path: 'C:\\b.pdf', display_name: 'b', file_hash: 'h2' });
    repo.upsert({ path: 'C:\\c.pdf', display_name: 'c', file_hash: 'h3' });

    expect(repo.clear()).toBe(3);
    expect(repo.list()).toEqual([]);
  });

  it('should clear() to 0 on an empty table', () => {
    expect(repo.clear()).toBe(0);
  });

  it('should use prepared statements that resist quote injection in path arg', () => {
    // This is not a real SQLi attempt — better-sqlite3 binds parameters, never
    // splices. But pin the behavior so a future refactor that switches to
    // string-concat would fail this test.
    const naughty = "C:\\foo'; DROP TABLE recent_files; --.pdf";
    repo.upsert({ path: naughty, display_name: 'naughty.pdf', file_hash: 'h' });

    // Table should still exist and the row should be retrievable verbatim.
    expect(repo.getByPath(naughty)?.path).toBe(naughty);
  });
});
