import { describe, expect, it } from 'vitest';

import { createMemoryDbBridge } from '../../main/db-bridge.js';

import {
  handleBookmarksDelete,
  handleBookmarksList,
  handleBookmarksUpsert,
  type BookmarksDeps,
} from './bookmarks.js';
import { expectErr, expectOk } from './test-support.js';

function makeDeps(): BookmarksDeps {
  return { repo: createMemoryDbBridge().bookmarks };
}

const FH = 'a'.repeat(64);

describe('bookmarks handlers', () => {
  it('upsert: rejects bad fileHash', () => {
    const res = handleBookmarksUpsert({ fileHash: 'short', pageIndex: 0, title: 't' }, makeDeps());
    expectErr(res, 'invalid_payload');
  });

  it('upsert: rejects negative pageIndex', () => {
    const res = handleBookmarksUpsert({ fileHash: FH, pageIndex: -1, title: 't' }, makeDeps());
    expectErr(res, 'invalid_payload');
  });

  it('upsert: rejects empty title', () => {
    const res = handleBookmarksUpsert({ fileHash: FH, pageIndex: 0, title: '' }, makeDeps());
    expectErr(res, 'invalid_payload');
  });

  it('upsert + list roundtrip', () => {
    const deps = makeDeps();
    const up = handleBookmarksUpsert({ fileHash: FH, pageIndex: 2, title: 'Cover' }, deps);
    expectOk(up);
    const list = expectOk(handleBookmarksList({ fileHash: FH }, deps));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.title).toBe('Cover');
  });

  it('delete: returns not_found for missing id', () => {
    const res = handleBookmarksDelete({ id: 9999 }, makeDeps());
    expectErr(res, 'not_found');
  });

  it('delete: removes existing row', () => {
    const deps = makeDeps();
    const up = expectOk(handleBookmarksUpsert({ fileHash: FH, pageIndex: 1, title: 'X' }, deps));
    const del = handleBookmarksDelete({ id: up.id }, deps);
    expectOk(del);
  });
});
