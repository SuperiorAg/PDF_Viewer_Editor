// One side of the Compare Files setup dialog. Renders the "Currently open"
// option (if a doc is open) AND a Browse button. Selected pick is shown
// with a Clear option.

import { useT } from '../../i18n/use-t';
import type { CompareFileSource } from '../../state/slices/compare-slice';

import styles from './compare-files-setup-dialog.module.css';

/** The "currently open" candidate is always an open-doc shape. */
type OpenDocSource = Extract<CompareFileSource, { kind: 'open-doc' }>;

interface SidePickerProps {
  side: 'left' | 'right';
  label: string;
  pick: CompareFileSource | null;
  openDocSource: OpenDocSource | null;
  onSelect: (s: CompareFileSource | null) => void;
  onBrowse: () => void;
}

export function SidePicker(props: SidePickerProps): JSX.Element {
  const { t } = useT();
  const { side, label, pick, openDocSource, onSelect, onBrowse } = props;

  const isOpenDocSelected = ((): boolean => {
    if (pick === null || pick.kind !== 'open-doc') return false;
    if (openDocSource === null) return false;
    return pick.handle === openDocSource.handle;
  })();
  const isDiskSelected = pick !== null && pick.kind === 'path';

  return (
    <section className={styles.column} aria-label={label}>
      <h3 className={styles.columnLabel}>{label}</h3>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>{t('modals:compare.openDocSection')}</div>
        {openDocSource ? (
          <button
            type="button"
            className={`${styles.optionRow} ${isOpenDocSelected ? styles.optionRowActive : ''}`}
            data-testid={`compare-pick-open-doc-${side}`}
            onClick={() => onSelect(openDocSource)}
          >
            {t('modals:compare.openDocOption', { name: openDocSource.displayName })}
          </button>
        ) : (
          <div className={styles.muted}>{t('modals:compare.noOpenDoc')}</div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>{t('modals:compare.diskSection')}</div>
        <button
          type="button"
          className={styles.browse}
          data-testid={`compare-browse-${side}`}
          onClick={onBrowse}
        >
          {t('modals:compare.browse')}
        </button>
        {isDiskSelected && pick && (
          <div
            className={`${styles.optionRow} ${styles.optionRowActive}`}
            data-testid={`compare-pick-disk-${side}`}
          >
            {pick.displayName}
          </div>
        )}
      </div>

      {pick !== null && (
        <button
          type="button"
          className={styles.clear}
          data-testid={`compare-clear-${side}`}
          onClick={() => onSelect(null)}
        >
          {t('modals:compare.clearPick')}
        </button>
      )}
    </section>
  );
}
