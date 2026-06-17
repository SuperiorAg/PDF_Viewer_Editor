// Handlers: stamps:list / stamps:create / stamps:delete (Phase 7.5 Wave 3, B7).
//
// Contract: docs/api-contracts.md §19.10 ("follows the Phase 1 bookmarks:*
// repo-pattern shape"). DTO mirrors data-models §13.10.
//
// The handlers take a thin StampsLibraryRepoBridge dependency rather than
// Ravi's raw `StampsLibraryRepo`. The bridge:
//   - exposes camelCase DTOs (matching data-models §13.10), translated from
//     the SQLite snake_case row shape;
//   - returns discriminated-union results for the failure cases (deleteUserStamp
//     'forbidden_builtin' / 'not_found'; insertUserStamp 'invalid_payload').
//
// The production wiring of the bridge lives in src/main/db-bridge.ts
// (adaptStampsLibraryRepo + MemoryStampsLibraryRepo). When the db-bridge is
// `null` (very early boot before setDbBridge), the handlers return
// 'db_unavailable'.

import { z } from 'zod';

import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  StampLibraryEntry,
  StampsCreateError,
  StampsCreateRequest,
  StampsCreateResponse,
  StampsCreateValue,
  StampsDeleteError,
  StampsDeleteRequest,
  StampsDeleteResponse,
  StampsDeleteValue,
  StampsListError,
  StampsListRequest,
  StampsListResponse,
  StampsListValue,
} from '../contracts.js';

// ============================================================================
// Bridge contract (David owns; mirror in db-bridge.ts)
// ============================================================================

export interface StampsLibraryRepoBridge {
  /** All entries; recency-desc with NULLs last. */
  list(): StampLibraryEntry[];
  /** Only entries with lastUsedAt !== null. */
  listRecent(limit: number): StampLibraryEntry[];
  /** Filter by kind. */
  listByKind(kind: 'text' | 'image'): StampLibraryEntry[];
  /** Single entry or null. */
  getById(id: number): StampLibraryEntry | null;
  /** Single builtin entry or null. */
  getByBuiltinKey(key: string): StampLibraryEntry | null;
  /** Insert a USER stamp. */
  insertUserStamp(input: {
    name: string;
    kind: 'text' | 'image';
    textValue?: string | null;
    imagePath?: string | null;
    widthPt: number;
    heightPt: number;
    color?: string | null;
  }): { ok: true; id: number } | { ok: false; error: 'invalid_payload'; reason: string };
  /** Delete a USER stamp. Refuses to delete built-ins. */
  deleteUserStamp(
    id: number,
  ):
    | { ok: true; removed: number }
    | { ok: false; error: 'forbidden_builtin' }
    | { ok: false; error: 'not_found' };
  /** Best-effort: bump last_used_at + use_count. */
  recordUse(id: number, now?: number): number | null;
}

// ============================================================================
// stamps:list
// ============================================================================

const DEFAULT_RECENT_LIMIT = 12;

const listRequestSchema = z.object({
  filter: z.enum(['all', 'recent', 'text', 'image']).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export interface StampsListDeps {
  repo: StampsLibraryRepoBridge | null;
}

export async function handleStampsList(
  req: unknown,
  deps: StampsListDeps,
): Promise<StampsListResponse> {
  if (!deps.repo) return fail<StampsListError>('db_unavailable', 'stamps repo not wired');

  // Treat undefined / null request as the empty default object so callers can
  // invoke list() without args.
  const parsed = listRequestSchema.safeParse(req ?? {});
  if (!parsed.success) {
    return fail<StampsListError>('db_unavailable', `invalid_payload: ${parsed.error.message}`);
  }
  const r = parsed.data as StampsListRequest;
  const filter = r.filter ?? 'all';

  let entries: StampLibraryEntry[] = [];
  try {
    if (filter === 'all') entries = deps.repo.list();
    else if (filter === 'recent') entries = deps.repo.listRecent(r.limit ?? DEFAULT_RECENT_LIMIT);
    else entries = deps.repo.listByKind(filter);
  } catch (e) {
    return fail<StampsListError>('db_unavailable', safeMessage(e, 'stamps repo threw on list'));
  }

  const v: StampsListValue = { entries };
  return ok(v);
}

// ============================================================================
// stamps:create
// ============================================================================

const createRequestSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(['text', 'image']),
  textValue: z.string().min(1).max(500).optional().nullable(),
  imagePath: z.string().min(1).max(1024).optional().nullable(),
  widthPt: z.number().positive(),
  heightPt: z.number().positive(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
});

export interface StampsCreateDeps {
  repo: StampsLibraryRepoBridge | null;
}

export async function handleStampsCreate(
  req: unknown,
  deps: StampsCreateDeps,
): Promise<StampsCreateResponse> {
  if (!deps.repo) return fail<StampsCreateError>('db_unavailable', 'stamps repo not wired');

  const parsed = createRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<StampsCreateError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data as StampsCreateRequest;
  if (r.kind === 'text' && (typeof r.textValue !== 'string' || r.textValue.length === 0)) {
    return fail<StampsCreateError>('invalid_payload', 'text stamps require textValue');
  }
  if (r.kind === 'image' && (typeof r.imagePath !== 'string' || r.imagePath.length === 0)) {
    return fail<StampsCreateError>('invalid_payload', 'image stamps require imagePath');
  }

  let res;
  try {
    res = deps.repo.insertUserStamp({
      name: r.name,
      kind: r.kind,
      textValue: r.textValue ?? null,
      imagePath: r.imagePath ?? null,
      widthPt: r.widthPt,
      heightPt: r.heightPt,
      color: r.color ?? null,
    });
  } catch (e) {
    return fail<StampsCreateError>('engine_failed', safeMessage(e, 'stamps repo threw on insert'));
  }

  if (!res.ok) {
    return fail<StampsCreateError>('invalid_payload', res.reason);
  }
  const v: StampsCreateValue = { id: res.id };
  return ok(v);
}

// ============================================================================
// stamps:delete
// ============================================================================

const deleteRequestSchema = z.object({
  id: z.number().int().positive(),
});

export interface StampsDeleteDeps {
  repo: StampsLibraryRepoBridge | null;
}

export async function handleStampsDelete(
  req: unknown,
  deps: StampsDeleteDeps,
): Promise<StampsDeleteResponse> {
  if (!deps.repo) return fail<StampsDeleteError>('db_unavailable', 'stamps repo not wired');

  const parsed = deleteRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<StampsDeleteError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data as StampsDeleteRequest;

  let res;
  try {
    res = deps.repo.deleteUserStamp(r.id);
  } catch (e) {
    return fail<StampsDeleteError>('engine_failed', safeMessage(e, 'stamps repo threw on delete'));
  }

  if (!res.ok) {
    if (res.error === 'forbidden_builtin') {
      return fail<StampsDeleteError>('forbidden_builtin', 'cannot delete built-in stamps');
    }
    return fail<StampsDeleteError>('not_found', `stamp ${r.id} not found`);
  }
  const v: StampsDeleteValue = { removed: res.removed };
  return ok(v);
}
