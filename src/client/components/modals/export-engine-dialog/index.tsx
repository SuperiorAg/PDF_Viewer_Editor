import { useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { useAppDispatch } from '../../../state/hooks';
import { closeModal } from '../../../state/slices/ui-slice';
import { exportPdfThunk } from '../../../state/thunks';
import { type ExportEnginePreference } from '../../../types/ipc-contract';
import { ModalShell } from '../modal-shell';

import styles from './export-engine-dialog.module.css';

export function ExportEngineDialog(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const [preference, setPreference] = useState<ExportEnginePreference>('auto');

  const close = (): void => {
    dispatch(closeModal());
  };

  const submit = async (): Promise<void> => {
    close();
    await dispatch(exportPdfThunk(preference));
  };

  const projectedEngine =
    preference === 'auto'
      ? t('modals:exportEngine.willRunAuto')
      : preference === 'pdf-lib'
        ? t('modals:exportEngine.willRunPdfLib')
        : t('modals:exportEngine.willRunChromium');

  return (
    <ModalShell
      title={t('modals:exportEngine.title')}
      onClose={close}
      footer={
        <>
          <button type="button" className={styles.secondary} onClick={close}>
            {t('modals:exportEngine.cancelButton')}
          </button>
          <button type="button" className={styles.primary} onClick={() => void submit()}>
            {t('modals:exportEngine.exportButton')}
          </button>
        </>
      }
    >
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('modals:exportEngine.engineLabel')}</span>
        <select
          value={preference}
          onChange={(e) => setPreference(e.target.value as ExportEnginePreference)}
        >
          <option value="auto">{t('modals:exportEngine.engineAuto')}</option>
          <option value="pdf-lib">{t('modals:exportEngine.enginePdfLib')}</option>
          <option value="chromium">{t('modals:exportEngine.engineChromium')}</option>
        </select>
      </label>
      <p className={styles.preview}>
        <strong>{t('modals:exportEngine.willRun')}</strong> {projectedEngine}
      </p>
      <p className={styles.note}>{t('modals:exportEngine.note')}</p>
    </ModalShell>
  );
}
