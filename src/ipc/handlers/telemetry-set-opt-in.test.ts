// @vitest-environment node
//
// Phase 7 (Wave 28a, David) — telemetry:setOptIn + telemetry:getStatus tests.
//
// Pins:
//   - setOptIn(true/false) validated boolean; rejects non-boolean / extra props
//   - turning OFF clears the buffer (bufferCleared:true)
//   - settings_write_failed when the persistence throws
//   - getStatus returns optedIn/bufferedCount/lastEventAt(+buffer when asked)

import { describe, expect, it } from 'vitest';

import {
  createTelemetryService,
  NoOpRingBufferTransport,
  type TelemetryService,
} from '../../main/telemetry.js';

import { handleTelemetryGetStatus } from './telemetry-get-status.js';
import { handleTelemetrySetOptIn } from './telemetry-set-opt-in.js';

function makeService(
  optIn: boolean,
  opts: { throwOnSet?: boolean } = {},
): { service: TelemetryService; transport: NoOpRingBufferTransport } {
  let value = optIn;
  const transport = new NoOpRingBufferTransport(10);
  const service = createTelemetryService({
    transport,
    settings: {
      getOptIn: () => value,
      setOptIn: (v) => {
        if (opts.throwOnSet) throw new Error('disk full');
        value = v;
      },
    },
    now: () => 7_000,
  });
  return { service, transport };
}

describe('handleTelemetrySetOptIn', () => {
  it('turns opt-in ON (bufferCleared:false)', async () => {
    const { service } = makeService(false);
    const r = await handleTelemetrySetOptIn({ optIn: true }, { service });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.optIn).toBe(true);
      expect(r.value.bufferCleared).toBe(false);
    }
  });

  it('turning opt-in OFF clears the ring buffer (bufferCleared:true)', async () => {
    const { service, transport } = makeService(true);
    service.recordEvent('doc.open', '2026-05-27');
    expect(transport.size()).toBe(1);

    const r = await handleTelemetrySetOptIn({ optIn: false }, { service });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.bufferCleared).toBe(true);
    expect(transport.size()).toBe(0);
  });

  it('rejects a non-boolean optIn', async () => {
    const { service } = makeService(false);
    const r = await handleTelemetrySetOptIn({ optIn: 'yes' }, { service });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects extra properties (strict)', async () => {
    const { service } = makeService(false);
    const r = await handleTelemetrySetOptIn({ optIn: true, smuggled: 'x' }, { service });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('returns settings_write_failed when persistence throws', async () => {
    const { service } = makeService(false, { throwOnSet: true });
    const r = await handleTelemetrySetOptIn({ optIn: true }, { service });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('settings_write_failed');
  });
});

describe('handleTelemetryGetStatus', () => {
  it('returns status with no buffer when includeBuffer:false', async () => {
    const { service } = makeService(true);
    service.recordEvent('app.launch', '2026-05-27');
    const r = await handleTelemetryGetStatus({ includeBuffer: false }, { service });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.optedIn).toBe(true);
      expect(r.value.bufferedCount).toBe(1);
      expect(r.value.lastEventAt).toBe(7_000);
      expect(r.value.buffer).toBeNull();
    }
  });

  it('returns the auditable buffer when includeBuffer:true', async () => {
    const { service } = makeService(true);
    service.recordEvent('doc.open', '2026-05-27');
    const r = await handleTelemetryGetStatus({ includeBuffer: true }, { service });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.buffer) {
      expect(r.value.buffer).toEqual([{ name: 'doc.open', dayBucket: '2026-05-27' }]);
    }
  });

  it('lastEventAt is null when nothing recorded', async () => {
    const { service } = makeService(false);
    const r = await handleTelemetryGetStatus({ includeBuffer: false }, { service });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.lastEventAt).toBeNull();
  });

  it('rejects a missing includeBuffer flag', async () => {
    const { service } = makeService(false);
    const r = await handleTelemetryGetStatus({}, { service });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });
});
