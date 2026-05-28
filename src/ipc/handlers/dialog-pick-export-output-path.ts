// Handler: dialog:pickExportOutputPath (Phase 6, api-contracts.md §17.9)
//
// Main-process file SAVE-AS dialog. Returns the absolute path or `null` if
// the user cancelled. Structurally mirrors Phase 1's `dialog:saveAs` — the
// renderer never sees raw paths from disk, but for export we DO return the
// path string so the engine can write to it (the engine writes; the renderer
// never opens the file directly with the bytes).

import { basename, extname } from 'node:path';

import { z } from 'zod';

import { fail, ok } from '../../shared/result.js';
import type {
  DialogPickExportOutputPathError,
  DialogPickExportOutputPathRequest,
  DialogPickExportOutputPathResponse,
  ExportFormat,
} from '../contracts.js';

export interface DialogPickExportOutputPathDeps {
  showSaveDialog: (opts: {
    defaultPath: string;
    filters: Array<{ name: string; extensions: string[] }>;
  }) => Promise<{ canceled: boolean; filePath?: string }>;
  sanitizePath: (raw: unknown) => string | null;
}

const requestSchema = z.object({
  defaultBasename: z.string().min(1).max(200),
  format: z.enum(['docx', 'xlsx', 'pptx', 'png', 'jpeg', 'tiff']),
});

const FILTER: Record<ExportFormat, { name: string; extensions: string[] }> = {
  docx: { name: 'Word document', extensions: ['docx'] },
  xlsx: { name: 'Excel workbook', extensions: ['xlsx'] },
  pptx: { name: 'PowerPoint presentation', extensions: ['pptx'] },
  png: { name: 'PNG image', extensions: ['png'] },
  jpeg: { name: 'JPEG image', extensions: ['jpeg', 'jpg'] },
  tiff: { name: 'TIFF image', extensions: ['tiff', 'tif'] },
};

export async function handleDialogPickExportOutputPath(
  req: unknown,
  deps: DialogPickExportOutputPathDeps,
): Promise<DialogPickExportOutputPathResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<DialogPickExportOutputPathError>('invalid_payload', parsed.error.message);
  }
  const { defaultBasename, format } = parsed.data;
  // Reject path separators in the basename (renderer must not pick the directory).
  if (/[\\/]/.test(defaultBasename)) {
    return fail<DialogPickExportOutputPathError>(
      'invalid_payload',
      'defaultBasename must not contain path separators',
    );
  }
  // Derive the suggested filename: strip any existing extension, then append
  // the format's default extension.
  const stripped = (() => {
    const base = basename(defaultBasename);
    const ext = extname(base).toLowerCase();
    return ext.length > 0 ? base.slice(0, base.length - ext.length) : base;
  })();
  const filter = FILTER[format];
  const suggested = `${stripped}.${filter.extensions[0]}`;
  const dialogRes = await deps.showSaveDialog({
    defaultPath: suggested,
    filters: [filter, { name: 'All files', extensions: ['*'] }],
  });
  if (dialogRes.canceled || !dialogRes.filePath) {
    return ok({ outputPath: null });
  }
  const safe = deps.sanitizePath(dialogRes.filePath);
  if (safe === null) {
    return fail<DialogPickExportOutputPathError>(
      'invalid_payload',
      'Chosen path failed sanitization',
    );
  }
  return ok({ outputPath: safe });
}

export type _UnusedReq = DialogPickExportOutputPathRequest;
