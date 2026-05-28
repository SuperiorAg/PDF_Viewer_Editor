// ShapeDraftOverlay — Phase 4 live SVG preview of the in-progress shape.
// Per docs/architecture-phase-4.md §5 + ui-spec §13.6.
//
// The component renders the current draft from shapes-slice as an SVG.
// Pointer events handled by the parent (pdf-canvas) — this is presentation
// only. JSX-a11y note: SVG elements get an aria-label for the live region.

import { useAppSelector } from '../../state/hooks';

import styles from './shape-tools.module.css';

export function ShapeDraftOverlay(): JSX.Element | null {
  const draft = useAppSelector((s) => s.shapes.draft);

  if (!draft) return null;

  const minX = Math.min(draft.startX, draft.currentX);
  const minY = Math.min(draft.startY, draft.currentY);
  const w = Math.abs(draft.currentX - draft.startX);
  const h = Math.abs(draft.currentY - draft.startY);

  let shape: JSX.Element | null = null;

  if (draft.tool === 'square') {
    shape = <rect x={minX} y={minY} width={w} height={h} className={styles.draftShape} />;
  } else if (draft.tool === 'circle') {
    shape = (
      <ellipse
        cx={minX + w / 2}
        cy={minY + h / 2}
        rx={Math.max(1, w / 2)}
        ry={Math.max(1, h / 2)}
        className={styles.draftShape}
      />
    );
  } else if (draft.tool === 'line' || draft.tool === 'arrow' || draft.tool === 'line-measure') {
    shape = (
      <line
        x1={draft.startX}
        y1={draft.startY}
        x2={draft.currentX}
        y2={draft.currentY}
        className={styles.draftShape}
      />
    );
  } else if (draft.tool === 'polygon' && draft.vertices) {
    const pts = draft.vertices
      .reduce<string[]>((acc, v, i) => {
        if (i % 2 === 0) acc.push(`${v},`);
        else acc[acc.length - 1] = `${acc[acc.length - 1]}${v}`;
        return acc;
      }, [])
      .join(' ');
    shape = <polygon points={pts} className={styles.draftShape} />;
  } else if (draft.tool === 'polyline-measure' && draft.vertices) {
    const pts = draft.vertices
      .reduce<string[]>((acc, v, i) => {
        if (i % 2 === 0) acc.push(`${v},`);
        else acc[acc.length - 1] = `${acc[acc.length - 1]}${v}`;
        return acc;
      }, [])
      .join(' ');
    shape = <polyline points={pts} className={styles.draftShape} />;
  } else if (draft.tool === 'callout') {
    shape = <rect x={minX} y={minY} width={w} height={h} className={styles.draftShape} />;
  }

  if (!shape) return null;

  return (
    <svg className={styles.svgOverlay} aria-label={`Drafting ${draft.tool} annotation`} role="img">
      {shape}
    </svg>
  );
}
