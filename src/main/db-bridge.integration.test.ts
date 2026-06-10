// Round-trip integration tests for the six adapter slots in db-bridge.ts.
//
// Why this file exists
// --------------------
// The existing `db-bridge.test.ts` and the handler-level tests under
// `src/ipc/handlers/*.test.ts` mock the repo factories via `vi.mock`. That
// asserts the MOCK's shape — not Ravi's real SQLite shape. Phase 7.2's
// Item A-1 static-import lift uncovered Phase-5.2 commit `f0715f8`-vintage
// signature drift between David's adapter (`adaptOcrJobsRepo.updateStatus`,
// six positional args) and Ravi's real SQLite repo (`updateStatus(id, input)`,
// one object). The drift sat silent for weeks because the dynamic-require
// gap fell through to the memory bridge — the bridge talked to the mock's
// signature.
//
// This file fixes the catch-surface gap permanently: every adapter method is
// exercised against the REAL `better-sqlite3` repo, using a fresh in-memory
// SQLite database per test. Any future signature drift between adapter and
// repo will fail this suite at PR time, before the e2e bites.
//
// Node 24 / better-sqlite3 ABI note (L-003)
// -----------------------------------------
// On a Node 24 host, run `node scripts/rebuild-native-for-node.mjs` first to
// swap in the Node-ABI prebuild. Restore the Electron-ABI binary with
// `node scripts/rebuild-native-for-node.mjs --electron` before packaging.

import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBookmarksRepo } from '../db/repositories/bookmarks-repo.js';
import { createExportJobsRepo } from '../db/repositories/export-jobs-repo.js';
import { createFormTemplatesRepo } from '../db/repositories/form-templates-repo.js';
import { createLanguagePacksRepo } from '../db/repositories/language-packs-repo.js';
import { createOcrJobsRepo } from '../db/repositories/ocr-jobs-repo.js';
import { createOcrResultsRepo } from '../db/repositories/ocr-results-repo.js';
import { createRecentFilesRepo } from '../db/repositories/recent-files-repo.js';
import { createSettingsRepo } from '../db/repositories/settings-repo.js';
import { createSignatureAuditRepo } from '../db/repositories/signature-audit-repo.js';
import { makeTestDatabase } from '../db/test-support.js';

import {
  adaptBookmarksRepo,
  adaptExportJobsRepo,
  adaptFormTemplatesRepo,
  adaptLanguagePacksRepo,
  adaptOcrJobsRepo,
  adaptOcrResultsRepo,
  adaptRecentsRepo,
  adaptSettingsRepo,
  adaptSignatureAuditRepo,
  type BookmarksRepo,
  type ExportJobsRepoBridge,
  type FormTemplatesRepo,
  type LanguagePacksRepoBridge,
  type OcrJobsRepoBridge,
  type OcrResultsRepoBridge,
  type RecentsRepo,
  type SettingsRepo,
  type SignatureAuditRepoBridge,
} from './db-bridge.js';

// ============================================================================
// Test harness: spin up a real SQLite DB and wire every adapter exactly the
// way `src/main/index.ts` Step 3.5 does. Each test gets a fresh DB.
// ============================================================================

interface WiredBridge {
  db: BetterSqlite3.Database;
  recents: RecentsRepo;
  settings: SettingsRepo;
  bookmarks: BookmarksRepo;
  formTemplates: FormTemplatesRepo;
  signatureAudit: SignatureAuditRepoBridge;
  ocrJobs: OcrJobsRepoBridge;
  ocrResults: OcrResultsRepoBridge;
  languagePacks: LanguagePacksRepoBridge;
  exportJobs: ExportJobsRepoBridge;
}

function wireRealBridge(): WiredBridge {
  const db = makeTestDatabase();
  return {
    db,
    recents: adaptRecentsRepo(createRecentFilesRepo(db)),
    settings: adaptSettingsRepo(createSettingsRepo(db)),
    bookmarks: adaptBookmarksRepo(createBookmarksRepo(db)),
    formTemplates: adaptFormTemplatesRepo(createFormTemplatesRepo(db)),
    signatureAudit: adaptSignatureAuditRepo(createSignatureAuditRepo(db)),
    ocrJobs: adaptOcrJobsRepo(createOcrJobsRepo(db)),
    ocrResults: adaptOcrResultsRepo(createOcrResultsRepo(db)),
    languagePacks: adaptLanguagePacksRepo(createLanguagePacksRepo(db)),
    exportJobs: adaptExportJobsRepo(createExportJobsRepo(db)),
  };
}

const DOC_HASH = 'a'.repeat(64);
const DOC_HASH_2 = 'b'.repeat(64);
const PRE_SIGN_HASH = 'c'.repeat(64);
const FINGERPRINT = 'd'.repeat(64);

describe('db-bridge round-trip against real SQLite repos (Item A-1.1 regression)', () => {
  let bridge: WiredBridge;

  beforeEach(() => {
    bridge = wireRealBridge();
  });

  afterEach(() => {
    bridge.db.close();
  });

  // ==========================================================================
  // ocrJobs — the canonical 7.2.1 drift. updateStatus is the load-bearing
  // signature; listAll is the second drift (Ravi returns rows + countAll,
  // bridge returns {items, total}).
  // ==========================================================================

  describe('ocrJobs adapter', () => {
    function makeQueuedRow(
      overrides: Partial<{
        doc_hash: string;
        status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | 'superseded_by_undo';
      }> = {},
    ) {
      return {
        doc_hash: overrides.doc_hash ?? DOC_HASH,
        page_range_start: 0,
        page_range_end: 4,
        langs: 'eng',
        preprocess_json: JSON.stringify({ deskew: true, denoise: false, contrastBoost: false }),
        status: overrides.status ?? ('queued' as const),
        started_at: 1_716_307_200_000,
        invalidated_signatures: 0 as const,
      };
    }

    it('insert + get round-trips through SQLite', () => {
      const id = bridge.ocrJobs.insert(makeQueuedRow());
      expect(id).toBeGreaterThan(0);
      const got = bridge.ocrJobs.get(id);
      expect(got).not.toBeNull();
      expect(got?.docHash).toBe(DOC_HASH);
      expect(got?.status).toBe('queued');
      expect(got?.invalidatedSignatures).toBe(false);
    });

    it('updateStatus({status:"completed", completed_at, mean_confidence, total_words}) lands cleanly — this is the v0.7.20 catch', () => {
      // This is the exact code path that Phase B of the e2e exercises after
      // OCR finishes. Before the fix, the adapter forwarded six positional
      // args to a one-object Ravi.updateStatus, evaluating
      // `assertOcrStatus(input.status)` where input was a number; threw
      // "status must be one of ... (got undefined)".
      const id = bridge.ocrJobs.insert(makeQueuedRow());
      const ok = bridge.ocrJobs.updateStatus(id, {
        status: 'completed',
        completed_at: 1_716_307_205_000,
        mean_confidence: 87.3,
        total_words: 142,
      });
      expect(ok).toBe(true);

      const got = bridge.ocrJobs.get(id);
      expect(got?.status).toBe('completed');
      expect(got?.completedAt).toBe(1_716_307_205_000);
      expect(got?.meanConfidence).toBe(87.3);
      expect(got?.totalWords).toBe(142);
    });

    it('updateStatus with only {status} preserves prior fields (COALESCE semantics)', () => {
      const id = bridge.ocrJobs.insert(makeQueuedRow());
      bridge.ocrJobs.updateStatus(id, {
        status: 'completed',
        completed_at: 1000,
        mean_confidence: 50,
        total_words: 10,
      });
      // queued/running transition without watermark fields — should NOT zero them.
      bridge.ocrJobs.updateStatus(id, { status: 'superseded_by_undo' });
      const got = bridge.ocrJobs.get(id);
      expect(got?.status).toBe('superseded_by_undo');
      expect(got?.meanConfidence).toBe(50);
      expect(got?.totalWords).toBe(10);
      expect(got?.completedAt).toBe(1000);
    });

    it('listAll returns {items, total} assembled from listAll + countAll', () => {
      bridge.ocrJobs.insert(makeQueuedRow());
      bridge.ocrJobs.insert(makeQueuedRow());
      bridge.ocrJobs.insert(makeQueuedRow({ doc_hash: DOC_HASH_2 }));

      const all = bridge.ocrJobs.listAll({}, 100, 0);
      expect(all.items.length).toBe(3);
      expect(all.total).toBe(3);

      const filtered = bridge.ocrJobs.listAll({ docHash: DOC_HASH }, 100, 0);
      expect(filtered.items.length).toBe(2);
      expect(filtered.total).toBe(2);
      for (const item of filtered.items) {
        expect(item.docHash).toBe(DOC_HASH);
      }
    });

    it('delete removes the row', () => {
      const id = bridge.ocrJobs.insert(makeQueuedRow());
      expect(bridge.ocrJobs.delete(id)).toBe(true);
      expect(bridge.ocrJobs.get(id)).toBeNull();
      expect(bridge.ocrJobs.delete(id)).toBe(false);
    });
  });

  // ==========================================================================
  // ocrResults — drift class: insert returns discriminated union; adapter
  // routes through Ravi's `upsert` which returns plain number (idempotent
  // under retry, matches handler-side expectation).
  // ==========================================================================

  describe('ocrResults adapter', () => {
    function ensureJob(): number {
      return bridge.ocrJobs.insert({
        doc_hash: DOC_HASH,
        page_range_start: 0,
        page_range_end: 4,
        langs: 'eng',
        preprocess_json: '{}',
        status: 'queued',
        started_at: 1_716_307_200_000,
        invalidated_signatures: 0,
      });
    }

    it('insert (routed via upsert) returns a plain number id', () => {
      const jobId = ensureJob();
      const id = bridge.ocrResults.insert({
        job_id: jobId,
        page_index: 0,
        total_words: 12,
        low_confidence_words: 2,
        mean_confidence: 88,
        words_json: JSON.stringify([
          {
            text: 'hello',
            confidence: 90,
            imgRect: { x0: 0, y0: 0, x1: 10, y1: 10 },
            pdfRect: null,
          },
        ]),
        img_width_px: 1700,
        img_height_px: 2200,
        duration_ms: 350,
      });
      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    });

    it('insert is idempotent on UNIQUE(job_id, page_index) — second insert REPLACES (upsert semantics)', () => {
      // This is the load-bearing assertion: the adapter routes `insert` to
      // Ravi's `upsert`. Without the routing change, the second call would
      // hit Ravi.insert which returns `{ok: false, error: 'duplicate'}` —
      // surfaced through the bridge as a discriminated object cast to
      // number, breaking the IPC handler's discard-the-return semantics.
      const jobId = ensureJob();
      const row = {
        job_id: jobId,
        page_index: 0,
        total_words: 12,
        low_confidence_words: 2,
        mean_confidence: 88,
        words_json: '[]',
        img_width_px: 1700,
        img_height_px: 2200,
        duration_ms: 350,
      };
      const id1 = bridge.ocrResults.insert(row);
      const id2 = bridge.ocrResults.insert({ ...row, total_words: 99 });
      expect(typeof id2).toBe('number');
      expect(id2).toBeGreaterThan(0);
      const all = bridge.ocrResults.listByJobId(jobId);
      expect(all.length).toBe(1);
      expect(all[0]?.totalWords).toBe(99);
      // id1 satisfies the contract (a number); the upsert may either
      // re-use the existing row id or assign a new one. Behaviour-detail
      // not asserted.
      void id1;
    });

    it('listPageResultsByJobId parses words_json end-to-end', () => {
      const jobId = ensureJob();
      bridge.ocrResults.insert({
        job_id: jobId,
        page_index: 0,
        total_words: 1,
        low_confidence_words: 0,
        mean_confidence: 95,
        words_json: JSON.stringify([
          { text: 'page0', confidence: 95, imgRect: { x0: 0, y0: 0, x1: 5, y1: 5 }, pdfRect: null },
        ]),
        img_width_px: 1700,
        img_height_px: 2200,
        duration_ms: 100,
      });
      bridge.ocrResults.insert({
        job_id: jobId,
        page_index: 1,
        total_words: 2,
        low_confidence_words: 0,
        mean_confidence: 90,
        words_json: JSON.stringify([
          {
            text: 'page1a',
            confidence: 90,
            imgRect: { x0: 0, y0: 0, x1: 5, y1: 5 },
            pdfRect: null,
          },
          {
            text: 'page1b',
            confidence: 90,
            imgRect: { x0: 5, y0: 0, x1: 10, y1: 5 },
            pdfRect: null,
          },
        ]),
        img_width_px: 1700,
        img_height_px: 2200,
        duration_ms: 100,
      });
      const pages = bridge.ocrResults.listPageResultsByJobId(jobId);
      expect(pages.length).toBe(2);
      expect(pages[0]?.pageIndex).toBe(0);
      expect(pages[0]?.words.length).toBe(1);
      expect(pages[0]?.words[0]?.text).toBe('page0');
      expect(pages[1]?.words.length).toBe(2);
    });
  });

  // ==========================================================================
  // signatureAudit — drift class: insert returns discriminated union;
  // markInvalidatedByOcrJob has the (docHash, fieldNames) → (rowIds)
  // resolution shift.
  // ==========================================================================

  describe('signatureAudit adapter', () => {
    function makeInsertInput(overrides: { doc_hash?: string; field_name?: string | null } = {}) {
      return {
        doc_hash: overrides.doc_hash ?? DOC_HASH,
        pre_sign_doc_hash: PRE_SIGN_HASH,
        signed_at: 1_716_307_200_000,
        signature_kind: 'pades' as const,
        signed_by_fingerprint: FINGERPRINT,
        signed_by_subject_cn: 'Ada',
        signed_by_issuer_cn: 'CA',
        cert_not_before: 1_000_000_000_000,
        cert_not_after: 2_000_000_000_000,
        tsa_url: null,
        tsa_response_status: null,
        sig_bytes_offset: null,
        sig_bytes_length: null,
        byte_range_json: JSON.stringify([0, 100, 300, 400]),
        reason: 'test',
        location: 'here',
        field_name: overrides.field_name === undefined ? 'SigField1' : overrides.field_name,
      };
    }

    it('insert + get round-trips, unwrapping the discriminated union to a number', () => {
      const id = bridge.signatureAudit.insert(makeInsertInput());
      expect(id).toBeGreaterThan(0);
      const got = bridge.signatureAudit.get(id);
      expect(got).not.toBeNull();
      expect(got?.docHash).toBe(DOC_HASH);
      expect(got?.fieldName).toBe('SigField1');
      expect(got?.byteRange).toEqual([0, 100, 300, 400]);
    });

    it('listAll filters + returns {items, total}', () => {
      bridge.signatureAudit.insert(makeInsertInput());
      bridge.signatureAudit.insert(
        makeInsertInput({ doc_hash: DOC_HASH_2, field_name: 'SigField2' }),
      );
      const all = bridge.signatureAudit.listAll({}, 100, 0);
      expect(all.total).toBe(2);
      const filtered = bridge.signatureAudit.listAll({ fileHash: DOC_HASH }, 100, 0);
      expect(filtered.total).toBe(1);
      expect(filtered.items[0]?.fieldName).toBe('SigField1');
    });

    it('markInvalidatedByOcrJob resolves (docHash, fieldNames) → rowIds → marks rows', () => {
      // Two sig rows on DOC_HASH with field names sigA / sigB; one row on DOC_HASH_2.
      bridge.signatureAudit.insert(makeInsertInput({ field_name: 'sigA' }));
      // Use distinct sig_bytes_offset to avoid UNIQUE-on-(doc_hash, sig_bytes_offset).
      const inputB = makeInsertInput({ field_name: 'sigB' });
      inputB.sig_bytes_offset = 200;
      bridge.signatureAudit.insert(inputB);
      bridge.signatureAudit.insert(makeInsertInput({ doc_hash: DOC_HASH_2, field_name: 'sigC' }));

      // Insert an OCR job to satisfy any FK on invalidated_by_ocr_job_id.
      const ocrJobId = bridge.ocrJobs.insert({
        doc_hash: DOC_HASH,
        page_range_start: 0,
        page_range_end: 0,
        langs: 'eng',
        preprocess_json: '{}',
        status: 'completed',
        started_at: 1_716_307_200_000,
        invalidated_signatures: 1,
      });

      const marked = bridge.signatureAudit.markInvalidatedByOcrJob(
        DOC_HASH,
        ['sigA', 'sigB'],
        ocrJobId,
      );
      expect(marked).toBe(2);

      // Empty field names → 0 rows.
      const none = bridge.signatureAudit.markInvalidatedByOcrJob(DOC_HASH, [], ocrJobId);
      expect(none).toBe(0);
    });
  });

  // ==========================================================================
  // languagePacks — drift class: remove returns discriminated; touchLastUsed
  // returns boolean (adapter swallows). upsert accepts optional last_used_at.
  // ==========================================================================

  describe('languagePacks adapter', () => {
    it('upsert + list + get round-trips', () => {
      bridge.languagePacks.upsert({
        lang: 'eng',
        source: 'downloaded',
        file_path: 'C:/tessdata/eng.traineddata',
        size_bytes: 1024,
        sha256: 'e'.repeat(64),
        installed_at: 1_716_307_200_000,
        last_used_at: null,
      });
      const list = bridge.languagePacks.list();
      expect(list.length).toBe(1);
      expect(list[0]?.lang).toBe('eng');
      expect(list[0]?.filePath).toBe('C:/tessdata/eng.traineddata');

      const got = bridge.languagePacks.get('eng');
      expect(got?.source).toBe('downloaded');
    });

    it('remove unwraps discriminated → boolean (true for downloaded)', () => {
      bridge.languagePacks.upsert({
        lang: 'fra',
        source: 'downloaded',
        file_path: 'C:/tessdata/fra.traineddata',
        size_bytes: 2048,
        sha256: 'f'.repeat(64),
        installed_at: 1_716_307_200_000,
        last_used_at: null,
      });
      expect(bridge.languagePacks.remove('fra')).toBe(true);
      expect(bridge.languagePacks.remove('fra')).toBe(false); // not_found → false
    });

    it('remove bundled → false (the bundled_protected variant collapses to boolean false)', () => {
      bridge.languagePacks.upsert({
        lang: 'eng',
        source: 'bundled',
        file_path: 'C:/tessdata/eng.traineddata',
        size_bytes: 1024,
        sha256: 'e'.repeat(64),
        installed_at: 1_716_307_200_000,
        last_used_at: null,
      });
      expect(bridge.languagePacks.remove('eng')).toBe(false);
      // Still present.
      expect(bridge.languagePacks.get('eng')).not.toBeNull();
    });

    it('touchLastUsed updates last_used_at (boolean return swallowed)', () => {
      bridge.languagePacks.upsert({
        lang: 'eng',
        source: 'downloaded',
        file_path: 'C:/tessdata/eng.traineddata',
        size_bytes: 1024,
        sha256: 'e'.repeat(64),
        installed_at: 1_716_307_200_000,
        last_used_at: null,
      });
      bridge.languagePacks.touchLastUsed('eng', 1_716_307_300_000);
      const got = bridge.languagePacks.get('eng');
      expect(got?.lastUsedAt).toBe(1_716_307_300_000);
    });
  });

  // ==========================================================================
  // formTemplates — no known drift in Phase 7.2; included for completeness.
  // The adapter mirrors Ravi's signature 1:1.
  // ==========================================================================

  describe('formTemplates adapter', () => {
    it('save + get + list round-trips', () => {
      const saved = bridge.formTemplates.save({
        name: 'invoice-v1',
        fields: [
          {
            id: 'name',
            kind: 'text',
            label: 'Name',
            rect: { page: 0, x: 0, y: 0, width: 100, height: 20 },
          },
        ] as Parameters<FormTemplatesRepo['save']>[0]['fields'],
      });
      expect(saved.ok).toBe(true);
      if (!saved.ok) throw new Error('unreachable');

      const got = bridge.formTemplates.get(saved.id);
      expect(got?.name).toBe('invoice-v1');
      expect(got?.fields.length).toBe(1);

      const list = bridge.formTemplates.list();
      expect(list.length).toBe(1);
      expect(list[0]?.fieldCount).toBe(1);
    });

    it('save surfaces name_in_use on duplicate', () => {
      const a = bridge.formTemplates.save({ name: 'dup', fields: [] });
      expect(a.ok).toBe(true);
      const b = bridge.formTemplates.save({ name: 'dup', fields: [] });
      expect(b.ok).toBe(false);
      if (b.ok) throw new Error('unreachable');
      expect(b.error).toBe('name_in_use');
    });
  });

  // ==========================================================================
  // exportJobs — the SECOND-largest drift class. Real repo has no listAll;
  // adapter emulates via {listByDocHash, listByStatus, listRecent,
  // listInProgress} + in-memory filter. Real updateProgress takes object
  // input, not positional args.
  // ==========================================================================

  describe('exportJobs adapter', () => {
    function makeInsertRow(
      overrides: { doc_hash?: string; format?: 'docx' | 'xlsx' | 'png' } = {},
    ) {
      const format = overrides.format ?? 'docx';
      const isImage = format === 'png';
      return {
        doc_hash: overrides.doc_hash ?? DOC_HASH,
        format,
        quality_tier: (isImage ? 'n/a' : 'text-only') as 'text-only' | 'layout-preserving' | 'n/a',
        page_range_start: 0,
        page_range_end: 0,
        include_annotations: 0 as 0 | 1,
        dpi: isImage ? 300 : null,
        jpeg_quality: null,
        multi_page_tiff: null,
        output_path: 'C:/out/file.docx',
        status: 'queued' as const,
        started_at: 1_716_307_200_000,
      };
    }

    it('insert + listAll round-trips', () => {
      const id = bridge.exportJobs.insert(makeInsertRow());
      expect(id).toBeGreaterThan(0);
      const all = bridge.exportJobs.listAll({}, 100, 0);
      expect(all.total).toBe(1);
      expect(all.items.length).toBe(1);
    });

    it('listAll filters by docHash + format independently', () => {
      bridge.exportJobs.insert(makeInsertRow());
      bridge.exportJobs.insert(makeInsertRow({ format: 'xlsx' }));
      bridge.exportJobs.insert(makeInsertRow({ doc_hash: DOC_HASH_2 }));

      const byDoc = bridge.exportJobs.listAll({ docHash: DOC_HASH }, 100, 0);
      expect(byDoc.total).toBe(2);

      const byFormat = bridge.exportJobs.listAll({ format: 'xlsx' }, 100, 0);
      expect(byFormat.total).toBe(1);
      // In-memory filter intersection: docHash AND format.
      const both = bridge.exportJobs.listAll({ docHash: DOC_HASH, format: 'xlsx' }, 100, 0);
      expect(both.total).toBe(1);
    });

    it('listAll status="queued"|"running" uses listInProgress under the hood; status="completed" uses listByStatus', () => {
      const queuedId = bridge.exportJobs.insert(makeInsertRow());
      bridge.exportJobs.updateStatus(queuedId, { status: 'running' });
      const completedId = bridge.exportJobs.insert(makeInsertRow({ doc_hash: DOC_HASH_2 }));
      bridge.exportJobs.updateStatus(completedId, { status: 'running' });
      bridge.exportJobs.updateStatus(completedId, {
        status: 'completed',
        completed_at: 1_716_307_205_000,
        duration_ms: 5000,
      });

      const inProgress = bridge.exportJobs.listAll({ status: 'running' }, 100, 0);
      expect(inProgress.total).toBe(1);

      const done = bridge.exportJobs.listAll({ status: 'completed' }, 100, 0);
      expect(done.total).toBe(1);
    });

    it('updateProgress with extras maps to Ravi object input', () => {
      const id = bridge.exportJobs.insert(makeInsertRow());
      bridge.exportJobs.updateStatus(id, { status: 'running' });
      bridge.exportJobs.updateProgress(id, 3, {
        paragraphsExtracted: 12,
        tablesDetected: 1,
        imagesEmbedded: 2,
        outputSizeBytes: 9999,
      });
      const row = bridge.exportJobs.get(id) as {
        pages_processed: number;
        paragraphs_extracted: number | null;
        tables_detected: number | null;
        images_embedded: number | null;
        output_size_bytes: number | null;
      } | null;
      expect(row).not.toBeNull();
      expect(row?.pages_processed).toBe(3);
      expect(row?.paragraphs_extracted).toBe(12);
      expect(row?.tables_detected).toBe(1);
      expect(row?.images_embedded).toBe(2);
      expect(row?.output_size_bytes).toBe(9999);
    });
  });

  // ==========================================================================
  // recents + bookmarks + settings — no drift in Phase 7.2; smoke them
  // through the same harness to widen the catch surface.
  // ==========================================================================

  describe('recents/bookmarks/settings (no-drift smoke)', () => {
    it('recents upsert + list', () => {
      bridge.recents.upsert({
        path: 'C:/a.pdf',
        displayName: 'a.pdf',
        fileHash: 'h'.repeat(64),
        lastOpenedAt: 1_716_307_200_000,
      });
      const list = bridge.recents.list(10);
      expect(list.length).toBe(1);
      expect(list[0]?.displayName).toBe('a.pdf');
    });

    it('bookmarks upsert + listByFile + delete', () => {
      const fh = 'h'.repeat(64);
      const id = bridge.bookmarks.upsert({ fileHash: fh, pageIndex: 0, title: 'cover' });
      expect(id).toBeGreaterThan(0);
      expect(bridge.bookmarks.listByFile(fh).length).toBe(1);
      expect(bridge.bookmarks.delete(id)).toBe(true);
    });

    it('settings set + get round-trips for a known Phase-1 key', () => {
      bridge.settings.set('theme', 'dark');
      expect(bridge.settings.get('theme')).toBe('dark');
    });
  });
});
