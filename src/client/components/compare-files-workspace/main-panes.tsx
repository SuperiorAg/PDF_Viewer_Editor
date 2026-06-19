// Main-panes — virtualized list of per-pair rows in the current view mode.
// Each row owns its own IntersectionObserver and triggers the relevant
// ensure*Loaded thunk when it enters the viewport.

import { useEffect, useRef, useState, useCallback } from 'react';

import { useAppSelector } from '../../state/hooks';
import { selectCompareSession, selectCompareViewMode } from '../../state/slices/compare-slice';

import styles from './compare-files-workspace.module.css';
import { focusedPairIndexAtomBus } from './focus-bus';
import { PairRow } from './pair-row';

/** Approximate row height for the main panes — used by the virtualizer
 *  to compute the window. Actual rows can be taller (the main panes
 *  measure rendered DOM) — we slightly over-estimate so we never display
 *  a black band. */
const ROW_HEIGHT_PX = 380;
const OVERSCAN_ROWS = 2;

export function CompareMainPanes(): JSX.Element | null {
  const session = useAppSelector(selectCompareSession);
  const viewMode = useAppSelector(selectCompareViewMode);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [clientHeight, setClientHeight] = useState(600);

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

  // Badge-click → scroll to row.
  useEffect(() => {
    const unsub = focusedPairIndexAtomBus.subscribe((pairIndex) => {
      const el = containerRef.current;
      if (!el) return;
      const target = pairIndex * ROW_HEIGHT_PX;
      el.scrollTo({ top: target, behavior: 'smooth' });
    });
    return unsub;
  }, []);

  if (!session) return null;

  const total = session.pagePairs.length;
  const totalHeight = total * ROW_HEIGHT_PX;
  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS);
  const visibleCount = Math.ceil(clientHeight / ROW_HEIGHT_PX) + OVERSCAN_ROWS * 2;
  const lastVisible = Math.min(total - 1, firstVisible + visibleCount);
  const rows: JSX.Element[] = [];
  for (let i = firstVisible; i <= lastVisible; i++) {
    rows.push(<PairRow key={i} pairIndex={i} viewMode={viewMode} />);
  }

  return (
    <div
      ref={containerRef}
      className={styles.mainPanes}
      onScroll={onScroll}
      data-testid="compare-main-panes"
      data-view-mode={viewMode}
    >
      <div className={styles.mainPanesInner} style={{ height: `${totalHeight}px` }}>
        <div
          className={styles.mainPanesWindow}
          style={{ transform: `translateY(${firstVisible * ROW_HEIGHT_PX}px)` }}
        >
          {rows}
        </div>
      </div>
    </div>
  );
}
