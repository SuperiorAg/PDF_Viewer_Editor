import { type ReactNode } from 'react';

import { useTablistKeys } from '../../hooks/use-tablist-keys';
import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectSidebarCollapsed, selectSidebarTab } from '../../state/slices/ui-selectors';
import { setSidebarTab, type SidebarTab } from '../../state/slices/ui-slice';
import { BookmarksPanel } from '../bookmarks-panel';
import { FormsPanel } from '../forms-panel';
// Phase 5 — OCR results panel as the 4th sidebar tab.
import { OcrResultsPanel } from '../ocr-results-panel';
// Phase 7.5 B7 (Riley Wave 3) — Stamps panel as the 6th sidebar tab.
import { StampsPanel } from '../stamps-panel';
import { ThumbnailStrip } from '../thumbnail-strip';

// Phase 6 — Exports tab as the 5th sidebar tab (ui-spec §15.4).
import { ExportsPanel } from './exports-panel';
import styles from './sidebar.module.css';

// Wave 28a (a11y-audit.md R-1): the proper WAI-ARIA tab pattern is restored
// here, replacing the Phase-1 jsx-a11y/aria-proptypes workaround that dropped
// tab semantics. role="tablist"/"tab"/"tabpanel" + aria-selected + roving
// tabindex (only the active tab is in the Tab order) + arrow-key navigation
// (vertical orientation: ArrowUp/ArrowDown; Home/End jump). On jsx-a11y 6.10
// the dynamic boolean aria-selected lints clean at `error` (no workaround
// needed — see build-report Wave 28a). Wave 28b: the tab labels + the
// tablist/nav aria-labels now resolve through t() (conventions §18.4 rule 9).

interface SidebarTabDef {
  id: SidebarTab;
  labelKey: string;
  testId?: string;
}

const SIDEBAR_TABS: readonly SidebarTabDef[] = [
  { id: 'thumbnails', labelKey: 'sidebar:tabs.thumbnails' },
  { id: 'bookmarks', labelKey: 'sidebar:tabs.bookmarks' },
  { id: 'forms', labelKey: 'sidebar:tabs.forms' },
  { id: 'ocr-results', labelKey: 'sidebar:tabs.ocrResults' },
  { id: 'exports', labelKey: 'sidebar:tabs.exports', testId: 'sidebar-tab-exports' },
  // Phase 7.5 B7 (Riley Wave 3).
  { id: 'stamps', labelKey: 'sidebar:tabs.stamps', testId: 'sidebar-tab-stamps' },
];

const TAB_IDS: readonly SidebarTab[] = SIDEBAR_TABS.map((t) => t.id);

export function Sidebar(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const tab = useAppSelector(selectSidebarTab);
  const collapsed = useAppSelector(selectSidebarCollapsed);

  const { onKeyDown, tabIndexFor } = useTablistKeys<SidebarTab>({
    tabs: TAB_IDS,
    active: tab,
    onActivate: (id) => dispatch(setSidebarTab(id)),
    orientation: 'vertical',
    idPrefix: 'sidebar-tab-id-',
  });

  if (collapsed) return null;

  const panelContents: ReactNode =
    tab === 'thumbnails' ? (
      <ThumbnailStrip />
    ) : tab === 'bookmarks' ? (
      <BookmarksPanel />
    ) : tab === 'forms' ? (
      <FormsPanel />
    ) : tab === 'ocr-results' ? (
      <OcrResultsPanel />
    ) : tab === 'exports' ? (
      // Phase 6 — Exports tab.
      <ExportsPanel />
    ) : (
      // Phase 7.5 B7 (Riley Wave 3) — Stamps tab.
      <StampsPanel />
    );

  return (
    <aside className={styles.sidebar} aria-label={t('sidebar:navLabel')}>
      <div
        className={styles.tabs}
        role="tablist"
        aria-label={t('sidebar:panelsLabel')}
        aria-orientation="vertical"
      >
        {SIDEBAR_TABS.map((tabDef) => {
          const isActive = tabDef.id === tab;
          return (
            <button
              key={tabDef.id}
              type="button"
              role="tab"
              id={`sidebar-tab-id-${tabDef.id}`}
              aria-selected={isActive}
              aria-controls={`sidebar-panel-${tabDef.id}`}
              tabIndex={tabIndexFor(tabDef.id)}
              className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
              onClick={() => dispatch(setSidebarTab(tabDef.id))}
              onKeyDown={onKeyDown}
              data-testid={tabDef.testId}
            >
              {t(tabDef.labelKey)}
            </button>
          );
        })}
      </div>
      <div
        className={styles.panel}
        role="tabpanel"
        id={`sidebar-panel-${tab}`}
        aria-labelledby={`sidebar-tab-id-${tab}`}
        tabIndex={0}
      >
        {panelContents}
      </div>
    </aside>
  );
}
