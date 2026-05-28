import { type CSSProperties, useEffect, useRef } from 'react';

import { loadDocumentByHandle } from '../../services/pdf-loader';
import { type RenderJob } from '../../services/pdf-render';
import { useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import { type PageModel } from '../../types/ipc-contract';

import styles from './thumbnail-strip.module.css';

interface ThumbnailItemProps {
  page: PageModel;
  index: number;
  isCurrent: boolean;
  isSelected: boolean;
  isDragOver: boolean;
  /** Roving tabindex from the parent listbox (a11y-audit.md R-4). */
  tabIndex?: 0 | -1;
  onClick: (e: React.MouseEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

// Custom-property style type extension. Sizing the thumbnail box requires
// per-page width/height that varies with the source page's aspect ratio AND
// rotation; encoding it as CSS custom properties lets the .module.css file own
// the dimensions while the component still drives the numeric values.
interface ThumbStyle extends CSSProperties {
  '--thumb-w': string;
  '--thumb-h': string;
}

// Fixed thumbnail-strip width target. Per ui-spec §6.1.
const THUMB_WIDTH_PX = 110;

export function ThumbnailItem(props: ThumbnailItemProps): JSX.Element {
  const doc = useAppSelector(selectCurrentDocument);
  const handle = doc?.handle;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Phase 4.1.1: PageModel.width/height come from `measurePageDimensionsThunk`
  // which fires once on document open. We no longer maintain a component-local
  // measured-dims state — Redux is authoritative.
  const isRotated90 = props.page.rotation === 90 || props.page.rotation === 270;
  const baseW = isRotated90 ? props.page.height : props.page.width;
  const baseH = isRotated90 ? props.page.width : props.page.height;
  const aspect = baseW / baseH;
  const thumbWidth = THUMB_WIDTH_PX;
  const thumbHeight = thumbWidth / aspect;

  // Render the page into the thumbnail canvas. Same lifecycle pattern as
  // PdfCanvas but at fixed thumbnail scale. Skipped for blank pages.
  useEffect(() => {
    if (handle === undefined) return;
    if (props.page.sourcePageRef.kind === 'blank') return;
    let cancelled = false;
    let runningJob: RenderJob | null = null;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    void (async () => {
      const res = await loadDocumentByHandle(handle);
      if (cancelled || !res.ok) return;
      try {
        const pageProxy = await res.doc.getPage(props.index);
        if (cancelled) {
          pageProxy.cleanup();
          return;
        }
        const scale = thumbWidth / pageProxy.width;
        runningJob = pageProxy.render(canvas, scale);
        try {
          await runningJob.promise;
        } catch (err) {
          const name = err instanceof Error ? err.name : '';
          if (name !== 'RenderingCancelledException') {
            // eslint-disable-next-line no-console
            console.warn(`thumb render failed for page ${props.index}:`, err);
          }
        }
        pageProxy.cleanup();
      } catch (err) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.warn(`thumb getPage failed for page ${props.index}:`, err);
        }
      }
    })();
    return () => {
      cancelled = true;
      runningJob?.cancel();
    };
  }, [handle, props.index, props.page.sourcePageRef.kind, thumbWidth]);

  const classes = [
    styles.item,
    props.isCurrent ? styles.itemCurrent : '',
    props.isSelected ? styles.itemSelected : '',
    props.isDragOver ? styles.itemDragOver : '',
  ]
    .filter(Boolean)
    .join(' ');

  const label =
    props.page.sourcePageRef.kind === 'blank'
      ? `Blank page ${props.index + 1}`
      : `Page ${props.index + 1}`;

  const thumbStyle: ThumbStyle = {
    '--thumb-w': `${thumbWidth}px`,
    '--thumb-h': `${thumbHeight}px`,
  };

  // Wave 28a (a11y-audit.md R-4 / §3 Path 2): each thumbnail is a listbox
  // `role="option"` with `aria-selected`. `aria-current="page"` marks the
  // page currently shown in the viewer (a navigation cue distinct from
  // selection). The roving tabindex + onKeyDown come from the parent listbox.
  // The `id` lets the parent move focus on arrow-key navigation.
  return (
    <li
      id={`thumb-option-${props.index}`}
      className={classes}
      role="option"
      aria-selected={props.isSelected}
      aria-current={props.isCurrent ? 'page' : undefined}
      aria-label={label}
      tabIndex={props.tabIndex}
      draggable={true}
      onClick={props.onClick}
      onKeyDown={props.onKeyDown}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
    >
      <div className={styles.thumbnail} style={thumbStyle}>
        {props.page.sourcePageRef.kind === 'blank' ? (
          <span className={styles.blankBadge}>Blank</span>
        ) : (
          <canvas ref={canvasRef} className={styles.thumbCanvas} aria-hidden="true" />
        )}
        {props.page.rotation !== 0 && (
          <span className={styles.rotationBadge} title={`Rotated ${props.page.rotation} degrees`}>
            {props.page.rotation}
            {String.fromCharCode(176)}
          </span>
        )}
      </div>
      <span className={styles.label}>{props.index + 1}</span>
    </li>
  );
}
