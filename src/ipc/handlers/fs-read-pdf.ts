// Handler: fs:readPdf  (drag-drop entry point)
//
// Renderer supplies a path from a drop event. Main MUST re-validate the path
// (sanitize + stat) before reading — never trust the renderer side per
// Playbook entry #15.

import { basename } from 'node:path';

import { fail, ok } from '../../shared/result.js';
import type {
  DialogOpenPdfValue,
  FsReadPdfError,
  FsReadPdfRequest,
  FsReadPdfResponse,
} from '../contracts.js';

export interface FsReadPdfDeps {
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

export async function handleFsReadPdf(
  req: FsReadPdfRequest,
  deps: FsReadPdfDeps,
): Promise<FsReadPdfResponse> {
  if (typeof req.droppedPath !== 'string' || req.droppedPath.length === 0) {
    return fail<FsReadPdfError>('path_rejected', 'droppedPath must be a non-empty string');
  }

  const safe = deps.sanitizePath(req.droppedPath);
  if (safe === null) {
    return fail<FsReadPdfError>('path_rejected', 'Dropped path failed sanitization');
  }

  try {
    const st = await deps.statFile(safe);
    const maxBytes = deps.getMaxFileSizeBytes();
    if (st.size > maxBytes) {
      return fail<FsReadPdfError>('too_large', `File exceeds max size (${maxBytes})`);
    }
    const bytes = await deps.readFile(safe);
    let metadata: { pageCount: number; warnings: string[] };
    try {
      metadata = await deps.loadPdfMetadata(bytes);
    } catch (e) {
      return fail<FsReadPdfError>('invalid_pdf', (e as Error).message);
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
    return fail<FsReadPdfError>('fs_read_failed', (e as Error).message);
  }
}
