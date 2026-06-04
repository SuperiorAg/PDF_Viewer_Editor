import { describe, expect, it } from 'vitest';

import {
  adaptBookmarksRepo,
  adaptRecentsRepo,
  adaptSignatureAuditRepo,
  createMemoryDbBridge,
  getDbBridge,
  setDbBridge,
  type RaviSignatureAuditRepo,
  type RaviSignatureAuditRow,
  type SignatureAuditInsertInput,
} from './db-bridge.js';

describe('db-bridge memory fallback', () => {
  it('provides working recents/settings/bookmarks repos', () => {
    const bridge = createMemoryDbBridge();
    bridge.recents.upsert({ path: 'C:/a.pdf', displayName: 'a.pdf', fileHash: 'h' });
    expect(bridge.recents.list(10)).toHaveLength(1);

    bridge.settings.set('theme', 'dark');
    expect(bridge.settings.get('theme')).toBe('dark');

    const id = bridge.bookmarks.upsert({
      fileHash: 'h',
      pageIndex: 0,
      title: 'cover',
    });
    expect(typeof id).toBe('number');
    expect(bridge.bookmarks.listByFile('h')).toHaveLength(1);
    expect(bridge.bookmarks.delete(id)).toBe(true);
  });

  it('setDbBridge swaps the active singleton', () => {
    const before = getDbBridge();
    const fresh = createMemoryDbBridge();
    setDbBridge(fresh);
    expect(getDbBridge()).toBe(fresh);
    // restore so other tests are unaffected
    setDbBridge(before);
  });
});

describe('adaptRecentsRepo', () => {
  it('translates snake_case rows to camelCase contract rows', () => {
    const raw = {
      list: () => [
        {
          path: 'C:/x.pdf',
          last_opened_at: 100,
          file_hash: 'h',
          display_name: 'x.pdf',
        },
      ],
      upsert: () => {
        /* no-op */
      },
      clear: () => 0,
    };
    const adapted = adaptRecentsRepo(raw);
    const out = adapted.list(10);
    expect(out[0]).toMatchObject({
      path: 'C:/x.pdf',
      displayName: 'x.pdf',
      fileHash: 'h',
      lastOpenedAt: 100,
    });
  });
});

describe('adaptBookmarksRepo', () => {
  it('translates snake_case rows to camelCase contract rows', () => {
    const raw = {
      listByFile: () => [
        {
          id: 1,
          file_hash: 'h',
          page_index: 4,
          title: 'T',
          created_at: 200,
        },
      ],
      upsert: () => 1,
      delete: () => true,
    };
    const adapted = adaptBookmarksRepo(raw);
    const out = adapted.listByFile('h');
    expect(out[0]).toMatchObject({
      id: 1,
      fileHash: 'h',
      pageIndex: 4,
      title: 'T',
      createdAt: 200,
    });
  });
});

// ============================================================================
// Phase 4 (Wave 16, David) — signature_audit_log adapter + memory repo tests
// ============================================================================

describe('SignatureAuditRepo memory fallback', () => {
  function makeInput(
    overrides: Partial<SignatureAuditInsertInput> = {},
  ): SignatureAuditInsertInput {
    return {
      doc_hash: 'a'.repeat(64),
      pre_sign_doc_hash: 'b'.repeat(64),
      signed_at: Date.now(),
      signature_kind: 'pades',
      signed_by_fingerprint: 'c'.repeat(64),
      signed_by_subject_cn: 'Ada',
      signed_by_issuer_cn: 'CA',
      cert_not_before: 1000,
      cert_not_after: 5000,
      tsa_url: null,
      tsa_response_status: null,
      sig_bytes_offset: 100,
      sig_bytes_length: 200,
      byte_range_json: JSON.stringify([0, 100, 300, 400]),
      reason: 'test',
      location: 'here',
      field_name: 'SigField1',
      ...overrides,
    };
  }

  it('insert + get round-trips byte_range_json into a parsed array', () => {
    const bridge = createMemoryDbBridge();
    if (!bridge.signatureAudit) throw new Error('signatureAudit not wired');
    const id = bridge.signatureAudit.insert(makeInput());
    const row = bridge.signatureAudit.get(id);
    expect(row).not.toBeNull();
    expect(row!.byteRange).toEqual([0, 100, 300, 400]);
    expect(row!.signatureKind).toBe('pades');
    expect(row!.signedBySubjectCN).toBe('Ada');
  });

  it('listByDocHash filters + sorts newest-first', () => {
    const bridge = createMemoryDbBridge();
    if (!bridge.signatureAudit) throw new Error('signatureAudit not wired');
    bridge.signatureAudit.insert(makeInput({ signed_at: 100 }));
    bridge.signatureAudit.insert(makeInput({ signed_at: 200 }));
    bridge.signatureAudit.insert(makeInput({ doc_hash: 'd'.repeat(64), signed_at: 300 }));
    const items = bridge.signatureAudit.listByDocHash('a'.repeat(64));
    expect(items).toHaveLength(2);
    expect(items[0]!.signedAt).toBe(200);
  });

  it('listAll filters by fingerprint + date range', () => {
    const bridge = createMemoryDbBridge();
    if (!bridge.signatureAudit) throw new Error('signatureAudit not wired');
    bridge.signatureAudit.insert(makeInput({ signed_by_fingerprint: 'X', signed_at: 100 }));
    bridge.signatureAudit.insert(makeInput({ signed_by_fingerprint: 'Y', signed_at: 200 }));
    const r1 = bridge.signatureAudit.listAll({ signedByFingerprint: 'X' }, 100, 0);
    expect(r1.total).toBe(1);
    const r2 = bridge.signatureAudit.listAll({ since: 150 }, 100, 0);
    expect(r2.total).toBe(1);
    expect(r2.items[0]!.signedAt).toBe(200);
  });

  it('delete returns true on hit, false on miss', () => {
    const bridge = createMemoryDbBridge();
    if (!bridge.signatureAudit) throw new Error('signatureAudit not wired');
    const id = bridge.signatureAudit.insert(makeInput());
    expect(bridge.signatureAudit.delete(id)).toBe(true);
    expect(bridge.signatureAudit.delete(id)).toBe(false);
  });
});

describe('adaptSignatureAuditRepo — Ravi adapter', () => {
  it('translates snake_case rows + parses byte_range_json', () => {
    const raviRow: RaviSignatureAuditRow = {
      id: 7,
      doc_hash: 'doc-hash',
      pre_sign_doc_hash: 'pre-hash',
      signed_at: 1234,
      signature_kind: 'pades-tsa',
      signed_by_fingerprint: 'fp',
      signed_by_subject_cn: 'Bob',
      signed_by_issuer_cn: 'CA',
      cert_not_before: 100,
      cert_not_after: 999,
      tsa_url: 'https://tsa.example.com',
      tsa_response_status: 'ok',
      sig_bytes_offset: 50,
      sig_bytes_length: 100,
      byte_range_json: '[0, 50, 150, 200]',
      reason: 'r',
      location: 'l',
      field_name: 'F',
      created_at: 2000,
    };
    const raw: RaviSignatureAuditRepo = {
      insert: () => 7,
      get: (id) => (id === 7 ? raviRow : null),
      listByDocHash: () => [raviRow],
      listAll: () => ({ items: [raviRow], total: 1 }),
      delete: () => true,
    };
    const adapted = adaptSignatureAuditRepo(raw);
    const got = adapted.get(7);
    expect(got).not.toBeNull();
    expect(got!.docHash).toBe('doc-hash');
    expect(got!.byteRange).toEqual([0, 50, 150, 200]);
    expect(got!.signedBySubjectCN).toBe('Bob');
    expect(got!.tsaUrl).toBe('https://tsa.example.com');
  });

  it('handles null byte_range_json gracefully (visual signatures)', () => {
    const raviRow: RaviSignatureAuditRow = {
      id: 5,
      doc_hash: 'd',
      pre_sign_doc_hash: 'p',
      signed_at: 1,
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
      created_at: 100,
    };
    const raw: RaviSignatureAuditRepo = {
      insert: () => 5,
      get: () => raviRow,
      listByDocHash: () => [],
      listAll: () => ({ items: [], total: 0 }),
      delete: () => true,
    };
    const adapted = adaptSignatureAuditRepo(raw);
    const got = adapted.get(5);
    expect(got!.byteRange).toBeNull();
    expect(got!.signatureKind).toBe('visual');
  });
});

// ============================================================
// Phase 5.2 (Marcus, 2026-06-04) — OcrResultsRepoBridge.listPageResultsByJobId
// ============================================================

describe('OcrResultsRepoBridge.listPageResultsByJobId (Phase 5.2)', () => {
  const sampleWordsJson = (text: string, conf = 90): string =>
    JSON.stringify([
      {
        text,
        confidence: conf,
        imgRect: { x0: 0, y0: 0, x1: 30, y1: 12 },
        pdfRect: { x: 10, y: 760, width: 30, height: 12 },
      },
    ]);

  it('memory bridge parses words_json and assembles OcrPageResult[] sorted by pageIndex', () => {
    const bridge = createMemoryDbBridge();
    const results = bridge.ocrResults!;
    // Insert out-of-order to test the sort.
    results.insert({
      job_id: 1,
      page_index: 2,
      total_words: 1,
      low_confidence_words: 0,
      mean_confidence: 90,
      words_json: sampleWordsJson('three'),
      img_width_px: 1700,
      img_height_px: 2200,
      duration_ms: 100,
    });
    results.insert({
      job_id: 1,
      page_index: 0,
      total_words: 1,
      low_confidence_words: 0,
      mean_confidence: 92,
      words_json: sampleWordsJson('one'),
      img_width_px: 1700,
      img_height_px: 2200,
      duration_ms: 110,
    });
    results.insert({
      job_id: 1,
      page_index: 1,
      total_words: 1,
      low_confidence_words: 1,
      mean_confidence: 45,
      words_json: sampleWordsJson('two', 45),
      img_width_px: 1700,
      img_height_px: 2200,
      duration_ms: 120,
    });
    // Different job — must NOT appear in the listing.
    results.insert({
      job_id: 2,
      page_index: 0,
      total_words: 1,
      low_confidence_words: 0,
      mean_confidence: 99,
      words_json: sampleWordsJson('other-job'),
      img_width_px: 100,
      img_height_px: 100,
      duration_ms: 1,
    });

    const pages = results.listPageResultsByJobId(1);
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.pageIndex)).toEqual([0, 1, 2]);
    expect(pages[0]!.words[0]!.text).toBe('one');
    expect(pages[1]!.words[0]!.text).toBe('two');
    expect(pages[2]!.words[0]!.text).toBe('three');
    expect(pages[0]!.imgDimsPx).toEqual({ widthPx: 1700, heightPx: 2200 });
    // PdfRect round-trips intact.
    expect(pages[0]!.words[0]!.pdfRect).toEqual({ x: 10, y: 760, width: 30, height: 12 });
  });

  it('skips rows with malformed words_json (partial-recovery policy)', () => {
    const bridge = createMemoryDbBridge();
    const results = bridge.ocrResults!;
    results.insert({
      job_id: 1,
      page_index: 0,
      total_words: 1,
      low_confidence_words: 0,
      mean_confidence: 92,
      words_json: sampleWordsJson('good'),
      img_width_px: 100,
      img_height_px: 100,
      duration_ms: 1,
    });
    // Intentionally corrupted JSON.
    results.insert({
      job_id: 1,
      page_index: 1,
      total_words: 1,
      low_confidence_words: 0,
      mean_confidence: 50,
      words_json: '{not-valid-json',
      img_width_px: 100,
      img_height_px: 100,
      duration_ms: 1,
    });
    results.insert({
      job_id: 1,
      page_index: 2,
      total_words: 1,
      low_confidence_words: 0,
      mean_confidence: 88,
      words_json: sampleWordsJson('also-good'),
      img_width_px: 100,
      img_height_px: 100,
      duration_ms: 1,
    });

    const pages = results.listPageResultsByJobId(1);
    expect(pages).toHaveLength(2);
    expect(pages.map((p) => p.pageIndex)).toEqual([0, 2]);
  });

  it('preserves null pdfRect (late-init contract)', () => {
    const bridge = createMemoryDbBridge();
    const results = bridge.ocrResults!;
    results.insert({
      job_id: 1,
      page_index: 0,
      total_words: 1,
      low_confidence_words: 0,
      mean_confidence: 92,
      words_json: JSON.stringify([
        {
          text: 'pending',
          confidence: 92,
          imgRect: { x0: 0, y0: 0, x1: 30, y1: 12 },
          pdfRect: null,
        },
      ]),
      img_width_px: 100,
      img_height_px: 100,
      duration_ms: 1,
    });

    const pages = results.listPageResultsByJobId(1);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.words[0]!.pdfRect).toBeNull();
  });

  it('returns empty array for an unknown jobId (no error)', () => {
    const bridge = createMemoryDbBridge();
    const pages = bridge.ocrResults!.listPageResultsByJobId(999);
    expect(pages).toEqual([]);
  });
});
