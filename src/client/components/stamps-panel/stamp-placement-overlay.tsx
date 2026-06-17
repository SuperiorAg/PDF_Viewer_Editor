// StampPlacementOverlay — Phase 7.5 B7 (Riley Wave 3).
//
// Mounts at the app level when `stamps.placement.active === true`. Shows a
// floating banner with the active stamp name + an Esc-to-cancel hint, and
// installs a one-shot global click listener that resolves the target page
// via the `[data-page-index]` data attribute pdf-canvas exposes. The click
// is converted to PDF user-space via the annotation-layer pattern (rect-
// from-bbox → x/y in canvas px → pdf coords by inverting page scale).
//
// Phase 7.5 scope is renderer-side persistence ONLY for v0.8.0:
//   - The stamp is materialized as a `FreeText` AnnotationModel via the
//     existing `kind: 'annot-add'` EditOperation — no new IPC channel and
//     no new EditOperation variant. This survives Save (`pdf:applyEditOps`)
//     because FreeText is a Phase-1 subtype that the existing serializer
//     handles, and re-opens correctly because the bytes go into
//     `/Annots[]` on the target page.
//   - The future `pdf:applyStamp` channel (api-contracts.md §19.10) is for
//     stamp annotations with image content — out of scope for Wave 3.

import { useEffect, useMemo } from 'react';

import { useT } from '../../i18n/use-t';
import {
  BUILTIN_STAMPS,
  resolveStampForPlacement,
  builtinStampEntries,
} from '../../services/builtin-stamps';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import { applyEdit } from '../../state/slices/document-slice';
import { exitPlacement, markStampUsed } from '../../state/slices/stamps-slice';
import type { AnnotationModel, RgbColor } from '../../types/ipc-contract';

import styles from './stamps-panel.module.css';

function uuid(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom may not expose crypto
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `stamp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface ResolvedStamp {
  text: string;
  color: RgbColor;
  widthPt: number;
}

export function StampPlacementOverlay(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const placement = useAppSelector((s) => s.stamps.placement);
  const customStamps = useAppSelector((s) => s.stamps.customStamps);

  // Resolve the active stamp's display name for the banner.
  const activeName = useMemo(() => {
    if (placement.stampId === null) return '';
    if (placement.stampId.startsWith('builtin:')) {
      const def = BUILTIN_STAMPS.find((s) => s.id === placement.stampId);
      if (def === undefined) return '';
      // Resolve through the i18n hook so the banner localizes.
      const entries = builtinStampEntries(t);
      const found = entries.find((e) => e.id === def.id);
      return found?.name ?? def.id;
    }
    const custom = customStamps.find((c) => c.id === placement.stampId);
    return custom?.name ?? placement.stampId;
  }, [placement.stampId, customStamps, t]);

  // One-shot global click listener. Active only while the placement is on
  // AND we have a current document open. The handler walks up from the
  // event target to find the closest `[data-page-index]` element, computes
  // CSS-px coords inside that element, and converts to PDF user-space using
  // the rendered page's bbox width vs PageModel.width ratio.
  useEffect(() => {
    if (!placement.active || placement.stampId === null) return;
    if (!doc) return;

    const stampPayload: ResolvedStamp | null = resolveStampForPlacement(
      placement.stampId,
      customStamps,
    );
    if (stampPayload === null) return;

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dispatch(exitPlacement());
      }
    };

    const onClick = (e: MouseEvent): void => {
      const target = e.target as Element | null;
      if (target === null) return;
      const pageEl = target.closest<HTMLElement>('[data-page-index]');
      if (pageEl === null) return;
      const pageIndexAttr = pageEl.dataset['pageIndex'];
      if (pageIndexAttr === undefined) return;
      const pageIndex = Number(pageIndexAttr);
      if (!Number.isFinite(pageIndex)) return;

      const page = doc.pages[pageIndex];
      if (page === undefined) return;

      // The page element is the rotated bbox the canvas renders into;
      // map click pos -> PDF user-space by inverting the page-scale.
      const rect = pageEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const isRotated90 = page.rotation === 90 || page.rotation === 270;
      const baseW = isRotated90 ? page.height : page.width;
      const baseH = isRotated90 ? page.width : page.height;
      const xCss = e.clientX - rect.left;
      const yCss = e.clientY - rect.top;
      const xPdf = (xCss / rect.width) * baseW;
      // PDF y-axis is bottom-up; CSS y-axis is top-down.
      const yPdf = baseH - (yCss / rect.height) * baseH;

      const stampHeight = Math.max(20, stampPayload.widthPt * 0.22);
      const annotation: AnnotationModel = {
        id: `stamp-${uuid()}`,
        pageIndex,
        subtype: 'FreeText',
        rect: {
          x: Math.max(0, xPdf - stampPayload.widthPt / 2),
          y: Math.max(0, yPdf - stampHeight / 2),
          width: stampPayload.widthPt,
          height: stampHeight,
        },
        color: stampPayload.color,
        opacity: 1,
        contents: stampPayload.text,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        dirty: true,
        freeText: { fontSize: stampHeight * 0.7, fontFamily: 'Helvetica-Bold' },
      };

      dispatch(
        applyEdit({
          kind: 'annot-add',
          meta: { ts: Date.now(), undoable: true, operationId: `stamp-${Date.now()}` },
          annotation,
        }),
      );
      const id = placement.stampId;
      if (id !== null) dispatch(markStampUsed(id));
      dispatch(exitPlacement());
    };

    window.addEventListener('keydown', onKey);
    // capture-phase so the banner exits before any per-component handlers
    // (annotation-layer's drag-author etc.) consume the click.
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick, true);
    };
  }, [placement.active, placement.stampId, doc, customStamps, dispatch]);

  if (!placement.active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('sidebar:stamps.placementAria')}
      className={styles.placementBanner}
    >
      <span>{t('sidebar:stamps.placementBanner', { name: activeName })}</span>
      <button
        type="button"
        className={styles.bannerCancel}
        onClick={() => dispatch(exitPlacement())}
        aria-label={t('sidebar:stamps.exitPlacement')}
      >
        {t('sidebar:stamps.exitPlacement')}
      </button>
    </div>
  );
}
