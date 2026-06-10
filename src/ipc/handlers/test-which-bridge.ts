// Handler: __test:whichBridge (Phase 7.2, David, 2026-06-10)
//
// STRUCTURAL GATE — read this FIRST:
//
//   `registerTestWhichBridge(...)` is the ONLY entry point. It checks
//   `process.env.NODE_ENV === 'test'` at REGISTRATION time and EARLY-RETURNS
//   in any other environment. The IPC channel `__test:whichBridge` is never
//   `ipcMain.handle`-d in production — there is nothing for a hostile
//   renderer to invoke. This is the strongest form of gating: the channel
//   does not exist in the prod IPC surface at all. A runtime guard INSIDE
//   the handler would still leak the channel name; the registration-time
//   guard prevents even that. Mirrors the `__test:seedOcrJob` pattern
//   verbatim (`src/ipc/handlers/test-seed-ocr-job.ts`).
//
// What this handler does:
//   Returns a six-field record describing, for each Phase-3..6 repo slot in
//   `DbBridge`, whether the slot was populated with the SQLite-backed factory
//   or fell back to the in-memory bridge at `setDbBridge` time. The
//   `_electron.launch()`-driven e2e spec uses this to assert "Item A-1's
//   static-import lift in src/main/index.ts actually loads the SQLite repos
//   in dev mode" — the failure mode this Phase replaces (six dynamic
//   `require('../db/repositories/*-repo.js')` blocks falling through to the
//   memory bridge under `_electron.launch()`, which silently broke the
//   v0.7.18 reopen-restore catch surface).
//
// See `docs/phase-7.2-test-design.md §2.6` for design rationale and the
// `__test:whichBridge` contract in `src/ipc/contracts.ts` for shapes.
//
// L-004 / L-005 compliance (phase-7.2-test-design §5): this module does NOT
// load pdf.js, does NOT rasterize, does NOT call `pdfjs.getDocument`. It
// reads the bridge-tag map from db-bridge.ts and returns six string literals.
// Julian's Wave-3 grep on `pdfjs|getDocument|pdf-lib` against this file must
// return zero matches.

import type { IpcMain } from 'electron';

import type { DbBridgeKinds } from '../../main/db-bridge.js';
import { fail, ok } from '../../shared/result.js';
import { Channels } from '../contracts.js';
import type { TestWhichBridgeError, TestWhichBridgeResponse } from '../contracts.js';

export interface TestWhichBridgeDeps {
  /** Returns the per-slot SQLite/memory tag map written by `setDbBridge` at
   *  app boot, or null if `setDbBridge` was never called with kinds. */
  getKinds: () => DbBridgeKinds | null;
}

/**
 * Pure handler — extracted from the IPC plumbing so the unit test in
 * `src/main/index.test.ts` (David's domain) can exercise the
 * present-vs-absent map paths without spinning up an IpcMain.
 */
export async function handleTestWhichBridge(
  _req: unknown,
  deps: TestWhichBridgeDeps,
): Promise<TestWhichBridgeResponse> {
  const kinds = deps.getKinds();
  if (kinds === null) {
    return fail<TestWhichBridgeError>(
      'bridge_not_initialized',
      'setDbBridge was not called with kinds — bridge introspection unavailable',
    );
  }
  // Return a shallow copy so the caller cannot mutate the module-scope tag
  // map. Cheap and defensive; six fields.
  return ok({
    formTemplates: kinds.formTemplates,
    signatureAudit: kinds.signatureAudit,
    ocrJobs: kinds.ocrJobs,
    ocrResults: kinds.ocrResults,
    languagePacks: kinds.languagePacks,
    exportJobs: kinds.exportJobs,
  });
}

/**
 * Register the test-only bridge-introspection channel — IFF NODE_ENV === 'test'.
 *
 * The early-return below IS the structural gate. Production builds never
 * `ipcMain.handle(__test:whichBridge, ...)`, so the channel is absent from
 * the IPC surface. Do not move the env check inside the handler — losing the
 * registration-time gate weakens the L-006-class invariant Riley specified
 * (`docs/phase-7.2-test-design.md §4 R5`).
 */
export function registerTestWhichBridge(opts: {
  ipcMain: IpcMain;
  deps: TestWhichBridgeDeps;
}): void {
  // Dot syntax (not bracket) is load-bearing: Vite's `define` config in
  // `electron.vite.config.ts` constant-folds `process.env.NODE_ENV` -> the
  // literal `"production"` ONLY for the dot form (AST identifier-access
  // match). With this dot form, prod builds collapse the line to
  // `if ("production" !== "test") return;` -> Rollup DCE drops everything
  // below, including the channel-name string `__test:whichBridge`. The
  // bracket form `process.env['NODE_ENV']` would not match the define key
  // and the registration would leak into the prod bundle. See Julian's
  // re-review §8 in `docs/code-review.md` and the prodNodeEnvDefine comment
  // at the top of `electron.vite.config.ts`. `tsconfig.json` has
  // `noUncheckedIndexedAccess: true` so dot vs bracket return identical
  // `string | undefined` here — no type-safety change.
  if (process.env.NODE_ENV !== 'test') return;
  opts.ipcMain.handle(Channels.TestWhichBridge, (_evt, payload: unknown) =>
    handleTestWhichBridge(payload, opts.deps),
  );
}
