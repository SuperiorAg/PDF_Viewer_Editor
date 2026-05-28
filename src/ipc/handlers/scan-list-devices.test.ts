// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { handleScanAcquire } from './scan-acquire.js';
import { handleScanListDevices } from './scan-list-devices.js';

describe('scan:* Phase 5.1 placeholder handlers (api-contracts.md §16.9-§16.10)', () => {
  it('scan:listDevices returns not_implemented_phase_5_1', async () => {
    const r = await handleScanListDevices({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('not_implemented_phase_5_1');
      expect(r.message).toMatch(/Phase 5\.1/);
    }
  });

  it('scan:acquire returns not_implemented_phase_5_1', async () => {
    const r = await handleScanAcquire({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('not_implemented_phase_5_1');
    }
  });

  it('scan:acquire ignores any payload (the Phase 5 contract reserves all fields)', async () => {
    const r = await handleScanAcquire({
      deviceId: 'arbitrary',
      resolution: 300,
      colorMode: 'color',
    });
    expect(r.ok).toBe(false);
  });
});
