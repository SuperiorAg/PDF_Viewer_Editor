// Phase 5.1 — scanner runtime bootstrap.
//
// Production glue between the native WIA addon, the scan->PDF composer, and the
// document store. Mirrors ocr-bootstrap.ts / export-bootstrap.ts exactly:
//   - STATICALLY imported by src/main/index.ts (so Vite never tree-shakes it).
//   - The addon itself is loaded via a runtime require INSIDE loadWiaAddon()
//     (so the main bundle builds before the .node is compiled).
//
// THIS FILE IS REQUIRED AT BOOT, but the addon VALUE may be null (non-Windows
// / addon-not-built) — that's the graceful-degrade path, surfaced as a typed
// scanner_unavailable Result, NOT a crash.

import type { DocumentHandle } from '../../ipc/contracts.js';
import type { Result } from '../../shared/result.js';

import { documentStore } from './document-store.js';
import { computeBufferHash } from './file-hash.js';
import { composeScanToPdf } from './scan-to-pdf.js';
import type { ScanPage, ScanToPdfError } from './scan-to-pdf.js';
import { loadWiaAddon, type WiaAddon } from './wia-scanner.js';

export interface BootstrappedScan {
  addon: WiaAddon | null;
  composeScanToPdf: (
    pages: ScanPage[],
  ) => Promise<
    Result<{ bytes: Uint8Array; pageCount: number; warnings: string[] }, ScanToPdfError>
  >;
  registerScannedPdf: (
    bytes: Uint8Array,
    displayName: string,
    pageCount: number,
  ) => { handle: DocumentHandle; displayName: string };
}

export function bootstrapScan(): BootstrappedScan {
  return {
    addon: loadWiaAddon(),
    composeScanToPdf,
    registerScannedPdf: (bytes, displayName, pageCount) => {
      const rec = documentStore.register({
        path: null, // in-memory only until the user saves (like pdf:combine output)
        displayName,
        fileHash: computeBufferHash(bytes),
        bytes,
        pageCount,
        pdflibLoadWarnings: [],
      });
      return { handle: rec.handle, displayName: rec.displayName };
    },
  };
}
