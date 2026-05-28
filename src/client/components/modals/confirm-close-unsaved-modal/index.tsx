import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { selectCurrentDocument } from '../../../state/slices/document-selectors';
import { closeModal } from '../../../state/slices/ui-slice';
import { closeDocumentThunk, saveDocumentThunk } from '../../../state/thunks';
import { ModalShell } from '../modal-shell';

import styles from './confirm-close-unsaved-modal.module.css';

export function ConfirmCloseUnsavedModal(): JSX.Element {
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);

  const dismiss = (): void => {
    dispatch(closeModal());
  };

  const dontSave = (): void => {
    dispatch(closeModal());
    void dispatch(closeDocumentThunk());
  };

  const saveAndClose = (): void => {
    dispatch(closeModal());
    void (async () => {
      await dispatch(saveDocumentThunk({ saveAs: false }));
      await dispatch(closeDocumentThunk());
    })();
  };

  return (
    <ModalShell
      title="Unsaved changes"
      onClose={dismiss}
      size="sm"
      footer={
        <>
          <button type="button" className={styles.dont} onClick={dontSave}>
            Don&apos;t save
          </button>
          <button type="button" className={styles.cancel} onClick={dismiss}>
            Cancel
          </button>
          <button type="button" className={styles.save} onClick={saveAndClose}>
            Save and close
          </button>
        </>
      }
    >
      <p>{doc ? <strong>{doc.displayName}</strong> : 'The document'} has unsaved changes.</p>
    </ModalShell>
  );
}
