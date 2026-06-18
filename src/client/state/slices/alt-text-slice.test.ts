// Alt-text slice tests — Phase 7.5 C5 (Riley Wave 5c).
// Covers reducer + helper contract from `docs/api-contracts.md §19.7.5`.

import { describe, expect, it } from 'vitest';

import { groupFiguresByPHash, type FigureWithoutAlt } from '../../types/alt-text-contract-stub';

import altTextReducer, {
  altTextApplyFailed,
  altTextApplyingStart,
  appliedAltText,
  clearAltTextSeed,
  closeAltTextBulkModal,
  loadedFigures,
  openAltTextBulkModal,
  openAltTextInspector,
  resetAltText,
  selectAltTextBulkModal,
  selectAltTextDrafts,
  selectAltTextFigures,
  selectAltTextOpen,
  selectAltTextSeedNodeId,
  setAltTextBulkDraft,
  setAltTextDraft,
  setAltTextLastError,
  setAltTextLoading,
  setAltTextOpen,
} from './alt-text-slice';

const INITIAL = altTextReducer(undefined, { type: '@@INIT' });

function f(id: string, page: number, hash?: string): FigureWithoutAlt {
  const base: FigureWithoutAlt = {
    structNodeId: id,
    pageIndex: page,
    bbox: [0, 0, 100, 100],
  };
  if (hash !== undefined) return { ...base, pHash: hash };
  return base;
}

describe('alt-text slice — reducer contract', () => {
  it('initial state is empty + closed', () => {
    expect(INITIAL.open).toBe(false);
    expect(INITIAL.figures).toEqual([]);
    expect(INITIAL.drafts).toEqual({});
    expect(INITIAL.bulkModal).toBeNull();
    expect(INITIAL.loaded).toBe(false);
  });

  it('setAltTextOpen toggles + clears bulkModal on close', () => {
    let s = altTextReducer(INITIAL, setAltTextOpen(true));
    expect(selectAltTextOpen({ altText: s })).toBe(true);
    s = altTextReducer(s, openAltTextBulkModal({ groupHash: 'h-1' }));
    expect(selectAltTextBulkModal({ altText: s })).not.toBeNull();
    s = altTextReducer(s, setAltTextOpen(false));
    expect(selectAltTextOpen({ altText: s })).toBe(false);
    expect(selectAltTextBulkModal({ altText: s })).toBeNull();
  });

  it('loadedFigures populates list + prunes stale drafts', () => {
    let s = altTextReducer(INITIAL, setAltTextDraft({ structNodeId: 'stale', value: 'old' }));
    s = altTextReducer(s, setAltTextDraft({ structNodeId: 'fresh', value: 'new' }));
    s = altTextReducer(
      s,
      loadedFigures({ docHash: 'doc-1', figures: [f('fresh', 2), f('other', 3)] }),
    );
    expect(selectAltTextFigures({ altText: s })).toHaveLength(2);
    expect(selectAltTextDrafts({ altText: s }).fresh).toBe('new');
    expect(selectAltTextDrafts({ altText: s }).stale).toBeUndefined();
    expect(s.loaded).toBe(true);
  });

  it('setAltTextDraft stores per-id values', () => {
    const s = altTextReducer(INITIAL, setAltTextDraft({ structNodeId: 'a', value: 'logo' }));
    expect(selectAltTextDrafts({ altText: s }).a).toBe('logo');
  });

  it('appliedAltText drops the figure + draft + applying flag', () => {
    let s = altTextReducer(
      INITIAL,
      loadedFigures({ docHash: 'doc-1', figures: [f('a', 0), f('b', 1)] }),
    );
    s = altTextReducer(s, setAltTextDraft({ structNodeId: 'a', value: 'logo' }));
    s = altTextReducer(s, altTextApplyingStart({ structNodeId: 'a' }));
    expect(s.applyingIds.a).toBe(true);
    s = altTextReducer(s, appliedAltText({ structNodeId: 'a' }));
    expect(selectAltTextFigures({ altText: s }).map((g) => g.structNodeId)).toEqual(['b']);
    expect(selectAltTextDrafts({ altText: s }).a).toBeUndefined();
    expect(s.applyingIds.a).toBeUndefined();
  });

  it('altTextApplyFailed clears applying flag + sets error', () => {
    let s = altTextReducer(INITIAL, altTextApplyingStart({ structNodeId: 'a' }));
    expect(s.applyingIds.a).toBe(true);
    s = altTextReducer(s, altTextApplyFailed({ structNodeId: 'a', message: 'boom' }));
    expect(s.applyingIds.a).toBeUndefined();
    expect(s.lastErrorMessage).toBe('boom');
  });

  it('bulk modal draft accumulation', () => {
    let s = altTextReducer(INITIAL, openAltTextBulkModal({ groupHash: 'group-1' }));
    s = altTextReducer(s, setAltTextBulkDraft('Acme logo'));
    expect(selectAltTextBulkModal({ altText: s })).toEqual({
      groupHash: 'group-1',
      draft: 'Acme logo',
    });
    s = altTextReducer(s, closeAltTextBulkModal());
    expect(selectAltTextBulkModal({ altText: s })).toBeNull();
  });

  it('setAltTextLastError clears loading', () => {
    let s = altTextReducer(INITIAL, setAltTextLoading(true));
    s = altTextReducer(s, setAltTextLastError('boom'));
    expect(s.loading).toBe(false);
    expect(s.lastErrorMessage).toBe('boom');
  });

  it('resetAltText returns to initial', () => {
    let s = altTextReducer(INITIAL, setAltTextOpen(true));
    s = altTextReducer(s, loadedFigures({ docHash: 'doc-1', figures: [f('a', 0)] }));
    s = altTextReducer(s, resetAltText());
    expect(s).toEqual(INITIAL);
  });

  // Wave 5d follow-up (Riley) — quick-fix seed wiring.
  // Per Wave 5d follow-up brief Fix 1: the C6 accessibility-checker quick-fix
  // 'open-alt-text-inspector' carries a struct node id; openInspector opens
  // the modal AND seeds the row to scroll into view.
  it('openAltTextInspector(no payload) opens the modal with no seed', () => {
    const s = altTextReducer(INITIAL, openAltTextInspector(undefined));
    expect(selectAltTextOpen({ altText: s })).toBe(true);
    expect(selectAltTextSeedNodeId({ altText: s })).toBeNull();
  });

  it('openAltTextInspector({seedNodeId}) opens the modal AND seeds the row', () => {
    const s = altTextReducer(INITIAL, openAltTextInspector({ seedNodeId: 'struct:7' }));
    expect(selectAltTextOpen({ altText: s })).toBe(true);
    expect(selectAltTextSeedNodeId({ altText: s })).toBe('struct:7');
  });

  it('clearAltTextSeed drops the seed without closing the modal', () => {
    let s = altTextReducer(INITIAL, openAltTextInspector({ seedNodeId: 'struct:7' }));
    s = altTextReducer(s, clearAltTextSeed());
    expect(selectAltTextOpen({ altText: s })).toBe(true);
    expect(selectAltTextSeedNodeId({ altText: s })).toBeNull();
  });

  it('setAltTextOpen(false) clears any pending seed (modal-close hygiene)', () => {
    let s = altTextReducer(INITIAL, openAltTextInspector({ seedNodeId: 'struct:7' }));
    expect(selectAltTextSeedNodeId({ altText: s })).toBe('struct:7');
    s = altTextReducer(s, setAltTextOpen(false));
    expect(selectAltTextOpen({ altText: s })).toBe(false);
    expect(selectAltTextSeedNodeId({ altText: s })).toBeNull();
  });
});

describe('alt-text contract helpers', () => {
  it('groupFiguresByPHash groups matching hashes + singletons for unhashed', () => {
    const figures: FigureWithoutAlt[] = [
      f('a', 0, 'hash-1'),
      f('b', 1, 'hash-1'),
      f('c', 2),
      f('d', 3, 'hash-2'),
      f('e', 4, 'hash-1'),
    ];
    const groups = groupFiguresByPHash(figures);
    // hash-1 (3 members) comes first, then hash-2 (1 member), then singleton 'c'.
    expect(groups[0]?.hash).toBe('hash-1');
    expect(groups[0]?.members.map((m) => m.structNodeId)).toEqual(['a', 'b', 'e']);
    expect(groups[1]?.hash).toBe('hash-2');
    expect(groups[1]?.members.map((m) => m.structNodeId)).toEqual(['d']);
    expect(groups[2]?.hash).toBeNull();
    expect(groups[2]?.members.map((m) => m.structNodeId)).toEqual(['c']);
  });

  it('groupFiguresByPHash empty list', () => {
    expect(groupFiguresByPHash([])).toEqual([]);
  });
});
