// Handler: dialog:openPdf
// Shows the native open dialog, reads the chosen file, registers a handle.
//
// All side effects (dialog, fs, db) are injectable via the deps object so
// tests can run without booting Electron. See dialog-open-pdf.test.ts.

import { basename } from 'node:path';

import { fail, ok } from '../../shared/result.js';
import type {
  DialogOpenPdfError,
  DialogOpenPdfRequest,
  DialogOpenPdfResponse,
  DialogOpenPdfValue,
} from '../contracts.js';

export interface DialogOpenPdfDeps {
  showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  readFile: (path: string) => Promise<Uint8Array>;
  statFile: (path: string) => Promise<{ size: number }>;
  computeFileHash: (path: string) => Promise<string>;
  loadPdfMetadata: (bytes: Uint8Array) => Promise<{ pageCount: number; warnings: string[] }>;
  registerHandle: (rec: {
    path: string;
    displayName: string;
    fileHash: string;
    bytes: Uint8Array;
    pageCount: number;
    pdflibLoadWarnings: string[];
  }) => { handle: number };
  recordRecent: (row: { path: string; displayName: string; fileHash: string }) => void;
  sanitizePath: (raw: unknown) => string | null;
  getMaxFileSizeBytes: () => number;
}

export async function handleDialogOpenPdf(
  _req: DialogOpenPdfRequest,
  deps: DialogOpenPdfDeps,
): Promise<DialogOpenPdfResponse> {
  try {
    const dialogRes = await deps.showOpenDialog();
    if (dialogRes.canceled || dialogRes.filePaths.length === 0) {
      return fail<DialogOpenPdfError>('user_cancelled', 'User cancelled open dialog');
    }
    const raw = dialogRes.filePaths[0];
    const safe = deps.sanitizePath(raw);
    if (safe === null) {
      return fail<DialogOpenPdfError>('invalid_pdf', 'Selected path failed sanitization');
    }

    const st = await deps.statFile(safe);
    const maxBytes = deps.getMaxFileSizeBytes();
    if (st.size > maxBytes) {
      return fail<DialogOpenPdfError>(
        'too_large',
        `File exceeds the configured max size (${maxBytes} bytes)`,
        { size: st.size, max: maxBytes },
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = await deps.readFile(safe);
    } catch (e) {
      return fail<DialogOpenPdfError>('fs_read_failed', (e as Error).message);
    }

    let metadata: { pageCount: number; warnings: string[] };
    try {
      metadata = await deps.loadPdfMetadata(bytes);
    } catch (e) {
      return fail<DialogOpenPdfError>('invalid_pdf', (e as Error).message);
    }

    const fileHash = await deps.computeFileHash(safe);
    const displayName = basename(safe);

    const reg = deps.registerHandle({
      path: safe,
      displayName,
      fileHash,
      bytes,
      pageCount: metadata.pageCount,
      pdflibLoadWarnings: metadata.warnings,
    });

    deps.recordRecent({ path: safe, displayName, fileHash });

    const value: DialogOpenPdfValue = {
      handle: reg.handle,
      displayName,
      fileHash,
      pageCount: metadata.pageCount,
      pdflibLoadWarnings: metadata.warnings,
    };
    return ok(value);
  } catch (e) {
    return fail<DialogOpenPdfError>('fs_read_failed', (e as Error).message);
  }
}
