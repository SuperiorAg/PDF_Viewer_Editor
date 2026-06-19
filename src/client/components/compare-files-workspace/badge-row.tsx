// One badge row in the page-list. Reads its own status selector (rendering
// is sparse — only the rows the virtualizer keeps mounted dispatch).

import { useT } from '../../i18n/use-t';
import { useAppSelector } from '../../state/hooks';
import {
  selectComparePairBadgeColor,
  selectCompareSession,
  selectComparePairTextStatus,
  selectComparePairVisualStatus,
} from '../../state/slices/compare-slice';

import styles from './compare-files-workspace.module.css';

interface BadgeRowProps {
  pairIndex: number;
  onClick: (pairIndex: number) => void;
}

export function BadgeRow({ pairIndex, onClick }: BadgeRowProps): JSX.Element | null {
  const { t } = useT();
  const session = useAppSelector(selectCompareSession);
  const color = useAppSelector((s) => selectComparePairBadgeColor(s, pairIndex));
  const textStatus = useAppSelector((s) => selectComparePairTextStatus(s, pairIndex));
  const visualStatus = useAppSelector((s) => selectComparePairVisualStatus(s, pairIndex));

  if (!session) return null;
  const pair = session.pagePairs[pairIndex];
  if (!pair) return null;
  const pageLabel = (pair.leftPageIndex ?? pair.rightPageIndex ?? -1) + 1;
  const ariaKey =
    textStatus === 'error' || visualStatus === 'error'
      ? 'badgeAriaError'
      : color === 'green'
        ? 'badgeAriaUnchanged'
        : color === 'red'
          ? 'badgeAriaBoth'
          : color === 'yellow'
            ? 'badgeAriaText'
            : textStatus === 'loading' || visualStatus === 'loading'
              ? 'badgeAriaLoading'
              : 'badgeAriaIdle';

  return (
    <button
      type="button"
      className={`${styles.badgeRow} ${styles[`badgeRow-${color}`]}`}
      data-testid={`compare-badge-${pairIndex}`}
      data-color={color}
      aria-label={t(`modals:compare.${ariaKey}`, { page: pageLabel })}
      onClick={() => onClick(pairIndex)}
    >
      <span className={`${styles.badgeDot} ${styles[`badgeDot-${color}`]}`} aria-hidden="true" />
      <span className={styles.badgeLabel}>{pageLabel}</span>
    </button>
  );
}
