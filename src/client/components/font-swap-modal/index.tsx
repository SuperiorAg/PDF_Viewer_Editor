// Font swap modal — Phase 7.5 B18 UI (Riley Wave 6).
// Spec: docs/ui-spec-phase-7.5.md §18.
//
// Lets the user replace an embedded font with one of the 14 standard PDF
// fonts. Activated from the Inspector Font tab (when a text run is
// selected) or from Tools menu → Replace Font. v0.8.0 ships standard-PDF
// font targets only (per David's contract comment); custom embed in v0.9.0.

import { useEffect, useMemo } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  closeFontSwap,
  selectFontSwap,
  STANDARD_FONT_OPTIONS,
  setFromFontName,
  setFontSwapScope,
  setToFontName,
} from '../../state/slices/font-swap-slice';
import { listEmbeddedFontsThunk, swapEmbeddedFontThunk } from '../../state/thunks-phase7-5-wave6';
import { type StandardPdfFontName } from '../../types/ipc-contract';
import { ModalShell } from '../modals/modal-shell';

import styles from './styles.module.css';

export function FontSwapModal(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const { t } = useT();
  const swap = useAppSelector(selectFontSwap);
  const doc = useAppSelector(selectCurrentDocument);

  // Fetch embedded fonts on open (or document change while open).
  useEffect(() => {
    if (swap.open && doc) {
      void dispatch(listEmbeddedFontsThunk(doc.handle));
    }
  }, [swap.open, doc, dispatch]);

  // Default fromFontName to the first embedded font's name when none was
  // pre-selected by the caller and the list resolves.
  useEffect(() => {
    if (swap.open && swap.fromFontName === null && swap.embeddedFonts.length > 0) {
      dispatch(setFromFontName(swap.embeddedFonts[0]?.name ?? null));
    }
  }, [swap.open, swap.fromFontName, swap.embeddedFonts, dispatch]);

  const canSwap = useMemo(
    () => doc !== null && swap.fromFontName !== null && !swap.swapping,
    [doc, swap.fromFontName, swap.swapping],
  );

  if (!swap.open) return null;

  return (
    <ModalShell
      title={t('modals:fontSwap.title')}
      onClose={() => dispatch(closeFontSwap())}
      size="md"
      footer={
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.primary}
            disabled={!canSwap}
            onClick={() => {
              if (doc === null || swap.fromFontName === null) return;
              void dispatch(
                swapEmbeddedFontThunk({
                  handle: doc.handle,
                  fromFontName: swap.fromFontName,
                  toFontName: swap.toFontName,
                }),
              );
            }}
          >
            {swap.swapping ? t('modals:fontSwap.swapping') : t('modals:fontSwap.swap')}
          </button>
          <button type="button" onClick={() => dispatch(closeFontSwap())}>
            {t('modals:fontSwap.close')}
          </button>
        </div>
      }
    >
      <div className={styles.body}>
        <div className={styles.field}>
          <label htmlFor="font-swap-from">{t('modals:fontSwap.fromPickerLabel')}</label>
          {swap.loadingFonts ? (
            <div className={styles.emptyFonts}>{t('modals:fontSwap.loadingFonts')}</div>
          ) : swap.embeddedFonts.length === 0 ? (
            <div className={styles.emptyFonts}>{t('modals:fontSwap.noEmbeddedFonts')}</div>
          ) : (
            <select
              id="font-swap-from"
              value={swap.fromFontName ?? ''}
              onChange={(e) => dispatch(setFromFontName(e.target.value || null))}
            >
              {swap.embeddedFonts.map((font) => (
                <option key={font.name} value={font.name}>
                  {font.name}
                  {font.isSubset ? ' (subset)' : ''}
                  {font.isEmbedded ? '' : ' [not embedded]'}
                </option>
              ))}
            </select>
          )}
          {swap.lastListError !== null && (
            <div className={styles.errorBanner}>
              {t('modals:fontSwap.loadError', { message: swap.lastListError })}
            </div>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="font-swap-to">{t('modals:fontSwap.toPickerLabel')}</label>
          <select
            id="font-swap-to"
            value={swap.toFontName}
            onChange={(e) => dispatch(setToFontName(e.target.value as StandardPdfFontName))}
          >
            {STANDARD_FONT_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <div className={styles.note}>{t('modals:fontSwap.v08Note')}</div>
        </div>

        <fieldset className={styles.field}>
          <legend>{t('modals:fontSwap.scopeLabel')}</legend>
          <div className={styles.scopeRow}>
            <label>
              <input
                type="radio"
                name="font-swap-scope"
                checked={swap.scope === 'this-run'}
                onChange={() => dispatch(setFontSwapScope('this-run'))}
              />
              {t('modals:fontSwap.scopeThisRun')}
            </label>
            <label>
              <input
                type="radio"
                name="font-swap-scope"
                checked={swap.scope === 'this-page'}
                onChange={() => dispatch(setFontSwapScope('this-page'))}
              />
              {t('modals:fontSwap.scopeThisPage')}
            </label>
            <label>
              <input
                type="radio"
                name="font-swap-scope"
                checked={swap.scope === 'whole-document'}
                onChange={() => dispatch(setFontSwapScope('whole-document'))}
              />
              {t('modals:fontSwap.scopeWholeDocument')}
            </label>
          </div>
          <div className={styles.note}>{t('modals:fontSwap.scopeNote')}</div>
        </fieldset>

        {swap.lastErrorMessage !== null && (
          <div className={styles.errorBanner}>{swap.lastErrorMessage}</div>
        )}

        {swap.lastFontsRewritten !== null && (
          <div className={styles.successBanner}>
            {t('modals:fontSwap.successHeader', { count: swap.lastFontsRewritten })}
          </div>
        )}

        {swap.lastWarnings.length > 0 && (
          <div className={styles.honestyBanner}>
            <div className={styles.honestyHeader}>{t('modals:fontSwap.warningsHeader')}</div>
            <ul className={styles.honestyList}>
              {swap.lastWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
