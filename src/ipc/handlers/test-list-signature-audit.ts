// Handler: __test:listSignatureAudit (Phase 7.2 7.2.4, Diego, 2026-06-10)
//
// STRUCTURAL GATE — read this FIRST:
//
//   `registerTestListSignatureAudit(...)` is the ONLY entry point. It checks
//   `process.env.NODE_ENV === 'test'` at REGISTRATION time and EARLY-RETURNS
//   in any other environment. The IPC channel `__test:listSignatureAudit` is
//   never `ipcMain.handle`-d in production — there is nothing for a hostile
//   renderer to invoke. Same registration-time gate as the other `__test:*`
//   channels in this directory.
//
// What this handler does:
//   Returns a flat slice of every `signature_audit_log` row matching a given
//   docHash, exposing only the columns the e2e at
//   `tests/e2e/signed-pdf-ocr-invalidation.spec.ts` asserts on:
//
//     - id                       — for cross-reference with the seed result
//     - docHash                  — sanity check the filter took
//     - fieldName                — confirms the bridge adapter's resolver matched
//     - invalidatedByOcrJobId    — THE assertion target: null pre-OCR, equal
//                                  to the new ocrJob.id post-OCR
//
// Why a dedicated channel instead of `signatures:listAudit`: the production
// channel projects to a camelCase DTO (`SignatureAuditRowDto`) that exposes
// `invalidatedByOcrJobId` — but the camelCase DTO also requires the full
// audit-list pagination payload (filters object, limit/offset). For an e2e
// the flat slice is cheaper to consume AND keeps the test's intent obvious.
//
// L-006 compliance:
//   Dot-syntax `process.env.NODE_ENV` gate (NOT bracket form) so Vite's
//   prod-mode define-fold can DCE the channel-name string + handler body
//   from `dist/main/index.js`. See `src/ipc/handlers/test-which-bridge.ts`
//   and Julian's re-review §8 for the rationale.
//
// L-004 / L-005 compliance: this module does NOT load pdf.js, does NOT
// rasterize. It reads DB rows via the signature_audit_log repo bridge.

import type { IpcMain } from 'electron';
import { z } from 'zod';

import type { SignatureAuditRepoBridge } from '../../main/db-bridge.js';
import { fail, ok } from '../../shared/result.js';
import { Channels } from '../contracts.js';
import type {
  TestListSignatureAuditError,
  TestListSignatureAuditRequest,
  TestListSignatureAuditResponse,
  TestSignatureAuditRowSlice,
} from '../contracts.js';

export interface TestListSignatureAuditDeps {
  signatureAuditRepo: SignatureAuditRepoBridge | null;
}

const requestSchema = z.object({
  docHash: z.string().min(1),
});

/**
 * Pure handler — extracted from the IPC plumbing so the unit test (or any
 * future caller) can exercise the read path without spinning up an IpcMain.
 */
export async function handleTestListSignatureAudit(
  req: unknown,
  deps: TestListSignatureAuditDeps,
): Promise<TestListSignatureAuditResponse> {
  const parsed = requestSchema.safeParse(req ?? {});
  if (!parsed.success) {
    return fail<TestListSignatureAuditError>('invalid_payload', parsed.error.message);
  }
  if (!deps.signatureAuditRepo) {
    return fail<TestListSignatureAuditError>('db_unavailable', 'signature_audit repo not wired');
  }

  const dtos = deps.signatureAuditRepo.listByDocHash(parsed.data.docHash);
  // The DTO already projects snake_case → camelCase + carries the
  // `invalidatedByOcrJobId` column added to SignatureAuditRowDto in
  // Phase 7.2 7.2.4. We just slice the four columns the e2e needs.
  const rows: TestSignatureAuditRowSlice[] = dtos.map((dto) => ({
    id: dto.id,
    docHash: dto.docHash,
    fieldName: dto.fieldName,
    invalidatedByOcrJobId: dto.invalidatedByOcrJobId,
  }));
  return ok({ rows });
}

/**
 * Register the test-only readback channel — IFF NODE_ENV === 'test'.
 *
 * The early-return below IS the structural gate. Production builds never
 * `ipcMain.handle(__test:listSignatureAudit, ...)`, so the channel is absent
 * from the IPC surface. Do not move the env check inside the handler — losing
 * the registration-time gate weakens the L-006 invariant Julian locked.
 */
export function registerTestListSignatureAudit(opts: {
  ipcMain: IpcMain;
  deps: TestListSignatureAuditDeps;
}): void {
  // Dot syntax (not bracket) is load-bearing for the prod-build define-fold
  // in `electron.vite.config.ts`. See the matching comment in
  // `src/ipc/handlers/test-which-bridge.ts:registerTestWhichBridge` and
  // Julian's Phase 7.2 re-review §8 for the full rationale. L-006 lock.
  if (process.env.NODE_ENV !== 'test') return;
  opts.ipcMain.handle(Channels.TestListSignatureAudit, (_evt, payload: unknown) =>
    handleTestListSignatureAudit(payload as TestListSignatureAuditRequest, opts.deps),
  );
}
