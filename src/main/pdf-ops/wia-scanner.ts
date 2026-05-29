// Phase 5.1 — WIA scanner addon loader + library-injection seam.
//
// ARCHITECTURE: docs/architecture-phase-5.md §7 (Q-E native-scanner) + the
// Phase 5.1 dispatch (custom Node-API COM addon under native/wia-scanner/).
//
// BOOTSTRAP PATH (read first — Playbook discipline, mirrors auto-update.ts):
//   The compiled addon lives at native/wia-scanner/build/Release/wia_scanner.node
//   — OUTSIDE node_modules and OUTSIDE the Vite-compiled main bundle. We load it
//   via a runtime `require()` resolved against a list of candidate paths (dev
//   tree + packaged resources). The require is INSIDE `loadWiaAddon()`, NOT a
//   top-level import, so:
//     1. The main bundle resolves + builds BEFORE the .node exists (the require
//        throws at first call, not at import time).
//     2. The factory module is statically imported by scan-bootstrap.ts, so Vite
//        does NOT tree-shake it (the Phase 6.1 runtime-require-tree-shake RCA).
//   This mirrors auto-update.ts / ocr-bootstrap.ts exactly.
//
// GRACEFUL DEGRADE (brief requirement C + Julian audit target):
//   On non-Windows, or when the addon is missing / fails to load / exports no
//   listDevices, `loadWiaAddon()` returns `null`. The scan engine maps a null
//   addon to a typed `scanner_unavailable` Result — NEVER a crash. The addon is
//   REQUIRED on the ScanEngine interface (no optional stub fallback); the
//   null-addon path is an explicit, tested degrade, not a silent no-op.

import { fail, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';

// ----------------------------------------------------------------------------
// The minimal native addon surface. Structurally typed so the TS build never
// takes a compile-time dependency on the .node binary (which is built by Diego
// / native/wia-scanner/build.mjs, not by tsc).
// ----------------------------------------------------------------------------

export interface NativeScanDevice {
  deviceId: string;
  name: string;
  type: string;
  description: string;
}

export interface NativeListResult {
  devices?: NativeScanDevice[];
  /** Present on a typed native failure (addon resolves, not rejects). */
  __wiaError?: string;
  detail?: string;
}

export interface NativeScannedPage {
  bytes: Buffer | Uint8Array;
  format: 'bmp' | 'png' | 'jpeg' | 'tiff';
  pageIndex: number;
}

export interface NativeAcquireResult {
  pages?: NativeScannedPage[];
  __wiaError?: string;
  detail?: string;
}

export interface NativeAcquireOptions {
  deviceId?: string;
  resolution?: number;
  colorMode?: 'bw' | 'grayscale' | 'color';
  source?: 'auto' | 'flatbed' | 'feeder';
}

export interface WiaAddon {
  platform: string;
  listDevices(): Promise<NativeListResult>;
  acquire(options: NativeAcquireOptions): Promise<NativeAcquireResult>;
}

// ----------------------------------------------------------------------------
// Candidate paths the compiled addon may live at, dev + packaged.
// ----------------------------------------------------------------------------

function addonCandidatePaths(): string[] {
  const rel = 'wia_scanner.node';
  const candidates: string[] = [];
  // 1. Packaged: electron-builder asarUnpack drops the .node under
  //    resources/app.asar.unpacked/native/wia-scanner/build/Release/.
  //    (Diego adds the asarUnpack glob — see README §Diego.)
  if (process.resourcesPath) {
    candidates.push(
      `${process.resourcesPath}/app.asar.unpacked/native/wia-scanner/build/Release/${rel}`,
      `${process.resourcesPath}/native/wia-scanner/build/Release/${rel}`,
    );
  }
  // 2. Dev tree: repo-root/native/wia-scanner/build/Release/.
  //    __dirname at runtime is the compiled main bundle dir; walk up to repo root.
  //    We also allow an explicit override for tests / packaging probes.
  if (process.env.WIA_ADDON_PATH) {
    candidates.unshift(process.env.WIA_ADDON_PATH);
  }
  // Best-effort dev path relative to cwd (electron-vite dev runs from repo root).
  candidates.push(`${process.cwd()}/native/wia-scanner/build/Release/${rel}`);
  return candidates;
}

let _cached: WiaAddon | null | undefined; // undefined = not tried yet

/**
 * Resolve + load the compiled WIA addon. Returns null on any failure
 * (non-Windows, missing binary, load error, missing exports). NEVER throws.
 * Result is memoized — repeated scans don't re-dlopen.
 */
export function loadWiaAddon(): WiaAddon | null {
  if (_cached !== undefined) return _cached;
  if (process.platform !== 'win32') {
    _cached = null;
    return null;
  }
  for (const path of addonCandidatePaths()) {
    try {
      // Indirect require so Vite does not try to bundle the .node at build time.
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const mod = require(path) as Partial<WiaAddon>;
      if (
        mod &&
        typeof mod.listDevices === 'function' &&
        typeof mod.acquire === 'function' &&
        mod.platform === 'win32'
      ) {
        _cached = mod as WiaAddon;
        return _cached;
      }
    } catch {
      // try next candidate
    }
  }
  console.error(
    '[wia-scanner] addon not found / failed to load — scanner features degrade to scanner_unavailable. ' +
      'Build it with `node native/wia-scanner/build.mjs` (Windows + VS Build Tools + Windows SDK required).',
  );
  _cached = null;
  return _cached;
}

/** Test seam: inject a mock addon (or null) and reset the memo. */
export function __setWiaAddonForTests(addon: WiaAddon | null | undefined): void {
  _cached = addon;
}

// ----------------------------------------------------------------------------
// Typed error union surfaced to the scan engine / handlers.
// ----------------------------------------------------------------------------

export type ScanError =
  | 'scanner_unavailable' // non-Windows, addon missing, or WIA service down
  | 'no_device' // addon loaded but no scanner enumerated
  | 'device_open_failed'
  | 'no_scan_item'
  | 'transfer_unsupported'
  | 'acquisition_failed'
  | 'enumeration_failed'
  | 'addon_internal_error';

// Map a native error code (from __wiaError) to our ScanError union. Unknown
// native codes collapse to addon_internal_error rather than leaking.
export function mapNativeError(code: string | undefined): ScanError {
  switch (code) {
    case 'wia_service_unavailable':
      return 'scanner_unavailable';
    case 'no_device':
      return 'no_device';
    case 'device_open_failed':
      return 'device_open_failed';
    case 'no_scan_item':
      return 'no_scan_item';
    case 'transfer_unsupported':
      return 'transfer_unsupported';
    case 'acquisition_failed':
      return 'acquisition_failed';
    case 'enumeration_failed':
      return 'enumeration_failed';
    default:
      return 'addon_internal_error';
  }
}

// ----------------------------------------------------------------------------
// Convenience wrappers returning discriminated Results (engine consumes these).
// ----------------------------------------------------------------------------

export interface ScanDevice {
  deviceId: string;
  name: string;
  type: string;
  description: string;
}

export async function listDevicesVia(
  addon: WiaAddon | null,
): Promise<Result<{ devices: ScanDevice[] }, ScanError>> {
  if (!addon) {
    return fail<ScanError>(
      'scanner_unavailable',
      'WIA scanner addon not available on this platform',
    );
  }
  let raw: NativeListResult;
  try {
    raw = await addon.listDevices();
  } catch (e) {
    return fail<ScanError>('addon_internal_error', `addon.listDevices threw: ${(e as Error).name}`);
  }
  if (raw.__wiaError) {
    return fail<ScanError>(mapNativeError(raw.__wiaError), raw.detail ?? raw.__wiaError);
  }
  const devices = (raw.devices ?? []).map((d) => ({
    deviceId: d.deviceId,
    name: d.name,
    type: d.type,
    description: d.description,
  }));
  return ok({ devices });
}

export interface AcquiredPage {
  bytes: Uint8Array;
  format: 'bmp' | 'png' | 'jpeg' | 'tiff';
  pageIndex: number;
}

export async function acquireVia(
  addon: WiaAddon | null,
  options: NativeAcquireOptions,
): Promise<Result<{ pages: AcquiredPage[] }, ScanError>> {
  if (!addon) {
    return fail<ScanError>(
      'scanner_unavailable',
      'WIA scanner addon not available on this platform',
    );
  }
  let raw: NativeAcquireResult;
  try {
    raw = await addon.acquire(options);
  } catch (e) {
    return fail<ScanError>('addon_internal_error', `addon.acquire threw: ${(e as Error).name}`);
  }
  if (raw.__wiaError) {
    return fail<ScanError>(mapNativeError(raw.__wiaError), raw.detail ?? raw.__wiaError);
  }
  const pages = (raw.pages ?? []).map((p) => ({
    bytes: p.bytes instanceof Uint8Array ? p.bytes : new Uint8Array(p.bytes),
    format: p.format,
    pageIndex: p.pageIndex,
  }));
  if (pages.length === 0) {
    return fail<ScanError>('acquisition_failed', 'scan produced no pages');
  }
  return ok({ pages });
}
