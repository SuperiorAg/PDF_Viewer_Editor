// Handler: dialog:saveAs
// Shows the native save dialog and returns an opaque destinationToken
// (raw paths stay in main per ARCHITECTURE §2.4).

import { basename } from 'node:path';

import { fail, ok } from '../../shared/result.js';
import type {
  DialogSaveAsError,
  DialogSaveAsRequest,
  DialogSaveAsResponse,
  DialogSaveAsValue,
} from '../contracts.js';

export interface DialogSaveAsDeps {
  showSaveDialog: (suggestedName: string) => Promise<{
    canceled: boolean;
    filePath?: string;
  }>;
  sanitizePath: (raw: unknown) => string | null;
  issueDestinationToken: (
    path: string,
    displayName: string,
  ) => { token: string; displayName: string };
}

const MAX_SUGGESTED_NAME = 255;

export async function handleDialogSaveAs(
  req: DialogSaveAsRequest,
  deps: DialogSaveAsDeps,
): Promise<DialogSaveAsResponse> {
  if (typeof req.suggestedName !== 'string' || req.suggestedName.length === 0) {
    return fail<DialogSaveAsError>('invalid_path', 'suggestedName is required');
  }
  if (req.suggestedName.length > MAX_SUGGESTED_NAME) {
    return fail<DialogSaveAsError>('invalid_path', 'suggestedName too long');
  }
  // Strip any path separators so the renderer can't influence directory choice.
  if (/[\\/]/.test(req.suggestedName)) {
    return fail<DialogSaveAsError>(
      'invalid_path',
      'suggestedName must not contain path separators',
    );
  }

  try {
    const dialogRes = await deps.showSaveDialog(req.suggestedName);
    if (dialogRes.canceled || !dialogRes.filePath) {
      return fail<DialogSaveAsError>('user_cancelled', 'User cancelled save dialog');
    }
    const safe = deps.sanitizePath(dialogRes.filePath);
    if (safe === null) {
      return fail<DialogSaveAsError>('invalid_path', 'Chosen path failed sanitization');
    }
    const displayName = basename(safe);
    const dest = deps.issueDestinationToken(safe, displayName);
    const value: DialogSaveAsValue = {
      destinationToken: dest.token,
      displayName: dest.displayName,
    };
    return ok(value);
  } catch (e) {
    return fail<DialogSaveAsError>('invalid_path', (e as Error).message);
  }
}
