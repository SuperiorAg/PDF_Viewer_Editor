// Handler: dialog:pickPdfFiles (Wave-30 follow-up H-30.1, David 2026-06-01).
//
// Path-only PDF picker. Shows the native open dialog (single or multi),
// sanitizes each chosen path, and returns the absolute paths back to the
// renderer. Does NOT read bytes, register handles, or touch recents — the
// Combine modal calls this to populate its source list, and pdf:combine
// reads the bytes under the same sanitization rules.
//
// Chose this as a separate channel (Option B from the brief) rather than
// extending dialog:openPdf with `multi: true`. Rationale documented in
// `src/ipc/contracts.ts` near `DialogPickPdfFilesRequest`.

import { z } from 'zod';

import { fail, ok } from '../../shared/result.js';
import type {
  DialogPickPdfFilesError,
  DialogPickPdfFilesRequest,
  DialogPickPdfFilesResponse,
} from '../contracts.js';

export interface DialogPickPdfFilesDeps {
  /**
   * Opens the native file picker. `properties` includes 'openFile' always;
   * 'multiSelections' is added when the request asks for multi-pick.
   */
  showOpenDialog: (opts: {
    properties: Array<'openFile' | 'multiSelections'>;
    filters: Array<{ name: string; extensions: string[] }>;
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  sanitizePath: (raw: unknown) => string | null;
}

const requestSchema = z.object({
  multi: z.boolean().optional(),
});

export async function handleDialogPickPdfFiles(
  req: unknown,
  deps: DialogPickPdfFilesDeps,
): Promise<DialogPickPdfFilesResponse> {
  const parsed = requestSchema.safeParse(req ?? {});
  if (!parsed.success) {
    return fail<DialogPickPdfFilesError>('invalid_path', parsed.error.message);
  }
  const { multi } = parsed.data as DialogPickPdfFilesRequest;

  const properties: Array<'openFile' | 'multiSelections'> = multi
    ? ['openFile', 'multiSelections']
    : ['openFile'];
  const dialogRes = await deps.showOpenDialog({
    properties,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (dialogRes.canceled || dialogRes.filePaths.length === 0) {
    return fail<DialogPickPdfFilesError>('user_cancelled', 'User cancelled file picker');
  }

  // Sanitize every path. If ANY single path fails sanitization, reject the
  // whole batch — combine semantics need an all-or-nothing path list, and
  // partial results would be confusing to the user.
  const paths: string[] = [];
  for (const raw of dialogRes.filePaths) {
    const safe = deps.sanitizePath(raw);
    if (safe === null) {
      return fail<DialogPickPdfFilesError>('invalid_path', `Path failed sanitization: ${raw}`);
    }
    paths.push(safe);
  }

  return ok({ paths });
}
