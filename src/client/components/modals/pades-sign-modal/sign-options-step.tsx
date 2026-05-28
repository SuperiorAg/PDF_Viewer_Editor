// Sign-options step — Phase 4 PAdES sign step 2.
// Per docs/ui-spec.md §13.5 (Step 2).

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { setPadesOptions } from '../../../state/slices/signatures-slice';

import styles from './pades-sign-modal.module.css';

export function SignOptionsStep(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const options = useAppSelector((s) => s.signatures.padesOptions);

  return (
    <div className={styles.body}>
      <label className={styles.field}>
        <span className={styles.label}>{t('modals:padesSign.optReason')}</span>
        <input
          className={styles.input}
          type="text"
          value={options.reason}
          onChange={(e) => dispatch(setPadesOptions({ reason: e.target.value }))}
          placeholder={t('modals:padesSign.optReasonPlaceholder')}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t('modals:padesSign.optLocation')}</span>
        <input
          className={styles.input}
          type="text"
          value={options.location}
          onChange={(e) => dispatch(setPadesOptions({ location: e.target.value }))}
        />
      </label>
      <div className={styles.optionsBlock}>
        <span className={styles.label}>{t('modals:padesSign.optAppearance')}</span>
        <label className={styles.optionRow}>
          <input
            type="checkbox"
            checked={options.showSubjectCN}
            onChange={(e) => dispatch(setPadesOptions({ showSubjectCN: e.target.checked }))}
          />
          {t('modals:padesSign.showSubjectCN')}
        </label>
        <label className={styles.optionRow}>
          <input
            type="checkbox"
            checked={options.showDate}
            onChange={(e) => dispatch(setPadesOptions({ showDate: e.target.checked }))}
          />
          {t('modals:padesSign.showDateOpt')}
        </label>
        <label className={styles.optionRow}>
          <input
            type="checkbox"
            checked={options.showIssuerCN}
            onChange={(e) => dispatch(setPadesOptions({ showIssuerCN: e.target.checked }))}
          />
          {t('modals:padesSign.showIssuerCN')}
        </label>
        <label className={styles.optionRow}>
          <input
            type="checkbox"
            checked={options.showReason}
            onChange={(e) => dispatch(setPadesOptions({ showReason: e.target.checked }))}
          />
          {t('modals:padesSign.showReason')}
        </label>
        <label className={styles.optionRow}>
          <input
            type="checkbox"
            checked={options.showTsaInfo}
            onChange={(e) => dispatch(setPadesOptions({ showTsaInfo: e.target.checked }))}
          />
          {t('modals:padesSign.showTsaInfo')}
        </label>
      </div>
      <div className={styles.optionsBlock}>
        <span className={styles.label}>{t('modals:padesSign.tsaTitle')}</span>
        <label className={styles.optionRow}>
          <input
            type="radio"
            name="tsa"
            checked={!options.useTsa}
            onChange={() => dispatch(setPadesOptions({ useTsa: false }))}
          />
          {t('modals:padesSign.tsaNone')}
        </label>
        <label className={styles.optionRow}>
          <input
            type="radio"
            name="tsa"
            checked={options.useTsa}
            onChange={() => dispatch(setPadesOptions({ useTsa: true }))}
          />
          {t('modals:padesSign.tsaConfigured')}
        </label>
      </div>
    </div>
  );
}
