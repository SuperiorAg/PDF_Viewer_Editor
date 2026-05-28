// Handler: forms:runMailMerge (Phase 3, api-contracts.md §13.9)
// Companion: forms:cancelMailMerge (§13.10.1)
//
// Long-running. Spawns the mail-merge runner (`mail-merge-runner.ts`) which
// streams `mail-merge:progress` events back to the renderer via the injected
// onProgress hook. The handler maintains a process-wide registry of active
// jobs keyed by jobId so the cancel sub-channel can flip the runner's
// cancelRequested flag.
//
// L-001 unchanged: no BrowserWindow construction; the runner is a plain
// async function in the main process context (architecture-phase-3.md §6.2).

import type { FormTemplatesRepo } from '../../main/db-bridge.js';
import { runMailMerge, type MailMergeRunDeps } from '../../main/pdf-ops/mail-merge-runner.js';
import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  FormsCancelMailMergeError,
  FormsCancelMailMergeRequest,
  FormsCancelMailMergeResponse,
  FormsRunMailMergeError,
  FormsRunMailMergeRequest,
  FormsRunMailMergeResponse,
  MailMergeProgressEvent,
} from '../contracts.js';

export interface FormsRunMailMergeDeps {
  /** Resolve the open document's bytes by handle. */
  getBytes(handle: DocumentHandle): Uint8Array | null;
  /** Resolve template bytes from a saved form_templates row. Returns the
   *  template's source PDF — but the saved row has no PDF attached, so this
   *  is null when only templateId (no templateHandle) is provided. The
   *  current open document is the supported template-source path. */
  formTemplatesRepo: FormTemplatesRepo;
  /** Write `bytes` atomically at `path`. */
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /**
   * Sanitize/validate FILE paths (concat-mode outputFile). Must enforce the
   * `.pdf` extension so a concat-mode output is always a `.pdf` file.
   *
   * Phase 3.1 (B-3.1, David): this is the original `.pdf`-only sanitizer.
   * Use `sanitizeDirectoryPath` for folder-mode outputFolder paths.
   */
  sanitizePath(raw: string): string | null;
  /**
   * Phase 3.1 (B-3.1, David): sanitize a folder-mode `outputFolder` path.
   * Runs the same hardening checks as `sanitizePath` but accepts paths with
   * NO extension OR with `.pdf` — i.e. real directory paths.
   *
   * Optional for backward compatibility: when omitted, falls back to
   * `sanitizePath` (current Wave-12 behavior). Production wiring in
   * `src/ipc/register.ts` MUST supply this to fix folder-mode mail-merge.
   */
  sanitizeDirectoryPath?(raw: string): string | null;
  /** Path join (injected so tests don't need node:path). */
  joinPath(a: string, b: string): string;
  /** Stream a progress event to the renderer (webContents.send wrapper). */
  emitProgress?(evt: MailMergeProgressEvent): void;
}

// ------------------------------------------------------------------
// Active-job registry (process-wide). Cancellation looks up the job's
// cancel flag here.
// ------------------------------------------------------------------

interface ActiveJob {
  cancelRequested: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __pdfViewerMailMergeJobs: Map<string, ActiveJob> | undefined;
}

function getRegistry(): Map<string, ActiveJob> {
  if (!globalThis.__pdfViewerMailMergeJobs) {
    globalThis.__pdfViewerMailMergeJobs = new Map();
  }
  return globalThis.__pdfViewerMailMergeJobs;
}

// ------------------------------------------------------------------
// Run
// ------------------------------------------------------------------

export async function handleFormsRunMailMerge(
  req: FormsRunMailMergeRequest,
  deps: FormsRunMailMergeDeps,
): Promise<FormsRunMailMergeResponse> {
  const job = req.job;
  if (!job || typeof job !== 'object') {
    return fail<FormsRunMailMergeError>('invalid_payload', 'job required');
  }
  if (typeof job.jobId !== 'string' || job.jobId.length === 0) {
    return fail<FormsRunMailMergeError>('invalid_payload', 'job.jobId required');
  }

  const registry = getRegistry();
  if (registry.has(job.jobId)) {
    return fail<FormsRunMailMergeError>('invalid_payload', `jobId '${job.jobId}' in flight`);
  }
  const slot: ActiveJob = { cancelRequested: false };
  registry.set(job.jobId, slot);

  // Resolve template bytes: prefer the open-document handle. templateId
  // alone is not supported in Phase 3 (the saved row stores field defs but
  // not the source PDF bytes — Phase 3.1 may add a "snapshot the template
  // PDF" feature; documented in architecture-phase-3.md §11).
  const runnerDeps: MailMergeRunDeps = {
    loadTemplateBytes: async (j) => {
      if (j.templateHandle !== null) {
        const b = deps.getBytes(j.templateHandle);
        if (!b)
          return { ok: false, error: 'handle_not_found', message: 'template handle not found' };
        return { ok: true, value: b };
      }
      if (j.templateId !== null) {
        // Saved templates carry field definitions only — there's no source
        // PDF stored. The wizard MUST supply templateHandle for the open
        // doc. Surface a recognizable failure.
        return {
          ok: false,
          error: 'template_not_found',
          message:
            'template-only mail-merge requires open template PDF (templateHandle); set it from the wizard',
        };
      }
      return {
        ok: false,
        error: 'template_not_found',
        message: 'no template specified',
      };
    },
    writeFile: deps.writeFile,
    sanitizePath: deps.sanitizePath,
    // Phase 3.1 (B-3.1, David): plumb the directory sanitizer through so
    // folder-mode mail-merge stops getting rejected on every invocation.
    ...(deps.sanitizeDirectoryPath ? { sanitizeDirectoryPath: deps.sanitizeDirectoryPath } : {}),
    joinPath: deps.joinPath,
    onProgress: deps.emitProgress
      ? (evt) => {
          deps.emitProgress?.(evt);
        }
      : () => undefined,
    isCancelled: () => slot.cancelRequested,
  };

  let result: Awaited<ReturnType<typeof runMailMerge>>;
  try {
    result = await runMailMerge(job, runnerDeps);
  } finally {
    registry.delete(job.jobId);
  }

  if (!result.ok) {
    // Map runner errors -> handler-channel errors. The unions are intentionally
    // overlapping; passthrough where possible, fall back to invalid_payload.
    const passThrough: ReadonlySet<string> = new Set([
      'invalid_payload',
      'data_parse_failed',
      'unmapped_required_field',
      'row_fill_failed',
      'output_path_invalid',
      'fs_write_failed',
    ]);
    const e = passThrough.has(result.error)
      ? (result.error as FormsRunMailMergeError)
      : ('invalid_payload' as const);
    return fail<FormsRunMailMergeError>(e, result.message);
  }
  // Cancel detection: the runner returns ok with wasCancelled=true; we keep
  // ok as the channel response (operator can read wasCancelled in the value).
  return ok(result.value);
}

// ------------------------------------------------------------------
// Cancel
// ------------------------------------------------------------------

export async function handleFormsCancelMailMerge(
  req: FormsCancelMailMergeRequest,
): Promise<FormsCancelMailMergeResponse> {
  if (typeof req.jobId !== 'string' || req.jobId.length === 0) {
    return fail<FormsCancelMailMergeError>('job_not_found', 'jobId required');
  }
  const slot = getRegistry().get(req.jobId);
  if (!slot) {
    return fail<FormsCancelMailMergeError>('job_not_found', `jobId '${req.jobId}' not active`);
  }
  slot.cancelRequested = true;
  return ok({});
}

/** Test-only reset. Drops all active jobs. */
export function _resetMailMergeJobRegistryForTests(): void {
  globalThis.__pdfViewerMailMergeJobs = new Map();
}
