// Telemetry framework tests (conventions §18.5). Pure modules — no i18next.

import { describe, expect, it } from 'vitest';

import { TELEMETRY_ALLOWLIST, isAllowlisted, toDayBucket } from './telemetry-events';
import { NoOpRingBufferTransport } from './telemetry-transport';

describe('telemetry allowlist', () => {
  it('accepts allowlisted event names', () => {
    expect(isAllowlisted('doc.open')).toBe(true);
    expect(isAllowlisted('feature.export.docx')).toBe(true);
    expect(isAllowlisted('feature.locale.changed')).toBe(true);
  });

  it('rejects non-allowlisted names (the runtime PII/abuse guard)', () => {
    expect(isAllowlisted('doc.open.with.path')).toBe(false);
    expect(isAllowlisted('arbitrary.event')).toBe(false);
    expect(isAllowlisted('')).toBe(false);
  });

  it('the allowlist matches the documented 16-event set', () => {
    expect(TELEMETRY_ALLOWLIST.size).toBe(16);
  });
});

describe('toDayBucket — coarse, no sub-day resolution', () => {
  it('produces a YYYY-MM-DD string in UTC', () => {
    const ms = Date.UTC(2026, 4, 28, 13, 47, 9); // 2026-05-28T13:47:09Z
    expect(toDayBucket(ms)).toBe('2026-05-28');
  });

  it('drops the time component entirely (anti-fingerprint)', () => {
    const morning = Date.UTC(2026, 4, 28, 0, 0, 1);
    const night = Date.UTC(2026, 4, 28, 23, 59, 59);
    expect(toDayBucket(morning)).toBe(toDayBucket(night));
  });
});

describe('NoOpRingBufferTransport — bounded, in-memory, clearable', () => {
  it('records and snapshots events (name + count + dayBucket only)', () => {
    const t = new NoOpRingBufferTransport(10);
    t.record({ name: 'doc.open', count: 1, dayBucket: '2026-05-28' });
    const snap = t.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toEqual({ name: 'doc.open', count: 1, dayBucket: '2026-05-28' });
    // Structural PII guard: only the three permitted fields exist.
    expect(Object.keys(snap[0]!).sort()).toEqual(['count', 'dayBucket', 'name']);
  });

  it('evicts oldest events past the bound (ring buffer)', () => {
    const t = new NoOpRingBufferTransport(3);
    for (let i = 0; i < 5; i += 1) {
      t.record({ name: 'app.launch', count: 1, dayBucket: `2026-05-2${i}` });
    }
    const snap = t.snapshot();
    expect(snap).toHaveLength(3);
    expect(snap[0]!.dayBucket).toBe('2026-05-22'); // first two evicted
  });

  it('clear() empties the buffer (opt-out + panel reset)', () => {
    const t = new NoOpRingBufferTransport();
    t.record({ name: 'doc.save', count: 1, dayBucket: '2026-05-28' });
    t.clear();
    expect(t.snapshot()).toHaveLength(0);
  });
});
