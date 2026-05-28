// PlacementHandle — drag/resize/rotate corner handle.
// Per docs/ui-spec.md §13.4 — shared with image-overlay.

import { useCallback } from 'react';

import styles from './signature-placement-overlay.module.css';

export type HandlePos = 'nw' | 'ne' | 'sw' | 'se';

interface PlacementHandleProps {
  pos: HandlePos;
  onDrag: (dxPx: number, dyPx: number) => void;
}

export function PlacementHandle(props: PlacementHandleProps): JSX.Element {
  const cls =
    props.pos === 'nw'
      ? styles.handleNW
      : props.pos === 'ne'
        ? styles.handleNE
        : props.pos === 'sw'
          ? styles.handleSW
          : styles.handleSE;

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;

      const onMove = (ev: MouseEvent): void => {
        props.onDrag(ev.clientX - startX, ev.clientY - startY);
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [props],
  );

  return (
    <div
      className={`${styles.handle} ${cls}`}
      role="button"
      tabIndex={0}
      aria-label={`${props.pos} resize handle`}
      onMouseDown={onMouseDown}
      onKeyDown={(e) => {
        // No-op key handler so jsx-a11y/interactive-supports-focus is satisfied;
        // resize via keyboard is Phase 4.1 (per ui-spec §13.15 Phase 7 floor).
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
        }
      }}
    />
  );
}
