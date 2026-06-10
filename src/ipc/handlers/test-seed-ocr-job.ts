// Handler: __test:seedOcrJob (Phase 7.1, David, 2026-06-05)
//
// STRUCTURAL GATE — read this FIRST:
//
//   `registerTestSeedOcrJob(...)` is the ONLY entry point. It checks
//   `process.env.NODE_ENV === 'test'` at REGISTRATION time and EARLY-RETURNS
//   in any other environment. The IPC channel `__test:seedOcrJob` is never
//   `ipcMain.handle`-d in production — there is nothing for a hostile
//   renderer to invoke. This is the strongest form of gating: the channel
//   does not exist in the prod IPC surface at all. A runtime guard INSIDE
//   the handler would still leak the channel name; the registration-time
//   guard prevents even that.
//
// See `docs/phase-7.1-test-design.md §3` for design rationale and the
// `__test:seedOcrJob` contract in `src/ipc/contracts.ts` for shapes.
//
// L-004 / L-005 compliance (phase-7.1-test-design §6.2): this module does NOT
// load pdf.js, does NOT rasterize, does NOT call `pdfjs.getDocument`. It reads
// fixture bytes via `node:fs` and computes a SHA-256 docHash with `node:crypto`
// — the bytes never reach pdf.js. Julian's Wave-3 grep on `pdfjs|getDocument|
// pdf-lib` against this file must return zero matches.

import { createHash } from 'node:crypto';
import { promises as fsPromises } from 'node:fs';

import type { IpcMain } from 'electron';
import { z } from 'zod';

import type { OcrJobsRepoBridge, OcrResultsRepoBridge } from '../../main/db-bridge.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import { Channels } from '../contracts.js';
import type {
  TestSeedOcrJobError,
  TestSeedOcrJobRequest,
  TestSeedOcrJobResponse,
} from '../contracts.js';

export interface TestSeedOcrJobDeps {
  ocrJobsRepo: OcrJobsRepoBridge | null;
  ocrResultsRepo: OcrResultsRepoBridge | null;
  /** Injectable clock for deterministic timestamps under test. Defaults to Date.now. */
  now?: () => number;
}

// Zod schema mirrors `TestSeedOcrJobRequest`. We keep `words` as a passthrough
// `unknown[]` and trust the spec to supply well-formed OcrWord rows — the
// canonical Phase 7.1 run uses status='queued' so seededResults is absent.
const wordSchema = z
  .object({
    text: z.string(),
    confidence: z.number(),
    imgRect: z.object({
      x0: z.number(),
      y0: z.number(),
      x1: z.number(),
      y1: z.number(),
    }),
    pdfRect: z.unknown().nullable(),
  })
  .passthrough();

const requestSchema = z.object({
  fixturePath: z.string().min(1),
  status: z.enum(['queued', 'completed']),
  langs: z.array(z.string().min(1)).min(1),
  seededResults: z
    .array(
      z.object({
        pageIndex: z.number().int().nonnegative(),
        totalWords: z.number().int().nonnegative(),
        lowConfidenceWords: z.number().int().nonnegative(),
        meanConfidence: z.number(),
        words: z.array(wordSchema),
        imgDimsPx: z.object({
          widthPx: z.number().int().positive(),
          heightPx: z.number().int().positive(),
        }),
        durationMs: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  pageRange: z
    .object({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .optional(),
  preprocess: z
    .object({
      deskew: z.boolean(),
      denoise: z.boolean(),
      contrastBoost: z.boolean(),
    })
    .optional(),
});

/**
 * Pure handler — extracted from the IPC plumbing so the unit test in
 * `test-seed-ocr-job.test.ts` (Diego's domain in Wave 3) can exercise the
 * insert paths without spinning up an IpcMain.
 */
export async function handleTestSeedOcrJob(
  req: unknown,
  deps: TestSeedOcrJobDeps,
): Promise<TestSeedOcrJobResponse> {
  const parsed = requestSchema.safeParse(req ?? {});
  if (!parsed.success) {
    return fail<TestSeedOcrJobError>('invalid_payload', parsed.error.message);
  }
  const data = parsed.data;
  if (
    data.status === 'completed' &&
    (data.seededResults === undefined || data.seededResults.length === 0)
  ) {
    return fail<TestSeedOcrJobError>(
      'invalid_payload',
      "status='completed' requires non-empty seededResults",
    );
  }
  if (!deps.ocrJobsRepo) {
    return fail<TestSeedOcrJobError>('db_unavailable', 'ocr_jobs repo not wired');
  }

  // Read fixture bytes for docHash. We intentionally avoid pdf.js / pdf-lib —
  // the hash is taken straight from disk bytes (L-004/L-005 compliance).
  let bytes: Buffer;
  try {
    bytes = await fsPromises.readFile(data.fixturePath);
  } catch (e) {
    return fail<TestSeedOcrJobError>(
      'fixture_not_found',
      safeMessage(e, `fixture not found: ${data.fixturePath}`),
      { fixturePath: data.fixturePath },
    );
  }
  const docHash = createHash('sha256').update(bytes).digest('hex');

  const clock = deps.now ?? ((): number => Date.now());
  const pageRange = data.pageRange ?? { start: 0, end: 0 };
  const preprocess = data.preprocess ?? {
    deskew: false,
    denoise: false,
    contrastBoost: false,
  };
  const startedAt = clock();

  let jobId: number;
  try {
    jobId = deps.ocrJobsRepo.insert({
      doc_hash: docHash,
      page_range_start: pageRange.start,
      page_range_end: pageRange.end,
      langs: data.langs.join('+'),
      preprocess_json: JSON.stringify(preprocess),
      status: data.status === 'completed' ? 'running' : 'queued',
      started_at: startedAt,
      invalidated_signatures: 0,
    });
  } catch (e) {
    return fail<TestSeedOcrJobError>(
      'db_insert_failed',
      safeMessage(e, 'failed to insert ocr_jobs row'),
    );
  }

  if (data.status === 'completed' && data.seededResults !== undefined) {
    let totalWords = 0;
    let weightedConfidenceSum = 0;
    try {
      for (const pr of data.seededResults) {
        if (deps.ocrResultsRepo) {
          deps.ocrResultsRepo.insert({
            job_id: jobId,
            page_index: pr.pageIndex,
            total_words: pr.totalWords,
            low_confidence_words: pr.lowConfidenceWords,
            mean_confidence: pr.meanConfidence,
            words_json: JSON.stringify(pr.words),
            img_width_px: pr.imgDimsPx.widthPx,
            img_height_px: pr.imgDimsPx.heightPx,
            duration_ms: pr.durationMs,
          });
        }
        totalWords += pr.totalWords;
        weightedConfidenceSum += pr.meanConfidence * pr.totalWords;
      }
      const meanConfidence = totalWords > 0 ? weightedConfidenceSum / totalWords : 0;
      deps.ocrJobsRepo.updateStatus(jobId, {
        status: 'completed',
        completed_at: clock(),
        mean_confidence: meanConfidence,
        total_words: totalWords,
      });
    } catch (e) {
      return fail<TestSeedOcrJobError>(
        'db_insert_failed',
        safeMessage(e, 'failed to insert ocr_results row'),
      );
    }
  }

  return ok({ jobId, docHash });
}

/**
 * Register the test-only seed channel — IFF NODE_ENV === 'test'.
 *
 * The early-return below IS the structural gate. Production builds never
 * `ipcMain.handle(__test:seedOcrJob, ...)`, so the channel is absent from
 * the IPC surface. Do not move the env check inside the handler — losing the
 * registration-time gate weakens the L-006-class invariant Riley specified.
 */
export function registerTestSeedOcrJob(opts: { ipcMain: IpcMain; deps: TestSeedOcrJobDeps }): void {
  // Dot syntax (not bracket) is load-bearing for the prod-build define-fold
  // in `electron.vite.config.ts`. See the matching comment in
  // `src/ipc/handlers/test-which-bridge.ts:registerTestWhichBridge` and
  // Julian's Phase 7.2 re-review §8 for the full rationale.
  if (process.env.NODE_ENV !== 'test') return;
  opts.ipcMain.handle(Channels.TestSeedOcrJob, (_evt, payload: unknown) =>
    handleTestSeedOcrJob(payload as TestSeedOcrJobRequest, opts.deps),
  );
}
