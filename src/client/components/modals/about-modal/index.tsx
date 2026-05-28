// AboutModal — the standalone About dialog (Help → About). ui-spec.md §16.2.
//
// Surfaces: app version + runtime, the live update-status area (the load-bearing
// trust-floor placement for obligations #2 + #6 via UpdateStatusArea), and the
// license + acknowledgments list (which MUST name the Phase-7-new MIT deps:
// i18next, react-i18next, electron-updater). Every string is t()-keyed from the
// start — no hardcode-then-re-extract.
//
// The Settings → About TAB (settings-modal) reuses the same UpdateStatusArea +
// acknowledgments copy so the two surfaces never drift.

import { useEffect, useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { api } from '../../../services/api';
import { useAppDispatch } from '../../../state/hooks';
import { closeModal } from '../../../state/slices/ui-slice';
import { UpdateStatusArea } from '../../update-status-area';
import { ModalShell } from '../modal-shell';

import styles from './about-modal.module.css';

export function AboutModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const v = await api.app.getVersion();
      if (v.ok) setVersion(v.value.appVersion);
    })();
  }, []);

  const close = (): void => {
    dispatch(closeModal());
  };

  return (
    <ModalShell
      title={t('modals:about.title')}
      onClose={close}
      size="md"
      footer={
        <button type="button" className={styles.primary} onClick={close}>
          {t('common:close')}
        </button>
      }
    >
      <div className={styles.about}>
        <p className={styles.tagline}>{t('modals:about.tagline')}</p>

        <div className={styles.versionRow}>
          <span className={styles.versionLabel}>{t('modals:about.versionLabel')}</span>
          <span className={styles.versionValue}>{version ?? t('common:loading')}</span>
        </div>

        <section aria-labelledby="about-updates-heading" className={styles.section}>
          <h3 id="about-updates-heading" className={styles.heading}>
            {t('modals:about.updatesHeading')}
          </h3>
          <UpdateStatusArea />
        </section>

        <section aria-labelledby="about-license-heading" className={styles.section}>
          <h3 id="about-license-heading" className={styles.heading}>
            {t('modals:about.licenseHeading')}
          </h3>
          <p className={styles.licenseBody}>{t('modals:about.licenseBody')}</p>
          <p className={styles.builtWith}>{t('modals:about.builtWith')}</p>
          {/* Documentation / Repository are shown as labels, not links: there is
              no URL-open IPC channel in Phase 7 (app.openExternal only does
              show-in-explorer by handle) and the repo is not published yet
              (mirrors the update placeholder honesty). Nathan wires real links
              in Wave 30 once the repo URL exists. */}
          <p className={styles.builtWith}>
            {t('modals:about.documentation')} · {t('modals:about.repository')}
          </p>
        </section>
      </div>
    </ModalShell>
  );
}
