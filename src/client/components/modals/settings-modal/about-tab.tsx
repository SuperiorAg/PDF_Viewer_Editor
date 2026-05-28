// Settings → About tab (ui-spec.md §16.2). Version + the live update-status
// area (the load-bearing trust-floor placement for obligations #2 + #6, shared
// with the standalone About modal via UpdateStatusArea) + license/acknowledgments
// naming the Phase-7-new MIT deps (i18next, react-i18next, electron-updater).

import { useT } from '../../../i18n/use-t';
import { UpdateStatusArea } from '../../update-status-area';

import styles from './settings-modal.module.css';

interface AboutTabProps {
  appVersion: string;
}

export function AboutTab({ appVersion }: AboutTabProps): JSX.Element {
  const { t } = useT();

  return (
    <>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>{t('settings:about.versionLabel')}</span>
        <span className={styles.fieldValue}>{appVersion}</span>
      </div>

      <fieldset className={styles.group}>
        <legend className={styles.groupHeading}>{t('modals:about.updatesHeading')}</legend>
        <UpdateStatusArea />
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.groupHeading}>{t('modals:about.licenseHeading')}</legend>
        <p className={styles.fieldHint}>{t('modals:about.licenseBody')}</p>
        <p className={styles.fieldHint}>{t('modals:about.builtWith')}</p>
      </fieldset>

      <p className={styles.fieldHint}>{t('settings:about.blurb')}</p>
    </>
  );
}
