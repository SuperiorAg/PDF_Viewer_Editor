// Handlers: bookmarks:listTree, bookmarks:move, bookmarks:rename (Phase 2).
//
// Phase 2 (api-contracts.md §12.5-§12.7, data-models.md §7.5).
// Thin adapters over the BookmarksRepo Phase-2 methods; David adapts Ravi's
// snake_case repo through db-bridge.ts (see adaptBookmarksRepo in that file).

import type { MoveBookmarkResult } from '../../main/db-bridge.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  BookmarksListTreeError,
  BookmarksListTreeRequest,
  BookmarksListTreeResponse,
  BookmarksMoveError,
  BookmarksMoveRequest,
  BookmarksMoveResponse,
  BookmarksRenameError,
  BookmarksRenameRequest,
  BookmarksRenameResponse,
  BookmarkNode,
  FileHash,
} from '../contracts.js';

const FILE_HASH_RE = /^[a-f0-9]{64}$/;
const MAX_TITLE = 256;

export interface BookmarksRepoLikePhase2 {
  listTree(fileHash: FileHash): BookmarkNode[];
  // Wave 8.5 (H-1): widened from `boolean` so the handler receives the
  // discriminated variant directly. The bridge interface in
  // src/main/db-bridge.ts now also returns MoveBookmarkResult, so production
  // (Ravi's SQLite repo via adaptBookmarksRepo), tests (MemoryBookmarksRepo),
  // and direct unit tests of the handler all flow the same shape end-to-end.
  move(id: number, newParentId: number | null, newSortOrder: number): MoveBookmarkResult;
  rename(id: number, title: string): boolean;
}

export interface BookmarksPhase2Deps {
  repo: BookmarksRepoLikePhase2;
}

export function handleBookmarksListTree(
  req: BookmarksListTreeRequest,
  deps: BookmarksPhase2Deps,
): BookmarksListTreeResponse {
  if (typeof req.fileHash !== 'string' || !FILE_HASH_RE.test(req.fileHash)) {
    return fail<BookmarksListTreeError>('db_unavailable', 'fileHash must be 64-char hex');
  }
  try {
    return ok({ tree: deps.repo.listTree(req.fileHash) });
  } catch (e) {
    return fail<BookmarksListTreeError>(
      'db_unavailable',
      safeMessage(e, 'Database is unavailable'),
    );
  }
}

export function handleBookmarksMove(
  req: BookmarksMoveRequest,
  deps: BookmarksPhase2Deps,
): BookmarksMoveResponse {
  if (typeof req.id !== 'number' || !Number.isInteger(req.id) || req.id < 0) {
    return fail<BookmarksMoveError>('invalid_payload', 'id must be a non-negative integer');
  }
  if (req.newParentId !== null && (!Number.isInteger(req.newParentId) || req.newParentId < 0)) {
    return fail<BookmarksMoveError>(
      'invalid_payload',
      'newParentId must be a non-negative integer or null',
    );
  }
  if (!Number.isInteger(req.newSortOrder) || req.newSortOrder < 0) {
    return fail<BookmarksMoveError>(
      'invalid_payload',
      'newSortOrder must be a non-negative integer',
    );
  }
  try {
    // Wave 8.5 (H-1): the repo's discriminated-union return is preserved
    // end-to-end (bridge keeps the variant, see db-bridge.ts:MoveBookmarkResult).
    // We switch on `result.error` to map each failure mode to the right IPC
    // variant. The Wave 7 implementation collapsed the result to `boolean`
    // then heuristically reconstructed the variant from `newParentId`,
    // mis-classifying every `not_found`-with-non-null-parent as
    // `cycle_detected` and rendering `invalid_parent` unreachable.
    //
    // Wave 10 / Phase 2.5 (D-10.1): the `invalid_parent → invalid_payload`
    // wire translation is removed. The Wave 8.5 amendment to
    // `docs/api-contracts.md §12.6` now lists `'invalid_parent'` as a
    // first-class variant of `BookmarksMoveError`, so the handler passes
    // the variant through verbatim. Riley's R-10.3 work updates the
    // renderer thunk error handling.
    const result = deps.repo.move(req.id, req.newParentId, req.newSortOrder);
    if (result.ok) {
      return ok({});
    }
    switch (result.error) {
      case 'not_found':
        return fail<BookmarksMoveError>('not_found', `bookmark ${req.id} not found`);
      case 'cycle_detected':
        return fail<BookmarksMoveError>(
          'cycle_detected',
          `moving bookmark ${req.id} under parent ${String(req.newParentId)} would create a cycle`,
        );
      case 'invalid_parent':
        return fail<BookmarksMoveError>(
          'invalid_parent',
          `newParentId ${String(req.newParentId)} does not exist or belongs to a different file`,
        );
      default: {
        // Exhaustiveness guard — TS catches forgotten variants at compile
        // time. The runtime branch is unreachable today and surfaces a
        // db_unavailable rather than silently succeeding if a future
        // variant is added to MoveBookmarkResult and someone forgets the
        // case here.
        const exhaustive: never = result.error;
        return fail<BookmarksMoveError>(
          'db_unavailable',
          `unknown move error variant: ${String(exhaustive)}`,
        );
      }
    }
  } catch (e) {
    return fail<BookmarksMoveError>('db_unavailable', safeMessage(e, 'Database is unavailable'));
  }
}

export function handleBookmarksRename(
  req: BookmarksRenameRequest,
  deps: BookmarksPhase2Deps,
): BookmarksRenameResponse {
  if (typeof req.id !== 'number' || !Number.isInteger(req.id) || req.id < 0) {
    return fail<BookmarksRenameError>('invalid_payload', 'id must be a non-negative integer');
  }
  if (typeof req.title !== 'string' || req.title.length === 0 || req.title.length > MAX_TITLE) {
    return fail<BookmarksRenameError>('invalid_payload', `title must be 1..${MAX_TITLE} chars`);
  }
  try {
    const renamed = deps.repo.rename(req.id, req.title);
    if (!renamed) {
      return fail<BookmarksRenameError>('not_found', `bookmark ${req.id} not found`);
    }
    return ok({});
  } catch (e) {
    return fail<BookmarksRenameError>('db_unavailable', safeMessage(e, 'Database is unavailable'));
  }
}
