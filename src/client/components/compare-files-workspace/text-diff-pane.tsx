// Renders a per-page text diff with equal/insert/delete segment classes.

import { useT } from '../../i18n/use-t';
import type { ComparePageTextEntry } from '../../state/slices/compare-slice';

import styles from './compare-files-workspace.module.css';

interface TextDiffPaneProps {
  entry: ComparePageTextEntry;
  pageLabel: number;
}

export function TextDiffPane({ entry, pageLabel }: TextDiffPaneProps): JSX.Element {
  const { t } = useT();
  const value = entry.textValue;
  if (!value) return <div />;

  if (!value.summary.changed) {
    return (
      <div
        className={styles.textPane}
        data-testid={`compare-text-${pageLabel - 1}`}
        data-changed="false"
      >
        <div className={styles.noChanges}>{t('modals:compare.noChangesOnPage')}</div>
      </div>
    );
  }

  return (
    <div
      className={styles.textPane}
      data-testid={`compare-text-${pageLabel - 1}`}
      data-changed="true"
    >
      {value.diffs.map((seg, i) => (
        <span key={i} className={styles[`textSeg-${seg.kind}`]} data-kind={seg.kind}>
          {seg.text}
        </span>
      ))}
    </div>
  );
}
