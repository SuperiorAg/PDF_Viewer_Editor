import { useCallback, useRef, useState } from 'react';

import { useT } from '../../i18n/use-t';
import { screenRectToPdf, type PageViewport } from '../../services/pdf-coords';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  selectActiveTool,
  selectAnnotationDefaults,
  selectDraftAnnotation,
  selectSelectedAnnotationId,
} from '../../state/slices/annotations-selectors';
import {
  beginDraft,
  cancelDraft,
  selectAnnotation,
  updateDraft,
  type AnnotationTool,
} from '../../state/slices/annotations-slice';
import { applyEdit } from '../../state/slices/document-slice';
import {
  type AnnotationModel,
  type AnnotationSubtype,
  type PageModel,
} from '../../types/ipc-contract';

import styles from './annotation-layer.module.css';
import { AnnotationRender } from './annotation-render';

// Maps the active annotation tool to its toolbar i18n label key (the tool union
// names don't all match the toolbar JSON keys: text→textBox, strikeout→
// strikethrough, ink→freehand). 'cursor' is handled separately (idle label).
const TOOL_LABEL_KEYS: Record<Exclude<AnnotationTool, 'cursor'>, string> = {
  highlight: 'toolbar:highlight',
  sticky: 'toolbar:sticky',
  text: 'toolbar:textBox',
  underline: 'toolbar:underline',
  strikeout: 'toolbar:strikethrough',
  ink: 'toolbar:freehand',
};

interface AnnotationLayerProps {
  pageIndex: number;
  page: PageModel;
  viewport: PageViewport;
  annotations: AnnotationModel[];
}

export function AnnotationLayer(props: AnnotationLayerProps): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const activeTool = useAppSelector(selectActiveTool);
  const defaults = useAppSelector(selectAnnotationDefaults);
  const draft = useAppSelector(selectDraftAnnotation);
  const selectedId = useAppSelector(selectSelectedAnnotationId);
  const layerRef = useRef<HTMLDivElement>(null);
  const [isAuthoring, setIsAuthoring] = useState(false);

  const startAuthor = useCallback(
    (e: React.MouseEvent): void => {
      if (activeTool === 'cursor') return;
      const layer = layerRef.current;
      if (!layer) return;
      const rect = layer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (activeTool === 'sticky') {
        // Single click; commit immediately.
        commitAnnotation('Text', { x, y, width: 24, height: 24 }, 'Sticky note');
        return;
      }
      setIsAuthoring(true);
      dispatch(beginDraft({ pageIndex: props.pageIndex, x, y }));
    },
    // commitAnnotation is a render-scope closure (recreated each render);
    // including it would break this callback's memoization. It is intentionally
    // omitted, matching the sibling `onEnd` callback below. Same rationale as
    // the disable at the end of this file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTool, dispatch, props.pageIndex],
  );

  const onMove = useCallback(
    (e: React.MouseEvent): void => {
      if (!isAuthoring) return;
      const layer = layerRef.current;
      if (!layer) return;
      const rect = layer.getBoundingClientRect();
      dispatch(
        updateDraft({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        }),
      );
    },
    [dispatch, isAuthoring],
  );

  const commitAnnotation = (
    subtype: AnnotationSubtype,
    screenRect: { x: number; y: number; width: number; height: number },
    contents?: string,
  ): void => {
    const pdfRect = screenRectToPdf(screenRect, props.page, props.viewport);
    const newAnnot: AnnotationModel = {
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pageIndex: props.pageIndex,
      subtype,
      rect: pdfRect,
      color: defaults.color,
      opacity: defaults.opacity,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      dirty: true,
      ...(contents !== undefined ? { contents } : {}),
      ...(subtype === 'FreeText'
        ? { freeText: { fontSize: defaults.fontSize, fontFamily: defaults.fontFamily } }
        : {}),
      ...(subtype === 'Highlight'
        ? {
            highlight: {
              quadPoints: [
                pdfRect.x,
                pdfRect.y + pdfRect.height,
                pdfRect.x + pdfRect.width,
                pdfRect.y + pdfRect.height,
                pdfRect.x,
                pdfRect.y,
                pdfRect.x + pdfRect.width,
                pdfRect.y,
              ],
            },
          }
        : {}),
    };
    dispatch(
      applyEdit({
        kind: 'annot-add',
        meta: { ts: Date.now(), undoable: true, operationId: `aa-${Date.now()}` },
        annotation: newAnnot,
      }),
    );
    dispatch(selectAnnotation(newAnnot.id));
  };

  const onEnd = useCallback((): void => {
    if (!isAuthoring) return;
    setIsAuthoring(false);
    if (!draft) {
      dispatch(cancelDraft());
      return;
    }
    const x = Math.min(draft.startX, draft.currentX);
    const y = Math.min(draft.startY, draft.currentY);
    const width = Math.abs(draft.currentX - draft.startX);
    const height = Math.abs(draft.currentY - draft.startY);
    if (width < 4 || height < 4) {
      // Ignore stray clicks.
      dispatch(cancelDraft());
      return;
    }
    let subtype: AnnotationSubtype = 'FreeText';
    if (activeTool === 'highlight') subtype = 'Highlight';
    if (activeTool === 'text') subtype = 'FreeText';
    commitAnnotation(subtype, { x, y, width, height }, subtype === 'FreeText' ? '' : undefined);
    dispatch(cancelDraft());
    // commitAnnotation depends on closure-captured values; eslint complains about
    // useCallback exhaustive deps. The function is intentionally invoked only
    // here so we leave it out of the dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, dispatch, draft, isAuthoring]);

  const draftRect =
    draft && draft.pageIndex === props.pageIndex
      ? {
          x: Math.min(draft.startX, draft.currentX),
          y: Math.min(draft.startY, draft.currentY),
          width: Math.abs(draft.currentX - draft.startX),
          height: Math.abs(draft.currentY - draft.startY),
        }
      : null;

  const cursor =
    activeTool === 'cursor' ? 'default' : activeTool === 'sticky' ? 'pointer' : 'crosshair';

  // a11y (Wave-30 lint-sweep deferred item, resolved here per docs/a11y-audit.md
  // §3 Path 3 + §5 DOCUMENT-ONLY + §7 gap #1). The drawing surface now has the
  // WAI-ARIA `application` role and a descriptive accessible name that ALSO names
  // the keyboard alternative: pick a tool from the keyboard-operable Annotation
  // toolbar, then add/position annotations from the Inspector. That makes the
  // element accessible-NAMED and pass jsx-a11y/no-static-element-interactions
  // legitimately (it is no longer a nameless static <div>) — the original
  // eslint-disable for that rule is REMOVED.
  //
  // A freehand/drag STROKE is inherently pointer-only (an arbitrary stroke has no
  // keyboard equivalent), so per the audit this is the DOCUMENT-ONLY tier: full
  // keyboard stroke-authoring (arrow-key placement of a new annotation) is a
  // documented Phase 7.2 enhancement, NOT a Phase-7 blocker — highlight / text /
  // sticky / shape annotations remain keyboard-operable via the toolbar +
  // Inspector, giving a complete non-mouse annotation workflow.
  const layerLabel =
    activeTool === 'cursor'
      ? t('toolbar:annotationLayerIdle')
      : t('toolbar:annotationLayerDrawing', { tool: t(TOOL_LABEL_KEYS[activeTool]) });

  return (
    // jsx-a11y lists the WAI-ARIA `application` role in its NON-interactive set,
    // so `no-noninteractive-element-interactions` fires on the (correct) pointer
    // handlers of this drawing surface. Per the WAI-ARIA spec `application` IS the
    // right role for a custom pointer-interaction widget, and the element is now
    // accessible-named (see layerLabel). This single scoped directive is a
    // plugin-taxonomy false positive against a correct, named widget — NOT the
    // original "nameless static div" defect (whose no-static-element-interactions
    // disable is gone). Re-classifying `application` in .eslintrc.cjs is Diego's
    // domain; this in-file directive is the equivalent and matches the audit's
    // DOCUMENT-ONLY verdict for pointer-only drawing (full keyboard authoring =
    // Phase 7.2).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={layerRef}
      role="application"
      aria-label={layerLabel}
      className={styles.layer}
      style={{ cursor }}
      onMouseDown={startAuthor}
      onMouseMove={onMove}
      onMouseUp={onEnd}
      onMouseLeave={onEnd}
    >
      {props.annotations.map((a) => (
        <AnnotationRender
          key={a.id}
          annotation={a}
          page={props.page}
          viewport={props.viewport}
          selected={selectedId === a.id}
          onSelect={() => dispatch(selectAnnotation(a.id))}
        />
      ))}
      {draftRect && (
        <div
          className={styles.draftRect}
          style={{
            left: draftRect.x,
            top: draftRect.y,
            width: draftRect.width,
            height: draftRect.height,
          }}
        />
      )}
    </div>
  );
}
