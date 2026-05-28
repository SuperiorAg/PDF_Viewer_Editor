// ScanModal — Phase 5.1 placeholder. Per docs/ui-spec.md §14.6 and
// docs/architecture-phase-5.md §7 (Q-E deferral verdict).
//
// **Phase 5 behavior:** the modal is reachable only when something
// programmatically dispatches `openScanModal` — the Tools menu item that
// would normally open this modal is DISABLED in Phase 5 (see menu-bar wiring),
// so a user cannot reach this modal via the menu. The modal still ships so
// Phase 5.1 implementers have a target — and so that a user who *does*
// somehow reach it (e.g. via a future drag-drop affordance for a scanner
// trigger file) gets a clean explanation instead of a runtime error.

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { closeScanModal } from '../../../state/slices/scan-slice';
import { type RootState } from '../../../state/store';
import { ModalShell } from '../modal-shell';

import styles from './scan-modal.module.css';

export function ScanModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const lastError = useAppSelector((s: RootState) => s.scan.lastError);

  const onClose = (): void => {
    dispatch(closeScanModal());
  };

  return (
    <ModalShell title={t('modals:scan.title')} onClose={onClose}>
      <div className={styles.body}>
        <div className={styles.deferralMessage}>
          <p className={styles.title}>{t('modals:scan.deferredTitle')}</p>
          <p>{t('modals:scan.deferredBody')}</p>
          <p>{t('modals:scan.untilThen')}</p>
          <ul className={styles.list}>
            <li>{t('modals:scan.winScanApp')}</li>
            <li>{t('modals:scan.winFaxScan')}</li>
          </ul>
          <p>{t('modals:scan.saveThenDrag')}</p>
          {lastError !== null && (
            <p>
              <strong>{t('modals:scan.lastError')}</strong> {lastError}
            </p>
          )}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            {t('modals:scan.close')}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
