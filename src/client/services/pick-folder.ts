// pickFolder shim — Phase 7.5 Wave 3 (Riley).
//
// David's Wave 2 split-document handler accepts a `destinationDirectoryToken`
// resolved by an injected resolver dep (pdf-split-document.ts handler comment
// L-10..15). The handler is wired-with-resolver-dep waiting for the
// renderer-side folder picker — this module is that picker.
//
// Channel name `dialog:pickFolder` is reserved in api-contracts.md, but the
// contract types + the preload bridge are still David's domain to land.
// Until the live bridge exists this shim returns 'bridge_unavailable' and
// the caller surfaces a clear error toast. When David lands the real channel
// it slots into `window.pdfApi.dialog.pickFolder` and resolveFn picks it up
// automatically.

import type { Result } from '../../shared/result';
import { fail, ok } from '../../shared/result';

export type PickFolderError = 'bridge_unavailable' | 'cancelled' | 'engine_failed';

export interface PickFolderResponse {
  /** OS-validated absolute path token the main process will accept on the
   * `destinationDirectoryToken` channel of pdf:splitDocument et al. */
  token: string;
  /** User-facing folder path (display only — do not pass to main). */
  displayPath: string;
}

interface PickFolderBridge {
  pickFolder(): Promise<Result<PickFolderResponse, PickFolderError>>;
}

function resolveBridge(): PickFolderBridge | null {
  if (typeof window === 'undefined' || window.pdfApi === undefined) return null;
  // The bridge mounts under `window.pdfApi.dialog.pickFolder` per the api-
  // contracts placeholder. Feature-detect without augmenting the canonical
  // PdfApi type (David's domain).
  const dialog = window.pdfApi.dialog as unknown as Partial<PickFolderBridge>;
  if (typeof dialog.pickFolder === 'function') {
    return { pickFolder: dialog.pickFolder.bind(dialog) };
  }
  return null;
}

/** Open the OS folder-picker dialog. Returns a token resolver consumes,
 * plus a display path to show in the UI. */
export async function pickFolder(): Promise<Result<PickFolderResponse, PickFolderError>> {
  const bridge = resolveBridge();
  if (bridge === null) {
    return fail<PickFolderError>(
      'bridge_unavailable',
      'window.pdfApi.dialog.pickFolder is not exposed yet (open question for Marcus — see Wave 3 brief).',
    );
  }
  try {
    return await bridge.pickFolder();
  } catch (e) {
    return fail<PickFolderError>(
      'engine_failed',
      e instanceof Error ? e.message : 'Folder picker failed',
    );
  }
}

/** Convenience: typed `ok` re-export to keep callers' imports tidy. */
export const okFolder = (value: PickFolderResponse): Result<PickFolderResponse, PickFolderError> =>
  ok(value);
