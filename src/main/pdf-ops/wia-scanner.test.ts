// @vitest-environment node
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  acquireVia,
  listDevicesVia,
  loadWiaAddon,
  mapNativeError,
  __setWiaAddonForTests,
  type WiaAddon,
} from './wia-scanner.js';

// ---- pure mapper + Result-wrapper tests (always run) -----------------------

describe('mapNativeError', () => {
  it('maps known native codes to the ScanError union', () => {
    expect(mapNativeError('wia_service_unavailable')).toBe('scanner_unavailable');
    expect(mapNativeError('no_device')).toBe('no_device');
    expect(mapNativeError('device_open_failed')).toBe('device_open_failed');
    expect(mapNativeError('enumeration_failed')).toBe('enumeration_failed');
  });
  it('collapses unknown native codes to addon_internal_error', () => {
    expect(mapNativeError('totally_unknown')).toBe('addon_internal_error');
    expect(mapNativeError(undefined)).toBe('addon_internal_error');
  });
});

describe('listDevicesVia / acquireVia graceful degrade', () => {
  it('listDevicesVia(null) => scanner_unavailable (no throw)', async () => {
    const r = await listDevicesVia(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('scanner_unavailable');
  });
  it('acquireVia(null, ...) => scanner_unavailable (no throw)', async () => {
    const r = await acquireVia(null, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('scanner_unavailable');
  });

  it('listDevicesVia maps the empty-pages acquire to a typed acquisition_failed', async () => {
    const addon: WiaAddon = {
      platform: 'win32',
      listDevices: async () => ({ devices: [] }),
      acquire: async () => ({ pages: [] }),
    };
    const r = await acquireVia(addon, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('acquisition_failed');
  });
});

describe('loadWiaAddon memoization (test seam)', () => {
  it('__setWiaAddonForTests overrides the loader result', () => {
    const fake: WiaAddon = {
      platform: 'win32',
      listDevices: async () => ({ devices: [] }),
      acquire: async () => ({ pages: [] }),
    };
    __setWiaAddonForTests(fake);
    expect(loadWiaAddon()).toBe(fake);
    __setWiaAddonForTests(null);
    expect(loadWiaAddon()).toBeNull();
    // Reset to "not tried" so other suites observe real behavior.
    __setWiaAddonForTests(undefined);
  });
});

// ---- native smoke test (guarded — runs only with the built addon present) --
//
// Manual COM-refcount verification (cannot be unit-tested): run this against a
// real scanner repeatedly and watch the process handle count in Task Manager —
// it must NOT grow across N acquisitions (every COM interface is Release()d via
// the RAII ComPtr in wia-com.cc; every PROPVARIANT/BSTR/STGMEDIUM is freed).

const addonPath = join(
  process.cwd(),
  'native',
  'wia-scanner',
  'build',
  'Release',
  'wia_scanner.node',
);
const hasAddon = process.platform === 'win32' && existsSync(addonPath);

describe.skipIf(!hasAddon)('native WIA addon smoke (Windows + built addon only)', () => {
  it('loads the real addon and exposes listDevices/acquire', () => {
    __setWiaAddonForTests(undefined); // force a real load attempt
    process.env.WIA_ADDON_PATH = addonPath;
    const addon = loadWiaAddon();
    expect(addon).not.toBeNull();
    expect(addon?.platform).toBe('win32');
    expect(typeof addon?.listDevices).toBe('function');
    expect(typeof addon?.acquire).toBe('function');
    __setWiaAddonForTests(undefined);
  });

  it('listDevices returns a well-formed device array (may be empty if no scanner)', async () => {
    __setWiaAddonForTests(undefined);
    process.env.WIA_ADDON_PATH = addonPath;
    const r = await listDevicesVia(loadWiaAddon());
    expect(r.ok).toBe(true);
    if (r.ok) {
      for (const d of r.value.devices) {
        expect(typeof d.deviceId).toBe('string');
        expect(typeof d.name).toBe('string');
      }
    }
    __setWiaAddonForTests(undefined);
  });
});
