// Tag-add modal — Phase 7.5 C3 (Riley Wave 5b).
//
// Renders when the user clicks the "+" header button. Asks for the new
// node's type + an optional title before dispatching `addChild`.
// Per docs/ui-spec-phase-7.5.md §24.1.

import { useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n/use-t';
import {
  DEFAULT_NEW_CHILD_TYPE,
  PICKABLE_TYPES,
  type StructTreeNodeType,
} from '../../types/struct-tree-contract-stub';

import styles from './tag-tree-editor.module.css';

interface TagAddModalProps {
  parentType: string;
  onCancel: () => void;
  onSubmit: (type: StructTreeNodeType, title: string) => void;
}

export function TagAddModal(props: TagAddModalProps): JSX.Element {
  const { t } = useT();
  const [type, setType] = useState<StructTreeNodeType>(DEFAULT_NEW_CHILD_TYPE);
  const [title, setTitle] = useState('');
  const submitRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Default focus on Cancel (destructive-leaning safety pattern from the
  // Phase 7.4 B1 redaction Apply modal lesson — jsx-a11y/no-autofocus
  // forbids the prop; use a useEffect + ref instead).
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const onSubmit = (): void => {
    props.onSubmit(type, title);
  };

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tag-add-modal-title"
    >
      <div className={styles.modal}>
        <h3 id="tag-add-modal-title" className={styles.modalTitle}>
          {t('modals:accessibility.tagPdf.addChildTitle', { parentType: props.parentType })}
        </h3>
        <div className={styles.inspectorField}>
          <label htmlFor="tag-add-type">{t('modals:accessibility.tagPdf.type')}</label>
          <select
            id="tag-add-type"
            value={type}
            onChange={(e) => setType(e.target.value as StructTreeNodeType)}
          >
            {PICKABLE_TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {tp}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.inspectorField}>
          <label htmlFor="tag-add-title">{t('modals:accessibility.tagPdf.titleLabel')}</label>
          <input
            id="tag-add-title"
            type="text"
            value={title}
            placeholder={t('modals:accessibility.tagPdf.titlePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitRef.current?.click();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                props.onCancel();
              }
            }}
          />
        </div>
        <div className={styles.modalActions}>
          <button
            ref={cancelRef}
            type="button"
            className={styles.iconButton}
            onClick={props.onCancel}
          >
            {t('common:cancel')}
          </button>
          <button ref={submitRef} type="button" className={styles.applyButton} onClick={onSubmit}>
            {t('modals:accessibility.tagPdf.addChild')}
          </button>
        </div>
      </div>
    </div>
  );
}
