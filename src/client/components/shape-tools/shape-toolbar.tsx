// ShapeToolbar — Phase 4 toolbar buttons for the 7 new shape tools.
// Per docs/ui-spec.md §13.1 + §13.11 (shortcuts).
//
// Phase 7.4 A2 (Riley) — all 8 visible labels + 8 ARIA names + 8 tooltip
// strings + the container ARIA label go through i18n. The previous version
// (acrobat-parity-audit.md §3.3) had 17 hardcoded English strings in this
// file alone — the single biggest marking-debt cluster in the renderer.
// All keys live under the `toolbar:shapeTools.*` sub-tree.
//
// Spanish translations are an INITIAL pass by an author who is not a native
// Spanish speaker. Native-speaker review is the next step (deferrable). The
// visible button labels are short by design (toolbar buttons); the ARIA +
// tooltip carry the full descriptive name in both locales.

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { type ShapeTool, setActiveShapeTool } from '../../state/slices/shapes-slice';

import styles from './shape-tools.module.css';

interface ShapeToolEntry {
  id: ShapeTool;
  labelKey: string;
  ariaKey: string;
  tooltipKey: string;
  shortcut: string;
}

const TOOLS: readonly ShapeToolEntry[] = [
  {
    id: 'square',
    labelKey: 'toolbar:shapeTools.rect',
    ariaKey: 'toolbar:shapeTools.rectAria',
    tooltipKey: 'toolbar:shapeTools.rectTooltip',
    shortcut: 'Q',
  },
  {
    id: 'circle',
    labelKey: 'toolbar:shapeTools.ellipse',
    ariaKey: 'toolbar:shapeTools.ellipseAria',
    tooltipKey: 'toolbar:shapeTools.ellipseTooltip',
    shortcut: 'C',
  },
  {
    id: 'polygon',
    labelKey: 'toolbar:shapeTools.polygon',
    ariaKey: 'toolbar:shapeTools.polygonAria',
    tooltipKey: 'toolbar:shapeTools.polygonTooltip',
    shortcut: 'G',
  },
  {
    id: 'line',
    labelKey: 'toolbar:shapeTools.line',
    ariaKey: 'toolbar:shapeTools.lineAria',
    tooltipKey: 'toolbar:shapeTools.lineTooltip',
    shortcut: 'L',
  },
  {
    id: 'arrow',
    labelKey: 'toolbar:shapeTools.arrow',
    ariaKey: 'toolbar:shapeTools.arrowAria',
    tooltipKey: 'toolbar:shapeTools.arrowTooltip',
    shortcut: 'L',
  },
  {
    id: 'callout',
    labelKey: 'toolbar:shapeTools.callout',
    ariaKey: 'toolbar:shapeTools.calloutAria',
    tooltipKey: 'toolbar:shapeTools.calloutTooltip',
    shortcut: 'B',
  },
  {
    id: 'line-measure',
    labelKey: 'toolbar:shapeTools.lineMeasure',
    ariaKey: 'toolbar:shapeTools.lineMeasureAria',
    tooltipKey: 'toolbar:shapeTools.lineMeasureTooltip',
    shortcut: 'M',
  },
  {
    id: 'polyline-measure',
    labelKey: 'toolbar:shapeTools.polylineMeasure',
    ariaKey: 'toolbar:shapeTools.polylineMeasureAria',
    tooltipKey: 'toolbar:shapeTools.polylineMeasureTooltip',
    shortcut: 'Shift+M',
  },
];

export function ShapeToolbar(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const active = useAppSelector((s) => s.shapes.activeTool);

  return (
    <div role="toolbar" aria-label={t('toolbar:shapeTools.label')} className={styles.toolbar}>
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={`${styles.toolButton} ${active === tool.id ? styles.toolButtonActive : ''}`}
          aria-label={t(tool.ariaKey)}
          aria-pressed={active === tool.id ? 'true' : 'false'}
          title={t(tool.tooltipKey)}
          onClick={() => dispatch(setActiveShapeTool(tool.id))}
        >
          {t(tool.labelKey)}
        </button>
      ))}
    </div>
  );
}
