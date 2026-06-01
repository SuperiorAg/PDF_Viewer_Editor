// Handlers: bookmarks:list, bookmarks:upsert, bookmarks:delete.

import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  BookmarkRow,
  BookmarksDeleteError,
  BookmarksDeleteRequest,
  BookmarksDeleteResponse,
  BookmarksListError,
  BookmarksListRequest,
  BookmarksListResponse,
  BookmarksUpsertError,
  BookmarksUpsertRequest,
  BookmarksUpsertResponse,
  FileHash,
} from '../contracts.js';

const FILE_HASH_RE = /^[a-f0-9]{64}$/;
const MAX_TITLE = 256;

export interface BookmarksRepoLike {
  listByFile(fileHash: FileHash): BookmarkRow[];
  upsert(row: {
    id?: number;
    fileHash: FileHash;
    pageIndex: number;
    title: string;
    createdAt?: number;
  }): number;
  delete(id: number): boolean;
}

export interface BookmarksDeps {
  repo: BookmarksRepoLike;
}

export function handleBookmarksList(
  req: BookmarksListRequest,
  deps: BookmarksDeps,
): BookmarksListResponse {
  if (typeof req.fileHash !== 'string' || !FILE_HASH_RE.test(req.fileHash)) {
    return fail<BookmarksListError>('db_unavailable', 'fileHash must be 64-char hex');
  }
  try {
    return ok({ items: deps.repo.listByFile(req.fileHash) });
  } catch (e) {
    return fail<BookmarksListError>('db_unavailable', safeMessage(e, 'Database is unavailable'));
  }
}

export function handleBookmarksUpsert(
  req: BookmarksUpsertRequest,
  deps: BookmarksDeps,
): BookmarksUpsertResponse {
  if (typeof req.fileHash !== 'string' || !FILE_HASH_RE.test(req.fileHash)) {
    return fail<BookmarksUpsertError>('invalid_payload', 'fileHash must be 64-char hex');
  }
  if (typeof req.pageIndex !== 'number' || !Number.isInteger(req.pageIndex) || req.pageIndex < 0) {
    return fail<BookmarksUpsertError>('invalid_payload', 'pageIndex must be a non-negative int');
  }
  if (typeof req.title !== 'string' || req.title.length === 0 || req.title.length > MAX_TITLE) {
    return fail<BookmarksUpsertError>('invalid_payload', `title must be 1..${MAX_TITLE} chars`);
  }
  if (req.id !== undefined && (!Number.isInteger(req.id) || req.id < 0)) {
    return fail<BookmarksUpsertError>('invalid_payload', 'id must be a non-negative int');
  }

  try {
    // D-2 / TS2379 fix: conditional spread for the optional `id` so we never
    // hand `undefined` into a `number?` field (exactOptionalPropertyTypes).
    const id = deps.repo.upsert({
      fileHash: req.fileHash,
      pageIndex: req.pageIndex,
      title: req.title,
      ...(req.id !== undefined ? { id: req.id } : {}),
    });
    return ok({ id });
  } catch (e) {
    const raw = (e as Error).message || '';
    if (/unique/i.test(raw)) {
      return fail<BookmarksUpsertError>('duplicate', safeMessage(e, 'Bookmark already exists'));
    }
    return fail<BookmarksUpsertError>('db_unavailable', safeMessage(e, 'Database is unavailable'));
  }
}

export function handleBookmarksDelete(
  req: BookmarksDeleteRequest,
  deps: BookmarksDeps,
): BookmarksDeleteResponse {
  if (typeof req.id !== 'number' || !Number.isInteger(req.id) || req.id < 0) {
    return fail<BookmarksDeleteError>('not_found', 'id must be a non-negative int');
  }
  try {
    const found = deps.repo.delete(req.id);
    if (!found) return fail<BookmarksDeleteError>('not_found', `bookmark id ${req.id} not found`);
    return ok({});
  } catch (e) {
    return fail<BookmarksDeleteError>('db_unavailable', safeMessage(e, 'Database is unavailable'));
  }
}
