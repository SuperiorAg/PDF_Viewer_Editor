// Visual diff — renders the right-page PNG with the diff-mask PNG overlaid.

import { useT } from '../../i18n/use-t';
import type { ComparePageVisualEntry } from '../../state/slices/compare-slice';

import styles from './compare-files-workspace.module.css';

interface VisualDiffPaneProps {
  entry: ComparePageVisualEntry;
}

export function VisualDiffPane({ entry }: VisualDiffPaneProps): JSX.Element | null {
  const { t } = useT();
  const v = entry.visualValue;
  if (!v || !entry.diffMaskUrl) return null;
  // Prefer right (modified) as the base. On a right-orphan we fall back to left.
  const baseUrl = entry.rightUrl ?? entry.leftUrl;
  return (
    <div className={styles.visualPane} data-testid="compare-visual-pane">
      <div className={styles.visualMeta}>
        <span data-testid="compare-visual-percent">
          {t('modals:compare.visualPercentLabel', { percent: v.diffPercent.toFixed(2) })}
        </span>
        <span data-testid="compare-visual-count">
          {t('modals:compare.visualPixelCount', { count: v.diffPixelCount })}
        </span>
      </div>
      <div
        className={styles.visualStack}
        style={{ width: `${v.width}px`, height: `${v.height}px` }}
      >
        {baseUrl !== null && (
          <img className={styles.visualBase} src={baseUrl} alt="" aria-hidden="true" />
        )}
        <img
          className={styles.visualMask}
          src={entry.diffMaskUrl}
          alt=""
          aria-hidden="true"
          data-testid="compare-visual-mask"
        />
      </div>
    </div>
  );
}
