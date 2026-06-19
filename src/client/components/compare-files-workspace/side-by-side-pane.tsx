// Side-by-side pane — three columns (left, right, diff mask). Each column
// renders a scaled-down version of the PNGs the engine returned, capped at
// a modest width so a 1064-page document stays smooth.

import { useT } from '../../i18n/use-t';
import type { ComparePairResults } from '../../state/slices/compare-slice';
import { COMPARE_VISUAL_RENDER_WIDTH_TEMPLATE } from '../../state/slices/compare-slice';

import styles from './compare-files-workspace.module.css';

interface SideBySidePaneProps {
  entry: ComparePairResults;
  pageLabel: number;
}

export function SideBySidePane({ entry, pageLabel }: SideBySidePaneProps): JSX.Element {
  const { t } = useT();
  const visual = entry.visual;
  const v = visual.visualValue;

  return (
    <div className={styles.sideBySide} data-testid={`compare-side-by-side-${pageLabel - 1}`}>
      <div className={styles.sideColumn}>
        <div className={styles.sideColumnHeader}>{t('modals:compare.sideBySideLeft')}</div>
        {visual.leftUrl !== null ? (
          <img className={styles.sideImg} src={visual.leftUrl} alt="" aria-hidden="true" />
        ) : (
          <div className={styles.sidePlaceholder}>—</div>
        )}
      </div>
      <div className={styles.sideColumn}>
        <div className={styles.sideColumnHeader}>{t('modals:compare.sideBySideRight')}</div>
        {visual.rightUrl !== null ? (
          <img className={styles.sideImg} src={visual.rightUrl} alt="" aria-hidden="true" />
        ) : (
          <div className={styles.sidePlaceholder}>—</div>
        )}
      </div>
      <div className={styles.sideColumn}>
        <div className={styles.sideColumnHeader}>{t('modals:compare.sideBySideDiffMask')}</div>
        {visual.diffMaskUrl !== null ? (
          <img className={styles.sideImg} src={visual.diffMaskUrl} alt="" aria-hidden="true" />
        ) : (
          <div className={styles.sidePlaceholder}>—</div>
        )}
      </div>
      {v && (
        <div className={styles.sideMeta}>
          {COMPARE_VISUAL_RENDER_WIDTH_TEMPLATE.replace('{{width}}', String(v.width))}
        </div>
      )}
    </div>
  );
}
