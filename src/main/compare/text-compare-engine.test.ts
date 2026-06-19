// Tests for the text-compare engine (Phase 7.5 Wave 7).

import { describe, expect, it } from 'vitest';

import { compareTexts } from './text-compare-engine.js';

describe('compareTexts', () => {
  it('returns empty diff when both sides are null', () => {
    const res = compareTexts({ leftText: null, rightText: null });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.diffs).toEqual([]);
    expect(res.value.summary).toEqual({
      equalChars: 0,
      insertChars: 0,
      deleteChars: 0,
      changed: false,
    });
  });

  it('returns empty diff when both sides are empty strings', () => {
    const res = compareTexts({ leftText: '', rightText: '' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.diffs).toEqual([]);
    expect(res.value.summary.changed).toBe(false);
  });

  it('returns a single equal segment when both texts are identical', () => {
    const res = compareTexts({
      leftText: 'Hello, world!',
      rightText: 'Hello, world!',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.diffs).toHaveLength(1);
    expect(res.value.diffs[0].kind).toBe('equal');
    expect(res.value.diffs[0].text).toBe('Hello, world!');
    expect(res.value.summary).toEqual({
      equalChars: 13,
      insertChars: 0,
      deleteChars: 0,
      changed: false,
    });
  });

  it('emits insert + delete segments when texts diverge', () => {
    const res = compareTexts({
      leftText: 'The quick brown fox',
      rightText: 'The lazy brown fox',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const kinds = res.value.diffs.map((d) => d.kind);
    expect(kinds).toContain('equal');
    expect(kinds).toContain('insert');
    expect(kinds).toContain('delete');
    expect(res.value.summary.changed).toBe(true);
    expect(res.value.summary.insertChars).toBeGreaterThan(0);
    expect(res.value.summary.deleteChars).toBeGreaterThan(0);
    expect(res.value.summary.equalChars).toBeGreaterThan(0);
  });

  it('treats left=null as a full insert (orphan modified-only page)', () => {
    const res = compareTexts({
      leftText: null,
      rightText: 'newly added page',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.diffs).toHaveLength(1);
    expect(res.value.diffs[0]).toEqual({
      kind: 'insert',
      text: 'newly added page',
    });
    expect(res.value.summary).toEqual({
      equalChars: 0,
      insertChars: 16,
      deleteChars: 0,
      changed: true,
    });
  });

  it('treats right=null as a full delete (orphan baseline-only page)', () => {
    const res = compareTexts({
      leftText: 'removed page',
      rightText: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.diffs).toHaveLength(1);
    expect(res.value.diffs[0]).toEqual({
      kind: 'delete',
      text: 'removed page',
    });
    expect(res.value.summary).toEqual({
      equalChars: 0,
      insertChars: 0,
      deleteChars: 12,
      changed: true,
    });
  });

  it('returns an empty result for orphan with empty present-side', () => {
    const res = compareTexts({ leftText: null, rightText: '' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.diffs).toEqual([]);
    expect(res.value.summary.changed).toBe(false);
  });

  it('rejects non-string non-null inputs', () => {
    const res = compareTexts({
      leftText: 42 as unknown as string,
      rightText: 'ok',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('invalid_payload');
  });

  it('emits insert-only when left is empty string', () => {
    const res = compareTexts({ leftText: '', rightText: 'abc' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.summary.insertChars).toBe(3);
    expect(res.value.summary.deleteChars).toBe(0);
    expect(res.value.summary.changed).toBe(true);
  });

  it('emits delete-only when right is empty string', () => {
    const res = compareTexts({ leftText: 'abc', rightText: '' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.summary.deleteChars).toBe(3);
    expect(res.value.summary.insertChars).toBe(0);
    expect(res.value.summary.changed).toBe(true);
  });

  it('preserves character-count math across complex diffs', () => {
    // Total left + total right - 2*equal = inserts + deletes (algebra
    // check for the summary). Use slightly larger inputs to surface
    // any miscounting.
    const left = 'aaaa bbbb cccc dddd eeee';
    const right = 'aaaa xxxx cccc yyyy eeee';
    const res = compareTexts({ leftText: left, rightText: right });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { equalChars, insertChars, deleteChars } = res.value.summary;
    // The reconstructed text length on each side equals the original.
    expect(equalChars + deleteChars).toBe(left.length);
    expect(equalChars + insertChars).toBe(right.length);
  });
});
