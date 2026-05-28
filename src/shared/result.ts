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
