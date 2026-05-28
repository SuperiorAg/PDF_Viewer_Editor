import { useEffect } from 'react';

import { findShortcutForEvent, type ShortcutId } from '../shortcuts';

export function useKeyboardShortcut(handler: (id: ShortcutId, e: KeyboardEvent) => void): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      // Ignore key events targeted at text inputs / textareas so the user can
      // type 'h' or 's' inside a textarea without firing tools.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable === true) {
          // Allow Ctrl-chord shortcuts to still fire even when in an input
          // (Ctrl+S should save).
          if (!e.ctrlKey && !e.metaKey) return;
        }
      }
      const id = findShortcutForEvent(e);
      if (id) {
        handler(id, e);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handler]);
}
