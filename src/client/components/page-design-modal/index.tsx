// Page Design modal — Phase 7.5 B4 (Riley Wave 4).
// Per docs/ui-spec-phase-7.5.md §4. Three tabs (Watermark / Header & Footer /
// Background) share a preview pane and a range picker. Apply dispatches the
// appropriate David-shipped IPC channel.

import { useState } from 'react';

import { useT } from '../../i18n/use-t';
import { api } from '../../services/api';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  closePageDesign,
  markApplied,
  parsePageRange,
  rangeToTarget,
  setActiveTab,
  setApplying,
  setLastError,
  setRange,
  type PageDesignTab,
} from '../../state/slices/page-design-slice';
import { pushToast } from '../../state/slices/ui-slice';
import { selectCurrentPage } from '../../state/slices/viewport-selectors';
import type {
  PdfApplyBackgroundRequest,
  PdfApplyHeaderFooterRequest,
  PdfApplyWatermarkRequest,
  PdfBackgroundSource,
  PdfWatermarkSource,
} from '../../types/ipc-contract';
import { ModalShell } from '../modals/modal-shell';

import { BackgroundTab } from './background-tab';
import { HeaderFooterTab } from './header-footer-tab';
import styles from './page-design-modal.module.css';
import { PreviewPane } from './preview-pane';
import { WatermarkTab } from './watermark-tab';

const TAB_ORDER: readonly PageDesignTab[] = ['watermark', 'header-footer', 'background'];

function hexToRgb01(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (m === null) return null;
  const h = m[1];
  if (h === undefined) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return { r, g, b };
}

export function PageDesignModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const state = useAppSelector((s) => s.pageDesign);
  const currentPage = useAppSelector(selectCurrentPage);
  const [validationError, setValidationError] = useState<string | null>(null);

  const onClose = (): void => {
    dispatch(closePageDesign());
  };

  const onApply = async (): Promise<void> => {
    setValidationError(null);
    if (doc === null) return;
    const pageCount = doc.pageCount;
    const target = rangeToTarget(state.range, currentPage, pageCount);
    if (target === null) {
      setValidationError(t('modals:pageDesign.errorInvalidRange'));
      return;
    }
    if (state.range.kind === 'range') {
      // Strict re-validate so single-page ranges that fall outside also surface.
      const parsed = parsePageRange(state.range.pages, pageCount);
      if (parsed === null || parsed.length === 0) {
        setValidationError(t('modals:pageDesign.errorInvalidRange'));
        return;
      }
    }
    dispatch(setApplying(true));
    try {
      if (state.activeTab === 'watermark') {
        const wm = state.watermark;
        let source: PdfWatermarkSource;
        if (wm.source === 'image') {
          if (wm.imageBytes === null) {
            setValidationError(t('modals:pageDesign.errorImageRequired'));
            dispatch(setApplying(false));
            return;
          }
          source = { kind: 'image', imageBytes: wm.imageBytes };
        } else {
          source = {
            kind: 'text',
            text: wm.text,
            fontSize: wm.fontSize,
            fontColor: wm.fontColor,
            rotationDegrees: wm.rotationDegrees,
          };
        }
        const req: PdfApplyWatermarkRequest = {
          handle: doc.handle,
          target,
          source,
          opacity: wm.opacity,
          position: wm.position,
          layer: wm.layer,
        };
        const res = await api.pdf.applyWatermark(req);
        await handleResult(res.ok, res.ok ? res.value.pagesAffected : 0, res.ok ? '' : res.message);
      } else if (state.activeTab === 'header-footer') {
        const hf = state.headerFooter;
        const hasHeader = hf.headerLeft !== '' || hf.headerCenter !== '' || hf.headerRight !== '';
        const hasFooter = hf.footerLeft !== '' || hf.footerCenter !== '' || hf.footerRight !== '';
        const req: PdfApplyHeaderFooterRequest = {
          handle: doc.handle,
          target,
          marginTop: hf.marginTop,
          marginBottom: hf.marginBottom,
          startPageNumber: hf.startPageNumber,
          totalPageCountToken: hf.includeTotalPages,
          ...(hasHeader
            ? {
                header: {
                  left: hf.headerLeft,
                  center: hf.headerCenter,
                  right: hf.headerRight,
                  fontSize: hf.headerFontSize,
                },
              }
            : {}),
          ...(hasFooter
            ? {
                footer: {
                  left: hf.footerLeft,
                  center: hf.footerCenter,
                  right: hf.footerRight,
                  fontSize: hf.footerFontSize,
                },
              }
            : {}),
        };
        const res = await api.pdf.applyHeaderFooter(req);
        await handleResult(res.ok, res.ok ? res.value.pagesAffected : 0, res.ok ? '' : res.message);
      } else {
        const bg = state.background;
        let source: PdfBackgroundSource;
        if (bg.source === 'image') {
          if (bg.imageBytes === null) {
            setValidationError(t('modals:pageDesign.errorImageRequired'));
            dispatch(setApplying(false));
            return;
          }
          source = { kind: 'image', imageBytes: bg.imageBytes, opacity: bg.opacity };
        } else {
          // Validate hex; default to white on parse failure (already guarded
          // by the color picker, but be belt-and-braces).
          source = { kind: 'color', color: hexToRgb01(bg.color) === null ? '#FFFFFF' : bg.color };
        }
        const req: PdfApplyBackgroundRequest = { handle: doc.handle, target, source };
        const res = await api.pdf.applyBackground(req);
        await handleResult(res.ok, res.ok ? res.value.pagesAffected : 0, res.ok ? '' : res.message);
      }
    } finally {
      dispatch(setApplying(false));
    }
  };

  const handleResult = async (
    ok: boolean,
    pagesAffected: number,
    message: string,
  ): Promise<void> => {
    if (!ok) {
      dispatch(setLastError(message));
      dispatch(
        pushToast({
          kind: 'error',
          message: t('modals:pageDesign.errorEngineFailed', { message }),
        }),
      );
      return;
    }
    dispatch(markApplied());
    dispatch(
      pushToast({
        kind: 'success',
        message: t('modals:pageDesign.successToast', { count: pagesAffected }),
      }),
    );
    dispatch(closePageDesign());
  };

  return (
    <ModalShell title={t('modals:pageDesign.title')} onClose={onClose} size="lg">
      <div role="tablist" className={styles.tabs}>
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={state.activeTab === tab}
            className={`${styles.tab} ${state.activeTab === tab ? styles.tabActive : ''}`}
            onClick={() => dispatch(setActiveTab(tab))}
          >
            {t(`modals:pageDesign.tabs.${tab === 'header-footer' ? 'headerFooter' : tab}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {state.activeTab === 'watermark' && <WatermarkTab />}
        {state.activeTab === 'header-footer' && <HeaderFooterTab />}
        {state.activeTab === 'background' && <BackgroundTab />}
      </div>

      <div className={styles.row}>
        <span className={styles.label}>{t('modals:pageDesign.range.label')}</span>
        <label className={styles.checkboxRow}>
          <input
            type="radio"
            name="pd-range"
            checked={state.range.kind === 'all'}
            onChange={() => dispatch(setRange({ kind: 'all', pages: state.range.pages }))}
          />
          {t('modals:pageDesign.range.all')}
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="radio"
            name="pd-range"
            checked={state.range.kind === 'current'}
            onChange={() => dispatch(setRange({ kind: 'current', pages: state.range.pages }))}
          />
          {t('modals:pageDesign.range.current')}
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="radio"
            name="pd-range"
            checked={state.range.kind === 'range'}
            onChange={() => dispatch(setRange({ kind: 'range', pages: state.range.pages }))}
          />
          {t('modals:pageDesign.range.range')}
        </label>
        <input
          className={styles.input}
          type="text"
          placeholder={t('modals:pageDesign.range.rangeHint')}
          value={state.range.pages}
          disabled={state.range.kind !== 'range'}
          onChange={(e) => dispatch(setRange({ kind: 'range', pages: e.target.value }))}
          aria-label={t('modals:pageDesign.range.rangeHint')}
        />
      </div>

      <PreviewPane />

      {validationError !== null && <div className={styles.error}>{validationError}</div>}
      {state.lastError !== null && (
        <div className={styles.error}>
          {t('modals:pageDesign.errorEngineFailed', { message: state.lastError })}
        </div>
      )}

      <div className={styles.row}>
        <button type="button" className={styles.input} onClick={onClose} disabled={state.applying}>
          {t('modals:pageDesign.cancel')}
        </button>
        <button
          type="button"
          className={styles.input}
          onClick={() => void onApply()}
          disabled={state.applying || doc === null}
        >
          {state.applying ? t('modals:pageDesign.applying') : t('modals:pageDesign.apply')}
        </button>
      </div>
    </ModalShell>
  );
}
