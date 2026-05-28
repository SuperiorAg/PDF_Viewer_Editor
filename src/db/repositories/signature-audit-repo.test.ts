import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestDatabase } from '../test-support';

import {
  createSignatureAuditRepo,
  type InsertSignatureAuditInput,
  type SignatureAuditRepo,
} from './signature-audit-repo';

// ============================================================
// Fixture builders
// ============================================================

/**
 * Build a fully-populated PAdES-TSA insert payload. Tests override individual
 * fields by spread. We keep this realistic (64-hex hashes, plausible CN
 * strings, monotonic timestamps) so the round-trip assertions verify the
 * SQLite layer end-to-end rather than synthetic skeleton data.
 */
function makePadesTsaInput(
  overrides: Partial<InsertSignatureAuditInput> = {},
): InsertSignatureAuditInput {
  return {
    doc_hash: 'a'.repeat(64),
    pre_sign_doc_hash: 'b'.repeat(64),
    signed_at: 1716307200000,
    signature_kind: 'pades-tsa',
    signed_by_fingerprint: 'c'.repeat(64),
    signed_by_subject_cn: 'Adam Hudson',
    signed_by_issuer_cn: 'SuperiorAg Internal CA',
    cert_not_before: 1700000000000,
    cert_not_after: 1900000000000,
    tsa_url: 'https://timestamp.example.com',
    tsa_response_status: 'ok',
    sig_bytes_offset: 12345,
    sig_bytes_length: 8192,
    byte_range_json: '[0,12345,20537,500000]',
    reason: 'I approve this contract',
    location: 'St. Louis, MO',
    field_name: 'Signature1',
    ...overrides,
  };
}

/**
 * Build a visual-signature payload. Visual rows have NULL cert/sig fields; the
 * UNIQUE(doc_hash, sig_bytes_offset) constraint tolerates NULL collisions per
 * data-models §9.4.1 so multiple visual signatures on the same doc coexist.
 */
function makeVisualInput(
  overrides: Partial<InsertSignatureAuditInput> = {},
): InsertSignatureAuditInput {
  return {
    doc_hash: 'd'.repeat(64),
    pre_sign_doc_hash: 'e'.repeat(64),
    signed_at: 1716307200000,
    signature_kind: 'visual',
    signed_by_fingerprint: null,
    signed_by_subject_cn: null,
    signed_by_issuer_cn: null,
    cert_not_before: null,
    cert_not_after: null,
    tsa_url: null,
    tsa_response_status: null,
    sig_bytes_offset: null,
    sig_bytes_length: null,
    byte_range_json: null,
    reason: null,
    location: null,
    field_name: null,
    ...overrides,
  };
}

describe('signature-audit-repo', () => {
  let db: BetterSqlite3.Database;
  let repo: SignatureAuditRepo;

  beforeEach(() => {
    db = makeTestDatabase();
    repo = createSignatureAuditRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================
  // Schema verification (smoke test that migration 0004 ran)
  // ============================================================

  describe('schema migration', () => {
    it('reports schema_version >= 4 after migrations apply', () => {
      const row = db
        .prepare<[], { v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
        .get();
      expect(row?.v).toBeGreaterThanOrEqual(4);
    });

    it('creates signature_audit_log with the canonical column set', () => {
      const cols = db
        .prepare<[], { name: string }>(`PRAGMA table_info(signature_audit_log)`)
        .all()
        .map((r) => r.name)
        .sort();
      expect(cols).toEqual(
        [
          'byte_range_json',
          'cert_not_after',
          'cert_not_before',
          'created_at',
          'doc_hash',
          'field_name',
          'id',
          'location',
          'pre_sign_doc_hash',
          'reason',
          'sig_bytes_length',
          'sig_bytes_offset',
          'signature_kind',
          'signed_at',
          'signed_by_fingerprint',
          'signed_by_issuer_cn',
          'signed_by_subject_cn',
          'tsa_response_status',
          'tsa_url',
          // Phase 5 additive (data-models §10.10): FK column linking to
          // the OCR job that invalidated this signature row, if any.
          'invalidated_by_ocr_job_id',
        ].sort(),
      );
    });

    it('creates the documented indexes (data-models §9.4 + §10.10)', () => {
      const idx = db
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master
            WHERE type = 'index' AND tbl_name = 'signature_audit_log'`,
        )
        .all()
        .map((r) => r.name);
      expect(idx).toEqual(
        expect.arrayContaining([
          'idx_signature_audit_log_doc_hash',
          'idx_signature_audit_log_pre_sign_doc_hash',
          'idx_signature_audit_log_signed_at',
          'idx_signature_audit_log_fingerprint',
          // Phase 5 additive index — supports listInvalidatedByOcrJob.
          'idx_signature_audit_log_invalidated_by_ocr_job_id',
        ]),
      );
    });

    it('enforces CHECK on signature_kind at the SQL level', () => {
      // Defense-in-depth: even if the repo validator regresses, the DDL CHECK
      // (data-models §9.4 DDL line `CHECK (signature_kind IN ...)`) still
      // refuses bad values.
      const insertRaw = db.prepare(
        `INSERT INTO signature_audit_log
           (doc_hash, pre_sign_doc_hash, signed_at, signature_kind, created_at)
         VALUES ('x', 'y', 1, 'invalid-kind', 1)`,
      );
      expect(() => insertRaw.run()).toThrowError(/CHECK constraint failed/);
    });

    it('enforces UNIQUE(doc_hash, sig_bytes_offset) at the SQL level', () => {
      // Same defense-in-depth — the repo pre-checks but the SQL constraint is
      // the authoritative guard (data-models §9.4.1).
      const raw = db.prepare(
        `INSERT INTO signature_audit_log
           (doc_hash, pre_sign_doc_hash, signed_at, signature_kind,
            sig_bytes_offset, created_at)
         VALUES ('same-doc', 'p', 1, 'pades', 100, 1)`,
      );
      raw.run();
      expect(() => raw.run()).toThrowError(/UNIQUE constraint failed/);
    });
  });

  // ============================================================
  // listByDocHash — first stop for new readers
  // ============================================================

  describe('listByDocHash', () => {
    it('returns [] for a fresh database', () => {
      expect(repo.listByDocHash('any-doc-hash')).toEqual([]);
    });

    it('returns inserted rows for the matching doc_hash', () => {
      const ins = repo.insert(makePadesTsaInput());
      expect(ins.ok).toBe(true);

      const rows = repo.listByDocHash('a'.repeat(64));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.signature_kind).toBe('pades-tsa');
      expect(rows[0]?.signed_by_subject_cn).toBe('Adam Hudson');
    });

    it('does NOT return rows for other doc_hashes', () => {
      repo.insert(makePadesTsaInput({ doc_hash: 'a'.repeat(64) }));
      repo.insert(
        makePadesTsaInput({
          doc_hash: 'b'.repeat(64),
          sig_bytes_offset: 99999,
          signed_by_fingerprint: '1'.repeat(64),
        }),
      );
      const rows = repo.listByDocHash('a'.repeat(64));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.doc_hash).toBe('a'.repeat(64));
    });

    it('orders by signed_at DESC with id ASC tie-break', () => {
      repo.insert(makePadesTsaInput({ signed_at: 1000, sig_bytes_offset: 1 }));
      repo.insert(makePadesTsaInput({ signed_at: 3000, sig_bytes_offset: 2 }));
      repo.insert(makePadesTsaInput({ signed_at: 2000, sig_bytes_offset: 3 }));
      // Two rows at the same signed_at — order should fall back to id ASC.
      repo.insert(makePadesTsaInput({ signed_at: 2000, sig_bytes_offset: 4 }));

      const rows = repo.listByDocHash('a'.repeat(64));
      expect(rows.map((r) => ({ at: r.signed_at, off: r.sig_bytes_offset }))).toEqual([
        { at: 3000, off: 2 },
        { at: 2000, off: 3 },
        { at: 2000, off: 4 },
        { at: 1000, off: 1 },
      ]);
    });

    it('respects limit + offset', () => {
      for (let i = 0; i < 5; i++) {
        repo.insert(makePadesTsaInput({ signed_at: 1000 + i, sig_bytes_offset: i + 1 }));
      }
      // signed_at DESC: 1004, 1003, 1002, 1001, 1000.
      // Page through with limit=2.
      expect(repo.listByDocHash('a'.repeat(64), 2, 0).map((r) => r.signed_at)).toEqual([
        1004, 1003,
      ]);
      expect(repo.listByDocHash('a'.repeat(64), 2, 2).map((r) => r.signed_at)).toEqual([
        1002, 1001,
      ]);
      expect(repo.listByDocHash('a'.repeat(64), 2, 4).map((r) => r.signed_at)).toEqual([1000]);
    });
  });

  // ============================================================
  // insert — round-trip + duplicates + validation
  // ============================================================

  describe('insert', () => {
    it('round-trips every PAdES-TSA field byte-for-byte', () => {
      const input = makePadesTsaInput();
      const res = repo.insert(input);
      if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
      expect(res.id).toBeGreaterThan(0);

      const row = repo.get(res.id);
      expect(row).not.toBeNull();
      // Every field except the id + (optionally) created_at must match the input.
      // We strip the id and assert the remaining shape.
      expect(row).toMatchObject({
        doc_hash: input.doc_hash,
        pre_sign_doc_hash: input.pre_sign_doc_hash,
        signed_at: input.signed_at,
        signature_kind: input.signature_kind,
        signed_by_fingerprint: input.signed_by_fingerprint,
        signed_by_subject_cn: input.signed_by_subject_cn,
        signed_by_issuer_cn: input.signed_by_issuer_cn,
        cert_not_before: input.cert_not_before,
        cert_not_after: input.cert_not_after,
        tsa_url: input.tsa_url,
        tsa_response_status: input.tsa_response_status,
        sig_bytes_offset: input.sig_bytes_offset,
        sig_bytes_length: input.sig_bytes_length,
        byte_range_json: input.byte_range_json,
        reason: input.reason,
        location: input.location,
        field_name: input.field_name,
      });
      expect(row?.id).toBe(res.id);
      expect(row?.created_at).toBeGreaterThan(0);
    });

    it('defaults created_at to Date.now() when omitted', () => {
      const before = Date.now();
      const res = repo.insert(makePadesTsaInput());
      const after = Date.now();
      if (!res.ok) throw new Error('expected ok');

      const row = repo.get(res.id);
      expect(row?.created_at).toBeGreaterThanOrEqual(before);
      expect(row?.created_at).toBeLessThanOrEqual(after);
    });

    it('accepts explicit created_at override', () => {
      const res = repo.insert(makePadesTsaInput({ created_at: 999 }));
      if (!res.ok) throw new Error('expected ok');
      expect(repo.get(res.id)?.created_at).toBe(999);
    });

    it('round-trips a visual signature with the NULL cert/sig fields', () => {
      const res = repo.insert(makeVisualInput());
      if (!res.ok) throw new Error('expected ok');

      const row = repo.get(res.id);
      expect(row?.signature_kind).toBe('visual');
      // Verify at the raw-row level so NULLs are actual SQL NULLs, not the
      // string 'null' — same paranoia as form-templates-repo's NULL test.
      const raw = db
        .prepare<
          { id: number },
          {
            signed_by_fingerprint: string | null;
            cert_not_before: number | null;
            sig_bytes_offset: number | null;
            byte_range_json: string | null;
            tsa_response_status: string | null;
          }
        >(
          `SELECT signed_by_fingerprint, cert_not_before, sig_bytes_offset,
                  byte_range_json, tsa_response_status
             FROM signature_audit_log WHERE id = @id`,
        )
        .get({ id: res.id });
      expect(raw?.signed_by_fingerprint).toBeNull();
      expect(raw?.cert_not_before).toBeNull();
      expect(raw?.sig_bytes_offset).toBeNull();
      expect(raw?.byte_range_json).toBeNull();
      expect(raw?.tsa_response_status).toBeNull();
    });

    it('allows multiple visual signatures on the same doc_hash (NULL offset)', () => {
      // Per data-models §9.4.1, UNIQUE(doc_hash, sig_bytes_offset) tolerates
      // NULL offsets — multiple visual signatures coexist on one doc.
      const a = repo.insert(makeVisualInput({ doc_hash: 'shared-doc' }));
      const b = repo.insert(makeVisualInput({ doc_hash: 'shared-doc' }));
      const c = repo.insert(makeVisualInput({ doc_hash: 'shared-doc' }));
      expect(a.ok && b.ok && c.ok).toBe(true);
      expect(repo.listByDocHash('shared-doc')).toHaveLength(3);
    });

    it('returns { ok:false, error:"duplicate" } on UNIQUE(doc_hash, sig_bytes_offset)', () => {
      const first = repo.insert(makePadesTsaInput({ sig_bytes_offset: 4242 }));
      expect(first.ok).toBe(true);

      const second = repo.insert(
        makePadesTsaInput({
          sig_bytes_offset: 4242,
          // Differ in every other field to prove uniqueness is the (doc, offset) pair.
          signed_by_fingerprint: '9'.repeat(64),
          signed_at: 2_000_000_000_000,
        }),
      );
      expect(second).toEqual({ ok: false, error: 'duplicate' });

      // Only one row landed.
      expect(repo.listByDocHash('a'.repeat(64))).toHaveLength(1);
    });

    it('rejects invalid signature_kind at the repo boundary', () => {
      expect(() =>
        repo.insert(
          makePadesTsaInput({
            // @ts-expect-error — runtime guard test
            signature_kind: 'nonsense',
          }),
        ),
      ).toThrowError(/signature_kind must be/);
    });

    it('rejects empty doc_hash + pre_sign_doc_hash', () => {
      expect(() => repo.insert(makePadesTsaInput({ doc_hash: '' }))).toThrowError(/doc_hash/);
      expect(() => repo.insert(makePadesTsaInput({ pre_sign_doc_hash: '' }))).toThrowError(
        /pre_sign_doc_hash/,
      );
    });

    it('rejects negative timestamps + offsets', () => {
      expect(() => repo.insert(makePadesTsaInput({ signed_at: -1 }))).toThrowError(/signed_at/);
      expect(() => repo.insert(makePadesTsaInput({ sig_bytes_offset: -1 }))).toThrowError(
        /sig_bytes_offset/,
      );
      expect(() => repo.insert(makePadesTsaInput({ cert_not_before: -1 }))).toThrowError(
        /cert_not_before/,
      );
    });

    it('rejects invalid tsa_response_status', () => {
      expect(() =>
        repo.insert(
          makePadesTsaInput({
            // @ts-expect-error — runtime guard test
            tsa_response_status: 'maybe',
          }),
        ),
      ).toThrowError(/tsa_response_status/);
    });
  });

  // ============================================================
  // SQL-injection resistance
  //
  // Per Wave 13.5 lesson (M-13.5-1 sibling): no permissive stubs in repo tests.
  // We pass real adversarial inputs through every TEXT-typed field of the
  // insert payload and through the string parameters of every read method.
  // After all the noise we assert the table still exists and the row is
  // retrievable verbatim — the exact pattern recent-files-repo establishes.
  // ============================================================

  describe('SQL-injection resistance', () => {
    const PAYLOADS = [
      "'; DROP TABLE signature_audit_log; --",
      "x' OR '1'='1",
      "x' UNION SELECT * FROM schema_migrations; --",
      'x"; DELETE FROM signature_audit_log; --',
      "x'); DROP TABLE schema_migrations; --",
      'x\x00\nDROP TABLE signature_audit_log;',
    ];

    it.each(PAYLOADS)(
      'preserves table + roundtrips payload %j in every string column',
      (payload: string) => {
        const input = makePadesTsaInput({
          doc_hash: payload,
          pre_sign_doc_hash: payload,
          signed_by_fingerprint: payload,
          signed_by_subject_cn: payload,
          signed_by_issuer_cn: payload,
          tsa_url: payload,
          byte_range_json: payload,
          reason: payload,
          location: payload,
          field_name: payload,
        });
        const res = repo.insert(input);
        if (!res.ok) throw new Error(`expected ok, got ${res.error}`);

        // Read it back via every method that takes a string parameter — if any
        // of these were string-concat'd into SQL, the payload would have
        // detonated. Instead each one returns the row verbatim.
        const byId = repo.get(res.id);
        expect(byId?.doc_hash).toBe(payload);
        expect(byId?.signed_by_subject_cn).toBe(payload);
        expect(byId?.reason).toBe(payload);
        expect(byId?.byte_range_json).toBe(payload);

        expect(repo.listByDocHash(payload)).toHaveLength(1);
        expect(repo.listByPreSignDocHash(payload)).toHaveLength(1);
        expect(repo.listByFingerprint(payload)).toHaveLength(1);
        expect(
          repo.listAll({ fileHash: payload, signedByFingerprint: payload }).items,
        ).toHaveLength(1);

        // The schema is still intact.
        const tables = db
          .prepare<[], { name: string }>(
            `SELECT name FROM sqlite_master
              WHERE type='table' AND name='signature_audit_log'`,
          )
          .all();
        expect(tables).toHaveLength(1);
        // schema_migrations also still present.
        const migrations = db
          .prepare<[], { v: number }>('SELECT MAX(version) AS v FROM schema_migrations')
          .get();
        expect(migrations?.v).toBeGreaterThanOrEqual(4);
      },
    );
  });

  // ============================================================
  // listByPreSignDocHash
  // ============================================================

  describe('listByPreSignDocHash', () => {
    it('returns rows matching pre_sign_doc_hash regardless of doc_hash', () => {
      // Same pre-sign hash, two different post-sign docs — the verify flow's
      // canonical "did the signed bytes round-trip cleanly?" question.
      repo.insert(
        makePadesTsaInput({
          doc_hash: 'post-a',
          pre_sign_doc_hash: 'pre-shared',
          sig_bytes_offset: 1,
        }),
      );
      repo.insert(
        makePadesTsaInput({
          doc_hash: 'post-b',
          pre_sign_doc_hash: 'pre-shared',
          sig_bytes_offset: 2,
        }),
      );
      // Unrelated row at a different pre-sign hash.
      repo.insert(
        makePadesTsaInput({
          doc_hash: 'post-c',
          pre_sign_doc_hash: 'pre-other',
          sig_bytes_offset: 3,
        }),
      );

      const rows = repo.listByPreSignDocHash('pre-shared');
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.doc_hash).sort()).toEqual(['post-a', 'post-b']);
    });
  });

  // ============================================================
  // listByFingerprint
  // ============================================================

  describe('listByFingerprint', () => {
    it('filters by signer cert fingerprint', () => {
      const fpA = 'a'.repeat(64);
      const fpB = 'b'.repeat(64);
      repo.insert(makePadesTsaInput({ signed_by_fingerprint: fpA, sig_bytes_offset: 1 }));
      repo.insert(
        makePadesTsaInput({
          signed_by_fingerprint: fpA,
          sig_bytes_offset: 2,
          signed_at: 1000,
        }),
      );
      repo.insert(
        makePadesTsaInput({
          signed_by_fingerprint: fpB,
          sig_bytes_offset: 3,
        }),
      );

      const rowsA = repo.listByFingerprint(fpA);
      expect(rowsA).toHaveLength(2);
      expect(rowsA.every((r) => r.signed_by_fingerprint === fpA)).toBe(true);

      const rowsB = repo.listByFingerprint(fpB);
      expect(rowsB).toHaveLength(1);
    });

    it('respects optional signed_at window', () => {
      const fp = 'f'.repeat(64);
      repo.insert(
        makePadesTsaInput({
          signed_by_fingerprint: fp,
          signed_at: 1000,
          sig_bytes_offset: 1,
        }),
      );
      repo.insert(
        makePadesTsaInput({
          signed_by_fingerprint: fp,
          signed_at: 2000,
          sig_bytes_offset: 2,
        }),
      );
      repo.insert(
        makePadesTsaInput({
          signed_by_fingerprint: fp,
          signed_at: 3000,
          sig_bytes_offset: 3,
        }),
      );

      expect(repo.listByFingerprint(fp, 1500, 2500).map((r) => r.signed_at)).toEqual([2000]);
      // Open-ended bounds.
      expect(repo.listByFingerprint(fp, 2000).map((r) => r.signed_at)).toEqual([3000, 2000]);
      expect(repo.listByFingerprint(fp, undefined, 2000).map((r) => r.signed_at)).toEqual([
        2000, 1000,
      ]);
    });

    it('rejects inverted window (since > until)', () => {
      expect(() => repo.listByFingerprint('x', 5000, 1000)).toThrowError(/window invalid/);
    });
  });

  // ============================================================
  // listAll — generic filtered list with total
  // ============================================================

  describe('listAll', () => {
    beforeEach(() => {
      // Three docs, two signers, signed across a time range.
      repo.insert(
        makePadesTsaInput({
          doc_hash: 'doc-1',
          signed_by_fingerprint: 'fp-A',
          signed_at: 1000,
          sig_bytes_offset: 10,
        }),
      );
      repo.insert(
        makePadesTsaInput({
          doc_hash: 'doc-1',
          signed_by_fingerprint: 'fp-B',
          signed_at: 2000,
          sig_bytes_offset: 20,
        }),
      );
      repo.insert(
        makePadesTsaInput({
          doc_hash: 'doc-2',
          signed_by_fingerprint: 'fp-A',
          signed_at: 3000,
          sig_bytes_offset: 30,
        }),
      );
      repo.insert(
        makePadesTsaInput({
          doc_hash: 'doc-3',
          signed_by_fingerprint: 'fp-A',
          signed_at: 4000,
          sig_bytes_offset: 40,
        }),
      );
    });

    it('returns every row with empty filters + reports total', () => {
      const res = repo.listAll({});
      expect(res.total).toBe(4);
      expect(res.items).toHaveLength(4);
      // signed_at DESC.
      expect(res.items.map((r) => r.signed_at)).toEqual([4000, 3000, 2000, 1000]);
    });

    it('AND-filters by fileHash + fingerprint', () => {
      const res = repo.listAll({ fileHash: 'doc-1', signedByFingerprint: 'fp-A' });
      expect(res.total).toBe(1);
      expect(res.items).toHaveLength(1);
      expect(res.items[0]?.doc_hash).toBe('doc-1');
      expect(res.items[0]?.signed_by_fingerprint).toBe('fp-A');
    });

    it('AND-filters by signed_at window', () => {
      const res = repo.listAll({ since: 2000, until: 3000 });
      expect(res.total).toBe(2);
      expect(res.items.map((r) => r.signed_at)).toEqual([3000, 2000]);
    });

    it('paginates without losing total count', () => {
      const page1 = repo.listAll({}, 2, 0);
      expect(page1.total).toBe(4);
      expect(page1.items).toHaveLength(2);
      expect(page1.items.map((r) => r.signed_at)).toEqual([4000, 3000]);

      const page2 = repo.listAll({}, 2, 2);
      expect(page2.total).toBe(4);
      expect(page2.items.map((r) => r.signed_at)).toEqual([2000, 1000]);
    });

    it('filter by fingerprint = fp-A returns 3 rows across docs', () => {
      const res = repo.listAll({ signedByFingerprint: 'fp-A' });
      expect(res.total).toBe(3);
      expect(res.items.every((r) => r.signed_by_fingerprint === 'fp-A')).toBe(true);
    });
  });

  // ============================================================
  // delete (undo-PAdES flow)
  // ============================================================

  describe('delete', () => {
    it('removes by id and returns true', () => {
      const ins = repo.insert(makePadesTsaInput());
      if (!ins.ok) throw new Error('expected ok');

      expect(repo.delete(ins.id)).toBe(true);
      expect(repo.get(ins.id)).toBeNull();
      expect(repo.listByDocHash('a'.repeat(64))).toEqual([]);
    });

    it('returns false when row does not exist', () => {
      expect(repo.delete(99999)).toBe(false);
    });

    it('rejects non-positive id', () => {
      expect(() => repo.delete(0)).toThrowError(/Invalid id/);
      expect(() => repo.delete(-1)).toThrowError(/Invalid id/);
    });

    it('does not cascade — deleting one row leaves siblings intact', () => {
      const a = repo.insert(makePadesTsaInput({ sig_bytes_offset: 1 }));
      const b = repo.insert(makePadesTsaInput({ sig_bytes_offset: 2 }));
      if (!a.ok || !b.ok) throw new Error('expected ok');

      expect(repo.delete(a.id)).toBe(true);
      const rows = repo.listByDocHash('a'.repeat(64));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(b.id);
    });
  });

  // ============================================================
  // get
  // ============================================================

  describe('get', () => {
    it('returns null for unknown id', () => {
      expect(repo.get(99999)).toBeNull();
    });

    it('rejects non-positive id', () => {
      expect(() => repo.get(0)).toThrowError(/Invalid id/);
      expect(() => repo.get(-3)).toThrowError(/Invalid id/);
      expect(() => repo.get(1.5)).toThrowError(/Invalid id/);
    });
  });

  // ============================================================
  // Cross-method pipeline
  // ============================================================

  describe('cross-method integration', () => {
    it('insert -> listByDocHash -> delete pipeline reflects every change', () => {
      const a = repo.insert(makePadesTsaInput({ doc_hash: 'pipe-doc', sig_bytes_offset: 1 }));
      const b = repo.insert(makePadesTsaInput({ doc_hash: 'pipe-doc', sig_bytes_offset: 2 }));
      if (!a.ok || !b.ok) throw new Error('expected ok');

      expect(repo.listByDocHash('pipe-doc')).toHaveLength(2);

      repo.delete(a.id);
      const after = repo.listByDocHash('pipe-doc');
      expect(after).toHaveLength(1);
      expect(after[0]?.id).toBe(b.id);

      // listAll reflects the same view.
      expect(repo.listAll({ fileHash: 'pipe-doc' }).total).toBe(1);
    });

    it('byte_range_json round-trips verbatim (bridge owns parse/serialize)', () => {
      // Wave 12 takeaway #1: JSON columns are stored as TEXT, never parsed
      // by the repo. The bridge owns the boundary. We verify a payload with
      // whitespace + key ordering JSON.stringify wouldn't produce by default.
      const payload = '[\n  0,\n  100,\n  200,\n  500\n]';
      const res = repo.insert(makePadesTsaInput({ byte_range_json: payload }));
      if (!res.ok) throw new Error('expected ok');
      expect(repo.get(res.id)?.byte_range_json).toBe(payload);
    });
  });

  // ============================================================
  // Phase 5 — OCR invalidation cross-link (data-models §10.10)
  // ============================================================

  describe('Phase 5 — OCR invalidation cross-link', () => {
    /**
     * Insert an ocr_jobs row directly via SQL so this test file doesn't take
     * a runtime dependency on the OCR jobs repo. The signature-audit FK
     * needs a real row in ocr_jobs to satisfy `REFERENCES ocr_jobs(id)`.
     */
    function makeOcrJobRow(): number {
      const result = db
        .prepare(
          `INSERT INTO ocr_jobs (doc_hash, page_range_start, page_range_end,
            langs, preprocess_json, status, started_at,
            invalidated_signatures, created_at)
            VALUES ('docX', 0, 5, 'eng', '{}', 'completed', 100, 1, 100)`,
        )
        .run();
      const rowid = result.lastInsertRowid;
      return typeof rowid === 'bigint' ? Number(rowid) : rowid;
    }

    it('insert defaults invalidated_by_ocr_job_id to NULL', () => {
      const res = repo.insert(makePadesTsaInput());
      if (!res.ok) throw new Error('expected ok');
      expect(repo.get(res.id)?.invalidated_by_ocr_job_id).toBeNull();
    });

    it('markInvalidatedByOcrJob links audit rows to a job and counts changes', () => {
      const ocrJobId = makeOcrJobRow();
      const a = repo.insert(makePadesTsaInput({ sig_bytes_offset: 1 }));
      const b = repo.insert(makePadesTsaInput({ sig_bytes_offset: 2 }));
      const c = repo.insert(makePadesTsaInput({ sig_bytes_offset: 3 }));
      if (!a.ok || !b.ok || !c.ok) throw new Error('expected ok');

      const changed = repo.markInvalidatedByOcrJob([a.id, b.id], ocrJobId);
      expect(changed).toBe(2);

      expect(repo.get(a.id)?.invalidated_by_ocr_job_id).toBe(ocrJobId);
      expect(repo.get(b.id)?.invalidated_by_ocr_job_id).toBe(ocrJobId);
      // Untouched row still NULL.
      expect(repo.get(c.id)?.invalidated_by_ocr_job_id).toBeNull();
    });

    it('markInvalidatedByOcrJob with empty array is a no-op', () => {
      const ocrJobId = makeOcrJobRow();
      expect(repo.markInvalidatedByOcrJob([], ocrJobId)).toBe(0);
    });

    it('markInvalidatedByOcrJob rejects invalid ocr job id', () => {
      const a = repo.insert(makePadesTsaInput({ sig_bytes_offset: 1 }));
      if (!a.ok) throw new Error('expected ok');
      expect(() => repo.markInvalidatedByOcrJob([a.id], 0)).toThrowError(/Invalid ocrJobId/);
    });

    it('markInvalidatedByOcrJob rejects invalid row ids', () => {
      const ocrJobId = makeOcrJobRow();
      expect(() => repo.markInvalidatedByOcrJob([0], ocrJobId)).toThrowError(/Invalid rowIds/);
      expect(() =>
        // @ts-expect-error — runtime guard test
        repo.markInvalidatedByOcrJob('not-an-array', ocrJobId),
      ).toThrowError(/rowIds must be an array/);
    });

    it('listInvalidatedByOcrJob returns rows linked to a job, ordered signed_at DESC', () => {
      const ocrJobId = makeOcrJobRow();
      const a = repo.insert(makePadesTsaInput({ sig_bytes_offset: 1, signed_at: 1000 }));
      const b = repo.insert(makePadesTsaInput({ sig_bytes_offset: 2, signed_at: 3000 }));
      const c = repo.insert(makePadesTsaInput({ sig_bytes_offset: 3, signed_at: 2000 }));
      if (!a.ok || !b.ok || !c.ok) throw new Error('expected ok');

      repo.markInvalidatedByOcrJob([a.id, b.id, c.id], ocrJobId);
      const rows = repo.listInvalidatedByOcrJob(ocrJobId);
      expect(rows.map((r) => r.signed_at)).toEqual([3000, 2000, 1000]);
    });

    it('listInvalidatedByOcrJob returns [] for a job with no invalidations', () => {
      const ocrJobId = makeOcrJobRow();
      expect(repo.listInvalidatedByOcrJob(ocrJobId)).toEqual([]);
    });

    it('listInvalidatedByOcrJob rejects invalid id', () => {
      expect(() => repo.listInvalidatedByOcrJob(0)).toThrowError(/Invalid ocrJobId/);
    });

    it('SELECT statements include invalidated_by_ocr_job_id in row shape', () => {
      // Regression guard for the Phase 5 column projection extension: every
      // read method must surface invalidated_by_ocr_job_id, NOT undefined.
      const ocrJobId = makeOcrJobRow();
      const a = repo.insert(makePadesTsaInput({ sig_bytes_offset: 1 }));
      if (!a.ok) throw new Error('expected ok');
      repo.markInvalidatedByOcrJob([a.id], ocrJobId);

      expect(repo.get(a.id)).toHaveProperty('invalidated_by_ocr_job_id', ocrJobId);
      expect(repo.listByDocHash('a'.repeat(64))[0]).toHaveProperty(
        'invalidated_by_ocr_job_id',
        ocrJobId,
      );
      expect(repo.listByPreSignDocHash('b'.repeat(64))[0]).toHaveProperty(
        'invalidated_by_ocr_job_id',
        ocrJobId,
      );
      expect(repo.listByFingerprint('c'.repeat(64))[0]).toHaveProperty(
        'invalidated_by_ocr_job_id',
        ocrJobId,
      );
      expect(repo.listAll({}).items[0]).toHaveProperty('invalidated_by_ocr_job_id', ocrJobId);
    });
  });
});
