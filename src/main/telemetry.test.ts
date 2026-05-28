// @vitest-environment node
//
// Phase 7 (Wave 28a, David) — telemetry service + NoOpRingBufferTransport tests.
//
// Contract pins (conventions §18.5 + architecture-phase-7.md §4):
//   - opt-in OFF => recordEvent is a SILENT no-op (does not even buffer)
//   - opt-in ON  => allowlisted event records; non-allowlisted is dropped
//   - turning opt-in OFF clears the ring buffer (no orphaned events)
//   - ring buffer is BOUNDED (oldest evicted); snapshot is a defensive copy
//   - lastEventAt is nullable + late-init (null until first recorded event)
//   - getStatus(includeBuffer:false) returns buffer:null

import { describe, expect, it } from 'vitest';

import {
  createTelemetryService,
  isAllowlistedEvent,
  NoOpRingBufferTransport,
  TELEMETRY_ALLOWLIST,
  type TelemetrySettingsAccess,
} from './telemetry.js';

function makeSettings(initialOptIn: boolean): TelemetrySettingsAccess & { value: boolean } {
  const state = { value: initialOptIn };
  return {
    value: state.value,
    getOptIn: () => state.value,
    setOptIn: (v: boolean) => {
      state.value = v;
    },
  };
}

// A controllable clock for deterministic lastEventAt assertions.
function makeClock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('NoOpRingBufferTransport', () => {
  it('is bounded — evicts the oldest when capacity is exceeded', () => {
    const t = new NoOpRingBufferTransport(3);
    t.record({ name: 'doc.open', dayBucket: '2026-05-27' });
    t.record({ name: 'doc.save', dayBucket: '2026-05-27' });
    t.record({ name: 'feature.ocr.run', dayBucket: '2026-05-27' });
    t.record({ name: 'feature.export.docx', dayBucket: '2026-05-27' }); // overflow

    expect(t.size()).toBe(3);
    const snap = t.snapshot();
    // oldest ('doc.open') evicted; window holds the last three.
    expect(snap.map((e) => e.name)).toEqual(['doc.save', 'feature.ocr.run', 'feature.export.docx']);
  });

  it('snapshot is a defensive copy — mutating it does not affect the buffer', () => {
    const t = new NoOpRingBufferTransport(10);
    t.record({ name: 'app.launch', dayBucket: '2026-05-27' });
    const snap = t.snapshot() as Array<{ name: string; dayBucket: string }>;
    snap.push({ name: 'doc.open', dayBucket: '2026-05-27' });
    expect(t.size()).toBe(1);
  });

  it('clear() empties the buffer', () => {
    const t = new NoOpRingBufferTransport(10);
    t.record({ name: 'app.launch', dayBucket: '2026-05-27' });
    t.clear();
    expect(t.size()).toBe(0);
    expect(t.snapshot()).toEqual([]);
  });

  it('defaults to a 500-event capacity', () => {
    const t = new NoOpRingBufferTransport();
    for (let i = 0; i < 600; i++) {
      t.record({ name: 'doc.open', dayBucket: '2026-05-27' });
    }
    expect(t.size()).toBe(500);
  });

  it('guards a degenerate capacity (minimum 1)', () => {
    const t = new NoOpRingBufferTransport(0);
    t.record({ name: 'app.launch', dayBucket: '2026-05-27' });
    t.record({ name: 'doc.open', dayBucket: '2026-05-27' });
    expect(t.size()).toBe(1);
  });
});

describe('telemetry allowlist', () => {
  it('the runtime Set matches every contract event name (16 entries)', () => {
    expect(TELEMETRY_ALLOWLIST.size).toBe(16);
  });

  it('accepts allowlisted names and rejects unknown ones', () => {
    expect(isAllowlistedEvent('feature.ocr.run')).toBe(true);
    expect(isAllowlistedEvent('feature.export.pptx')).toBe(true);
    expect(isAllowlistedEvent('not.a.real.event')).toBe(false);
    expect(isAllowlistedEvent('')).toBe(false);
  });
});

describe('createTelemetryService', () => {
  it('opt-in OFF makes recordEvent a SILENT no-op (does not even buffer)', () => {
    const transport = new NoOpRingBufferTransport(10);
    const svc = createTelemetryService({
      transport,
      settings: makeSettings(false),
      now: makeClock().now,
    });

    const r = svc.recordEvent('doc.open', '2026-05-27');
    expect(r).toEqual({ recorded: false, reason: 'not_opted_in' });
    // The hard gate means NOTHING is buffered when opt-in is OFF.
    expect(transport.size()).toBe(0);
    expect(svc.getStatus(true).buffer).toEqual([]);
  });

  it('opt-in ON records an allowlisted event + stamps lastEventAt', () => {
    const transport = new NoOpRingBufferTransport(10);
    const clock = makeClock(5_000);
    const svc = createTelemetryService({
      transport,
      settings: makeSettings(true),
      now: clock.now,
    });

    const r = svc.recordEvent('feature.sign.pades', '2026-05-27');
    expect(r).toEqual({ recorded: true });
    expect(transport.size()).toBe(1);

    const status = svc.getStatus(false);
    expect(status.optedIn).toBe(true);
    expect(status.bufferedCount).toBe(1);
    expect(status.lastEventAt).toBe(5_000);
    // includeBuffer:false => no buffer snapshot.
    expect(status.buffer).toBeNull();
  });

  it('opt-in ON drops a non-allowlisted name (recorded:false, reason not_allowlisted)', () => {
    const transport = new NoOpRingBufferTransport(10);
    const svc = createTelemetryService({
      transport,
      settings: makeSettings(true),
      now: makeClock().now,
    });

    const r = svc.recordEvent('feature.evil.exfiltrate', '2026-05-27');
    expect(r).toEqual({ recorded: false, reason: 'not_allowlisted' });
    expect(transport.size()).toBe(0);
  });

  it('lastEventAt is nullable + late-init (null until the first recorded event)', () => {
    const transport = new NoOpRingBufferTransport(10);
    const svc = createTelemetryService({
      transport,
      settings: makeSettings(true),
      now: makeClock(42).now,
    });
    expect(svc.getStatus(false).lastEventAt).toBeNull();
    svc.recordEvent('app.launch', '2026-05-27');
    expect(svc.getStatus(false).lastEventAt).toBe(42);
  });

  it('turning opt-in OFF clears the ring buffer (no orphaned events survive)', () => {
    const transport = new NoOpRingBufferTransport(10);
    const settings = makeSettings(true);
    const svc = createTelemetryService({
      transport,
      settings,
      now: makeClock().now,
    });
    svc.recordEvent('doc.open', '2026-05-27');
    svc.recordEvent('doc.save', '2026-05-27');
    expect(transport.size()).toBe(2);

    const result = svc.setOptIn(false);
    expect(result).toEqual({ optIn: false, bufferCleared: true });
    expect(transport.size()).toBe(0);
    // lastEventAt is reset on opt-out so the status carries no stale timestamp.
    expect(svc.getStatus(false).lastEventAt).toBeNull();
    // Persistence flag flipped.
    expect(settings.getOptIn()).toBe(false);
  });

  it('turning opt-in ON does NOT clear the buffer (bufferCleared:false)', () => {
    const transport = new NoOpRingBufferTransport(10);
    const settings = makeSettings(false);
    const svc = createTelemetryService({
      transport,
      settings,
      now: makeClock().now,
    });
    const result = svc.setOptIn(true);
    expect(result).toEqual({ optIn: true, bufferCleared: false });
    expect(settings.getOptIn()).toBe(true);
  });

  it('getStatus(includeBuffer:true) returns name+dayBucket-only entries (no PII)', () => {
    const transport = new NoOpRingBufferTransport(10);
    const svc = createTelemetryService({
      transport,
      settings: makeSettings(true),
      now: makeClock().now,
    });
    svc.recordEvent('feature.locale.changed', '2026-05-27');
    const buffer = svc.getStatus(true).buffer;
    expect(buffer).not.toBeNull();
    if (buffer) {
      expect(buffer).toHaveLength(1);
      // Each entry has EXACTLY name + dayBucket — no other fields.
      expect(Object.keys(buffer[0] ?? {}).sort()).toEqual(['dayBucket', 'name']);
    }
  });
});
