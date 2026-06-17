import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import {
  createAccessibilityEditSessionRepo,
  type AccessibilityEditSessionRepo,
} from './accessibility-edit-session-repo';

describe('accessibility-edit-session-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: AccessibilityEditSessionRepo;

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createAccessibilityEditSessionRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('upsertOnOpen', () => {
    it('creates a new session row with sensible defaults', () => {
      const row = repo.upsertOnOpen({
        doc_hash: 'docA',
        struct_tree_json: '{"type":"Document","children":[]}',
        has_existing_tags: false,
      });
      expect(row.doc_hash).toBe('docA');
      expect(row.struct_tree_json).toBe('{"type":"Document","children":[]}');
      expect(row.reading_order_json).toBe('[]');
      expect(row.alt_text_overrides_json).toBe('{}');
      expect(row.has_existing_tags).toBe(0);
      expect(row.created_at).toBeGreaterThan(0);
      expect(row.updated_at).toBeGreaterThan(0);
    });

    it('coerces has_existing_tags boolean -> 0/1', () => {
      const row = repo.upsertOnOpen({
        doc_hash: 'docA',
        struct_tree_json: '{}',
        has_existing_tags: true,
      });
      expect(row.has_existing_tags).toBe(1);
    });

    it('is idempotent for the same doc_hash (UNIQUE)', () => {
      const r1 = repo.upsertOnOpen({
        doc_hash: 'docA',
        struct_tree_json: '{"first":true}',
        has_existing_tags: 0,
      });
      const r2 = repo.upsertOnOpen({
        doc_hash: 'docA',
        struct_tree_json: '{"second":true}',
        has_existing_tags: 1,
      });
      // INSERT OR IGNORE: second call returns the existing row, NOT the second
      // payload. Update is for that purpose.
      expect(r1.id).toBe(r2.id);
      expect(r2.struct_tree_json).toBe('{"first":true}');
      expect(r2.has_existing_tags).toBe(0);
    });

    it('rejects empty doc_hash', () => {
      expect(() =>
        repo.upsertOnOpen({
          doc_hash: '',
          struct_tree_json: '{}',
          has_existing_tags: false,
        }),
      ).toThrowError(/doc_hash/);
    });

    it('rejects empty struct_tree_json', () => {
      expect(() =>
        repo.upsertOnOpen({
          doc_hash: 'docA',
          struct_tree_json: '',
          has_existing_tags: false,
        }),
      ).toThrowError(/struct_tree_json/);
    });
  });

  describe('update', () => {
    it('updates only the provided patch keys and bumps updated_at', () => {
      const row = repo.upsertOnOpen({
        doc_hash: 'docA',
        struct_tree_json: '{"orig":1}',
        has_existing_tags: false,
        created_at: 1000,
        updated_at: 1000,
      });

      const changed = repo.update('docA', {
        reading_order_json: '[{"mcid":0}]',
        updated_at: 5000,
      });
      expect(changed).toBe(1);

      const got = repo.getByDocHash('docA');
      expect(got?.reading_order_json).toBe('[{"mcid":0}]');
      // struct_tree_json untouched.
      expect(got?.struct_tree_json).toBe('{"orig":1}');
      // updated_at advanced; created_at preserved.
      expect(got?.updated_at).toBe(5000);
      expect(got?.created_at).toBe(row.created_at);
    });

    it('returns 0 changes when the patch is empty', () => {
      repo.upsertOnOpen({
        doc_hash: 'docA',
        struct_tree_json: '{}',
        has_existing_tags: false,
      });
      expect(repo.update('docA', {})).toBe(0);
    });

    it('returns 0 changes when no session exists', () => {
      expect(repo.update('nope', { struct_tree_json: '{}' })).toBe(0);
    });
  });

  describe('getByDocHash', () => {
    it('returns null for an unknown doc_hash', () => {
      expect(repo.getByDocHash('nope')).toBeNull();
    });
  });

  describe('deleteByDocHash', () => {
    it('removes the row', () => {
      repo.upsertOnOpen({
        doc_hash: 'docA',
        struct_tree_json: '{}',
        has_existing_tags: false,
      });
      expect(repo.deleteByDocHash('docA')).toBe(1);
      expect(repo.getByDocHash('docA')).toBeNull();
    });

    it('returns 0 when no row matches', () => {
      expect(repo.deleteByDocHash('nope')).toBe(0);
    });
  });

  describe('deleteOlderThan', () => {
    it('removes rows where updated_at < cutoff', () => {
      repo.upsertOnOpen({
        doc_hash: 'docA',
        struct_tree_json: '{}',
        has_existing_tags: false,
        created_at: 1000,
        updated_at: 1000,
      });
      repo.upsertOnOpen({
        doc_hash: 'docB',
        struct_tree_json: '{}',
        has_existing_tags: false,
        created_at: 3000,
        updated_at: 3000,
      });

      expect(repo.deleteOlderThan(2000)).toBe(1);
      expect(repo.getByDocHash('docA')).toBeNull();
      expect(repo.getByDocHash('docB')).not.toBeNull();
    });

    it('rejects negative cutoff', () => {
      expect(() => repo.deleteOlderThan(-1)).toThrowError(/cutoffMs/);
    });
  });
});
