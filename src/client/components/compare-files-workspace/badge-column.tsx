// Compare badge column — virtualized list of page-pair status badges
// (green/yellow/red/gray). Click a badge to scroll the main panes to that
// row. Renders only the on-screen rows (windowed virtualization).

import { useRef, useState, useEffect, useCallback } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCompareSession } from '../../state/slices/compare-slice';
import { ensureCompareTextLoadedThunk } from '../../state/thunks-phase7-5-wave7';

import { BadgeRow } from './badge-row';
import styles from './compare-files-workspace.module.css';
import { focusedPairIndexAtomBus } from './focus-bus';

/** Pixel height per badge row — kept in sync with the CSS rule. */
const ROW_HEIGHT_PX = 32;
/** Render this many extra rows above + below the viewport to smooth scroll. */
const OVERSCAN_ROWS = 4;

export function CompareBadgeColumn(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectCompareSession);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [clientHeight, setClientHeight] = useState(600);

  // Measure container height once mounted + on resize.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setClientHeight(el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setClientHeight(e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>): void => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const onBadgeClick = useCallback(
    (pairIndex: number): void => {
      focusedPairIndexAtomBus.publish(pairIndex);
      // Eagerly load text for that pair (text is the cheapest mode).
      void dispatch(ensureCompareTextLoadedThunk({ pairIndex }));
    },
    [dispatch],
  );

  if (!session) return null;
  const total = session.pagePairs.length;
  const totalHeight = total * ROW_HEIGHT_PX;
  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS);
  const visibleCount = Math.ceil(clientHeight / ROW_HEIGHT_PX) + OVERSCAN_ROWS * 2;
  const lastVisible = Math.min(total - 1, firstVisible + visibleCount);
  const rows: JSX.Element[] = [];
  for (let i = firstVisible; i <= lastVisible; i++) {
    rows.push(<BadgeRow key={i} pairIndex={i} onClick={onBadgeClick} />);
  }

  return (
    <div
      ref={containerRef}
      className={styles.badgeColumn}
      onScroll={onScroll}
      data-testid="compare-badge-column"
      aria-label={t('modals:compare.badgeColumnHeader')}
    >
      <div className={styles.badgeColumnInner} style={{ height: `${totalHeight}px` }}>
        <div
          className={styles.badgeColumnWindow}
          style={{ transform: `translateY(${firstVisible * ROW_HEIGHT_PX}px)` }}
        >
          {rows}
        </div>
      </div>
    </div>
  );
}
