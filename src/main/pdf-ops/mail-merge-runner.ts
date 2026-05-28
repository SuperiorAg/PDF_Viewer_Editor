// Phase 3 Mail-Merge Runner.
//
// Contract: `docs/form-engine.md §6`. Architecture: `architecture-phase-3.md §6`.
// Convention: `docs/conventions.md §14.4` (mail-merge BYPASSES the EditOperation
// funnel — it produces N output PDFs directly without touching dirtyOps).
//
// L-001 unchanged: this module does NOT construct any BrowserWindow. The
// runner is a plain async function running inside the main IPC handler's
// process context (architecture-phase-3.md §6.2).
//
// Pure(-ish): the runner DOES write output files, but it owns no state
// across invocations; an injected `writeFile` is the only side effect. All
// pdf-lib work is pure over the template + per-row values.

import { PDFDocument } from 'pdf-lib';

import type {
  FormFieldDefinition,
  FormFieldType,
  FormFieldValue,
  MailMergeDataSource,
  MailMergeJob,
  MailMergeOutputMode,
  MailMergeProgressEvent,
} from '../../ipc/contracts.js';
import type { Result } from '../../shared/result.js';
import { fail, ok } from '../../shared/result.js';

import { parseDataSource } from './csv-excel-parser.js';
import { fillForm } from './form-engine.js';

export type MailMergeRunError =
  | 'invalid_payload'
  | 'data_parse_failed'
  | 'unmapped_required_field'
  | 'row_fill_failed'
  | 'output_path_invalid'
  | 'fs_write_failed';

export interface MailMergeRunOk {
  jobId: string;
  outputPath: string | null;
  rowsWritten: number;
  totalRows: number;
  wasCancelled: boolean;
  warnings: string[];
}

export type MailMergeRunResult = Result<MailMergeRunOk, MailMergeRunError>;

export interface MailMergeRunDeps {
  /** Resolve the template bytes given the job's templateHandle / templateId. */
  loadTemplateBytes: (
    job: MailMergeJob,
  ) => Promise<Result<Uint8Array, 'handle_not_found' | 'template_not_found'>>;
  /** Atomic-rename write: caller decides folder vs file path resolution. */
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  /**
   * Sanitize / validate an output FILE path (concat-mode outputFile). Returns
   * the canonical absolute path or `null` if rejected. The injected fn must
   * enforce `.pdf` extension so concat outputs are always `.pdf` files.
   */
  sanitizePath: (raw: string) => string | null;
  /**
   * Phase 3.1 (B-3.1, David): sanitize / validate an output DIRECTORY path
   * (folder-mode outputFolder). Returns the canonical absolute path or `null`
   * if rejected. The injected fn must allow paths with NO extension (a
   * directory is not a `.pdf` file) while still running the rest of the
   * hardening checks (control chars, traversal, UNC, reserved DOS names...).
   *
   * Optional: when omitted, the runner falls back to `sanitizePath` for
   * backward compatibility — but production folder-mode mail-merge REQUIRES
   * this dep, otherwise every directory path is rejected as
   * `output_path_invalid` (the production bug B-3.1).
   */
  sanitizeDirectoryPath?: (raw: string) => string | null;
  /** Join two path segments using the host path separator. */
  joinPath: (a: string, b: string) => string;
  /** Optional progress reporter; runner emits monotonically increasing percents. */
  onProgress?: (evt: MailMergeProgressEvent) => void;
  /** Optional cancellation token; runner checks before each row. */
  isCancelled?: () => boolean;
}

const DEFAULT_FILENAME_TEMPLATE = 'merged-{rowIndex:04}.pdf';

export async function runMailMerge(
  job: MailMergeJob,
  deps: MailMergeRunDeps,
): Promise<MailMergeRunResult> {
  // ---- Validate the job shape -------------------------------------------
  if (!job || typeof job.jobId !== 'string' || job.jobId.length === 0) {
    return fail<MailMergeRunError>('invalid_payload', 'job.jobId must be a non-empty string');
  }
  if (job.templateHandle === null && job.templateId === null) {
    return fail<MailMergeRunError>(
      'invalid_payload',
      'one of templateHandle / templateId must be set',
    );
  }
  if (!job.dataSource || !isValidDataSource(job.dataSource)) {
    return fail<MailMergeRunError>('invalid_payload', 'dataSource invalid');
  }
  if (!job.outputMode || !isValidOutputMode(job.outputMode)) {
    return fail<MailMergeRunError>('invalid_payload', 'outputMode invalid');
  }
  if (!Array.isArray(job.fields)) {
    return fail<MailMergeRunError>('invalid_payload', 'fields must be an array');
  }
  if (typeof job.columnMapping !== 'object' || job.columnMapping === null) {
    return fail<MailMergeRunError>('invalid_payload', 'columnMapping must be an object');
  }

  const warnings: string[] = [];

  // ---- Phase 1: parse data source ----------------------------------------
  reportProgress(deps, {
    jobId: job.jobId,
    phase: 'parsing-data',
    currentRow: 0,
    totalRows: -1,
    percent: 2,
  });
  const parsed = await parseDataSource(job.dataSource);
  if (!parsed.ok) {
    return fail<MailMergeRunError>('data_parse_failed', parsed.message);
  }
  const rows = parsed.value.rows;
  warnings.push(...parsed.value.warnings);

  // ---- Required-field-mapping check --------------------------------------
  const requiredFields = job.fields.filter((f) => f.required);
  const mappedFieldNames = new Set(Object.values(job.columnMapping));
  for (const rf of requiredFields) {
    if (!mappedFieldNames.has(rf.name)) {
      return fail<MailMergeRunError>(
        'unmapped_required_field',
        `required field '${rf.name}' has no column mapping`,
        { fieldName: rf.name },
      );
    }
  }

  reportProgress(deps, {
    jobId: job.jobId,
    phase: 'parsing-data',
    currentRow: 0,
    totalRows: rows.length,
    percent: 5,
  });

  // ---- Phase 2: load the template ----------------------------------------
  reportProgress(deps, {
    jobId: job.jobId,
    phase: 'preparing-template',
    currentRow: 0,
    totalRows: rows.length,
    percent: 8,
  });
  const tplRes = await deps.loadTemplateBytes(job);
  if (!tplRes.ok) {
    return fail<MailMergeRunError>('invalid_payload', `template load failed: ${tplRes.message}`);
  }
  const templateBytes = tplRes.value;

  // Validate output path / folder once.
  //
  // Phase 3.1 (B-3.1, David): folder-mode uses a DIRECTORY sanitizer because
  // the production `.pdf`-only sanitizer rejects every directory path with
  // `output_path_invalid`. Falls back to `sanitizePath` only when the caller
  // didn't inject the dir variant (tests + Phase 3.0 wiring); production
  // wiring (register.ts) MUST supply `sanitizeDirectoryPath`.
  let outputBaseFolder: string | null = null;
  let outputConcatFile: string | null = null;
  if (job.outputMode.kind === 'folder') {
    const dirSanitizer = deps.sanitizeDirectoryPath ?? deps.sanitizePath;
    outputBaseFolder = dirSanitizer(job.outputMode.outputFolder);
    if (!outputBaseFolder) {
      return fail<MailMergeRunError>(
        'output_path_invalid',
        `outputFolder rejected: ${job.outputMode.outputFolder}`,
      );
    }
  } else {
    outputConcatFile = deps.sanitizePath(job.outputMode.outputFile);
    if (!outputConcatFile) {
      return fail<MailMergeRunError>(
        'output_path_invalid',
        `outputFile rejected: ${job.outputMode.outputFile}`,
      );
    }
  }

  // ---- Phase 3: per-row fill + write -------------------------------------
  const filenameTemplate =
    job.outputMode.kind === 'folder' && job.outputMode.filenameTemplate
      ? job.outputMode.filenameTemplate
      : DEFAULT_FILENAME_TEMPLATE;

  const filledBytesForConcat: Uint8Array[] = [];
  let rowsWritten = 0;
  let wasCancelled = false;

  for (let i = 0; i < rows.length; i += 1) {
    if (deps.isCancelled?.()) {
      wasCancelled = true;
      break;
    }
    const row = rows[i];
    if (!row) continue;
    const fieldValues = mapRowToFieldValues(row, job.columnMapping, job.fields);
    // Phase 3.1 (H-3.2, David): honor the per-job flatten flag. When true,
    // fillForm runs `form.flatten()` before serializing so each row's output
    // PDF is non-editable. Defaults to `false` for back-compat with Phase 3.0
    // callers that omit the field.
    const fillRes = await fillForm(templateBytes, fieldValues, {
      flatten: job.flattenForms === true,
    });
    if (!fillRes.ok) {
      return fail<MailMergeRunError>(
        'row_fill_failed',
        `row ${i} fillForm failed: ${fillRes.message}`,
        { rowIndex: i, fillError: fillRes.error },
      );
    }
    warnings.push(...fillRes.value.warnings);
    if (fillRes.value.unmatchedFieldNames.length > 0) {
      warnings.push(`row ${i}: ${fillRes.value.unmatchedFieldNames.length} unmatched field(s)`);
    }

    if (job.outputMode.kind === 'folder' && outputBaseFolder) {
      const filename = sanitizeFilename(renderFilename(filenameTemplate, row, i));
      const dest = deps.joinPath(outputBaseFolder, filename);
      try {
        reportProgress(deps, {
          jobId: job.jobId,
          phase: 'writing-row',
          currentRow: i + 1,
          totalRows: rows.length,
          percent: 10 + Math.floor(((i + 1) / Math.max(1, rows.length)) * 80),
        });
        await deps.writeFile(dest, fillRes.value.newBytes);
      } catch (e) {
        return fail<MailMergeRunError>(
          'fs_write_failed',
          `row ${i} write '${dest}' failed: ${(e as Error).message}`,
        );
      }
    } else {
      filledBytesForConcat.push(fillRes.value.newBytes);
    }
    rowsWritten += 1;

    reportProgress(deps, {
      jobId: job.jobId,
      phase: 'rendering-row',
      currentRow: i + 1,
      totalRows: rows.length,
      percent: 10 + Math.floor(((i + 1) / Math.max(1, rows.length)) * 80),
    });

    // Yield to the event loop every 10 rows so the renderer's progress
    // channel + cancellation flag stay responsive. setImmediate isn't a
    // browser primitive — we use setTimeout(0) for cross-runtime safety.
    if (i % 10 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  // ---- Phase 4: finalize -------------------------------------------------
  reportProgress(deps, {
    jobId: job.jobId,
    phase: 'finalizing',
    currentRow: rowsWritten,
    totalRows: rows.length,
    percent: 95,
  });

  let outputPath: string | null = null;
  if (job.outputMode.kind === 'concat' && outputConcatFile) {
    if (wasCancelled) {
      // Atomic semantics: no concat output on cancel (form-engine.md §6.5).
      outputPath = null;
    } else if (filledBytesForConcat.length === 0) {
      // Nothing to concat (zero-row input). Treat as success with no file.
      outputPath = null;
      warnings.push('mail-merge: zero rows; no output produced');
    } else {
      let merged: Uint8Array;
      try {
        merged = await concatPdfs(filledBytesForConcat);
      } catch (e) {
        return fail<MailMergeRunError>('row_fill_failed', `concat failed: ${(e as Error).message}`);
      }
      try {
        await deps.writeFile(outputConcatFile, merged);
        outputPath = outputConcatFile;
      } catch (e) {
        return fail<MailMergeRunError>(
          'fs_write_failed',
          `concat write '${outputConcatFile}' failed: ${(e as Error).message}`,
        );
      }
    }
  } else if (job.outputMode.kind === 'folder' && outputBaseFolder) {
    outputPath = outputBaseFolder;
  }

  reportProgress(deps, {
    jobId: job.jobId,
    phase: 'finalizing',
    currentRow: rowsWritten,
    totalRows: rows.length,
    percent: 100,
  });

  return ok({
    jobId: job.jobId,
    outputPath,
    rowsWritten,
    totalRows: rows.length,
    wasCancelled,
    warnings,
  });
}

// ============================================================================
// Helpers
// ============================================================================

function reportProgress(deps: MailMergeRunDeps, evt: MailMergeProgressEvent): void {
  if (deps.onProgress) deps.onProgress(evt);
}

function isValidDataSource(src: MailMergeDataSource): boolean {
  if (src.kind === 'csv') return src.bytes instanceof Uint8Array && src.bytes.byteLength > 0;
  if (src.kind === 'xlsx') return src.bytes instanceof Uint8Array && src.bytes.byteLength > 0;
  return false;
}

function isValidOutputMode(mode: MailMergeOutputMode): boolean {
  if (mode.kind === 'folder') {
    return typeof mode.outputFolder === 'string' && mode.outputFolder.length > 0;
  }
  if (mode.kind === 'concat') {
    return typeof mode.outputFile === 'string' && mode.outputFile.length > 0;
  }
  return false;
}

export function mapRowToFieldValues(
  row: Record<string, string>,
  columnMapping: Record<string, string>,
  fields: FormFieldDefinition[],
): Record<string, FormFieldValue> {
  const fieldByName = new Map<string, FormFieldDefinition>();
  for (const f of fields) fieldByName.set(f.name, f);

  const result: Record<string, FormFieldValue> = {};
  for (const [columnName, fieldName] of Object.entries(columnMapping)) {
    const cellRaw = row[columnName];
    if (cellRaw === undefined || cellRaw === '') continue;
    const def = fieldByName.get(fieldName);
    if (!def) continue;
    result[fieldName] = coerceCellToFieldValue(cellRaw, def.type);
  }
  return result;
}

function coerceCellToFieldValue(cell: string, type: FormFieldType): FormFieldValue {
  switch (type) {
    case 'text':
      return { type: 'text', value: cell };
    case 'date':
      return { type: 'date', value: normalizeDate(cell) };
    case 'checkbox': {
      const truthy = ['true', 'yes', 'y', '1', 'on', 'x', 'checked'];
      return { type: 'checkbox', value: truthy.includes(cell.toLowerCase().trim()) };
    }
    case 'radio':
      return { type: 'radio', value: cell };
    case 'dropdown':
      return { type: 'dropdown', value: cell };
    case 'signature':
      return { type: 'signature', value: null };
  }
}

/**
 * Best-effort date normalization. Accepts ISO-8601, US (MM/DD/YYYY), EU
 * (DD/MM/YYYY — ambiguous, falls through to literal), and returns the
 * original string if no parse succeeds. Phase 3.1 adds locale-aware parsing.
 */
function normalizeDate(cell: string): string {
  const trimmed = cell.trim();
  // ISO-8601 already
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  // US-style MM/DD/YYYY
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (us) {
    const mm = us[1]?.padStart(2, '0') ?? '01';
    const dd = us[2]?.padStart(2, '0') ?? '01';
    return `${us[3]}-${mm}-${dd}`;
  }
  return trimmed;
}

/**
 * Filename templating: `{column}` substitutes the cell value;
 * `{rowIndex:04}` substitutes the zero-padded 1-based row number.
 */
export function renderFilename(
  template: string,
  row: Record<string, string>,
  rowIndex0: number,
): string {
  return template.replace(/\{([^}]+)\}/g, (_match, expr: string) => {
    const colonAt = expr.indexOf(':');
    const key = colonAt >= 0 ? expr.slice(0, colonAt) : expr;
    const fmt = colonAt >= 0 ? expr.slice(colonAt + 1) : '';
    if (key === 'rowIndex') {
      const pad = parseInt(fmt.replace(/^0/, ''), 10);
      const oneBased = (rowIndex0 + 1).toString();
      return Number.isFinite(pad) && pad > oneBased.length ? oneBased.padStart(pad, '0') : oneBased;
    }
    return row[key] ?? '';
  });
}

// eslint-disable-next-line no-control-regex -- intentional: this regex strips filesystem-invalid chars from merge-generated filenames, and ASCII control chars (\x00-\x1f) are exactly part of that invalid set (Windows + POSIX both reject them). Removing them would let control chars leak into output filenames.
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
function sanitizeFilename(s: string): string {
  let out = s.replace(INVALID_FILENAME_CHARS, '_');
  // Trim trailing dots/spaces (Windows-hostile)
  out = out.replace(/[.\s]+$/g, '');
  if (out.length === 0) out = 'merged.pdf';
  if (!/\.pdf$/i.test(out)) out += '.pdf';
  return out;
}

async function concatPdfs(filledBytesArray: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const bytes of filledBytesArray) {
    const src = await PDFDocument.load(bytes);
    const copied = await merged.copyPages(src, src.getPageIndices());
    copied.forEach((p) => merged.addPage(p));
  }
  return merged.save({ useObjectStreams: true });
}
