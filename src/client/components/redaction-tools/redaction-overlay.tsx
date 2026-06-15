// RedactionOverlay — Phase 7.4 B1 SVG overlay of pending redaction marks.
// Per docs/phase-7.4-b1-redaction-design.md §2.3.
//
// Renders one SVG `<rect>` per pending mark on the given page. Two visual modes:
//   - showMarks ON  (default) → outlined red rect (`markRectPreview`); the
//     underlying text is visible so the user can verify "yes, this is what
//     I want gone".
//   - showMarks OFF           → opaque black rect (`markRectOpaque`); a WYSIWYG
//     preview of what Apply will produce.
//
// The overlay is presentation-only. Pointer handling for adding/removing marks
// lives in the parent canvas component (a future PDF-canvas integration wave
// will wire it; this is the page-keyed renderer-only surface). The overlay's
// `pageIndex` prop tells it which page to draw for.
//
// a11y: `role="img"` + `aria-label` so Narrator announces "N redaction marks
// on page M" — per design §2.7.

import { useT } from '../../i18n/use-t';
import { useAppSelector } from '../../state/hooks';
import {
  selectRedactionByPage,
  selectRedactionShowMarks,
} from '../../state/slices/redactions-slice';

import styles from './redaction-tools.module.css';

export interface RedactionOverlayProps {
  /** 0-based page index this overlay paints for. */
  pageIndex: number;
}

export function RedactionOverlay(props: RedactionOverlayProps): JSX.Element | null {
  const { t } = useT();
  const byPage = useAppSelector(selectRedactionByPage);
  const showMarks = useAppSelector(selectRedactionShowMarks);

  const marks = byPage[props.pageIndex] ?? [];
  if (marks.length === 0) return null;

  const cls = showMarks ? styles.markRectPreview : styles.markRectOpaque;

  return (
    <svg
      className={styles.overlay}
      role="img"
      aria-label={t('toolbar:redactionTools.overlayPageLabel', {
        count: marks.length,
        page: props.pageIndex + 1,
      })}
    >
      {marks.map((m) => (
        <rect
          key={m.id}
          x={m.rect.x}
          y={m.rect.y}
          width={m.rect.width}
          height={m.rect.height}
          className={cls}
        />
      ))}
    </svg>
  );
}
