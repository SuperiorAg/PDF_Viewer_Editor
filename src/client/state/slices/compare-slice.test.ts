// Compare-slice unit tests — Phase 7.5 Wave 7 B2 (Riley).

import { describe, expect, test } from 'vitest';

import type { ComparePagePair } from '../../types/ipc-contract';

import compareReducer, {
  type ComparePageTextValue,
  type ComparePageVisualValue,
  COMPARE_DEFAULT_RENDER_WIDTH,
  COMPARE_MULTI_COLUMN_FOOTNOTE,
  COMPARE_ORPHAN_LEFT_LABEL,
  COMPARE_ORPHAN_RIGHT_LABEL,
  COMPARE_SEQUENTIAL_PAIRING_BANNER,
  COMPARE_VISUAL_RENDER_WIDTH_TEMPLATE,
  cleared,
  pairEvicted,
  selectCompareEvictableBlobs,
  selectCompareIsActive,
  selectComparePairBadgeColor,
  selectComparePairEntry,
  selectComparePairTextStatus,
  selectComparePairVisualStatus,
  selectCompareSession,
  selectCompareSetup,
  selectCompareSetupCanCompare,
  selectCompareTextInflight,
  selectCompareViewMode,
  selectCompareVisualInflight,
  sessionClosed,
  sessionOpened,
  setupClosed,
  setupLeftPicked,
  setupOpened,
  setupOpeningFailed,
  setupOpeningStarted,
  setupRightPicked,
  textRequestFailed,
  textRequestStarted,
  textRequestSucceeded,
  viewModeChanged,
  visualRequestFailed,
  visualRequestStarted,
  visualRequestSucceeded,
  type CompareSession,
  type CompareState,
} from './compare-slice';

function initial(): CompareState {
  return compareReducer(undefined, { type: '__init' });
}

function fakeSession(overrides: Partial<CompareSession> = {}): CompareSession {
  const pagePairs: ComparePagePair[] = [
    { leftPageIndex: 0, rightPageIndex: 0 },
    { leftPageIndex: 1, rightPageIndex: 1 },
    { leftPageIndex: 2, rightPageIndex: null }, // left-only orphan
  ];
  return {
    sessionId: 'session-1',
    leftDisplayName: 'baseline.pdf',
    rightDisplayName: 'modified.pdf',
    pageCountLeft: 3,
    pageCountRight: 2,
    pagePairs,
    ...overrides,
  };
}

function fakeTextValue(changed: boolean): ComparePageTextValue {
  return {
    pageNumber: 1,
    leftPageIndex: 0,
    rightPageIndex: 0,
    diffs: changed
      ? [
          { kind: 'equal', text: 'Hello ' },
          { kind: 'delete', text: 'cruel ' },
          { kind: 'insert', text: 'kind ' },
          { kind: 'equal', text: 'world' },
        ]
      : [{ kind: 'equal', text: 'Hello world' }],
    summary: {
      equalChars: changed ? 11 : 11,
      insertChars: changed ? 5 : 0,
      deleteChars: changed ? 6 : 0,
      changed,
    },
  };
}

function fakeVisualValue(diffPixels: number): ComparePageVisualValue {
  return {
    pageNumber: 1,
    leftPageIndex: 0,
    rightPageIndex: 0,
    width: 800,
    height: 1000,
    diffPixelCount: diffPixels,
    totalPixelCount: 800 * 1000,
    diffPercent: Math.round((diffPixels / (800 * 1000)) * 10000) / 100,
  };
}

describe('compare-slice — honesty strings', () => {
  test('sequential-pairing banner is the exact wording specified by Wave 7 brief', () => {
    expect(COMPARE_SEQUENTIAL_PAIRING_BANNER).toBe(
      'Pages are paired sequentially. Smarter content-matching is a future enhancement.',
    );
  });
  test('multi-column footnote is the exact wording specified by David', () => {
    expect(COMPARE_MULTI_COLUMN_FOOTNOTE).toBe(
      'Multi-column documents may show out-of-reading-order text segments. Use the Reading Order overlay to inspect tagged docs.',
    );
  });
  test('visual render-width disclosure uses the {{width}} placeholder', () => {
    expect(COMPARE_VISUAL_RENDER_WIDTH_TEMPLATE).toContain('{{width}}');
    expect(COMPARE_VISUAL_RENDER_WIDTH_TEMPLATE).toMatch(
      /renders at \{\{width\}\}px for performance\./,
    );
  });
  test('orphan labels are the exact verbatim strings', () => {
    expect(COMPARE_ORPHAN_LEFT_LABEL).toBe('Only on left');
    expect(COMPARE_ORPHAN_RIGHT_LABEL).toBe('Only on right');
  });
  test('default render width matches David engine default', () => {
    expect(COMPARE_DEFAULT_RENDER_WIDTH).toBe(800);
  });
});

describe('compare-slice — setup dialog', () => {
  test('setupOpened sets open=true and clears prior error', () => {
    const after = compareReducer(
      { ...initial(), setup: { ...initial().setup, lastOpenError: 'boom' } },
      setupOpened(),
    );
    expect(after.setup.open).toBe(true);
    expect(after.setup.lastOpenError).toBeNull();
  });

  test('setupClosed resets setup to initial', () => {
    const s1 = compareReducer(initial(), setupOpened());
    const s2 = compareReducer(
      s1,
      setupLeftPicked({ kind: 'open-doc', handle: 7, displayName: 'a.pdf' }),
    );
    const s3 = compareReducer(s2, setupClosed());
    expect(s3.setup.open).toBe(false);
    expect(s3.setup.left).toBeNull();
    expect(s3.setup.right).toBeNull();
  });

  test('setupLeftPicked and setupRightPicked assign sources', () => {
    let s = compareReducer(initial(), setupOpened());
    s = compareReducer(s, setupLeftPicked({ kind: 'open-doc', handle: 8, displayName: 'a.pdf' }));
    s = compareReducer(
      s,
      setupRightPicked({ kind: 'path', path: '/x/y.pdf', displayName: 'y.pdf' }),
    );
    expect(s.setup.left?.kind).toBe('open-doc');
    expect(s.setup.right?.kind).toBe('path');
  });

  test('canCompare selector requires both sides AND not opening', () => {
    let s = compareReducer(initial(), setupOpened());
    expect(selectCompareSetupCanCompare({ compare: s })).toBe(false);
    s = compareReducer(s, setupLeftPicked({ kind: 'open-doc', handle: 8, displayName: 'a.pdf' }));
    expect(selectCompareSetupCanCompare({ compare: s })).toBe(false);
    s = compareReducer(
      s,
      setupRightPicked({ kind: 'path', path: '/x/y.pdf', displayName: 'y.pdf' }),
    );
    expect(selectCompareSetupCanCompare({ compare: s })).toBe(true);
    s = compareReducer(s, setupOpeningStarted());
    expect(selectCompareSetupCanCompare({ compare: s })).toBe(false);
  });

  test('setupOpeningFailed surfaces a renderer-facing error', () => {
    let s = compareReducer(initial(), setupOpened());
    s = compareReducer(s, setupOpeningStarted());
    s = compareReducer(s, setupOpeningFailed('handle_not_found'));
    expect(s.setup.opening).toBe(false);
    expect(s.setup.lastOpenError).toBe('handle_not_found');
  });

  test('setupLeftPicked clears prior open error so user can retry', () => {
    let s = compareReducer(initial(), setupOpened());
    s = compareReducer(s, setupOpeningFailed('boom'));
    s = compareReducer(s, setupLeftPicked(null));
    expect(s.setup.lastOpenError).toBeNull();
  });
});

describe('compare-slice — session lifecycle', () => {
  test('sessionOpened replaces session, resets results, sets text mode', () => {
    let s = compareReducer(initial(), setupOpened());
    s = compareReducer(s, viewModeChanged('visual'));
    s = compareReducer(s, sessionOpened(fakeSession()));
    expect(s.session?.sessionId).toBe('session-1');
    expect(s.viewMode).toBe('text');
    expect(s.setup.open).toBe(false);
    expect(s.pageResults).toEqual({});
    expect(s.inflightText).toEqual({});
    expect(s.inflightVisual).toEqual({});
  });

  test('sessionClosed clears everything but preserves setup state in initial form', () => {
    let s = compareReducer(initial(), sessionOpened(fakeSession()));
    s = compareReducer(s, textRequestSucceeded({ pairIndex: 0, value: fakeTextValue(true) }));
    s = compareReducer(s, sessionClosed());
    expect(s.session).toBeNull();
    expect(s.pageResults).toEqual({});
  });

  test('selectCompareIsActive reflects session presence', () => {
    let s = initial();
    expect(selectCompareIsActive({ compare: s })).toBe(false);
    s = compareReducer(s, sessionOpened(fakeSession()));
    expect(selectCompareIsActive({ compare: s })).toBe(true);
  });

  test('selectCompareSession returns the same session object', () => {
    const session = fakeSession();
    const s = compareReducer(initial(), sessionOpened(session));
    expect(selectCompareSession({ compare: s })?.sessionId).toBe(session.sessionId);
  });
});

describe('compare-slice — view mode', () => {
  test('viewModeChanged sets the requested mode', () => {
    let s = compareReducer(initial(), sessionOpened(fakeSession()));
    s = compareReducer(s, viewModeChanged('side-by-side'));
    expect(selectCompareViewMode({ compare: s })).toBe('side-by-side');
    s = compareReducer(s, viewModeChanged('visual'));
    expect(selectCompareViewMode({ compare: s })).toBe('visual');
  });
});

describe('compare-slice — text request lifecycle', () => {
  test('textRequestStarted marks inflight + sets loading', () => {
    const s = compareReducer(initial(), textRequestStarted(0));
    expect(selectCompareTextInflight({ compare: s }, 0)).toBe(true);
    expect(selectComparePairTextStatus({ compare: s }, 0)).toBe('loading');
  });

  test('textRequestSucceeded clears inflight, sets ready, stores value', () => {
    let s = compareReducer(initial(), textRequestStarted(2));
    s = compareReducer(s, textRequestSucceeded({ pairIndex: 2, value: fakeTextValue(true) }));
    expect(selectCompareTextInflight({ compare: s }, 2)).toBe(false);
    expect(selectComparePairTextStatus({ compare: s }, 2)).toBe('ready');
    const entry = selectComparePairEntry({ compare: s }, 2);
    expect(entry?.text.textValue?.summary.changed).toBe(true);
  });

  test('textRequestFailed clears inflight + surfaces message', () => {
    let s = compareReducer(initial(), textRequestStarted(1));
    s = compareReducer(s, textRequestFailed({ pairIndex: 1, message: 'extraction_failed' }));
    expect(selectComparePairTextStatus({ compare: s }, 1)).toBe('error');
    expect(selectComparePairEntry({ compare: s }, 1)?.text.errorMessage).toBe('extraction_failed');
    expect(selectCompareTextInflight({ compare: s }, 1)).toBe(false);
  });
});

describe('compare-slice — visual request lifecycle', () => {
  test('visualRequestStarted marks inflight + sets loading', () => {
    const s = compareReducer(initial(), visualRequestStarted(0));
    expect(selectCompareVisualInflight({ compare: s }, 0)).toBe(true);
    expect(selectComparePairVisualStatus({ compare: s }, 0)).toBe('loading');
  });

  test('visualRequestSucceeded stores blob URLs + value', () => {
    let s = compareReducer(initial(), visualRequestStarted(0));
    s = compareReducer(
      s,
      visualRequestSucceeded({
        pairIndex: 0,
        value: fakeVisualValue(5000),
        diffMaskUrl: 'blob:diff-0',
        leftUrl: 'blob:left-0',
        rightUrl: 'blob:right-0',
      }),
    );
    const entry = selectComparePairEntry({ compare: s }, 0);
    expect(entry?.visual.diffMaskUrl).toBe('blob:diff-0');
    expect(entry?.visual.leftUrl).toBe('blob:left-0');
    expect(entry?.visual.rightUrl).toBe('blob:right-0');
    expect(entry?.visual.visualValue?.diffPixelCount).toBe(5000);
  });

  test('visualRequestSucceeded with null left/right (orphan) is preserved', () => {
    let s = compareReducer(initial(), visualRequestStarted(2));
    s = compareReducer(
      s,
      visualRequestSucceeded({
        pairIndex: 2,
        value: fakeVisualValue(0),
        diffMaskUrl: 'blob:diff-2',
        leftUrl: 'blob:left-2',
        rightUrl: null,
      }),
    );
    const entry = selectComparePairEntry({ compare: s }, 2);
    expect(entry?.visual.leftUrl).toBe('blob:left-2');
    expect(entry?.visual.rightUrl).toBeNull();
  });

  test('visualRequestFailed clears inflight + surfaces message', () => {
    let s = compareReducer(initial(), visualRequestStarted(1));
    s = compareReducer(s, visualRequestFailed({ pairIndex: 1, message: 'rasterize_failed' }));
    expect(selectComparePairVisualStatus({ compare: s }, 1)).toBe('error');
    expect(selectComparePairEntry({ compare: s }, 1)?.visual.errorMessage).toBe('rasterize_failed');
  });
});

describe('compare-slice — eviction + clear', () => {
  test('pairEvicted removes the entry but does NOT touch other pairs', () => {
    let s = compareReducer(
      initial(),
      textRequestSucceeded({ pairIndex: 0, value: fakeTextValue(true) }),
    );
    s = compareReducer(s, textRequestSucceeded({ pairIndex: 1, value: fakeTextValue(false) }));
    s = compareReducer(s, pairEvicted(0));
    expect(selectComparePairEntry({ compare: s }, 0)).toBeUndefined();
    expect(selectComparePairEntry({ compare: s }, 1)).toBeDefined();
  });

  test('cleared resets to initial', () => {
    let s = compareReducer(initial(), sessionOpened(fakeSession()));
    s = compareReducer(s, textRequestSucceeded({ pairIndex: 0, value: fakeTextValue(true) }));
    s = compareReducer(s, cleared());
    expect(s).toEqual(initial());
  });

  test('selectCompareEvictableBlobs returns pairs holding blob URLs', () => {
    let s = compareReducer(initial(), visualRequestStarted(0));
    s = compareReducer(
      s,
      visualRequestSucceeded({
        pairIndex: 0,
        value: fakeVisualValue(5000),
        diffMaskUrl: 'blob:diff-0',
        leftUrl: 'blob:left-0',
        rightUrl: 'blob:right-0',
      }),
    );
    s = compareReducer(s, visualRequestStarted(1));
    s = compareReducer(
      s,
      visualRequestSucceeded({
        pairIndex: 1,
        value: fakeVisualValue(0),
        diffMaskUrl: 'blob:diff-1',
        leftUrl: 'blob:left-1',
        rightUrl: 'blob:right-1',
      }),
    );
    const evictable = selectCompareEvictableBlobs({ compare: s });
    expect(evictable).toHaveLength(2);
    expect(evictable[0]?.urls).toContain('blob:diff-0');
    expect(evictable[1]?.urls).toContain('blob:diff-1');
  });

  test('selectCompareEvictableBlobs ignores text-only pairs', () => {
    const s = compareReducer(
      initial(),
      textRequestSucceeded({ pairIndex: 0, value: fakeTextValue(true) }),
    );
    const evictable = selectCompareEvictableBlobs({ compare: s });
    expect(evictable).toEqual([]);
  });
});

describe('compare-slice — badge color selector', () => {
  test('idle pair returns gray', () => {
    const s = initial();
    expect(selectComparePairBadgeColor({ compare: s }, 0)).toBe('gray');
  });

  test('pair where neither side has loaded returns gray', () => {
    const s = compareReducer(initial(), textRequestStarted(0));
    expect(selectComparePairBadgeColor({ compare: s }, 0)).toBe('gray');
  });

  test('text equal + visual zero diff = green', () => {
    let s = compareReducer(
      initial(),
      textRequestSucceeded({ pairIndex: 0, value: fakeTextValue(false) }),
    );
    s = compareReducer(
      s,
      visualRequestSucceeded({
        pairIndex: 0,
        value: fakeVisualValue(0),
        diffMaskUrl: 'blob:diff-0',
        leftUrl: 'blob:left-0',
        rightUrl: 'blob:right-0',
      }),
    );
    expect(selectComparePairBadgeColor({ compare: s }, 0)).toBe('green');
  });

  test('text changed + visual no change = yellow', () => {
    let s = compareReducer(
      initial(),
      textRequestSucceeded({ pairIndex: 0, value: fakeTextValue(true) }),
    );
    s = compareReducer(
      s,
      visualRequestSucceeded({
        pairIndex: 0,
        value: fakeVisualValue(0),
        diffMaskUrl: 'blob:diff-0',
        leftUrl: 'blob:left-0',
        rightUrl: 'blob:right-0',
      }),
    );
    expect(selectComparePairBadgeColor({ compare: s }, 0)).toBe('yellow');
  });

  test('text changed + visual changed = red', () => {
    let s = compareReducer(
      initial(),
      textRequestSucceeded({ pairIndex: 0, value: fakeTextValue(true) }),
    );
    s = compareReducer(
      s,
      visualRequestSucceeded({
        pairIndex: 0,
        value: fakeVisualValue(7777),
        diffMaskUrl: 'blob:diff-0',
        leftUrl: 'blob:left-0',
        rightUrl: 'blob:right-0',
      }),
    );
    expect(selectComparePairBadgeColor({ compare: s }, 0)).toBe('red');
  });

  test('visual-only loaded with no change defaults to gray (text still pending)', () => {
    const s = compareReducer(
      initial(),
      visualRequestSucceeded({
        pairIndex: 0,
        value: fakeVisualValue(0),
        diffMaskUrl: 'blob:diff-0',
        leftUrl: 'blob:left-0',
        rightUrl: 'blob:right-0',
      }),
    );
    // text status is still idle so the badge is "not yet decided" (gray)
    expect(selectComparePairBadgeColor({ compare: s }, 0)).toBe('gray');
  });
});

describe('compare-slice — selectors smoke', () => {
  test('selectCompareSetup is exposed', () => {
    const s = compareReducer(initial(), setupOpened());
    expect(selectCompareSetup({ compare: s }).open).toBe(true);
  });
});
