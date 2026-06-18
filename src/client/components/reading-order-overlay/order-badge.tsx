// Reading-order overlay — numbered draggable badge.
// Phase 7.5 C4 (Riley Wave 5c). Per docs/ui-spec-phase-7.5.md §25.
//
// One badge per content block visible on screen. Renders a numbered pill
// at the top-left of the block's bbox (PDF user-space → CSS coords via the
// page element's bounding rect). HTML5 drag-and-drop is used because the
// existing tag-tree-editor already uses it (consistency), and the perf
// gate is satisfied — only visible badges mount.

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
  onDragStart: (fromIndex: number) => void;
  onDragEnd: () => void;
  onDragEnter: (overIndex: number) => void;
  onDrop: (overIndex: number) => void;
  onKeyMove: (fromIndex: number, direction: 'up' | 'down') => void;
}

export function OrderBadge(props: OrderBadgeProps): JSX.Element {
  const { t } = useT();
  const ariaLabel = t('modals:accessibility.readingOrder.badgeAria', {
    current: props.step,
    total: props.total,
  });
  const className = [
    styles.badge,
    props.dragging ? styles.badgeDragging : '',
    props.dragOver ? styles.badgeDragOver : '',
  ]
    .filter((c): c is string => typeof c === 'string' && c.length > 0)
    .join(' ');
  return (
    <button
      type="button"
      className={className}
      // eslint-disable-next-line react/forbid-dom-props
      style={{ left: props.left, top: props.top }}
      draggable
      aria-label={ariaLabel}
      title={ariaLabel}
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
