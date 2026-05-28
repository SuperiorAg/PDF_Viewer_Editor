import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import { createBookmarksRepo, type BookmarksRepo } from './bookmarks-repo';

describe('bookmarks-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: BookmarksRepo;

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createBookmarksRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should return [] for a file with no bookmarks', () => {
    expect(repo.listByFile('nohash')).toEqual([]);
  });

  it('should insert a bookmark and return a positive id', () => {
    const id = repo.upsert({ file_hash: 'h1', page_index: 0, title: 'Cover' });
    expect(id).toBeGreaterThan(0);

    const list = repo.listByFile('h1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, file_hash: 'h1', page_index: 0, title: 'Cover' });
    expect(list[0]?.created_at).toBeGreaterThan(0);
  });

  it('should list bookmarks ordered by page_index ASC, then created_at ASC', () => {
    repo.upsert({ file_hash: 'h', page_index: 5, title: 'Mid', created_at: 100 });
    repo.upsert({ file_hash: 'h', page_index: 0, title: 'Cover', created_at: 200 });
    repo.upsert({ file_hash: 'h', page_index: 10, title: 'End', created_at: 50 });
    repo.upsert({ file_hash: 'h', page_index: 5, title: 'Mid-2', created_at: 300 });

    const titles = repo.listByFile('h').map((b) => b.title);
    expect(titles).toEqual(['Cover', 'Mid', 'Mid-2', 'End']);
  });

  it('should isolate bookmarks by file_hash', () => {
    repo.upsert({ file_hash: 'A', page_index: 0, title: 'A-only' });
    repo.upsert({ file_hash: 'B', page_index: 0, title: 'B-only' });

    expect(repo.listByFile('A').map((b) => b.title)).toEqual(['A-only']);
    expect(repo.listByFile('B').map((b) => b.title)).toEqual(['B-only']);
  });

  it('should update an existing bookmark when id is provided', () => {
    const id = repo.upsert({ file_hash: 'h', page_index: 0, title: 'Initial' });

    const updatedId = repo.upsert({
      id,
      file_hash: 'h',
      page_index: 3,
      title: 'Revised',
    });
    expect(updatedId).toBe(id);

    const list = repo.listByFile('h');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, page_index: 3, title: 'Revised' });
  });

  it('should throw when updating a non-existent id', () => {
    expect(() =>
      repo.upsert({ id: 99999, file_hash: 'h', page_index: 0, title: 'Ghost' }),
    ).toThrowError(/not found/);
  });

  it('should return the existing id on duplicate (UNIQUE tuple) insert', () => {
    const first = repo.upsert({ file_hash: 'h', page_index: 0, title: 'Dup' });
    const second = repo.upsert({ file_hash: 'h', page_index: 0, title: 'Dup' });
    expect(second).toBe(first);
    expect(repo.listByFile('h')).toHaveLength(1);
  });

  it('should allow same title at different page_index', () => {
    repo.upsert({ file_hash: 'h', page_index: 0, title: 'Heading' });
    repo.upsert({ file_hash: 'h', page_index: 5, title: 'Heading' });
    expect(repo.listByFile('h')).toHaveLength(2);
  });

  it('should reject negative page_index', () => {
    expect(() => repo.upsert({ file_hash: 'h', page_index: -1, title: 'Bad' })).toThrowError(
      /Invalid page_index/,
    );
  });

  it('should reject non-integer page_index', () => {
    expect(() => repo.upsert({ file_hash: 'h', page_index: 1.5, title: 'Bad' })).toThrowError(
      /Invalid page_index/,
    );
  });

  it('should reject an empty title', () => {
    expect(() => repo.upsert({ file_hash: 'h', page_index: 0, title: '   ' })).toThrowError(
      /non-empty/,
    );
  });

  it('should delete by id and return true', () => {
    const id = repo.upsert({ file_hash: 'h', page_index: 0, title: 'Delete me' });
    expect(repo.delete(id)).toBe(true);
    expect(repo.listByFile('h')).toEqual([]);
  });

  it('should return false when delete target does not exist', () => {
    expect(repo.delete(424242)).toBe(false);
  });

  it('should default created_at to Date.now() when omitted', () => {
    const before = Date.now();
    const id = repo.upsert({ file_hash: 'h', page_index: 0, title: 'Auto-ts' });
    const after = Date.now();

    const row = repo.listByFile('h').find((b) => b.id === id);
    expect(row).toBeDefined();
    expect(row?.created_at).toBeGreaterThanOrEqual(before);
    expect(row?.created_at).toBeLessThanOrEqual(after);
  });

  // ============================================================
  // Phase 2 — nesting + ordering (migrations/0002_phase2_bookmarks.sql)
  // ============================================================

  describe('Phase 2 — listTree', () => {
    it('returns [] for a file with no bookmarks', () => {
      expect(repo.listTree('nohash')).toEqual([]);
    });

    it('returns flat roots when nothing is nested', () => {
      repo.upsert({ file_hash: 'h', page_index: 0, title: 'A', sort_order: 1024 });
      repo.upsert({ file_hash: 'h', page_index: 5, title: 'B', sort_order: 2048 });
      repo.upsert({ file_hash: 'h', page_index: 10, title: 'C', sort_order: 3072 });

      const tree = repo.listTree('h');
      expect(tree.map((n) => n.title)).toEqual(['A', 'B', 'C']);
      expect(tree.every((n) => n.children.length === 0)).toBe(true);
      expect(tree.every((n) => n.parent_id === null)).toBe(true);
    });

    it('orders roots by sort_order ASC, then id ASC', () => {
      const a = repo.upsert({ file_hash: 'h', page_index: 0, title: 'A', sort_order: 2000 });
      const b = repo.upsert({ file_hash: 'h', page_index: 1, title: 'B', sort_order: 1000 });
      // Tie on sort_order — id breaks the tie.
      const c = repo.upsert({ file_hash: 'h', page_index: 2, title: 'C', sort_order: 1000 });

      const tree = repo.listTree('h');
      const ids = tree.map((n) => n.id);
      expect(ids).toEqual([b, c, a]);
    });

    it('builds a nested tree with mixed depth', () => {
      const root1 = repo.upsert({
        file_hash: 'h',
        page_index: 0,
        title: 'Chapter 1',
        sort_order: 1024,
      });
      const root2 = repo.upsert({
        file_hash: 'h',
        page_index: 10,
        title: 'Chapter 2',
        sort_order: 2048,
      });
      const child1a = repo.upsert({
        file_hash: 'h',
        page_index: 1,
        title: '1.1',
        parent_id: root1,
        sort_order: 1024,
      });
      const child1b = repo.upsert({
        file_hash: 'h',
        page_index: 2,
        title: '1.2',
        parent_id: root1,
        sort_order: 2048,
      });
      const grandchild = repo.upsert({
        file_hash: 'h',
        page_index: 1,
        title: '1.1.1',
        parent_id: child1a,
        sort_order: 1024,
      });

      const tree = repo.listTree('h');
      expect(tree).toHaveLength(2);
      expect(tree[0]?.id).toBe(root1);
      expect(tree[1]?.id).toBe(root2);
      expect(tree[0]?.children.map((c) => c.id)).toEqual([child1a, child1b]);
      expect(tree[0]?.children[0]?.children.map((c) => c.id)).toEqual([grandchild]);
      expect(tree[1]?.children).toEqual([]);
    });

    it('isolates trees by file_hash', () => {
      const aRoot = repo.upsert({ file_hash: 'A', page_index: 0, title: 'A-root' });
      repo.upsert({ file_hash: 'A', page_index: 1, title: 'A-child', parent_id: aRoot });
      repo.upsert({ file_hash: 'B', page_index: 0, title: 'B-only' });

      const treeA = repo.listTree('A');
      const treeB = repo.listTree('B');
      expect(treeA).toHaveLength(1);
      expect(treeA[0]?.children).toHaveLength(1);
      expect(treeB).toHaveLength(1);
      expect(treeB[0]?.children).toEqual([]);
    });

    it('existing Phase-1 rows surface as top-level with sort_order=0', () => {
      // Simulate a pre-Phase-2 row that came through the migration: no
      // parent_id, no sort_order. The upsert path here defaults both to
      // null/0 — mirroring the migration defaults.
      const id = repo.upsert({ file_hash: 'h', page_index: 0, title: 'Legacy' });

      const tree = repo.listTree('h');
      expect(tree).toHaveLength(1);
      expect(tree[0]?.id).toBe(id);
      expect(tree[0]?.parent_id).toBeNull();
      expect(tree[0]?.sort_order).toBe(0);
      expect(tree[0]?.children).toEqual([]);
    });
  });

  describe('Phase 2 — move', () => {
    it('re-parents a top-level bookmark under a sibling', () => {
      const parent = repo.upsert({ file_hash: 'h', page_index: 0, title: 'Parent' });
      const child = repo.upsert({ file_hash: 'h', page_index: 1, title: 'Child' });

      const res = repo.move(child, parent, 1024);
      expect(res).toEqual({ ok: true });

      const tree = repo.listTree('h');
      expect(tree).toHaveLength(1);
      expect(tree[0]?.id).toBe(parent);
      expect(tree[0]?.children.map((c) => c.id)).toEqual([child]);
    });

    it('re-orders a bookmark within its sibling group', () => {
      const a = repo.upsert({ file_hash: 'h', page_index: 0, title: 'A', sort_order: 1024 });
      const b = repo.upsert({ file_hash: 'h', page_index: 1, title: 'B', sort_order: 2048 });
      const c = repo.upsert({ file_hash: 'h', page_index: 2, title: 'C', sort_order: 3072 });

      // Move C to the front by giving it a sort_order below A.
      const res = repo.move(c, null, 512);
      expect(res).toEqual({ ok: true });

      const tree = repo.listTree('h');
      expect(tree.map((n) => n.id)).toEqual([c, a, b]);
    });

    it('moves a bookmark from one parent to another', () => {
      const p1 = repo.upsert({ file_hash: 'h', page_index: 0, title: 'P1' });
      const p2 = repo.upsert({ file_hash: 'h', page_index: 10, title: 'P2' });
      const child = repo.upsert({
        file_hash: 'h',
        page_index: 1,
        title: 'Child',
        parent_id: p1,
      });

      expect(repo.move(child, p2, 0).ok).toBe(true);

      const tree = repo.listTree('h');
      const p1Node = tree.find((n) => n.id === p1);
      const p2Node = tree.find((n) => n.id === p2);
      expect(p1Node?.children).toEqual([]);
      expect(p2Node?.children.map((c) => c.id)).toEqual([child]);
    });

    it('promotes a child back to root when newParentId is null', () => {
      const root = repo.upsert({ file_hash: 'h', page_index: 0, title: 'Root' });
      const child = repo.upsert({
        file_hash: 'h',
        page_index: 1,
        title: 'Child',
        parent_id: root,
      });

      expect(repo.move(child, null, 4096).ok).toBe(true);

      const tree = repo.listTree('h');
      expect(tree).toHaveLength(2);
      expect(tree.every((n) => n.children.length === 0)).toBe(true);
    });

    it('rejects making a bookmark its own parent (trivial cycle)', () => {
      const id = repo.upsert({ file_hash: 'h', page_index: 0, title: 'Self' });
      const res = repo.move(id, id, 0);
      expect(res).toEqual({ ok: false, error: 'cycle_detected' });
    });

    it('rejects making a bookmark a descendant of itself (deep cycle)', () => {
      // Build A -> B -> C, then attempt to move A under C.
      const a = repo.upsert({ file_hash: 'h', page_index: 0, title: 'A' });
      const b = repo.upsert({ file_hash: 'h', page_index: 1, title: 'B', parent_id: a });
      const c = repo.upsert({ file_hash: 'h', page_index: 2, title: 'C', parent_id: b });

      const res = repo.move(a, c, 0);
      expect(res).toEqual({ ok: false, error: 'cycle_detected' });

      // Schema must be unchanged after a rejected move.
      const tree = repo.listTree('h');
      expect(tree).toHaveLength(1);
      expect(tree[0]?.id).toBe(a);
      expect(tree[0]?.children[0]?.id).toBe(b);
      expect(tree[0]?.children[0]?.children[0]?.id).toBe(c);
    });

    it('rejects move when the target row does not exist', () => {
      const res = repo.move(99999, null, 0);
      expect(res).toEqual({ ok: false, error: 'not_found' });
    });

    it('rejects move when the new parent does not exist', () => {
      const id = repo.upsert({ file_hash: 'h', page_index: 0, title: 'X' });
      const res = repo.move(id, 99999, 0);
      expect(res).toEqual({ ok: false, error: 'invalid_parent' });
    });

    it('rejects move when new parent belongs to a different file', () => {
      const aRoot = repo.upsert({ file_hash: 'A', page_index: 0, title: 'A-root' });
      const bChild = repo.upsert({ file_hash: 'B', page_index: 0, title: 'B-child' });
      const res = repo.move(bChild, aRoot, 0);
      expect(res).toEqual({ ok: false, error: 'invalid_parent' });
    });

    it('rejects move with non-integer sort_order', () => {
      const id = repo.upsert({ file_hash: 'h', page_index: 0, title: 'X' });
      expect(() => repo.move(id, null, 1.5)).toThrowError(/Invalid sort_order/);
    });
  });

  describe('Phase 2 — rename', () => {
    it('updates the title of an existing bookmark', () => {
      const id = repo.upsert({ file_hash: 'h', page_index: 0, title: 'Old' });
      expect(repo.rename(id, 'New')).toBe(true);
      expect(repo.listByFile('h')[0]?.title).toBe('New');
    });

    it('returns false when the target does not exist', () => {
      expect(repo.rename(99999, 'Anything')).toBe(false);
    });

    it('rejects an empty title', () => {
      const id = repo.upsert({ file_hash: 'h', page_index: 0, title: 'Real' });
      expect(() => repo.rename(id, '   ')).toThrowError(/non-empty/);
      // Side-effect-free on failure.
      expect(repo.listByFile('h')[0]?.title).toBe('Real');
    });
  });

  describe('Phase 2 — cascade delete', () => {
    it('removes all descendants when a parent is deleted', () => {
      // PRAGMA foreign_keys = ON is set in test-support.makeTestDatabase().
      const root = repo.upsert({ file_hash: 'h', page_index: 0, title: 'Root' });
      const child = repo.upsert({
        file_hash: 'h',
        page_index: 1,
        title: 'Child',
        parent_id: root,
      });
      const grandchild = repo.upsert({
        file_hash: 'h',
        page_index: 2,
        title: 'Grand',
        parent_id: child,
      });

      expect(repo.delete(root)).toBe(true);

      expect(repo.listByFile('h')).toEqual([]);
      // Explicit id-lookup: child and grandchild gone.
      const remaining = db
        .prepare<[], { id: number }>('SELECT id FROM user_bookmarks')
        .all()
        .map((r) => r.id);
      expect(remaining).not.toContain(child);
      expect(remaining).not.toContain(grandchild);
    });
  });

  describe('Phase 2 — upsert with new fields', () => {
    it('inserts with parent_id and sort_order', () => {
      const parent = repo.upsert({ file_hash: 'h', page_index: 0, title: 'P' });
      const child = repo.upsert({
        file_hash: 'h',
        page_index: 1,
        title: 'C',
        parent_id: parent,
        sort_order: 1024,
      });

      const row = repo.listByFile('h').find((r) => r.id === child);
      expect(row?.parent_id).toBe(parent);
      expect(row?.sort_order).toBe(1024);
    });

    it('updates parent_id and sort_order via id-upsert', () => {
      const parent = repo.upsert({ file_hash: 'h', page_index: 0, title: 'P' });
      const child = repo.upsert({ file_hash: 'h', page_index: 1, title: 'C' });

      repo.upsert({
        id: child,
        file_hash: 'h',
        page_index: 1,
        title: 'C',
        parent_id: parent,
        sort_order: 5000,
      });

      const tree = repo.listTree('h');
      expect(tree[0]?.children.map((c) => c.id)).toEqual([child]);
      expect(tree[0]?.children[0]?.sort_order).toBe(5000);
    });

    it('preserves existing parent_id/sort_order when upsert omits them', () => {
      const parent = repo.upsert({ file_hash: 'h', page_index: 0, title: 'P' });
      const child = repo.upsert({
        file_hash: 'h',
        page_index: 1,
        title: 'C',
        parent_id: parent,
        sort_order: 1024,
      });

      // Update only the title via id-upsert; parent_id and sort_order should stick.
      repo.upsert({ id: child, file_hash: 'h', page_index: 1, title: 'C-renamed' });

      const tree = repo.listTree('h');
      expect(tree[0]?.children).toHaveLength(1);
      expect(tree[0]?.children[0]?.title).toBe('C-renamed');
      expect(tree[0]?.children[0]?.parent_id).toBe(parent);
      expect(tree[0]?.children[0]?.sort_order).toBe(1024);
    });

    it('schema_migrations reports version >= 2 after Phase 2 migrations apply', () => {
      // makeTestDatabase() runs every migration under <repo>/migrations. The
      // intent of this assertion is "the Phase-2 bookmarks migration landed."
      // Each later phase (Wave 12 = v3 forms, Wave 16 = v4 signatures) bumps
      // the watermark; the assertion is GTE so this test stays correct as
      // the schema evolves.
      const row = db
        .prepare<[], { v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
        .get();
      expect(row?.v).toBeGreaterThanOrEqual(2);
    });
  });
});
