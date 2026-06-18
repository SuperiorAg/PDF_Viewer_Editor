// Alt Text Inspector — bulk-set sub-modal.
// Phase 7.5 C5 (Riley Wave 5c). Per docs/ui-spec-phase-7.5.md §26.
//
// Opens when the user clicks "Bulk set alt text for similar figures"
// inside a group whose figures share a pHash. The textarea collects a
// single alt-text string; on Apply, the parent dispatches
// `applyBulkAltTextThunk` against every figure in the group.

import { useT } from '../../i18n/use-t';
import type { FigureWithoutAlt } from '../../types/alt-text-contract-stub';

import styles from './alt-text-inspector.module.css';

interface BulkModalProps {
  groupHash: string;
  members: readonly FigureWithoutAlt[];
  draft: string;
  applying: boolean;
  onDraftChange: (value: string) => void;
  onApply: () => void;
  onCancel: () => void;
}

export function BulkModal(props: BulkModalProps): JSX.Element {
  const { t } = useT();
  return (
    <div
      className={styles.bulkOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="alt-text-bulk-title"
    >
      <div className={styles.bulkModal}>
        <h3 id="alt-text-bulk-title" className={styles.bulkTitle}>
          {t('modals:accessibility.altText.bulkModal.title')}
        </h3>
        <p className={styles.bulkLabel}>
          {t('modals:accessibility.altText.bulkModal.matched', { count: props.members.length })}
        </p>
        <label className={styles.bulkLabel} htmlFor="alt-text-bulk-input">
          {t('modals:accessibility.altText.bulkModal.altLabel')}
        </label>
        <textarea
          id="alt-text-bulk-input"
          className={styles.bulkInput}
          value={props.draft}
          onChange={(e) => props.onDraftChange(e.target.value)}
          placeholder={t('modals:accessibility.altText.bulkModal.altPlaceholder')}
        />
        <div className={styles.bulkActions}>
          <button type="button" className={styles.closeButton} onClick={props.onCancel}>
            {t('modals:accessibility.altText.bulkModal.cancel')}
          </button>
          <button
            type="button"
            className={styles.applyButton}
            onClick={props.onApply}
            disabled={props.applying || props.draft.length === 0}
          >
            {props.applying
              ? t('modals:accessibility.altText.applying')
              : t('modals:accessibility.altText.bulkModal.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
