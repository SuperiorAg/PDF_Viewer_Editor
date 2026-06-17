// Header & Footer tab — Phase 7.5 B4 (Riley Wave 4).
// Per docs/ui-spec-phase-7.5.md §4.1.

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { updateHeaderFooter } from '../../state/slices/page-design-slice';

import styles from './page-design-modal.module.css';

export function HeaderFooterTab(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const hf = useAppSelector((s) => s.pageDesign.headerFooter);

  const setStrip = (
    side: 'header' | 'footer',
    pos: 'Left' | 'Center' | 'Right',
    value: string,
  ): void => {
    const key = `${side}${pos}` as keyof typeof hf;
    dispatch(updateHeaderFooter({ [key]: value } as Partial<typeof hf>));
  };

  return (
    <div className={styles.tabPanel}>
      <div className={styles.column}>
        <span className={styles.label}>{t('modals:pageDesign.headerFooter.header')}</span>
        <div className={styles.row}>
          <input
            className={styles.input}
            type="text"
            placeholder={t('modals:pageDesign.headerFooter.left')}
            value={hf.headerLeft}
            onChange={(e) => setStrip('header', 'Left', e.target.value)}
            aria-label={t('modals:pageDesign.headerFooter.left')}
          />
          <input
            className={styles.input}
            type="text"
            placeholder={t('modals:pageDesign.headerFooter.center')}
            value={hf.headerCenter}
            onChange={(e) => setStrip('header', 'Center', e.target.value)}
            aria-label={t('modals:pageDesign.headerFooter.center')}
          />
          <input
            className={styles.input}
            type="text"
            placeholder={t('modals:pageDesign.headerFooter.right')}
            value={hf.headerRight}
            onChange={(e) => setStrip('header', 'Right', e.target.value)}
            aria-label={t('modals:pageDesign.headerFooter.right')}
          />
        </div>
      </div>

      <div className={styles.column}>
        <span className={styles.label}>{t('modals:pageDesign.headerFooter.footer')}</span>
        <div className={styles.row}>
          <input
            className={styles.input}
            type="text"
            placeholder={t('modals:pageDesign.headerFooter.left')}
            value={hf.footerLeft}
            onChange={(e) => setStrip('footer', 'Left', e.target.value)}
            aria-label={t('modals:pageDesign.headerFooter.left')}
          />
          <input
            className={styles.input}
            type="text"
            placeholder={t('modals:pageDesign.headerFooter.center')}
            value={hf.footerCenter}
            onChange={(e) => setStrip('footer', 'Center', e.target.value)}
            aria-label={t('modals:pageDesign.headerFooter.center')}
          />
          <input
            className={styles.input}
            type="text"
            placeholder={t('modals:pageDesign.headerFooter.right')}
            value={hf.footerRight}
            onChange={(e) => setStrip('footer', 'Right', e.target.value)}
            aria-label={t('modals:pageDesign.headerFooter.right')}
          />
        </div>
      </div>

      <div className={styles.row}>
        <label className={styles.label} htmlFor="hf-margin-top">
          {t('modals:pageDesign.headerFooter.marginTop')}
        </label>
        <input
          id="hf-margin-top"
          className={styles.numberInput}
          type="number"
          min={0}
          max={200}
          value={hf.marginTop}
          onChange={(e) => dispatch(updateHeaderFooter({ marginTop: Number(e.target.value) || 0 }))}
        />
        <label className={styles.label} htmlFor="hf-margin-bottom">
          {t('modals:pageDesign.headerFooter.marginBottom')}
        </label>
        <input
          id="hf-margin-bottom"
          className={styles.numberInput}
          type="number"
          min={0}
          max={200}
          value={hf.marginBottom}
          onChange={(e) =>
            dispatch(updateHeaderFooter({ marginBottom: Number(e.target.value) || 0 }))
          }
        />
      </div>

      <div className={styles.row}>
        <label className={styles.label} htmlFor="hf-start-page">
          {t('modals:pageDesign.headerFooter.startPageNumber')}
        </label>
        <input
          id="hf-start-page"
          className={styles.numberInput}
          type="number"
          min={1}
          value={hf.startPageNumber}
          onChange={(e) =>
            dispatch(updateHeaderFooter({ startPageNumber: Math.max(1, Number(e.target.value)) }))
          }
        />
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={hf.includeTotalPages}
            onChange={(e) => dispatch(updateHeaderFooter({ includeTotalPages: e.target.checked }))}
          />
          {t('modals:pageDesign.headerFooter.includeTotalPages', { token: '{totalPages}' })}
        </label>
      </div>

      <div className={styles.hint}>{t('modals:pageDesign.headerFooter.tokenHint')}</div>
    </div>
  );
}
