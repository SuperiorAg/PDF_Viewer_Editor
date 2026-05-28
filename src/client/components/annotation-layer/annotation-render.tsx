import { pdfRectToScreen, type PageViewport } from '../../services/pdf-coords';
import { type AnnotationModel, type PageModel, type RgbColor } from '../../types/ipc-contract';

import styles from './annotation-layer.module.css';

interface AnnotationRenderProps {
  annotation: AnnotationModel;
  page: PageModel;
  viewport: PageViewport;
  selected: boolean;
  onSelect: () => void;
}

function rgbCss(color: RgbColor): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export function AnnotationRender(props: AnnotationRenderProps): JSX.Element {
  const screen = pdfRectToScreen(props.annotation.rect, props.page, props.viewport);
  const color = rgbCss(props.annotation.color);
  const selectedClass = props.selected ? styles.selected : '';
  const ariaLabel = `${props.annotation.subtype} annotation${
    props.annotation.contents ? `: ${props.annotation.contents}` : ''
  }`;

  if (props.annotation.subtype === 'Highlight') {
    return (
      <button
        type="button"
        className={`${styles.annot} ${styles.highlight} ${selectedClass}`}
        aria-label={ariaLabel}
        style={{
          left: screen.x,
          top: screen.y,
          width: screen.width,
          height: screen.height,
          background: color,
          opacity: props.annotation.opacity,
        }}
        onClick={(e) => {
          e.stopPropagation();
          props.onSelect();
        }}
      />
    );
  }
  if (props.annotation.subtype === 'Text') {
    return (
      <button
        type="button"
        className={`${styles.annot} ${styles.sticky} ${selectedClass}`}
        aria-label={ariaLabel}
        title={props.annotation.contents ?? 'Sticky note'}
        style={{
          left: screen.x,
          top: screen.y,
          width: 22,
          height: 22,
          background: color,
        }}
        onClick={(e) => {
          e.stopPropagation();
          props.onSelect();
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M5 4 h11 l4 4 v9 a2 2 0 0 1-2 2 H5 a2 2 0 0 1-2-2 V6 a2 2 0 0 1 2-2 z"
            fill="white"
            stroke="rgba(0,0,0,0.6)"
            strokeWidth="1.6"
          />
        </svg>
      </button>
    );
  }
  // FreeText (text box)
  return (
    <button
      type="button"
      className={`${styles.annot} ${styles.freeText} ${selectedClass}`}
      aria-label={ariaLabel}
      style={{
        left: screen.x,
        top: screen.y,
        width: screen.width,
        height: screen.height,
        borderColor: color,
        color,
        opacity: props.annotation.opacity,
      }}
      onClick={(e) => {
        e.stopPropagation();
        props.onSelect();
      }}
    >
      <span className={styles.freeTextContents}>{props.annotation.contents ?? 'Text'}</span>
    </button>
  );
}
