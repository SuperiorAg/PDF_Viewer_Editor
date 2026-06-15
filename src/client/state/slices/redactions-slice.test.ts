// Redactions slice tests — Phase 7.4 B1 (Wave 2, Riley).
// Covers the reducer + selector contract from docs/phase-7.4-b1-redaction-design.md §7.2.

import { describe, expect, it } from 'vitest';

import redactionsReducer, {
  addMark,
  applySucceeded,
  clearMarks,
  removeMark,
  selectRedactionPagesWithMarks,
  selectRedactionTotalMarks,
  setActiveRedactionTool,
  setApplyError,
  setApplying,
  setPendingInvalidatedSignatureFields,
  setShowMarks,
} from './redactions-slice';

const INITIAL = redactionsReducer(undefined, { type: '@@INIT' });

const RECT = { x: 10, y: 20, width: 100, height: 40 };

describe('redactionsSlice — reducer contract', () => {
  it('initial state has no tool, no marks, showMarks on', () => {
    expect(INITIAL.activeTool).toBeNull();
    expect(INITIAL.byPage).toEqual({});
    expect(INITIAL.totalMarks).toBe(0);
    expect(INITIAL.showMarks).toBe(true);
    expect(INITIAL.applying).toBe(false);
    expect(INITIAL.lastApplyError).toBeNull();
    expect(INITIAL.pendingInvalidatedSignatureFields).toEqual([]);
  });

  it('setActiveRedactionTool updates the tool only', () => {
    const s = redactionsReducer(INITIAL, setActiveRedactionTool('rect'));
    expect(s.activeTool).toBe('rect');
    expect(s.byPage).toEqual({});
  });

  it('addMark synthesizes id + createdAt and bumps totalMarks', () => {
    const s = redactionsReducer(INITIAL, addMark({ pageIndex: 1, rect: RECT }));
    expect(s.byPage[1]).toHaveLength(1);
    expect(s.byPage[1]?.[0]?.id).toMatch(/^r-/);
    expect(s.byPage[1]?.[0]?.createdAt).toBeGreaterThan(0);
    expect(s.byPage[1]?.[0]?.rect).toEqual(RECT);
    expect(s.totalMarks).toBe(1);
  });

  it('addMark with injected id + createdAt is deterministic for tests', () => {
    const s = redactionsReducer(
      INITIAL,
      addMark({ pageIndex: 0, rect: RECT, id: 'm-1', createdAt: 42 }),
    );
    expect(s.byPage[0]?.[0]?.id).toBe('m-1');
    expect(s.byPage[0]?.[0]?.createdAt).toBe(42);
  });

  it('addMark across multiple pages stacks per page and counts total', () => {
    let s = redactionsReducer(INITIAL, addMark({ pageIndex: 0, rect: RECT, id: 'a' }));
    s = redactionsReducer(s, addMark({ pageIndex: 0, rect: RECT, id: 'b' }));
    s = redactionsReducer(s, addMark({ pageIndex: 2, rect: RECT, id: 'c' }));
    expect(s.byPage[0]).toHaveLength(2);
    expect(s.byPage[2]).toHaveLength(1);
    expect(s.totalMarks).toBe(3);
    expect(selectRedactionTotalMarks({ redactions: s })).toBe(3);
    expect(selectRedactionPagesWithMarks({ redactions: s })).toBe(2);
  });

  it('removeMark decrements totalMarks and deletes page entry when last mark removed', () => {
    let s = redactionsReducer(INITIAL, addMark({ pageIndex: 1, rect: RECT, id: 'x' }));
    s = redactionsReducer(s, addMark({ pageIndex: 1, rect: RECT, id: 'y' }));
    s = redactionsReducer(s, removeMark({ pageIndex: 1, id: 'x' }));
    expect(s.byPage[1]).toHaveLength(1);
    expect(s.totalMarks).toBe(1);
    s = redactionsReducer(s, removeMark({ pageIndex: 1, id: 'y' }));
    expect(s.byPage[1]).toBeUndefined();
    expect(s.totalMarks).toBe(0);
  });

  it('clearMarks resets byPage + totalMarks but preserves activeTool/showMarks', () => {
    let s = redactionsReducer(INITIAL, setActiveRedactionTool('rect'));
    s = redactionsReducer(s, addMark({ pageIndex: 0, rect: RECT }));
    s = redactionsReducer(s, addMark({ pageIndex: 1, rect: RECT }));
    s = redactionsReducer(s, clearMarks());
    expect(s.byPage).toEqual({});
    expect(s.totalMarks).toBe(0);
    expect(s.activeTool).toBe('rect');
    expect(s.showMarks).toBe(true);
  });

  it('setShowMarks toggles overlay flag', () => {
    let s = redactionsReducer(INITIAL, setShowMarks(false));
    expect(s.showMarks).toBe(false);
    s = redactionsReducer(s, setShowMarks(true));
    expect(s.showMarks).toBe(true);
  });

  it('setApplying clears lastApplyError when going to true', () => {
    let s = redactionsReducer(INITIAL, setApplyError('engine_failed'));
    expect(s.lastApplyError).toBe('engine_failed');
    s = redactionsReducer(s, setApplying(true));
    expect(s.applying).toBe(true);
    expect(s.lastApplyError).toBeNull();
  });

  it('setApplyError clears applying flag', () => {
    let s = redactionsReducer(INITIAL, setApplying(true));
    s = redactionsReducer(s, setApplyError('engine_failed'));
    expect(s.applying).toBe(false);
    expect(s.lastApplyError).toBe('engine_failed');
  });

  it('setPendingInvalidatedSignatureFields stores the list for the modal', () => {
    const s = redactionsReducer(
      INITIAL,
      setPendingInvalidatedSignatureFields(['SigField1', 'SigField2']),
    );
    expect(s.pendingInvalidatedSignatureFields).toEqual(['SigField1', 'SigField2']);
  });

  it('applySucceeded clears marks + error + tool', () => {
    let s = redactionsReducer(INITIAL, setActiveRedactionTool('rect'));
    s = redactionsReducer(s, addMark({ pageIndex: 0, rect: RECT }));
    s = redactionsReducer(s, setApplyError('engine_failed'));
    s = redactionsReducer(s, applySucceeded());
    expect(s.byPage).toEqual({});
    expect(s.totalMarks).toBe(0);
    expect(s.applying).toBe(false);
    expect(s.lastApplyError).toBeNull();
    expect(s.activeTool).toBeNull();
  });
});
