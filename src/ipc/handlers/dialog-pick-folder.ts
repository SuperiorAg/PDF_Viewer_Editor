// Handler: dialog:pickFolder (Phase 7.5 Wave 3 — David, 2026-06-17)
//
// Contract: src/ipc/contracts.ts `DialogPickFolderRequest/Response` (per
// docs/api-contracts.md §19.2.3 + §19.12.2 references).
//
// Behavior:
//   1. Show the native open-directory dialog.
//   2. Sanitize the chosen absolute path.
//   3. Issue a 60s-TTL directoryToken via documentStore (parallel to
//      destinationToken from dialog:saveAs).
//   4. Return { directoryToken, displayName }. Raw paths never cross to the
//      renderer.
//
// Wave 3 consumers (when the renderer wires Wave-4 UIs):
//   - pdf:splitDocument: redeems via documentStore.consumeDirectoryToken.
//   - pdf:replayActionScript (Wave 6): same.

import { basename } from 'node:path';

import { z } from 'zod';

import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DialogPickFolderError,
  DialogPickFolderResponse,
  DialogPickFolderValue,
} from '../contracts.js';

// ============================================================================
// Schemas
// ============================================================================

const requestSchema = z.object({
  title: z.string().max(200).optional(),
  defaultPath: z.string().max(1024).optional(),
  baseFilename: z.string().max(200).optional(),
});

// ============================================================================
// Deps
// ============================================================================

export interface DialogPickFolderDeps {
  /** Wraps Electron's `dialog.showOpenDialog({ properties: ['openDirectory'] })`. */
  showOpenDirectoryDialog: (opts: {
    title?: string;
    defaultPath?: string;
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  sanitizePath: (raw: unknown) => string | null;
  issueDirectoryToken: (
    directory: string,
    displayName: string,
    baseFilename: string,
  ) => { token: string; displayName: string };
}

// ============================================================================
// Handler
// ============================================================================

export async function handleDialogPickFolder(
  req: unknown,
  deps: DialogPickFolderDeps,
): Promise<DialogPickFolderResponse> {
  const parsed = requestSchema.safeParse(req ?? {});
  if (!parsed.success) {
    return fail<DialogPickFolderError>('invalid_path', parsed.error.message);
  }
  const r = parsed.data;

  let dialogRes: { canceled: boolean; filePaths: string[] };
  try {
    dialogRes = await deps.showOpenDirectoryDialog({
      ...(r.title !== undefined ? { title: r.title } : {}),
      ...(r.defaultPath !== undefined ? { defaultPath: r.defaultPath } : {}),
    });
  } catch (e) {
    return fail<DialogPickFolderError>(
      'invalid_path',
      safeMessage(e, 'Unable to show folder picker'),
    );
  }

  if (dialogRes.canceled || dialogRes.filePaths.length === 0) {
    return fail<DialogPickFolderError>('user_cancelled', 'User cancelled folder picker');
  }

  const chosen = dialogRes.filePaths[0];
  if (!chosen) {
    return fail<DialogPickFolderError>('user_cancelled', 'No directory chosen');
  }

  const safe = deps.sanitizePath(chosen);
  if (safe === null) {
    return fail<DialogPickFolderError>('invalid_path', 'Chosen folder failed sanitization');
  }

  const leafName = basename(safe);
  const baseFilename = r.baseFilename ?? leafName;
  const dest = deps.issueDirectoryToken(safe, leafName, baseFilename);
  const value: DialogPickFolderValue = {
    directoryToken: dest.token,
    displayName: dest.displayName,
  };
  return ok(value);
}
