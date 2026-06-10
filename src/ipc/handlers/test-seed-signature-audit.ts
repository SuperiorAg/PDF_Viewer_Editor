// Handler: __test:seedSignatureAudit (Phase 7.2 7.2.4, Diego, 2026-06-10)
//
// STRUCTURAL GATE — read this FIRST:
//
//   `registerTestSeedSignatureAudit(...)` is the ONLY entry point. It checks
//   `process.env.NODE_ENV === 'test'` at REGISTRATION time and EARLY-RETURNS
//   in any other environment. The IPC channel `__test:seedSignatureAudit` is
//   never `ipcMain.handle`-d in production — there is nothing for a hostile
//   renderer to invoke. This is the strongest form of gating: the channel
//   does not exist in the prod IPC surface at all. A runtime guard INSIDE
//   the handler would still leak the channel name; the registration-time
//   guard prevents even that. Mirrors the `__test:seedOcrJob` /
//   `__test:whichBridge` pattern verbatim.
//
// What this handler does:
//   Inserts a single row into `signature_audit_log` keyed by (docHash,
//   fieldName). The e2e at `tests/e2e/signed-pdf-ocr-invalidation.spec.ts`
//   uses this BEFORE running OCR so the production OCR handler — which
//   computes `signedFields` from `detectPriorPadesSignatures(doc)` and then
//   calls `signatureAudit.markInvalidatedByOcrJob(docHash, signedFields,
//   jobId)` — has a real row to resolve and mark. Without the seed, the
//   bridge adapter's `(docHash, fieldNames) → rowIds` resolution returns an
//   empty set and the test would assert against zero affected rows.
//
//   This dodges the cert-store + UI-driven PAdES sign path (which is not
//   exercisable from a Playwright `_electron.launch()` harness without
//   mocking the file dialog). The OCR invalidation back-ref code path
//   itself runs exactly as it does in production.
//
// L-006 compliance:
//   The early-return below uses DOT-SYNTAX `process.env.NODE_ENV` (not the
//   bracket form). Vite's `define` config in `electron.vite.config.ts`
//   constant-folds the dot form to the literal `"production"` in prod-mode
//   builds; Rollup then collapses `if ("production" !== "test") return;` to
//   `if (true) return;` and dead-code-eliminates the channel-name string +
//   handler body from `dist/main/index.js`. The bracket form does NOT match
//   Vite's define key and would leak the channel into the prod bundle. See
//   `src/ipc/handlers/test-which-bridge.ts` and Julian's re-review §8 in
//   `docs/code-review.md` for the full rationale.
//
// L-004 / L-005 compliance: this module does NOT load pdf.js, does NOT
// rasterize, does NOT call `pdfjs.getDocument`. It writes a single DB row
// via the signature_audit_log repo bridge.

import type { IpcMain } from 'electron';
import { z } from 'zod';

import type { SignatureAuditRepoBridge } from '../../main/db-bridge.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import { Channels } from '../contracts.js';
import type {
  TestSeedSignatureAuditError,
  TestSeedSignatureAuditRequest,
  TestSeedSignatureAuditResponse,
} from '../contracts.js';

export interface TestSeedSignatureAuditDeps {
  signatureAuditRepo: SignatureAuditRepoBridge | null;
  /** Injectable clock for deterministic timestamps under test. Defaults to Date.now. */
  now?: () => number;
}

const requestSchema = z.object({
  docHash: z.string().min(1),
  fieldName: z.string().min(1),
  signatureKind: z.enum(['pades', 'pades-tsa']).optional(),
});

/**
 * Pure handler — extracted from the IPC plumbing so the unit test (or any
 * future caller) can exercise the insert path without spinning up an IpcMain.
 */
export async function handleTestSeedSignatureAudit(
  req: unknown,
  deps: TestSeedSignatureAuditDeps,
): Promise<TestSeedSignatureAuditResponse> {
  const parsed = requestSchema.safeParse(req ?? {});
  if (!parsed.success) {
    return fail<TestSeedSignatureAuditError>('invalid_payload', parsed.error.message);
  }
  if (!deps.signatureAuditRepo) {
    return fail<TestSeedSignatureAuditError>('db_unavailable', 'signature_audit repo not wired');
  }

  const data = parsed.data;
  const clock = deps.now ?? ((): number => Date.now());
  const signedAt = clock();

  let rowId: number;
  try {
    rowId = deps.signatureAuditRepo.insert({
      doc_hash: data.docHash,
      // pre_sign_doc_hash is required by the schema; the e2e doesn't care
      // about the verify-flow back-pointer here, so we reuse docHash. The
      // production sign engine sets these to different values (pre-sign vs
      // post-sign) but the audit-row read paths the e2e exercises don't
      // filter on pre_sign_doc_hash.
      pre_sign_doc_hash: data.docHash,
      signed_at: signedAt,
      signature_kind: data.signatureKind ?? 'pades',
      // Real signer metadata is irrelevant for the OCR back-ref e2e; the
      // bridge adapter resolves rows by (doc_hash, field_name), not by
      // signer identity. Synthetic values keep the row valid and grep-able.
      signed_by_fingerprint: 'a'.repeat(64),
      signed_by_subject_cn: 'PDF_Viewer_Editor Test Signer',
      signed_by_issuer_cn: 'PDF_Viewer_Editor Test Signer',
      cert_not_before: signedAt - 24 * 3600 * 1000,
      cert_not_after: signedAt + 365 * 24 * 3600 * 1000,
      tsa_url: null,
      tsa_response_status: null,
      // Non-null sig_bytes_offset / sig_bytes_length keeps the row shape
      // identical to a real PAdES insert. The values are nominal — neither
      // the bridge adapter's mark path nor the e2e assertions read them.
      sig_bytes_offset: 1024,
      sig_bytes_length: 8192,
      byte_range_json: JSON.stringify([0, 1024, 9216, 4096]),
      reason: 'Phase 7.2 7.2.4 e2e seed',
      location: null,
      field_name: data.fieldName,
    });
  } catch (e) {
    return fail<TestSeedSignatureAuditError>(
      'db_insert_failed',
      safeMessage(e, 'failed to insert signature_audit_log row'),
    );
  }

  return ok({ rowId });
}

/**
 * Register the test-only seed channel — IFF NODE_ENV === 'test'.
 *
 * The early-return below IS the structural gate. Production builds never
 * `ipcMain.handle(__test:seedSignatureAudit, ...)`, so the channel is absent
 * from the IPC surface. Do not move the env check inside the handler — losing
 * the registration-time gate weakens the L-006 invariant Julian locked.
 */
export function registerTestSeedSignatureAudit(opts: {
  ipcMain: IpcMain;
  deps: TestSeedSignatureAuditDeps;
}): void {
  // Dot syntax (not bracket) is load-bearing for the prod-build define-fold
  // in `electron.vite.config.ts`. See the matching comment in
  // `src/ipc/handlers/test-which-bridge.ts:registerTestWhichBridge` and
  // Julian's Phase 7.2 re-review §8 for the full rationale. L-006 lock.
  if (process.env.NODE_ENV !== 'test') return;
  opts.ipcMain.handle(Channels.TestSeedSignatureAudit, (_evt, payload: unknown) =>
    handleTestSeedSignatureAudit(payload as TestSeedSignatureAuditRequest, opts.deps),
  );
}
