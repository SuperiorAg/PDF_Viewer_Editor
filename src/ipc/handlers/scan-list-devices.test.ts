// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { WiaAddon } from '../../main/pdf-ops/wia-scanner.js';

import { handleScanListDevices } from './scan-list-devices.js';

// A mock addon implementing the production WiaAddon surface. We exercise the
// REAL handler logic (mapError, listDevicesVia) against a synthetic native
// layer — you can't drive a real scanner in CI.
function mockAddon(over: Partial<WiaAddon>): WiaAddon {
  return {
    platform: 'win32',
    listDevices: async () => ({
      devices: [
        { deviceId: 'dev-1', name: 'Xerox WIA', type: 'scanner', description: 'office MFP' },
        { deviceId: 'dev-2', name: 'Brother ADS', type: 'scanner', description: 'desk feeder' },
      ],
    }),
    acquire: async () => ({ pages: [] }),
    ...over,
  };
}

describe('scan:listDevices (Phase 5.1 — LIVE, api-contracts.md §16.9)', () => {
  it('returns the device list from the addon', async () => {
    const r = await handleScanListDevices({}, { addon: mockAddon({}) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.devices).toHaveLength(2);
      expect(r.value.devices[0]).toEqual({
        deviceId: 'dev-1',
        name: 'Xerox WIA',
        type: 'scanner',
        description: 'office MFP',
      });
    }
  });

  it('returns an empty list (ok) when no devices are connected', async () => {
    const r = await handleScanListDevices(
      {},
      { addon: mockAddon({ listDevices: async () => ({ devices: [] }) }) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.devices).toHaveLength(0);
  });

  it('degrades to scanner_unavailable when the addon is null (non-Windows / not built)', async () => {
    const r = await handleScanListDevices({}, { addon: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('scanner_unavailable');
  });

  it('maps a native enumeration_failed to enumeration_failed', async () => {
    const r = await handleScanListDevices(
      {},
      {
        addon: mockAddon({
          listDevices: async () => ({
            __wiaError: 'enumeration_failed',
            detail: 'EnumDeviceInfo hr=-1',
          }),
        }),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('enumeration_failed');
  });

  it('maps a native wia_service_unavailable to scanner_unavailable', async () => {
    const r = await handleScanListDevices(
      {},
      {
        addon: mockAddon({
          listDevices: async () => ({
            __wiaError: 'wia_service_unavailable',
            detail: 'CoCreate failed',
          }),
        }),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('scanner_unavailable');
  });

  it('maps an addon that throws to addon_internal_error (no exception across the bridge)', async () => {
    const r = await handleScanListDevices(
      {},
      {
        addon: mockAddon({
          listDevices: async () => {
            throw new Error('boom');
          },
        }),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('addon_internal_error');
  });
});
