// Compare Files Setup Dialog — Phase 7.5 Wave 7 B2 (Riley).
//
// Two-column picker. Each column lets the user pick a "Currently open" doc
// OR browse for a PDF on disk via dialog:pickPdfFiles. When BOTH sides are
// chosen the Compare button activates. Cancel + Esc dismiss; the setup
// state is cleared via setupClosed.
//
// File ownership stays renderer-only (no IPC outside the api proxy).

import { useT } from '../../i18n/use-t';
import { api } from '../../services/api';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  selectCompareSetup,
  selectCompareSetupCanCompare,
  setupClosed,
  setupLeftPicked,
  setupRightPicked,
  type CompareFileSource,
} from '../../state/slices/compare-slice';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import { pushToast } from '../../state/slices/ui-slice';
import { openCompareSessionThunk } from '../../state/thunks-phase7-5-wave7';
import { ModalShell } from '../modals/modal-shell';

import styles from './compare-files-setup-dialog.module.css';
import { SidePicker } from './side-picker';

export function CompareFilesSetupDialog(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const setup = useAppSelector(selectCompareSetup);
  const canCompare = useAppSelector(selectCompareSetupCanCompare);
  const currentDoc = useAppSelector(selectCurrentDocument);

  const close = (): void => {
    dispatch(setupClosed());
  };

  const onPickLeft = (s: CompareFileSource | null): void => {
    dispatch(setupLeftPicked(s));
  };
  const onPickRight = (s: CompareFileSource | null): void => {
    dispatch(setupRightPicked(s));
  };

  const onBrowse = async (side: 'left' | 'right'): Promise<void> => {
    const res = await api.dialog.pickPdfFiles({ multi: false });
    if (!res.ok) {
      if (res.error === 'user_cancelled') return;
      dispatch(
        pushToast({
          kind: 'error',
          message: t('modals:compare.browsePickerFailed', { message: res.message }),
        }),
      );
      return;
    }
    const path = res.value.paths[0];
    if (!path) return;
    const basename =
      path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1) || path;
    const src: CompareFileSource = { kind: 'path', path, displayName: basename };
    if (side === 'left') onPickLeft(src);
    else onPickRight(src);
  };

  const onCompare = (): void => {
    if (!setup.left || !setup.right) return;
    void dispatch(openCompareSessionThunk({ left: setup.left, right: setup.right }));
  };

  const openDocSource: CompareFileSource | null = currentDoc
    ? {
        kind: 'open-doc',
        handle: currentDoc.handle,
        displayName: currentDoc.displayName,
      }
    : null;

  const footer = (
    <div className={styles.footer}>
      {setup.lastOpenError && (
        <div className={styles.errorRow} role="alert">
          {t('modals:compare.openError', { message: setup.lastOpenError })}
        </div>
      )}
      <div className={styles.footerButtons}>
        <button type="button" className={styles.cancel} onClick={close}>
          {t('modals:compare.cancel')}
        </button>
        <button type="button" className={styles.compare} onClick={onCompare} disabled={!canCompare}>
          {setup.opening ? t('modals:compare.comparing') : t('modals:compare.compareButton')}
        </button>
      </div>
    </div>
  );

  return (
    <ModalShell title={t('modals:compare.setupTitle')} onClose={close} footer={footer} size="lg">
      <div className={styles.body}>
        <p className={styles.intro}>{t('modals:compare.setupIntro')}</p>
        <div className={styles.columns}>
          <SidePicker
            side="left"
            label={t('modals:compare.leftLabel')}
            pick={setup.left}
            openDocSource={openDocSource}
            onSelect={onPickLeft}
            onBrowse={() => void onBrowse('left')}
          />
          <SidePicker
            side="right"
            label={t('modals:compare.rightLabel')}
            pick={setup.right}
            openDocSource={openDocSource}
            onSelect={onPickRight}
            onBrowse={() => void onBrowse('right')}
          />
        </div>
      </div>
    </ModalShell>
  );
}
