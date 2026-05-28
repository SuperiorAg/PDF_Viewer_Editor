import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import { createFormTemplatesRepo, type FormTemplatesRepo } from './form-templates-repo';

// Helper: synthesize a JSON-encoded FormFieldDefinition[] payload for tests.
// We don't validate the shape inside the repo — that's the IPC layer's job —
// so a minimal-but-realistic object suffices for round-trip tests.
function makeFieldsJson(count = 2): string {
  const fields = Array.from({ length: count }, (_, i) => ({
    name: `Field${String(i + 1)}`,
    type: 'text' as const,
    pageIndex: 0,
    rect: { x: 10 + i * 100, y: 20, width: 80, height: 20 },
    label: `Field ${String(i + 1)} label`,
    required: i === 0,
    origin: 'authored' as const,
    unsaved: false,
  }));
  return JSON.stringify(fields);
}

describe('form-templates-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: FormTemplatesRepo;

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createFormTemplatesRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================
  // Schema verification (smoke test that migration 0003 ran)
  // ============================================================

  describe('schema migration', () => {
    it('reports schema_version >= 3 after migrations apply', () => {
      const row = db
        .prepare<[], { v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
        .get();
      expect(row?.v).toBeGreaterThanOrEqual(3);
    });

    it('creates form_templates with the canonical column set', () => {
      const cols = db
        .prepare<[], { name: string }>(`PRAGMA table_info(form_templates)`)
        .all()
        .map((r) => r.name)
        .sort();
      expect(cols).toEqual(
        [
          'created_at',
          'fields_json',
          'id',
          'last_column_mappings',
          'name',
          'source_doc_hash',
          'updated_at',
        ].sort(),
      );
    });

    it('creates the name + updated_at indexes', () => {
      const idx = db
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'form_templates'`,
        )
        .all()
        .map((r) => r.name);
      expect(idx).toEqual(expect.arrayContaining(['idx_form_templates_name']));
      expect(idx).toEqual(expect.arrayContaining(['idx_form_templates_updated_at']));
    });
  });

  // ============================================================
  // list()
  // ============================================================

  describe('list', () => {
    it('returns [] for an empty table', () => {
      expect(repo.list()).toEqual([]);
    });

    it('returns inserted templates with all columns populated', () => {
      const json = makeFieldsJson(3);
      const res = repo.upsert({
        name: 'Contract',
        fields_json: json,
        source_doc_hash: 'h1',
        last_column_mappings: null,
      });
      expect(res.ok).toBe(true);

      const rows = repo.list();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: 'Contract',
        fields_json: json,
        source_doc_hash: 'h1',
        last_column_mappings: null,
      });
      expect(rows[0]?.id).toBeGreaterThan(0);
      expect(rows[0]?.created_at).toBeGreaterThan(0);
      expect(rows[0]?.updated_at).toBeGreaterThan(0);
    });

    it('orders by updated_at DESC (most-recent first)', () => {
      // Force monotonic updated_at via explicit overrides — the default
      // Date.now() is millisecond-resolution and could tie in a fast loop.
      repo.upsert({
        name: 'A-oldest',
        fields_json: makeFieldsJson(1),
        source_doc_hash: null,
        last_column_mappings: null,
        updated_at: 1000,
      });
      repo.upsert({
        name: 'B-newest',
        fields_json: makeFieldsJson(1),
        source_doc_hash: null,
        last_column_mappings: null,
        updated_at: 3000,
      });
      repo.upsert({
        name: 'C-middle',
        fields_json: makeFieldsJson(1),
        source_doc_hash: null,
        last_column_mappings: null,
        updated_at: 2000,
      });

      expect(repo.list().map((r) => r.name)).toEqual(['B-newest', 'C-middle', 'A-oldest']);
    });
  });

  // ============================================================
  // get / getByName
  // ============================================================

  describe('get + getByName', () => {
    it('returns null for unknown id', () => {
      expect(repo.get(99999)).toBeNull();
    });

    it('returns null for unknown name', () => {
      expect(repo.getByName('Nonexistent')).toBeNull();
    });

    it('round-trips a template by id', () => {
      const json = makeFieldsJson(4);
      const res = repo.upsert({
        name: 'Lease',
        fields_json: json,
        source_doc_hash: 'h-lease',
        last_column_mappings: '{"Lessee":"TenantName"}',
      });
      if (!res.ok) throw new Error('expected ok');

      const row = repo.get(res.id);
      expect(row).not.toBeNull();
      expect(row?.name).toBe('Lease');
      expect(row?.fields_json).toBe(json);
      expect(row?.source_doc_hash).toBe('h-lease');
      expect(row?.last_column_mappings).toBe('{"Lessee":"TenantName"}');
    });

    it('round-trips a template by name', () => {
      repo.upsert({
        name: 'Invoice',
        fields_json: makeFieldsJson(2),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      const row = repo.getByName('Invoice');
      expect(row?.name).toBe('Invoice');
    });

    it('rejects non-positive id', () => {
      expect(() => repo.get(0)).toThrowError(/Invalid id/);
      expect(() => repo.get(-1)).toThrowError(/Invalid id/);
      expect(() => repo.get(1.5)).toThrowError(/Invalid id/);
    });

    it('rejects empty name on getByName', () => {
      expect(() => repo.getByName('')).toThrowError(/non-empty/);
      expect(() => repo.getByName('   ')).toThrowError(/non-empty/);
    });
  });

  // ============================================================
  // upsert — insert path
  // ============================================================

  describe('upsert (insert)', () => {
    it('inserts and returns a positive id', () => {
      const res = repo.upsert({
        name: 'New',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.id).toBeGreaterThan(0);
    });

    it('defaults created_at and updated_at to Date.now() when omitted', () => {
      const before = Date.now();
      const res = repo.upsert({
        name: 'AutoTs',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      const after = Date.now();
      if (!res.ok) throw new Error('expected ok');

      const row = repo.get(res.id);
      expect(row).not.toBeNull();
      expect(row?.created_at).toBeGreaterThanOrEqual(before);
      expect(row?.created_at).toBeLessThanOrEqual(after);
      expect(row?.updated_at).toBeGreaterThanOrEqual(before);
      expect(row?.updated_at).toBeLessThanOrEqual(after);
    });

    it('accepts explicit created_at / updated_at overrides', () => {
      const res = repo.upsert({
        name: 'Explicit',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
        created_at: 1716307200000,
        updated_at: 1716307260000,
      });
      if (!res.ok) throw new Error('expected ok');
      const row = repo.get(res.id);
      expect(row?.created_at).toBe(1716307200000);
      expect(row?.updated_at).toBe(1716307260000);
    });

    it('returns name_in_use when inserting a duplicate name', () => {
      repo.upsert({
        name: 'Dup',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      const second = repo.upsert({
        name: 'Dup',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      expect(second).toEqual({ ok: false, error: 'name_in_use' });
      // First insert intact, second never landed.
      expect(repo.list()).toHaveLength(1);
    });

    it('allows the same fields_json under different names', () => {
      const json = makeFieldsJson(3);
      const a = repo.upsert({
        name: 'A',
        fields_json: json,
        source_doc_hash: null,
        last_column_mappings: null,
      });
      const b = repo.upsert({
        name: 'B',
        fields_json: json,
        source_doc_hash: null,
        last_column_mappings: null,
      });
      expect(a.ok && b.ok).toBe(true);
      expect(repo.list()).toHaveLength(2);
    });

    it('preserves the JSON payload byte-for-byte (no parse-and-re-stringify)', () => {
      // A payload with whitespace + key ordering that JSON.stringify wouldn't
      // produce by default. The repo must NOT touch it.
      const payload = '[\n  {"name":"X","type":"text"},\n  {"name":"Y","type":"checkbox"}\n]';
      const res = repo.upsert({
        name: 'Verbatim',
        fields_json: payload,
        source_doc_hash: null,
        last_column_mappings: null,
      });
      if (!res.ok) throw new Error('expected ok');
      expect(repo.get(res.id)?.fields_json).toBe(payload);
    });

    it('rejects empty name', () => {
      expect(() =>
        repo.upsert({
          name: '   ',
          fields_json: makeFieldsJson(),
          source_doc_hash: null,
          last_column_mappings: null,
        }),
      ).toThrowError(/non-empty/);
    });

    it('rejects non-string fields_json', () => {
      expect(() =>
        repo.upsert({
          name: 'BadJson',
          // @ts-expect-error — runtime guard test
          fields_json: { not: 'a string' },
          source_doc_hash: null,
          last_column_mappings: null,
        }),
      ).toThrowError(/fields_json must be a string/);
    });

    it('rejects non-string non-null last_column_mappings', () => {
      expect(() =>
        repo.upsert({
          name: 'BadMappings',
          fields_json: makeFieldsJson(),
          source_doc_hash: null,
          // @ts-expect-error — runtime guard test
          last_column_mappings: { not: 'a string' },
        }),
      ).toThrowError(/last_column_mappings must be a string or null/);
    });
  });

  // ============================================================
  // upsert — update path
  // ============================================================

  describe('upsert (update)', () => {
    it('updates an existing row by id', () => {
      const inserted = repo.upsert({
        name: 'Initial',
        fields_json: makeFieldsJson(1),
        source_doc_hash: 'h1',
        last_column_mappings: null,
      });
      if (!inserted.ok) throw new Error('expected ok');

      const updated = repo.upsert({
        id: inserted.id,
        name: 'Renamed',
        fields_json: makeFieldsJson(5),
        source_doc_hash: 'h2',
        last_column_mappings: '{"A":"B"}',
      });
      expect(updated).toEqual({ ok: true, id: inserted.id });

      const row = repo.get(inserted.id);
      expect(row?.name).toBe('Renamed');
      expect(row?.source_doc_hash).toBe('h2');
      expect(row?.last_column_mappings).toBe('{"A":"B"}');
    });

    it('preserves created_at on update; bumps updated_at', () => {
      const inserted = repo.upsert({
        name: 'TsTest',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
        created_at: 1000,
        updated_at: 1000,
      });
      if (!inserted.ok) throw new Error('expected ok');

      const before = Date.now();
      const res = repo.upsert({
        id: inserted.id,
        name: 'TsTest',
        fields_json: makeFieldsJson(2),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      const after = Date.now();
      expect(res.ok).toBe(true);

      const row = repo.get(inserted.id);
      expect(row?.created_at).toBe(1000); // unchanged
      expect(row?.updated_at).toBeGreaterThanOrEqual(before);
      expect(row?.updated_at).toBeLessThanOrEqual(after);
    });

    it('returns not_found when updating a non-existent id', () => {
      const res = repo.upsert({
        id: 99999,
        name: 'Ghost',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      expect(res).toEqual({ ok: false, error: 'not_found' });
    });

    it('returns name_in_use when update would collide with another row', () => {
      repo.upsert({
        name: 'Existing',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      const target = repo.upsert({
        name: 'ToRename',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      if (!target.ok) throw new Error('expected ok');

      const collision = repo.upsert({
        id: target.id,
        name: 'Existing',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      expect(collision).toEqual({ ok: false, error: 'name_in_use' });

      // Target row unchanged.
      expect(repo.get(target.id)?.name).toBe('ToRename');
    });

    it('allows updating a row to its own current name (no false collision)', () => {
      const inserted = repo.upsert({
        name: 'SameName',
        fields_json: makeFieldsJson(1),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      if (!inserted.ok) throw new Error('expected ok');

      const res = repo.upsert({
        id: inserted.id,
        name: 'SameName', // unchanged name
        fields_json: makeFieldsJson(7),
        source_doc_hash: 'h-new',
        last_column_mappings: null,
      });
      expect(res).toEqual({ ok: true, id: inserted.id });
    });
  });

  // ============================================================
  // delete
  // ============================================================

  describe('delete', () => {
    it('removes by id and returns true', () => {
      const res = repo.upsert({
        name: 'ToDelete',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      if (!res.ok) throw new Error('expected ok');

      expect(repo.delete(res.id)).toBe(true);
      expect(repo.get(res.id)).toBeNull();
      expect(repo.list()).toEqual([]);
    });

    it('returns false when target does not exist', () => {
      expect(repo.delete(424242)).toBe(false);
    });

    it('rejects non-positive id', () => {
      expect(() => repo.delete(0)).toThrowError(/Invalid id/);
      expect(() => repo.delete(-3)).toThrowError(/Invalid id/);
    });

    it('does not cascade — deleting one template leaves siblings intact', () => {
      const a = repo.upsert({
        name: 'A',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      const b = repo.upsert({
        name: 'B',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      if (!a.ok || !b.ok) throw new Error('expected ok');

      expect(repo.delete(a.id)).toBe(true);
      expect(repo.list().map((r) => r.name)).toEqual(['B']);
    });
  });

  // ============================================================
  // updateColumnMappings
  // ============================================================

  describe('updateColumnMappings', () => {
    it('persists the JSON-encoded mapping and bumps updated_at', () => {
      const inserted = repo.upsert({
        name: 'MapMe',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
        created_at: 1000,
        updated_at: 1000,
      });
      if (!inserted.ok) throw new Error('expected ok');

      const before = Date.now();
      const res = repo.updateColumnMappings(inserted.id, {
        FirstName: 'GivenName',
        LastName: 'Surname',
      });
      const after = Date.now();
      expect(res).toBe(true);

      const row = repo.get(inserted.id);
      const decoded =
        row?.last_column_mappings === null
          ? null
          : (JSON.parse(row?.last_column_mappings ?? 'null') as Record<string, string>);
      expect(decoded).toEqual({ FirstName: 'GivenName', LastName: 'Surname' });
      expect(row?.created_at).toBe(1000);
      expect(row?.updated_at).toBeGreaterThanOrEqual(before);
      expect(row?.updated_at).toBeLessThanOrEqual(after);
    });

    it('overwrites a prior mapping', () => {
      const inserted = repo.upsert({
        name: 'Overwrite',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: '{"old":"value"}',
      });
      if (!inserted.ok) throw new Error('expected ok');

      repo.updateColumnMappings(inserted.id, { new: 'mapping' });
      expect(repo.get(inserted.id)?.last_column_mappings).toBe('{"new":"mapping"}');
    });

    it('accepts an empty mapping object', () => {
      const inserted = repo.upsert({
        name: 'EmptyMap',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: '{"a":"b"}',
      });
      if (!inserted.ok) throw new Error('expected ok');

      expect(repo.updateColumnMappings(inserted.id, {})).toBe(true);
      expect(repo.get(inserted.id)?.last_column_mappings).toBe('{}');
    });

    it('returns false when target does not exist', () => {
      expect(repo.updateColumnMappings(424242, { x: 'y' })).toBe(false);
    });

    it('rejects non-positive id', () => {
      expect(() => repo.updateColumnMappings(0, {})).toThrowError(/Invalid id/);
    });

    it('rejects non-object mappings', () => {
      const inserted = repo.upsert({
        name: 'GuardTest',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      if (!inserted.ok) throw new Error('expected ok');

      expect(() =>
        // @ts-expect-error — runtime guard test
        repo.updateColumnMappings(inserted.id, null),
      ).toThrowError(/Record<string, string>/);
      expect(() =>
        // @ts-expect-error — runtime guard test
        repo.updateColumnMappings(inserted.id, 'not-an-object'),
      ).toThrowError(/Record<string, string>/);
    });
  });

  // ============================================================
  // JSON round-trip (boundary contract with David's bridge adapter)
  // ============================================================

  describe('JSON round-trip', () => {
    it('round-trips a realistic FormFieldDefinition[] payload', () => {
      const fields = [
        {
          name: 'FirstName',
          type: 'text',
          pageIndex: 0,
          rect: { x: 100, y: 200, width: 200, height: 24 },
          label: 'First name',
          required: true,
          origin: 'authored',
          unsaved: false,
        },
        {
          name: 'AgreeToTerms',
          type: 'checkbox',
          pageIndex: 2,
          rect: { x: 50, y: 50, width: 20, height: 20 },
          label: 'I agree',
          required: true,
          defaultValue: { type: 'checkbox', value: false },
          origin: 'authored',
          unsaved: false,
        },
        {
          name: 'Color',
          type: 'dropdown',
          pageIndex: 1,
          rect: { x: 10, y: 10, width: 100, height: 24 },
          label: 'Pick a color',
          required: false,
          options: [
            { value: 'r', label: 'Red' },
            { value: 'g', label: 'Green' },
            { value: 'b', label: 'Blue' },
          ],
          origin: 'authored',
          unsaved: false,
        },
      ];
      const json = JSON.stringify(fields);

      const res = repo.upsert({
        name: 'RealisticPayload',
        fields_json: json,
        source_doc_hash: '0123abcd',
        last_column_mappings: JSON.stringify({ FirstName: 'fname', Color: 'col' }),
      });
      if (!res.ok) throw new Error('expected ok');

      const row = repo.get(res.id);
      const decoded = JSON.parse(row?.fields_json ?? '[]') as typeof fields;
      expect(decoded).toEqual(fields);
      const mappings = JSON.parse(row?.last_column_mappings ?? 'null') as Record<string, string>;
      expect(mappings).toEqual({ FirstName: 'fname', Color: 'col' });
    });

    it('stores nullable mapping column as actual NULL (not the string "null")', () => {
      const res = repo.upsert({
        name: 'NullMapping',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      if (!res.ok) throw new Error('expected ok');

      // Verify at the raw-row level so we know it's an SQL NULL, not 'null'.
      const raw = db
        .prepare<
          { id: number },
          { last_column_mappings: string | null }
        >('SELECT last_column_mappings FROM form_templates WHERE id = @id')
        .get({ id: res.id });
      expect(raw?.last_column_mappings).toBeNull();
    });

    it('stores nullable source_doc_hash column as actual NULL', () => {
      const res = repo.upsert({
        name: 'NullHash',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      if (!res.ok) throw new Error('expected ok');

      const raw = db
        .prepare<
          { id: number },
          { source_doc_hash: string | null }
        >('SELECT source_doc_hash FROM form_templates WHERE id = @id')
        .get({ id: res.id });
      expect(raw?.source_doc_hash).toBeNull();
    });
  });

  // ============================================================
  // Cross-method integration
  // ============================================================

  describe('cross-method integration', () => {
    it('list -> get -> updateColumnMappings -> get pipeline', () => {
      const json = makeFieldsJson(2);
      const inserted = repo.upsert({
        name: 'Pipeline',
        fields_json: json,
        source_doc_hash: 'h-pipe',
        last_column_mappings: null,
      });
      if (!inserted.ok) throw new Error('expected ok');

      // List sees it.
      expect(repo.list().map((r) => r.name)).toContain('Pipeline');

      // Get returns shape.
      const row = repo.get(inserted.id);
      expect(row?.name).toBe('Pipeline');

      // Mappings update lands.
      repo.updateColumnMappings(inserted.id, { ColA: 'Field1' });
      const after = repo.get(inserted.id);
      expect(after?.last_column_mappings).toBe('{"ColA":"Field1"}');
      // Fields untouched.
      expect(after?.fields_json).toBe(json);
    });

    it('upsert -> delete -> list reflects removal', () => {
      const res = repo.upsert({
        name: 'Transient',
        fields_json: makeFieldsJson(),
        source_doc_hash: null,
        last_column_mappings: null,
      });
      if (!res.ok) throw new Error('expected ok');

      expect(repo.list()).toHaveLength(1);
      repo.delete(res.id);
      expect(repo.list()).toEqual([]);
      expect(repo.get(res.id)).toBeNull();
      expect(repo.getByName('Transient')).toBeNull();
    });
  });
});
