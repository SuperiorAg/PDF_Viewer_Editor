// use-tablist-keys — the shared WAI-ARIA tab-pattern keyboard handler.
//
// Implements the roving-tabindex arrow-key navigation from a11y-audit.md §4
// (the pattern restored in Wave 28a). Used by both the sidebar tablist
// (vertical orientation) and the settings-modal tablist (horizontal
// orientation). Only the active tab is in the Tab order (tabIndex 0); the
// others are tabIndex -1. Arrow keys move the active tab AND focus; Home/End
// jump to first/last.
//
// The hook is intentionally state-agnostic: callers pass the ordered list of
// tab ids, the active id, and an `onActivate` callback. The hook returns an
// `onKeyDown` handler to spread onto every `role="tab"` button plus a
// `tabIndexFor` helper for the roving tabindex. Focus movement is performed by
// matching the new tab's DOM id (`tab-${id}`) — every tab button must carry
// that id (the a11y-audit §4 contract).

import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export type TablistOrientation = 'horizontal' | 'vertical';

interface UseTablistKeysArgs<T extends string> {
  /** Ordered tab ids, matching visual + DOM order. */
  tabs: readonly T[];
  /** The currently-active tab id. */
  active: T;
  /** Called when a key moves the active tab. */
  onActivate: (id: T) => void;
  /** 'vertical' = ArrowUp/ArrowDown (sidebar); 'horizontal' = ArrowLeft/ArrowRight (settings). */
  orientation: TablistOrientation;
  /** DOM id prefix; the focused button must have id `${idPrefix}${tabId}`. Default 'tab-'. */
  idPrefix?: string;
}

interface UseTablistKeysResult<T extends string> {
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  tabIndexFor: (id: T) => 0 | -1;
}

export function useTablistKeys<T extends string>(
  args: UseTablistKeysArgs<T>,
): UseTablistKeysResult<T> {
  const { tabs, active, onActivate, orientation, idPrefix = 'tab-' } = args;

  const focusTab = useCallback(
    (id: T): void => {
      // Defer to the next frame so React has applied the new tabIndex (the
      // newly-active tab becomes tabIndex 0) before we move focus to it.
      requestAnimationFrame(() => {
        const el = document.getElementById(`${idPrefix}${id}`);
        if (el) el.focus();
      });
    },
    [idPrefix],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>): void => {
      const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
      const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
      const idx = tabs.indexOf(active);
      if (idx === -1) return;

      let target: T | null = null;
      if (e.key === nextKey) {
        target = tabs[(idx + 1) % tabs.length] ?? null;
      } else if (e.key === prevKey) {
        target = tabs[(idx - 1 + tabs.length) % tabs.length] ?? null;
      } else if (e.key === 'Home') {
        target = tabs[0] ?? null;
      } else if (e.key === 'End') {
        target = tabs[tabs.length - 1] ?? null;
      }

      if (target !== null && target !== active) {
        e.preventDefault();
        onActivate(target);
        focusTab(target);
      }
    },
    [tabs, active, onActivate, orientation, focusTab],
  );

  const tabIndexFor = useCallback((id: T): 0 | -1 => (id === active ? 0 : -1), [active]);

  return { onKeyDown, tabIndexFor };
}
