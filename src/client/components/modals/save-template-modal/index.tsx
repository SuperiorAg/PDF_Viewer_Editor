// SaveTemplateModal — Phase 3 small modal launched from Forms sidebar.
// Per ui-spec.md §12.3 "Save as template" button.

import { useEffect, useRef, useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { selectFormFields } from '../../../state/slices/forms-selectors';
import { closeModal } from '../../../state/slices/ui-slice';
import { saveFormTemplateThunk } from '../../../state/thunks';
import { ModalShell } from '../modal-shell';

import styles from './save-template-modal.module.css';

export function SaveTemplateModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const fields = useAppSelector(selectFormFields);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Programmatic focus instead of autoFocus prop (jsx-a11y/no-autofocus).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onSave = (): void => {
    if (!name.trim()) return;
    void dispatch(
      saveFormTemplateThunk({
        name: name.trim(),
        fields: fields.filter((f) => f.origin === 'authored'),
      }),
    );
    dispatch(closeModal());
  };

  return (
    <ModalShell
      title={t('modals:saveTemplate.title')}
      onClose={() => dispatch(closeModal())}
      size="sm"
      footer={
        <>
          <button type="button" onClick={() => dispatch(closeModal())}>
            {t('modals:saveTemplate.cancel')}
          </button>
          <button type="button" onClick={onSave} disabled={!name.trim()}>
            {t('modals:saveTemplate.saveButton')}
          </button>
        </>
      }
    >
      <div className={styles.body}>
        <label htmlFor="template-name">{t('modals:saveTemplate.nameLabel')}</label>
        <input
          ref={inputRef}
          id="template-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave();
          }}
          className={styles.input}
        />
        <p className={styles.hint}>
          {t('modals:saveTemplate.authoredFieldsNote', {
            count: fields.filter((f) => f.origin === 'authored').length,
          })}
        </p>
      </div>
    </ModalShell>
  );
}
