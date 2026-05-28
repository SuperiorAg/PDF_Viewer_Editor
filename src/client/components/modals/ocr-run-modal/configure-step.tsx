// OcrConfigureStep — Step 1 of the OCR run modal.
// Per docs/ui-spec.md §14.3 step 1.

import { useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import {
  selectOcrDownloadablePacks,
  selectOcrDraft,
  selectOcrInstalledPacks,
  selectIsAnyDownloadInFlight,
} from '../../../state/slices/ocr-selectors';
import {
  openLanguagePackManagerModal,
  setDraftPageRange,
  setDraftPreprocess,
  toggleDraftLang,
} from '../../../state/slices/ocr-slice';
import { type PreprocessOptions } from '../../../types/ipc-contract';

import styles from './ocr-run-modal.module.css';

interface OcrConfigureStepProps {
  pageCount: number;
  onCancel: () => void;
  onStart: (args: {
    langs: string[];
    pageRange: { start: number; end: number } | null;
    preprocess: PreprocessOptions;
  }) => void;
}

export function OcrConfigureStep(props: OcrConfigureStepProps): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const draft = useAppSelector(selectOcrDraft);
  const installed = useAppSelector(selectOcrInstalledPacks);
  const downloadable = useAppSelector(selectOcrDownloadablePacks);
  const downloadInFlight = useAppSelector(selectIsAnyDownloadInFlight);

  const [allPages, setAllPages] = useState<boolean>(draft.pageRange === null);

  const toggleLang = (lang: string): void => {
    dispatch(toggleDraftLang(lang));
  };

  const setRangeMode = (mode: 'all' | 'range'): void => {
    if (mode === 'all') {
      setAllPages(true);
      dispatch(setDraftPageRange(null));
    } else {
      setAllPages(false);
      dispatch(
        setDraftPageRange({
          start: 0,
          end: Math.max(0, props.pageCount - 1),
        }),
      );
    }
  };

  const startDisabled: boolean = draft.langs.length === 0;

  return (
    <div className={styles.step}>
      <h3 className={styles.stepTitle}>{t('modals:ocrRun.configureTitle')}</h3>

      <div className={styles.fieldGroup}>
        <span className={styles.label}>{t('modals:ocrRun.languagesLabel')}</span>
        <div className={styles.langList}>
          {installed.length === 0 && (
            <span className={styles.downloadHint}>{t('modals:ocrRun.loadingPacks')}</span>
          )}
          {installed.map((p) => {
            const checked = draft.langs.includes(p.lang);
            return (
              <label key={p.lang} className={styles.langRow}>
                <input type="checkbox" checked={checked} onChange={() => toggleLang(p.lang)} />
                <span>{p.displayName}</span>
                <span className={styles.langCode}>({p.lang})</span>
              </label>
            );
          })}
        </div>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => dispatch(openLanguagePackManagerModal())}
          disabled={downloadInFlight}
        >
          {downloadable.length > 0
            ? t('modals:ocrRun.downloadMoreCount', { count: downloadable.length })
            : t('modals:ocrRun.downloadMore')}
        </button>
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.label}>{t('modals:ocrRun.pagesLabel')}</span>
        <div className={styles.pageRangeRow}>
          <label>
            <input
              type="radio"
              checked={allPages}
              onChange={() => setRangeMode('all')}
              name="ocr-page-range"
            />{' '}
            {t('modals:ocrRun.allPagesRange', { count: props.pageCount })}
          </label>
          <label>
            <input
              type="radio"
              checked={!allPages}
              onChange={() => setRangeMode('range')}
              name="ocr-page-range"
            />{' '}
            {t('modals:ocrRun.rangeLabel')}
          </label>
          {!allPages && draft.pageRange !== null && (
            <>
              <input
                type="number"
                className={styles.numInput}
                min={1}
                max={props.pageCount}
                value={draft.pageRange.start + 1}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(props.pageCount, Number(e.target.value)));
                  if (draft.pageRange === null) return;
                  dispatch(
                    setDraftPageRange({
                      start: v - 1,
                      end: Math.max(v - 1, draft.pageRange.end),
                    }),
                  );
                }}
                aria-label={t('modals:ocrRun.startPageLabel')}
              />
              <span>{t('modals:ocrRun.rangeTo')}</span>
              <input
                type="number"
                className={styles.numInput}
                min={1}
                max={props.pageCount}
                value={draft.pageRange.end + 1}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(props.pageCount, Number(e.target.value)));
                  if (draft.pageRange === null) return;
                  dispatch(
                    setDraftPageRange({
                      start: Math.min(v - 1, draft.pageRange.start),
                      end: v - 1,
                    }),
                  );
                }}
                aria-label={t('modals:ocrRun.endPageLabel')}
              />
            </>
          )}
        </div>
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.label}>{t('modals:ocrRun.preprocessLabel')}</span>
        <div className={styles.preprocessRow}>
          <label>
            <input
              type="checkbox"
              checked={draft.preprocess.deskew}
              onChange={(e) => dispatch(setDraftPreprocess({ deskew: e.target.checked }))}
            />{' '}
            {t('modals:ocrRun.deskewFull')}
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.preprocess.denoise}
              onChange={(e) => dispatch(setDraftPreprocess({ denoise: e.target.checked }))}
            />{' '}
            {t('modals:ocrRun.denoise')}
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.preprocess.contrastBoost}
              onChange={(e) => dispatch(setDraftPreprocess({ contrastBoost: e.target.checked }))}
            />{' '}
            {t('modals:ocrRun.contrastBoost')}
          </label>
        </div>
      </div>

      <div className={styles.honestyReminder}>
        <p className={styles.honestyReminderTitle}>{t('modals:ocrRun.honestyReminderTitle')}</p>
        <p>{t('modals:ocrRun.honestyReminderAccuracy')}</p>
        <p>{t('modals:ocrRun.honestyReminderDuplicate')}</p>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.secondary} onClick={props.onCancel}>
          {t('modals:ocrRun.cancel')}
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={startDisabled}
          onClick={() =>
            props.onStart({
              langs: draft.langs,
              pageRange: draft.pageRange,
              preprocess: draft.preprocess,
            })
          }
        >
          {t('modals:ocrRun.startOcr')}
        </button>
      </div>
    </div>
  );
}
