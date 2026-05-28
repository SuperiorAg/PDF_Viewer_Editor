// use-roving-toolbar — roving-tabindex controller for a `role="toolbar"`
// (a11y-audit.md R-3). Implements the WAI-ARIA Toolbar pattern: the toolbar is
// a SINGLE tab stop; ArrowLeft/ArrowRight (Home/End) move focus between its
// buttons. Disabled buttons are skipped. The remembered "active index" is the
// last-focused button so Tab re-entry lands where the user left off.
//
// Usage: the Toolbar renders an ordered list of buttons, each tagged with a
// sequential `rovingIndex`. The hook returns:
//   - `tabIndexFor(i)`  → 0 for the active button, -1 for the rest
//   - `onKeyDown(i)`    → arrow-key handler bound per button
//   - `registerRef(i)`  → ref callback so the hook can move DOM focus
//
// Index assignment is by render order; the hook does not need to know button
// semantics, only how many there are and which are disabled.

import { useCallback, useRef, useState } from 'react';

interface UseRovingToolbarResult {
  tabIndexFor: (i: number) => 0 | -1;
  onKeyDown: (i: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  registerRef: (i: number) => (el: HTMLButtonElement | null) => void;
}

export function useRovingToolbar(count: number): UseRovingToolbarResult {
  // The button index that currently holds the single tab stop. Defaults to the
  // first button; updated as the user arrows/clicks across the toolbar.
  const [activeIndex, setActiveIndex] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const registerRef = useCallback(
    (i: number) =>
      (el: HTMLButtonElement | null): void => {
        refs.current[i] = el;
      },
    [],
  );

  const focusIndex = useCallback((i: number): void => {
    const el = refs.current[i];
    if (el && !el.disabled) {
      el.focus();
    }
  }, []);

  // Find the next non-disabled button index in `dir` (+1 / -1), wrapping.
  const nextEnabled = useCallback(
    (from: number, dir: 1 | -1): number => {
      const n = refs.current.length || count;
      for (let step = 1; step <= n; step++) {
        const i = (from + dir * step + n * step) % n;
        const el = refs.current[i];
        if (el && !el.disabled) return i;
      }
      return from;
    },
    [count],
  );

  const firstEnabled = useCallback((): number => {
    const n = refs.current.length || count;
    for (let i = 0; i < n; i++) {
      const el = refs.current[i];
      if (el && !el.disabled) return i;
    }
    return 0;
  }, [count]);

  const lastEnabled = useCallback((): number => {
    const n = refs.current.length || count;
    for (let i = n - 1; i >= 0; i--) {
      const el = refs.current[i];
      if (el && !el.disabled) return i;
    }
    return Math.max(0, n - 1);
  }, [count]);

  const onKeyDown = useCallback(
    (i: number) =>
      (e: React.KeyboardEvent<HTMLButtonElement>): void => {
        let target: number | null = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          target = nextEnabled(i, 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          target = nextEnabled(i, -1);
        } else if (e.key === 'Home') {
          target = firstEnabled();
        } else if (e.key === 'End') {
          target = lastEnabled();
        }
        if (target !== null) {
          e.preventDefault();
          setActiveIndex(target);
          focusIndex(target);
        }
      },
    [nextEnabled, firstEnabled, lastEnabled, focusIndex],
  );

  // If the remembered active button is disabled (e.g. no document open so Save
  // is disabled), fall back to the first enabled one for the tab stop so the
  // toolbar is always reachable via Tab.
  const effectiveActive = (() => {
    const el = refs.current[activeIndex];
    if (el && !el.disabled) return activeIndex;
    return firstEnabled();
  })();

  const tabIndexFor = useCallback(
    (i: number): 0 | -1 => (i === effectiveActive ? 0 : -1),
    [effectiveActive],
  );

  return { tabIndexFor, onKeyDown, registerRef };
}
