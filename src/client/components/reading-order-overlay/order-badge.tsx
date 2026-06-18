// Reading-order overlay — numbered draggable badge.
// Phase 7.5 C4 (Riley Wave 5c). Per docs/ui-spec-phase-7.5.md §25.
//
// One badge per content block visible on screen. Renders a numbered pill
// at the top-left of the block's bbox (PDF user-space → CSS coords via the
// page element's bounding rect). HTML5 drag-and-drop is used because the
// existing tag-tree-editor already uses it (consistency), and the perf
// gate is satisfied — only visible badges mount.
//
// Wave 5d follow-up (Riley): when `focused === true` the badge auto-scrolls
// itself into view + paints a `.badgeFocused` outline modifier. The parent
// overlay drives the focus flag from the slice's `focusedEntryId` field
// (seeded by the C6 accessibility-checker quick-fix dispatcher).

import { useEffect, useRef } from 'react';

import { useT } from '../../i18n/use-t';

import styles from './reading-order-overlay.module.css';

interface OrderBadgeProps {
  /** 0-based source index in the live order array. */
  fromIndex: number;
  /** 1-based human-visible step number. */
  step: number;
  /** Total number of steps in the document (for the aria-label). */
  total: number;
  /** CSS-positioned coordinates (fixed). */
  left: number;
  top: number;
  /** Whether this badge is currently the drop target. */
  dragOver: boolean;
  /** Whether this badge is currently being dragged. */
  dragging: boolean;
  /** Wave 5d follow-up — quick-fix focus modifier. When true the badge
   *  auto-scrolls into view on mount + each focus-flip and paints a
   *  highlight outline so the user can see exactly which block the
   *  accessibility checker routed them at. */
  focused: boolean;
  onDragStart: (fromIndex: number) => void;
  onDragEnd: () => void;
  onDragEnter: (overIndex: number) => void;
  onDrop: (overIndex: number) => void;
  onKeyMove: (fromIndex: number, direction: 'up' | 'down') => void;
}

export function OrderBadge(props: OrderBadgeProps): JSX.Element {
  const { t } = useT();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const ariaLabel = t('modals:accessibility.readingOrder.badgeAria', {
    current: props.step,
    total: props.total,
  });
  const className = [
    styles.badge,
    props.dragging ? styles.badgeDragging : '',
    props.dragOver ? styles.badgeDragOver : '',
    props.focused ? styles.badgeFocused : '',
  ]
    .filter((c): c is string => typeof c === 'string' && c.length > 0)
    .join(' ');

  // Auto-scroll the focused badge into view. Effect re-runs whenever the
  // `focused` prop flips OR the badge's CSS-coords change (e.g. after the
  // user scrolls/zooms and the parent overlay re-renders) so a freshly
  // mounted badge for the seeded entry lands centered too. `scrollIntoView`
  // is a no-op when the element is already on screen.
  useEffect(() => {
    if (!props.focused) return;
    const el = buttonRef.current;
    if (el === null) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, [props.focused, props.left, props.top]);
  return (
    <button
      type="button"
      ref={buttonRef}
      className={className}
      // eslint-disable-next-line react/forbid-dom-props
      style={{ left: props.left, top: props.top }}
      draggable
      aria-label={ariaLabel}
      title={ariaLabel}
      data-focused={props.focused ? 'true' : undefined}
      onDragStart={(e) => {
        // Make the drag visible — Firefox needs a data payload, otherwise
        // the drag is suppressed. We use a custom MIME so we never confuse
        // with file drops handled at the window level.
        e.dataTransfer.setData(
          'application/x-pdf-viewer-reading-order-index',
          String(props.fromIndex),
        );
        e.dataTransfer.effectAllowed = 'move';
        props.onDragStart(props.fromIndex);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        props.onDragEnter(props.fromIndex);
      }}
      onDragOver={(e) => {
        // Required for the drop event to fire.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        props.onDrop(props.fromIndex);
      }}
      onDragEnd={() => props.onDragEnd()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          props.onKeyMove(props.fromIndex, 'up');
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          props.onKeyMove(props.fromIndex, 'down');
        }
      }}
    >
      {props.step}
    </button>
  );
}
