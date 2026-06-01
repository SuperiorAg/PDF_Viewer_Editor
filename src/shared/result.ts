// Cross-process discriminated-union Result type used by every IPC channel.
// Renderer + main both import the same `ok` / `fail` helpers so the discriminant
// is consistent end-to-end. See docs/api-contracts.md §0 and docs/conventions.md §5.1.

export type Result<T, E extends string> =
  | { ok: true; value: T }
  | { ok: false; error: E; message: string; details?: Record<string, unknown> };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E extends string>(
  error: E,
  message: string,
  details?: Record<string, unknown>,
): Result<never, E> {
  return details === undefined
    ? { ok: false, error, message }
    : { ok: false, error, message, details };
}

// ----------------------------------------------------------------------------
// safeMessage — production-safe error-message helper for IPC handler catch blocks.
//
// Hard-Won Playbook #4 (Julian 2026-06-01 audit): every site that returns
// `fail<E>('...', (e as Error).message)` from an IPC catch block leaks the raw
// Node/SQLite error string straight into a user-visible toast. Production
// surfaces like `ENOENT: no such file or directory, open 'C:\Users\<name>\...'`
// or `SqliteError: ...` carry filesystem paths, schema details, and internal
// class names. Acceptable in dev (faster diagnosis); not acceptable in
// production (PII + attack-surface signal).
//
// Usage:
//   try { ... } catch (e) {
//     return fail<MyError>('my_error', safeMessage(e, 'Unable to read file'));
//   }
//
// Behaviour:
//   - In production (`NODE_ENV === 'production'`): returns the supplied
//     `fallback` string. Generic, actionable, no leak.
//   - Otherwise (dev / test): returns the raw `Error.message` (or the
//     fallback if `e` is not an Error).
//
// Pair with electron-log on the main side keyed by request id when full
// diagnostics are needed — never via the IPC Result.message.
// ----------------------------------------------------------------------------
export function safeMessage(e: unknown, fallback: string): string {
  if (process.env['NODE_ENV'] === 'production') return fallback;
  if (e instanceof Error && typeof e.message === 'string' && e.message.length > 0) {
    return e.message;
  }
  return fallback;
}
