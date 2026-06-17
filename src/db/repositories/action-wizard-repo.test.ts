import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import { createActionWizardRepo, type ActionWizardRepo } from './action-wizard-repo';

describe('action-wizard-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: ActionWizardRepo;

  const sampleScript = JSON.stringify({
    schemaVersion: 1,
    name: 'Watermark + Save',
    createdAt: 1000,
    ops: [{ kind: 'addWatermark', text: 'DRAFT' }, { kind: 'save' }],
  });

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createActionWizardRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('insert', () => {
    it('inserts a new script and returns the id', () => {
      const r = repo.insert({
        name: 'Watermark + Save',
        schema_version: 1,
        script_json: sampleScript,
        created_at: 1000,
      });
      expect(r).toEqual({ ok: true, id: expect.any(Number) });
      if (r.ok) {
        const row = repo.getById(r.id);
        expect(row?.name).toBe('Watermark + Save');
        expect(row?.schema_version).toBe(1);
        expect(row?.script_json).toBe(sampleScript);
        expect(row?.created_at).toBe(1000);
        expect(row?.last_run_at).toBeNull();
        expect(row?.run_count).toBe(0);
      }
    });

    it('returns name_in_use on UNIQUE collision (no throw on SQL error)', () => {
      repo.insert({ name: 'X', schema_version: 1, script_json: '{}' });
      const r = repo.insert({ name: 'X', schema_version: 1, script_json: '{}' });
      expect(r).toEqual({ ok: false, error: 'name_in_use' });
    });

    it('rejects empty name', () => {
      expect(() => repo.insert({ name: '', schema_version: 1, script_json: '{}' })).toThrowError(
        /name/,
      );
    });

    it('rejects schema_version < 1', () => {
      expect(() => repo.insert({ name: 'X', schema_version: 0, script_json: '{}' })).toThrowError(
        /schema_version/,
      );
    });

    it('preserves script_json byte-for-byte', () => {
      const weirdJson = '{"a":1,"b":[null,true,false,"\\u00e9"]}';
      const r = repo.insert({ name: 'X', schema_version: 1, script_json: weirdJson });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const row = repo.getById(r.id);
        expect(row?.script_json).toBe(weirdJson);
      }
    });
  });

  describe('update', () => {
    it('updates schema_version + script_json without renaming', () => {
      const ins = repo.insert({ name: 'X', schema_version: 1, script_json: '{}' });
      if (!ins.ok) throw new Error('insert failed');

      const r = repo.update(ins.id, { schema_version: 2, script_json: '{"v":2}' });
      expect(r).toEqual({ ok: true });
      const row = repo.getById(ins.id);
      expect(row?.schema_version).toBe(2);
      expect(row?.script_json).toBe('{"v":2}');
      expect(row?.name).toBe('X');
    });

    it('renames when name is provided', () => {
      const ins = repo.insert({ name: 'X', schema_version: 1, script_json: '{}' });
      if (!ins.ok) throw new Error('insert failed');

      repo.update(ins.id, { name: 'Y', schema_version: 1, script_json: '{}' });
      const row = repo.getById(ins.id);
      expect(row?.name).toBe('Y');
    });

    it('returns not_found for an unknown id', () => {
      const r = repo.update(999999, { schema_version: 1, script_json: '{}' });
      expect(r).toEqual({ ok: false, error: 'not_found' });
    });

    it('returns name_in_use when renaming to an existing name', () => {
      const a = repo.insert({ name: 'A', schema_version: 1, script_json: '{}' });
      const b = repo.insert({ name: 'B', schema_version: 1, script_json: '{}' });
      if (!a.ok || !b.ok) throw new Error('insert failed');

      const r = repo.update(b.id, { name: 'A', schema_version: 1, script_json: '{}' });
      expect(r).toEqual({ ok: false, error: 'name_in_use' });
      // B was not renamed.
      expect(repo.getById(b.id)?.name).toBe('B');
    });

    it('allows re-saving with the same name (no false collision)', () => {
      const ins = repo.insert({ name: 'X', schema_version: 1, script_json: '{}' });
      if (!ins.ok) throw new Error('insert failed');

      const r = repo.update(ins.id, {
        name: 'X',
        schema_version: 1,
        script_json: '{"changed":true}',
      });
      expect(r).toEqual({ ok: true });
    });
  });

  describe('list / getByName / deleteById', () => {
    it('list orders by last_run_at DESC NULLS LAST', () => {
      const a = repo.insert({ name: 'A', schema_version: 1, script_json: '{}' });
      const b = repo.insert({ name: 'B', schema_version: 1, script_json: '{}' });
      const c = repo.insert({ name: 'C', schema_version: 1, script_json: '{}' });
      if (!a.ok || !b.ok || !c.ok) throw new Error('insert failed');

      repo.recordRun(a.id, 1000);
      repo.recordRun(b.id, 3000);
      // c never run.

      const order = repo.list().map((r) => r.name);
      expect(order.slice(0, 2)).toEqual(['B', 'A']);
      // c is last (never-run sinks).
      expect(order[2]).toBe('C');
    });

    it('getByName returns the row', () => {
      repo.insert({ name: 'Findable', schema_version: 1, script_json: '{}' });
      const row = repo.getByName('Findable');
      expect(row?.name).toBe('Findable');
    });

    it('getByName returns null for an unknown name', () => {
      expect(repo.getByName('nope')).toBeNull();
    });

    it('deleteById removes the row', () => {
      const ins = repo.insert({ name: 'X', schema_version: 1, script_json: '{}' });
      if (!ins.ok) throw new Error('insert failed');
      expect(repo.deleteById(ins.id)).toBe(1);
      expect(repo.getById(ins.id)).toBeNull();
    });

    it('deleteById returns 0 for an unknown id', () => {
      expect(repo.deleteById(999999)).toBe(0);
    });
  });

  describe('recordRun', () => {
    it('bumps last_run_at + run_count atomically', () => {
      const ins = repo.insert({ name: 'X', schema_version: 1, script_json: '{}' });
      if (!ins.ok) throw new Error('insert failed');
      expect(repo.recordRun(ins.id, 1000)).toBe(1);
      expect(repo.recordRun(ins.id, 2000)).toBe(2);
      const row = repo.getById(ins.id);
      expect(row?.last_run_at).toBe(2000);
      expect(row?.run_count).toBe(2);
    });

    it('returns null for an unknown id', () => {
      expect(repo.recordRun(999999)).toBeNull();
    });
  });
});
