import { describe, expect, it } from 'vitest';

import selectionReducer, {
  clearSelection,
  extendSelection,
  selectAll,
  selectOnly,
  toggleSelection,
} from './selection-slice';

describe('selectionSlice', () => {
  it('selectOnly replaces the selection', () => {
    let s = selectionReducer(undefined, { type: 'init' });
    s = selectionReducer(s, selectOnly(2));
    expect(s.selectedPageIndices).toEqual([2]);
  });

  it('toggleSelection adds and removes', () => {
    let s = selectionReducer(undefined, { type: 'init' });
    s = selectionReducer(s, toggleSelection(1));
    s = selectionReducer(s, toggleSelection(3));
    // D-3 fix (2026-05-21): RTK/Immer freezes reducer results, so we must clone
    // before calling the in-place `.sort()`. Mutating the frozen array throws
    // `Cannot assign to read only property '0'`.
    expect([...s.selectedPageIndices].sort()).toEqual([1, 3]);
    s = selectionReducer(s, toggleSelection(1));
    expect(s.selectedPageIndices).toEqual([3]);
  });

  it('extendSelection selects an inclusive range', () => {
    let s = selectionReducer(undefined, { type: 'init' });
    s = selectionReducer(s, selectOnly(2));
    s = selectionReducer(s, extendSelection({ to: 5, total: 10 }));
    expect(s.selectedPageIndices).toEqual([2, 3, 4, 5]);
  });

  it('selectAll selects every index up to total', () => {
    let s = selectionReducer(undefined, { type: 'init' });
    s = selectionReducer(s, selectAll(4));
    expect(s.selectedPageIndices).toEqual([0, 1, 2, 3]);
  });

  it('clearSelection empties', () => {
    let s = selectionReducer(undefined, { type: 'init' });
    s = selectionReducer(s, selectOnly(1));
    s = selectionReducer(s, clearSelection());
    expect(s.selectedPageIndices).toEqual([]);
  });
});
