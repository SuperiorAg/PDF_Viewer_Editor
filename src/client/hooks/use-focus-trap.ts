// use-focus-trap — the shared modal focus-management hook (a11y-audit.md R-8).
//
// Standardizes the WCAG 2.1 AA modal focus discipline across every modal:
//   1. On mount: remember the element that had focus (the trigger), then move
//      focus into the modal (first focusable element, or the container itself).
//   2. While open: Tab / Shift+Tab cycle WITHIN the modal — focus cannot leave
//      it (2.4.3 Focus Order; the modal is `aria-modal="true"`). Esc is NOT
//      handled here — ModalShell owns Esc-to-close so the trap never becomes a
//      keyboard trap (2.1.2 No Keyboard Trap).
//   3. On unmount: restore focus to the remembered trigger element.
//
// The hook returns a ref to attach to the modal container element. It is
// orientation- and content-agnostic; it re-queries focusable descendants on
// each Tab so dynamically-added controls (e.g. wizard steps) are included.

import { useEffect, useRef } from 'react';

// Selector for tabbable elements. Excludes negative-tabindex and disabled
// controls. Matches the WAI-ARIA APG focusable set.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
  const nodes = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  // NOTE: we deliberately do NOT filter by `offsetParent`/visibility here.
  // `offsetParent` depends on layout, which jsdom does not compute (it is
  // always null under test), so a visibility filter would empty the list and
  // break the trap in tests. The `:not([disabled])` / `[tabindex!="-1"]`
  // selector already excludes the elements that must never receive focus;
  // hidden-but-tabbable elements are an acceptable edge for a modal whose
  // content is fully visible by construction.
  return Array.from(nodes).filter((el) => !el.hasAttribute('hidden'));
}

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(): React.RefObject<T> {
  const containerRef = useRef<T>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Remember the trigger, then move focus into the modal.
    triggerRef.current = document.activeElement as HTMLElement | null;
    const focusables = getFocusable(container);
    const initial = focusables[0] ?? container;
    // Container itself needs to be focusable as a fallback (tabIndex -1 is set
    // by the caller on the dialog panel).
    initial.focus();

    // 2. Trap Tab within the modal.
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const items = getFocusable(container);
      if (items.length === 0) {
        // Nothing tabbable — keep focus pinned on the container.
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !container.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener('keydown', onKeyDown);

    return () => {
      container.removeEventListener('keydown', onKeyDown);
      // 3. Restore focus to the trigger on close.
      const trigger = triggerRef.current;
      if (trigger && typeof trigger.focus === 'function') {
        trigger.focus();
      }
    };
  }, []);

  return containerRef;
}
