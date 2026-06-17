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
//
// Phase 7.4 A5 (Riley) — mount under the main Toolbar via app.tsx, gated on
// the `ui.shapesPanelOpen` flag. Mirrors the FormDesignerToolbar pattern (a
// sibling sub-toolbar that returns null when its slice flag is false). Esc
// while focus is inside the sub-toolbar closes it; this matches the
// FormDesigner "Exit (Esc)" convention and the broader app keyboard idiom
// (modals + menus close on Esc — see useAppShortcuts).

import { useCallback, useEffect, useRef } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { type ShapeTool, setActiveShapeTool } from '../../state/slices/shapes-slice';
import { selectShapesPanelOpen } from '../../state/slices/ui-selectors';
import { setShapesPanelOpen } from '../../state/slices/ui-slice';

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
  // Phase 7.5 B17 (Riley Wave 3) — closed-polygon area measure tool. Joins
  // the shape sub-toolbar as the eighth measure entry.
  {
    id: 'area-measure',
    labelKey: 'toolbar:shapeTools.areaMeasure',
    ariaKey: 'toolbar:shapeTools.areaMeasureAria',
    tooltipKey: 'toolbar:shapeTools.areaMeasureTooltip',
    shortcut: 'Shift+A',
  },
];

export function ShapeToolbar(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const active = useAppSelector((s) => s.shapes.activeTool);
  const open = useAppSelector(selectShapesPanelOpen);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);

  // When the panel opens, focus the first shape-tool button so keyboard users
  // land inside it and Esc lands on a focused descendant. Mirrors the
  // focus-into-modal pattern used by the app's modal stack (a11y-audit R-5).
  useEffect(() => {
    if (open && firstButtonRef.current) {
      firstButtonRef.current.focus();
    }
  }, [open]);

  // Esc closes the panel. The handler is attached to the sub-toolbar itself
  // (not the document) so it only fires when focus is inside — the global Esc
  // listener for modals continues to work unchanged elsewhere.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dispatch(setShapesPanelOpen(false));
      }
    },
    [dispatch],
  );

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label={t('toolbar:shapeTools.label')}
      className={styles.toolbar}
      onKeyDown={onKeyDown}
    >
      {TOOLS.map((tool, idx) => (
        <button
          key={tool.id}
          type="button"
          ref={idx === 0 ? firstButtonRef : undefined}
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
