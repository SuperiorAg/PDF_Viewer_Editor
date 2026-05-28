// Test-support helpers for IPC handler tests.
//
// Closes the silent-pass risk Julian flagged in Wave 2 code review §G (MEDIUM):
// tests written as `if (!res.ok) expect(res.error).toBe('…')` SILENTLY PASS if a
// regression makes the handler return `{ ok: true, … }` — the conditional body
// just doesn't execute. The helpers below assert the discriminant BEFORE
// drilling into the variant, so a wrong-variant regression fails loudly.
//
// Wave 5 / Phase 1.1 (DV-1.1). Not shipped in the runtime bundle — Diego's
// build configs already exclude `**/*.test.ts` and (per H-LOW §H bullet) will
// extend to `**/test-support.ts`.

import { expect } from 'vitest';

import type { Result } from '../../shared/result.js';

/**
 * Asserts that `res` is the Err variant and its `error` discriminant equals `e`.
 *
 * Narrows `res` to the Err branch for callers that want to read `.message` or
 * `.details` after the assertion (TypeScript `asserts` annotation).
 *
 * @example
 *   const res = await handleX(req, deps);
 *   expectErr(res, 'invalid_payload');
 *   // res is now typed as { ok: false; error: 'invalid_payload'; message: string; ... }
 */
export function expectErr<E extends string>(
  res: Result<unknown, E>,
  e: E,
): asserts res is { ok: false; error: E; message: string; details?: Record<string, unknown> } {
  expect(res.ok).toBe(false);
  if (res.ok) {
    // Unreachable after the expect() above unless the harness keeps going.
    throw new Error(
      `expectErr('${e}') failed: got Ok(${JSON.stringify((res as { value: unknown }).value)})`,
    );
  }
  expect(res.error).toBe(e);
}

/**
 * Asserts that `res` is the Ok variant and returns its `value` for further
 * assertions. Replaces the `expect(res.ok).toBe(true); if (res.ok) { … }`
 * boilerplate at every success-path call site.
 *
 * @example
 *   const value = expectOk(await handleX(req, deps));
 *   expect(value.handle).toBe(7);
 */
export function expectOk<T>(res: Result<T, string>): T {
  expect(res.ok).toBe(true);
  if (!res.ok) {
    throw new Error(`expectOk failed: got Err('${res.error}': ${res.message})`);
  }
  return res.value;
}
