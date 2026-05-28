// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { handleSignaturesRequestTimestamp } from './signatures-request-timestamp.js';

describe('handleSignaturesRequestTimestamp', () => {
  it('rejects non-https URL', async () => {
    const r = await handleSignaturesRequestTimestamp({
      tsaUrl: 'http://insecure.example.com',
      hash: new Uint8Array(32),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects URL with userinfo', async () => {
    const r = await handleSignaturesRequestTimestamp({
      tsaUrl: 'https://user:pass@tsa.example.com',
      hash: new Uint8Array(32),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects URL with fragment', async () => {
    const r = await handleSignaturesRequestTimestamp({
      tsaUrl: 'https://tsa.example.com/path#hash',
      hash: new Uint8Array(32),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects bad hash length', async () => {
    const r = await handleSignaturesRequestTimestamp({
      tsaUrl: 'https://tsa.example.com',
      hash: new Uint8Array(16),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects timeoutMs out of range', async () => {
    const r = await handleSignaturesRequestTimestamp({
      tsaUrl: 'https://tsa.example.com',
      hash: new Uint8Array(32),
      timeoutMs: 1_000_000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  // We do NOT exercise the actual network path in unit tests; tsa-client
  // is exercised in its own test with an injected requestFn stub.
});
