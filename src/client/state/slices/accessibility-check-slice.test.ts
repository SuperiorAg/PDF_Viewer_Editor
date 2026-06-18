// Accessibility-check slice tests — Phase 7.5 C6 (Riley Wave 5d).
//
// Covers the reducer + selector contract for every state transition the
// C6 panel surfaces. Honesty assertions:
//   - subsetDisclosure passes through verbatim from the result payload.
//   - The four-state model survives the round-trip (pass/warn/fail/
//     unevaluated each survive as distinct counts + grouping flags).
//   - `cleared` resets to the initial state (used on document close).

import { describe, expect, it } from 'vitest';

import type { PdfRunAccessibilityCheckValue } from '../../types/accessibility-check-contract-stub';

import accessibilityCheckReducer, {
  cleared,
  runFailed,
  runStarted,
  runSucceeded,
  selectA11yExpandedGroups,
  selectA11yLastErrorMessage,
  selectA11yResults,
  selectA11yStatus,
  selectA11ySubsetDisclosure,
  selectA11ySummary,
  toggleGroup,
} from './accessibility-check-slice';

const INITIAL = accessibilityCheckReducer(undefined, { type: '@@INIT' });

function makeValue(
  overrides: Partial<PdfRunAccessibilityCheckValue> = {},
): PdfRunAccessibilityCheckValue {
  return {
    results: [],
    summary: { pass: 7, warn: 1, fail: 2, unevaluated: 2 },
    ranAt: 1750000000000,
    shippedRuleCount: 12,
    subsetDisclosure: 'Subset of WCAG 2.1 + PDF/UA-1 — see Help for the shipped rule set.',
    ...overrides,
  };
}

describe('accessibility-check slice — initial state', () => {
  it('starts idle with no results and no error', () => {
    expect(INITIAL.status).toBe('idle');
    expect(INITIAL.lastResult).toBeNull();
    expect(INITIAL.lastError).toBeNull();
    expect(INITIAL.lastErrorMessage).toBeNull();
  });

  it('default-expands fail / warn / unevaluated and collapses pass', () => {
    expect(INITIAL.expandedGroups.fail).toBe(true);
    expect(INITIAL.expandedGroups.warn).toBe(true);
    expect(INITIAL.expandedGroups.unevaluated).toBe(true);
    expect(INITIAL.expandedGroups.pass).toBe(false);
  });
});

describe('accessibility-check slice — runStarted', () => {
  it('flips status to running and clears prior error fields', () => {
    const dirty = accessibilityCheckReducer(
      INITIAL,
      runFailed({ error: 'engine_failed', message: 'boom' }),
    );
    expect(dirty.status).toBe('error');
    const after = accessibilityCheckReducer(dirty, runStarted());
    expect(after.status).toBe('running');
    expect(after.lastError).toBeNull();
    expect(after.lastErrorMessage).toBeNull();
  });

  it('does NOT wipe the previous lastResult — disclosure stays visible', () => {
    const ran = accessibilityCheckReducer(INITIAL, runSucceeded(makeValue()));
    const after = accessibilityCheckReducer(ran, runStarted());
    expect(after.status).toBe('running');
    // Belt-and-braces honest UX: previous run's subsetDisclosure remains
    // visible while a re-run is in flight.
    expect(after.lastResult).not.toBeNull();
  });
});

describe('accessibility-check slice — runSucceeded', () => {
  it('records the value verbatim — never paraphrases subsetDisclosure', () => {
    const value = makeValue({
      subsetDisclosure: 'EXACT-WORDS-FROM-DAVID',
    });
    const after = accessibilityCheckReducer(INITIAL, runSucceeded(value));
    expect(after.status).toBe('ready');
    expect(after.lastResult).toEqual(value);
    expect(after.lastResult?.subsetDisclosure).toBe('EXACT-WORDS-FROM-DAVID');
  });

  it('preserves the four-state summary as distinct buckets', () => {
    const value = makeValue({
      summary: { pass: 3, warn: 4, fail: 2, unevaluated: 1 },
    });
    const after = accessibilityCheckReducer(INITIAL, runSucceeded(value));
    expect(after.lastResult?.summary.pass).toBe(3);
    expect(after.lastResult?.summary.warn).toBe(4);
    expect(after.lastResult?.summary.fail).toBe(2);
    expect(after.lastResult?.summary.unevaluated).toBe(1);
  });

  it('clears any prior error when a fresh success lands', () => {
    const errored = accessibilityCheckReducer(
      INITIAL,
      runFailed({ error: 'handle_not_found', message: 'oops' }),
    );
    const after = accessibilityCheckReducer(errored, runSucceeded(makeValue()));
    expect(after.lastError).toBeNull();
    expect(after.lastErrorMessage).toBeNull();
  });
});

describe('accessibility-check slice — runFailed', () => {
  it('flips status to error and stores the error code + message', () => {
    const after = accessibilityCheckReducer(
      INITIAL,
      runFailed({ error: 'engine_failed', message: 'engine crashed' }),
    );
    expect(after.status).toBe('error');
    expect(after.lastError).toBe('engine_failed');
    expect(after.lastErrorMessage).toBe('engine crashed');
  });

  it('handles the bridge_unavailable error variant honestly', () => {
    const after = accessibilityCheckReducer(
      INITIAL,
      runFailed({
        error: 'bridge_unavailable',
        message: 'window.pdfApi.pdf.runAccessibilityCheck is not exposed',
      }),
    );
    expect(after.status).toBe('error');
    expect(after.lastError).toBe('bridge_unavailable');
    expect(after.lastErrorMessage).toContain('runAccessibilityCheck');
  });
});

describe('accessibility-check slice — toggleGroup', () => {
  it('toggles each group independently', () => {
    let state = INITIAL;
    state = accessibilityCheckReducer(state, toggleGroup('fail'));
    expect(state.expandedGroups.fail).toBe(false);
    state = accessibilityCheckReducer(state, toggleGroup('pass'));
    expect(state.expandedGroups.pass).toBe(true);
    state = accessibilityCheckReducer(state, toggleGroup('pass'));
    expect(state.expandedGroups.pass).toBe(false);
    // Untouched groups are stable.
    expect(state.expandedGroups.warn).toBe(true);
    expect(state.expandedGroups.unevaluated).toBe(true);
  });
});

describe('accessibility-check slice — cleared (document close)', () => {
  it('resets to the initial state after a successful run', () => {
    let state = accessibilityCheckReducer(INITIAL, runSucceeded(makeValue()));
    state = accessibilityCheckReducer(state, toggleGroup('pass'));
    state = accessibilityCheckReducer(state, cleared());
    expect(state).toEqual(INITIAL);
  });

  it('resets to the initial state after an error', () => {
    let state = accessibilityCheckReducer(
      INITIAL,
      runFailed({ error: 'engine_failed', message: 'fail' }),
    );
    state = accessibilityCheckReducer(state, cleared());
    expect(state).toEqual(INITIAL);
  });
});

describe('accessibility-check slice — selectors', () => {
  const ran = {
    accessibilityCheck: accessibilityCheckReducer(INITIAL, runSucceeded(makeValue())),
  };
  const erroring = {
    accessibilityCheck: accessibilityCheckReducer(
      INITIAL,
      runFailed({ error: 'engine_failed', message: 'engine crashed' }),
    ),
  };

  it('selectA11yStatus reports current status', () => {
    expect(selectA11yStatus({ accessibilityCheck: INITIAL })).toBe('idle');
    expect(selectA11yStatus(ran)).toBe('ready');
    expect(selectA11yStatus(erroring)).toBe('error');
  });

  it('selectA11yResults returns the value or null', () => {
    expect(selectA11yResults({ accessibilityCheck: INITIAL })).toBeNull();
    expect(selectA11yResults(ran)?.shippedRuleCount).toBe(12);
  });

  it('selectA11ySummary returns the four-state bucket', () => {
    expect(selectA11ySummary({ accessibilityCheck: INITIAL })).toBeNull();
    const s = selectA11ySummary(ran);
    expect(s).toEqual({ pass: 7, warn: 1, fail: 2, unevaluated: 2 });
  });

  it('selectA11ySubsetDisclosure returns the verbatim string', () => {
    expect(selectA11ySubsetDisclosure({ accessibilityCheck: INITIAL })).toBeNull();
    expect(selectA11ySubsetDisclosure(ran)).toBe(
      'Subset of WCAG 2.1 + PDF/UA-1 — see Help for the shipped rule set.',
    );
  });

  it('selectA11yExpandedGroups returns the group map', () => {
    const groups = selectA11yExpandedGroups({ accessibilityCheck: INITIAL });
    expect(groups.fail).toBe(true);
    expect(groups.pass).toBe(false);
  });

  it('selectA11yLastErrorMessage returns the message or null', () => {
    expect(selectA11yLastErrorMessage({ accessibilityCheck: INITIAL })).toBeNull();
    expect(selectA11yLastErrorMessage(erroring)).toBe('engine crashed');
  });
});
