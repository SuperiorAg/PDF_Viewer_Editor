// Compare Files Workspace — Phase 7.5 Wave 7 B2 (Riley).
//
// Dedicated view replacing the main viewer when a compare session is active.
// Layout:
//
//   ┌───────────────────────────────────────────────────────┐
//   │ Header — file names + page counts + Exit + view-mode   │
//   ├──────┬────────────────────────────────────────────────┤
//   │ Page │ Main panes                                      │
//   │ list │ (Text | Visual | Side-by-side)                  │
//   │      │                                                 │
//   │      │                                                 │
//   └──────┴────────────────────────────────────────────────┘
//
// Virtualization (hard rule): only the visible pair rows in the page-list
// AND the visible main-pane row trigger IPC. We use IntersectionObserver
// per row to detect on-screen; thunks dedupe re-requests.
//
// Honesty disclosures (P7.5-L-10) ride the header / footer with the
// VERBATIM strings exported from compare-slice.ts.

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  COMPARE_MULTI_COLUMN_FOOTNOTE,
  COMPARE_SEQUENTIAL_PAIRING_BANNER,
  selectCompareSession,
  selectCompareViewMode,
  type CompareViewMode,
  viewModeChanged,
} from '../../state/slices/compare-slice';
import { closeCompareSessionThunk } from '../../state/thunks-phase7-5-wave7';

import { CompareBadgeColumn } from './badge-column';
import styles from './compare-files-workspace.module.css';
import { CompareMainPanes } from './main-panes';

export function CompareFilesWorkspace(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectCompareSession);
  const viewMode = useAppSelector(selectCompareViewMode);

  if (!session) return null;

  const onExit = (): void => {
    void dispatch(closeCompareSessionThunk());
  };

  const onViewModeChange = (mode: CompareViewMode): void => {
    dispatch(viewModeChanged(mode));
  };

  return (
    <div className={styles.workspace} role="region" aria-label={t('modals:compare.setupTitle')}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>
            {t('modals:compare.workspaceTitle', {
              left: session.leftDisplayName,
              right: session.rightDisplayName,
            })}
          </h2>
          <button type="button" className={styles.exit} data-testid="compare-exit" onClick={onExit}>
            {t('modals:compare.workspaceExit')}
          </button>
        </div>
        <div className={styles.subRow}>
          <span className={styles.pageCount}>
            {t('modals:compare.workspacePageCount', {
              left: session.pageCountLeft,
              right: session.pageCountRight,
            })}
          </span>
          <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
        </div>
        <p className={styles.banner} role="note">
          {COMPARE_SEQUENTIAL_PAIRING_BANNER}
        </p>
      </header>
      <div className={styles.body}>
        <CompareBadgeColumn />
        <CompareMainPanes />
      </div>
      <footer className={styles.footnote}>
        <small>{COMPARE_MULTI_COLUMN_FOOTNOTE}</small>
      </footer>
    </div>
  );
}

interface ViewModeToggleProps {
  viewMode: CompareViewMode;
  onChange: (mode: CompareViewMode) => void;
}

function ViewModeToggle({ viewMode, onChange }: ViewModeToggleProps): JSX.Element {
  const { t } = useT();
  return (
    <div
      className={styles.viewModeGroup}
      role="radiogroup"
      aria-label={t('modals:compare.viewModeLabel')}
    >
      <ViewModeButton
        mode="text"
        active={viewMode === 'text'}
        label={t('modals:compare.viewModeText')}
        onClick={() => onChange('text')}
      />
      <ViewModeButton
        mode="visual"
        active={viewMode === 'visual'}
        label={t('modals:compare.viewModeVisual')}
        onClick={() => onChange('visual')}
      />
      <ViewModeButton
        mode="side-by-side"
        active={viewMode === 'side-by-side'}
        label={t('modals:compare.viewModeSideBySide')}
        onClick={() => onChange('side-by-side')}
      />
    </div>
  );
}

interface ViewModeButtonProps {
  mode: CompareViewMode;
  active: boolean;
  label: string;
  onClick: () => void;
}

function ViewModeButton({ mode, active, label, onClick }: ViewModeButtonProps): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-testid={`compare-view-mode-${mode}`}
      className={`${styles.viewModeButton} ${active ? styles.viewModeButtonActive : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
