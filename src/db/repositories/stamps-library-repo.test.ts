import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadMigrationsForTests, makeTestDatabase } from '../test-support';

import { createStampsLibraryRepo, type StampsLibraryRepo } from './stamps-library-repo';

describe('stamps-library-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: StampsLibraryRepo;

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createStampsLibraryRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('built-in seeds', () => {
    it('seeds the ten built-in stamps from migration 0009', () => {
      const all = repo.list();
      // At least 10 built-ins; a future wave may add more.
      const builtins = all.filter((s) => s.builtin_key !== null);
      expect(builtins.length).toBeGreaterThanOrEqual(10);
    });

    it('every built-in has a non-null builtin_key starting with "builtin:"', () => {
      const all = repo.list();
      for (const s of all.filter((s) => s.builtin_key !== null)) {
        expect(s.builtin_key).toMatch(/^builtin:/);
      }
    });

    it('returns the Approved built-in via getByBuiltinKey', () => {
      const approved = repo.getByBuiltinKey('builtin:approved');
      expect(approved).not.toBeNull();
      expect(approved?.name).toBe('stamps.builtin.approved');
      expect(approved?.kind).toBe('text');
      expect(approved?.text_value).toBe('APPROVED');
      expect(approved?.last_used_at).toBeNull();
      expect(approved?.use_count).toBe(0);
    });

    it('returns null from getByBuiltinKey for an unknown key', () => {
      expect(repo.getByBuiltinKey('builtin:bogus')).toBeNull();
    });

    it('built-in stamp creation is idempotent: re-applying 0009 inserts no duplicates', () => {
      const before = repo.list().length;
      // Re-run the migration SQL directly. INSERT OR IGNORE on UNIQUE(builtin_key)
      // must no-op.
      const migration0009 = loadMigrationsForTests().find((m) => m.version === 9);
      expect(migration0009).toBeDefined();
      // Skip CREATE TABLE re-application (would fail on UNIQUE-without-IF NOT
      // EXISTS); apply only the seed INSERTs. Simulate the idempotency check
      // by running the whole SQL again — every CREATE/INSERT uses
      // IF NOT EXISTS / OR IGNORE so a replay must be a no-op.
      db.exec(migration0009!.sql);
      const after = repo.list().length;
      expect(after).toBe(before);
    });
  });

  describe('insertUserStamp', () => {
    it('inserts a text stamp and returns the id', () => {
      const r = repo.insertUserStamp({
        name: 'My text stamp',
        kind: 'text',
        text_value: 'DUE TODAY',
        width_pt: 100,
        height_pt: 30,
        color: '#FF0000',
      });
      expect(r).toEqual({ ok: true, id: expect.any(Number) });

      if (r.ok) {
        const row = repo.getById(r.id);
        expect(row?.name).toBe('My text stamp');
        expect(row?.builtin_key).toBeNull();
        expect(row?.text_value).toBe('DUE TODAY');
        expect(row?.image_path).toBeNull();
        expect(row?.color).toBe('#FF0000');
        expect(row?.use_count).toBe(0);
        expect(row?.last_used_at).toBeNull();
      }
    });

    it('inserts an image stamp and ignores stray color/text_value', () => {
      const r = repo.insertUserStamp({
        name: 'My image stamp',
        kind: 'image',
        image_path: 'C:\\stamps\\logo.png',
        text_value: 'ignored',
        color: '#ignored',
        width_pt: 80,
        height_pt: 80,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const row = repo.getById(r.id);
        expect(row?.image_path).toBe('C:\\stamps\\logo.png');
        expect(row?.text_value).toBeNull();
        expect(row?.color).toBeNull();
      }
    });

    it('rejects empty name', () => {
      const r = repo.insertUserStamp({
        name: '',
        kind: 'text',
        text_value: 'X',
        width_pt: 100,
        height_pt: 30,
      });
      expect(r.ok).toBe(false);
    });

    it("rejects kind='text' without text_value", () => {
      const r = repo.insertUserStamp({
        name: 'X',
        kind: 'text',
        width_pt: 100,
        height_pt: 30,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toMatch(/text_value/);
      }
    });

    it("rejects kind='image' without image_path", () => {
      const r = repo.insertUserStamp({
        name: 'X',
        kind: 'image',
        width_pt: 100,
        height_pt: 30,
      });
      expect(r.ok).toBe(false);
    });

    it('rejects non-positive width/height', () => {
      const r = repo.insertUserStamp({
        name: 'X',
        kind: 'text',
        text_value: 'X',
        width_pt: 0,
        height_pt: 10,
      });
      expect(r.ok).toBe(false);
    });

    it('defaults created_at to Date.now() when omitted', () => {
      const before = Date.now();
      const r = repo.insertUserStamp({
        name: 'X',
        kind: 'text',
        text_value: 'X',
        width_pt: 10,
        height_pt: 10,
      });
      const after = Date.now();
      expect(r.ok).toBe(true);
      if (r.ok) {
        const row = repo.getById(r.id);
        expect(row?.created_at).toBeGreaterThanOrEqual(before);
        expect(row?.created_at).toBeLessThanOrEqual(after);
      }
    });
  });

  describe('deleteUserStamp', () => {
    it('forbids deleting a built-in', () => {
      const approved = repo.getByBuiltinKey('builtin:approved');
      expect(approved).not.toBeNull();
      const r = repo.deleteUserStamp(approved!.id);
      expect(r).toEqual({ ok: false, error: 'forbidden_builtin' });
      // Still there.
      expect(repo.getById(approved!.id)).not.toBeNull();
    });

    it('removes a user stamp', () => {
      const r = repo.insertUserStamp({
        name: 'X',
        kind: 'text',
        text_value: 'X',
        width_pt: 10,
        height_pt: 10,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const del = repo.deleteUserStamp(r.id);
        expect(del).toEqual({ ok: true, removed: 1 });
        expect(repo.getById(r.id)).toBeNull();
      }
    });

    it('returns not_found for an unknown id', () => {
      const r = repo.deleteUserStamp(999999);
      expect(r).toEqual({ ok: false, error: 'not_found' });
    });
  });

  describe('recordUse', () => {
    it('bumps use_count and last_used_at', () => {
      const r = repo.insertUserStamp({
        name: 'X',
        kind: 'text',
        text_value: 'X',
        width_pt: 10,
        height_pt: 10,
      });
      if (!r.ok) throw new Error('insert failed');
      const initial = repo.getById(r.id)!;
      expect(initial.use_count).toBe(0);
      expect(initial.last_used_at).toBeNull();

      const newCount = repo.recordUse(r.id, 5000);
      expect(newCount).toBe(1);
      const after = repo.getById(r.id)!;
      expect(after.use_count).toBe(1);
      expect(after.last_used_at).toBe(5000);

      repo.recordUse(r.id, 6000);
      expect(repo.getById(r.id)!.use_count).toBe(2);
      expect(repo.getById(r.id)!.last_used_at).toBe(6000);
    });

    it('returns null for an unknown id', () => {
      expect(repo.recordUse(999999)).toBeNull();
    });
  });

  describe('list / listRecent / listByKind', () => {
    it('listRecent returns only rows with non-null last_used_at, DESC', () => {
      const a = repo.insertUserStamp({
        name: 'A',
        kind: 'text',
        text_value: 'A',
        width_pt: 10,
        height_pt: 10,
      });
      const b = repo.insertUserStamp({
        name: 'B',
        kind: 'text',
        text_value: 'B',
        width_pt: 10,
        height_pt: 10,
      });
      const c = repo.insertUserStamp({
        name: 'C',
        kind: 'text',
        text_value: 'C',
        width_pt: 10,
        height_pt: 10,
      });
      if (!a.ok || !b.ok || !c.ok) throw new Error('insert failed');

      repo.recordUse(a.id, 1000);
      repo.recordUse(b.id, 3000);
      // c never used.

      const recent = repo.listRecent(10);
      const recentIds = recent.map((r) => r.id);
      expect(recentIds).toEqual([b.id, a.id]);
      expect(recentIds).not.toContain(c.id);
    });

    it('listRecent respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        const r = repo.insertUserStamp({
          name: `S${String(i)}`,
          kind: 'text',
          text_value: 'X',
          width_pt: 10,
          height_pt: 10,
        });
        if (r.ok) repo.recordUse(r.id, 100 + i);
      }
      expect(repo.listRecent(3)).toHaveLength(3);
    });

    it('listByKind filters to text vs image', () => {
      repo.insertUserStamp({
        name: 'T',
        kind: 'text',
        text_value: 'T',
        width_pt: 10,
        height_pt: 10,
      });
      repo.insertUserStamp({
        name: 'I',
        kind: 'image',
        image_path: 'C:\\x.png',
        width_pt: 10,
        height_pt: 10,
      });

      const text = repo.listByKind('text');
      const image = repo.listByKind('image');
      // The ten built-ins are all text, so text >= 11; image >= 1.
      expect(text.length).toBeGreaterThanOrEqual(11);
      expect(image.length).toBeGreaterThanOrEqual(1);
      for (const s of text) expect(s.kind).toBe('text');
      for (const s of image) expect(s.kind).toBe('image');
    });

    it('list orders never-used rows after recently-used rows', () => {
      const old = repo.insertUserStamp({
        name: 'Old',
        kind: 'text',
        text_value: 'O',
        width_pt: 10,
        height_pt: 10,
      });
      const fresh = repo.insertUserStamp({
        name: 'Fresh',
        kind: 'text',
        text_value: 'F',
        width_pt: 10,
        height_pt: 10,
      });
      if (!old.ok || !fresh.ok) throw new Error('insert failed');
      repo.recordUse(old.id, 1000);
      // fresh never used.

      const all = repo.list();
      const oldIdx = all.findIndex((s) => s.id === old.id);
      const freshIdx = all.findIndex((s) => s.id === fresh.id);
      expect(oldIdx).toBeGreaterThanOrEqual(0);
      expect(freshIdx).toBeGreaterThan(oldIdx);
    });
  });

  describe('schema sanity', () => {
    it('schema_migrations head matches the highest loaded migration', () => {
      // Self-updating expectation (Wave 28a takeaway) — never tie to a literal.
      const expected = Math.max(...loadMigrationsForTests().map((m) => m.version));
      const head = db
        .prepare<[], { v: number }>('SELECT MAX(version) AS v FROM schema_migrations')
        .get();
      expect(head?.v).toBe(expected);
    });
  });
});
