// @vitest-environment node
//
// Phase 7 (Wave 28a, David) — telemetry:recordEvent handler tests.
//
// THE HEADLINE: the `.strict()` zod schema is the STRUCTURAL PII guard. A
// request carrying ANY extra property (userId, filePath, docTitle, value, …)
// is REJECTED with `invalid_payload`. The privacy promise is structural, not a
// discipline that can be forgotten.
//
// Other pins:
//   - opt-in OFF => recorded:false, reason not_opted_in (renderer assertion)
//   - non-allowlisted name => recorded:false, reason not_allowlisted
//   - dayBucket must be YYYY-MM-DD (no sub-day timestamp; anti-fingerprint)
//   - happy path => recorded:true

import { describe, expect, it } from 'vitest';

import {
  createTelemetryService,
  NoOpRingBufferTransport,
  type TelemetryService,
} from '../../main/telemetry.js';

import { handleTelemetryRecordEvent } from './telemetry-record-event.js';

function makeService(optIn: boolean): TelemetryService {
  let value = optIn;
  return createTelemetryService({
    transport: new NoOpRingBufferTransport(10),
    settings: {
      getOptIn: () => value,
      setOptIn: (v) => {
        value = v;
      },
    },
    now: () => 1_000,
  });
}

describe('handleTelemetryRecordEvent — the .strict() PII guard', () => {
  it('REJECTS an extra userId field (structural PII guard)', async () => {
    const service = makeService(true);
    const r = await handleTelemetryRecordEvent(
      { name: 'doc.open', dayBucket: '2026-05-27', userId: 'x' },
      { service },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('REJECTS an extra filePath field (no path can ever be recorded)', async () => {
    const service = makeService(true);
    const r = await handleTelemetryRecordEvent(
      { name: 'doc.open', dayBucket: '2026-05-27', filePath: 'C:\\secret\\contract.pdf' },
      { service },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('REJECTS an extra docTitle / content field (no document content)', async () => {
    const service = makeService(true);
    const r = await handleTelemetryRecordEvent(
      { name: 'feature.export.docx', dayBucket: '2026-05-27', docTitle: 'NDA-Acme' },
      { service },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('REJECTS a sub-day timestamp masquerading as dayBucket', async () => {
    const service = makeService(true);
    const r = await handleTelemetryRecordEvent(
      { name: 'doc.open', dayBucket: '2026-05-27T13:45:22.123Z' },
      { service },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('REJECTS a malformed dayBucket (wrong format)', async () => {
    const service = makeService(true);
    const r = await handleTelemetryRecordEvent(
      { name: 'doc.open', dayBucket: 'May 27 2026' },
      { service },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('does NOT echo the rejected payload back in the error message', async () => {
    const service = makeService(true);
    const r = await handleTelemetryRecordEvent(
      { name: 'doc.open', dayBucket: '2026-05-27', userId: 'leaky@example.com' },
      { service },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).not.toContain('leaky@example.com');
    }
  });
});

describe('handleTelemetryRecordEvent — opt-in + allowlist re-checks', () => {
  it('opt-in OFF => recorded:false, reason not_opted_in', async () => {
    const service = makeService(false);
    const r = await handleTelemetryRecordEvent(
      { name: 'doc.open', dayBucket: '2026-05-27' },
      { service },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not_opted_in');
  });

  it('non-allowlisted name => recorded:false, reason not_allowlisted', async () => {
    const service = makeService(true);
    const r = await handleTelemetryRecordEvent(
      { name: 'feature.exfiltrate.everything', dayBucket: '2026-05-27' },
      { service },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not_allowlisted');
  });

  it('happy path (opt-in ON + allowlisted + valid bucket) => recorded:true', async () => {
    const service = makeService(true);
    const r = await handleTelemetryRecordEvent(
      { name: 'feature.ocr.run', dayBucket: '2026-05-27' },
      { service },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.recorded).toBe(true);
  });

  it('rejects a missing payload', async () => {
    const service = makeService(true);
    const r = await handleTelemetryRecordEvent({}, { service });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects a non-string name', async () => {
    const service = makeService(true);
    const r = await handleTelemetryRecordEvent({ name: 42, dayBucket: '2026-05-27' }, { service });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });
});
