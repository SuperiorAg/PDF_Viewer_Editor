// ShapeToolbar — Phase 4 toolbar buttons for the 7 new shape tools.
// Per docs/ui-spec.md §13.1 + §13.11 (shortcuts).

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { type ShapeTool, setActiveShapeTool } from '../../state/slices/shapes-slice';

import styles from './shape-tools.module.css';

const TOOLS: { id: ShapeTool; label: string; shortcut: string; ariaLabel: string }[] = [
  { id: 'square', label: 'Rect', shortcut: 'Q', ariaLabel: 'Rectangle (Q)' },
  { id: 'circle', label: 'Ellipse', shortcut: 'C', ariaLabel: 'Ellipse (C)' },
  { id: 'polygon', label: 'Polygon', shortcut: 'G', ariaLabel: 'Polygon (G)' },
  { id: 'line', label: 'Line', shortcut: 'L', ariaLabel: 'Line / Arrow (L)' },
  { id: 'arrow', label: 'Arrow', shortcut: 'L', ariaLabel: 'Arrow (L)' },
  { id: 'callout', label: 'Callout', shortcut: 'B', ariaLabel: 'Callout (B)' },
  { id: 'line-measure', label: 'Measure', shortcut: 'M', ariaLabel: 'Line measure (M)' },
  {
    id: 'polyline-measure',
    label: 'Poly-Measure',
    shortcut: 'Shift+M',
    ariaLabel: 'Polyline measure (Shift+M)',
  },
];

export function ShapeToolbar(): JSX.Element {
  const dispatch = useAppDispatch();
  const active = useAppSelector((s) => s.shapes.activeTool);

  return (
    <div role="toolbar" aria-label="Shape annotation tools" className={styles.toolbar}>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`${styles.toolButton} ${active === t.id ? styles.toolButtonActive : ''}`}
          aria-label={t.ariaLabel}
          aria-pressed={active === t.id ? 'true' : 'false'}
          title={`${t.label} (${t.shortcut})`}
          onClick={() => dispatch(setActiveShapeTool(t.id))}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
