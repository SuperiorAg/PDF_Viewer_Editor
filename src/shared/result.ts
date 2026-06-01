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
// `process.env` is read via the indirection below so this module compiles in
// both the main (`@types/node`) and renderer (`vite/client`) tsconfigs —
// `src/shared/**` is on both include paths. In the renderer this helper is
// effectively dead code (handlers don't run there) but it must still typecheck.
//
// Pair with electron-log on the main side keyed by request id when full
// diagnostics are needed — never via the IPC Result.message.
// ----------------------------------------------------------------------------
function readNodeEnv(): string {
  // `process` is typed by @types/node in the main tsconfig but absent from the
  // renderer tsconfig (which only includes `vite/client`). `src/shared/**` is
  // on both include paths, so we read via `globalThis` to compile in both. In
  // the renderer this branch is dead code (handlers don't run there).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cross-process global lookup
  const env = (globalThis as any).process?.env as Record<string, string | undefined> | undefined;
  return env?.['NODE_ENV'] ?? '';
}

export function safeMessage(e: unknown, fallback: string): string {
  if (readNodeEnv() === 'production') return fallback;
  if (e instanceof Error && typeof e.message === 'string' && e.message.length > 0) {
    return e.message;
  }
  return fallback;
}
