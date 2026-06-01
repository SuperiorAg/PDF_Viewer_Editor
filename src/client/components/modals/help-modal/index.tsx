// HelpModal — F1-bound in-app help overlay. Wave 30+ comprehensive expansion.
//
// Phase 1.1 R-1.1 shipped a single-screen Help modal (shortcuts table + Phase 1
// limitations + roadmap). The Wave-30 polish wave promotes this to a
// multi-section reference covering every shipped feature, sourced from
// docs/user-guide.md (Nathan, Phase 7). The structure lives in help-content.ts
// (a TS data module — no markdown renderer, no new deps); every string is
// resolved via useT('modals:help.*') so es-ES + future locales work with the
// same structure.
//
// Accessibility: horizontal-orientation WAI-ARIA tab pattern with roving
// tabindex (useTablistKeys), focus-trap inside the modal shell (useFocusTrap),
// Esc to close (ModalShell). Each tab panel has `tabIndex={0}` so the panel
// content is reachable by Tab. Shortcut KBD elements use semantic <kbd>.

import { useState } from 'react';

import { useTablistKeys } from '../../../hooks/use-tablist-keys';
import { useT, type TFunction } from '../../../i18n/use-t';
import { useAppDispatch } from '../../../state/hooks';
import { closeHelpModal } from '../../../state/slices/ui-slice';
import { ModalShell } from '../modal-shell';

import { HELP_SECTIONS, HELP_TABS, type HelpSection, type HelpTabId } from './help-content';
import styles from './help-modal.module.css';

interface ShortcutRow {
  category: string;
  action: string;
  shortcut: string;
  /** Sentinel — every shipped shortcut is `enabled` in current Phase 7+ surface. */
  status: 'enabled';
}

// Mirrors docs/user-guide.md §"Keyboard shortcuts (full list)" — Wave 4 Nathan,
// trimmed to the shipped surface. Single source of truth for the in-app help
// table. The status column is informational (all shipped).
const SHORTCUT_ROWS: ReadonlyArray<ShortcutRow> = [
  { category: 'File', action: 'Open PDF', shortcut: 'Ctrl+O', status: 'enabled' },
  { category: 'File', action: 'Save', shortcut: 'Ctrl+S', status: 'enabled' },
  { category: 'File', action: 'Save As', shortcut: 'Ctrl+Shift+S', status: 'enabled' },
  { category: 'File', action: 'Close document', shortcut: 'Ctrl+W', status: 'enabled' },
  { category: 'File', action: 'Quit', shortcut: 'Ctrl+Q', status: 'enabled' },
  { category: 'File', action: 'Print', shortcut: 'Ctrl+P', status: 'enabled' },
  { category: 'File', action: 'Export to PDF', shortcut: 'Ctrl+Shift+P', status: 'enabled' },
  { category: 'File', action: 'Settings', shortcut: 'Ctrl+,', status: 'enabled' },
  { category: 'Edit', action: 'Undo', shortcut: 'Ctrl+Z', status: 'enabled' },
  { category: 'Edit', action: 'Redo', shortcut: 'Ctrl+Y / Ctrl+Shift+Z', status: 'enabled' },
  { category: 'Edit', action: 'Find', shortcut: 'Ctrl+F', status: 'enabled' },
  { category: 'Edit', action: 'Select all pages', shortcut: 'Ctrl+A', status: 'enabled' },
  {
    category: 'Edit',
    action: 'Delete selection',
    shortcut: 'Delete / Backspace',
    status: 'enabled',
  },
  { category: 'View', action: 'Zoom in', shortcut: 'Ctrl++', status: 'enabled' },
  { category: 'View', action: 'Zoom out', shortcut: 'Ctrl+-', status: 'enabled' },
  {
    category: 'View',
    action: 'Zoom at cursor (Acrobat-style)',
    shortcut: 'Ctrl+wheel',
    status: 'enabled',
  },
  { category: 'View', action: 'Zoom 100%', shortcut: 'Ctrl+0', status: 'enabled' },
  { category: 'View', action: 'Fit width', shortcut: 'Ctrl+1', status: 'enabled' },
  { category: 'View', action: 'Fit page', shortcut: 'Ctrl+2', status: 'enabled' },
  { category: 'View', action: 'Toggle sidebar', shortcut: 'Ctrl+B', status: 'enabled' },
  { category: 'View', action: 'Toggle inspector', shortcut: 'Ctrl+I', status: 'enabled' },
  { category: 'View', action: 'Toggle fullscreen', shortcut: 'F11', status: 'enabled' },
  { category: 'Pages', action: 'Rotate clockwise', shortcut: 'Ctrl+R', status: 'enabled' },
  {
    category: 'Pages',
    action: 'Rotate counter-clockwise',
    shortcut: 'Ctrl+Shift+R',
    status: 'enabled',
  },
  { category: 'Pages', action: 'Previous page', shortcut: 'Page Up', status: 'enabled' },
  { category: 'Pages', action: 'Next page', shortcut: 'Page Down', status: 'enabled' },
  { category: 'Pages', action: 'First page', shortcut: 'Home', status: 'enabled' },
  { category: 'Pages', action: 'Last page', shortcut: 'End', status: 'enabled' },
  { category: 'Tools', action: 'Highlight', shortcut: 'H', status: 'enabled' },
  { category: 'Tools', action: 'Sticky note', shortcut: 'S', status: 'enabled' },
  { category: 'Tools', action: 'Text box', shortcut: 'T', status: 'enabled' },
  { category: 'Tools', action: 'Cursor / select', shortcut: 'V / Esc', status: 'enabled' },
  { category: 'Help', action: 'Help (this dialog)', shortcut: 'F1', status: 'enabled' },
  {
    category: 'Sidebar',
    action: 'Cycle sidebar tab',
    shortcut: 'Tab (when sidebar focus)',
    status: 'enabled',
  },
];

// ── Renderers for the 3 SubSection shapes (prose / bullets / steps) ──────────
// Kept inline (not split to per-shape files) — each is a small JSX block and
// they share the same i18n + style boundary.

function renderSubSection(
  sub: HelpSection['subsections'][number],
  index: number,
  t: TFunction,
): JSX.Element {
  if (sub.kind === 'prose') {
    return (
      <section key={`sub-${index}`} className={styles.subsection}>
        <h4 className={styles.subHeading}>{t(sub.headingKey)}</h4>
        <p className={styles.subBody}>{t(sub.bodyKey)}</p>
      </section>
    );
  }
  if (sub.kind === 'bullets') {
    return (
      <section key={`sub-${index}`} className={styles.subsection}>
        <h4 className={styles.subHeading}>{t(sub.headingKey)}</h4>
        {sub.introKey !== undefined && <p className={styles.subBody}>{t(sub.introKey)}</p>}
        <ul className={styles.bulletList}>
          {sub.bulletKeys.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      </section>
    );
  }
  // sub.kind === 'steps'
  return (
    <section key={`sub-${index}`} className={styles.subsection}>
      <h4 className={styles.subHeading}>{t(sub.headingKey)}</h4>
      <ol className={styles.stepsList}>
        {sub.stepKeys.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ol>
      {sub.footnoteKey !== undefined && <p className={styles.footnote}>{t(sub.footnoteKey)}</p>}
    </section>
  );
}

function ShortcutsTable({ t }: { t: TFunction }): JSX.Element {
  return (
    <table className={styles.shortcutsTable}>
      <thead>
        <tr>
          <th scope="col">{t('modals:help.colCategory')}</th>
          <th scope="col">{t('modals:help.colAction')}</th>
          <th scope="col">{t('modals:help.colShortcut')}</th>
          <th scope="col">{t('modals:help.colEnabled')}</th>
        </tr>
      </thead>
      <tbody>
        {SHORTCUT_ROWS.map((row) => (
          <tr key={`${row.category}-${row.action}`}>
            <td>{row.category}</td>
            <td>{row.action}</td>
            <td>
              <kbd className={styles.kbd}>{row.shortcut}</kbd>
            </td>
            <td>{t('modals:help.shortcutEnabled')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HelpModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState<HelpTabId>('gettingStarted');

  // WAI-ARIA tab pattern — horizontal orientation, roving tabindex, Home/End
  // jump to first/last. Same primitive the SettingsModal uses (Phase 7 a11y).
  const { onKeyDown, tabIndexFor } = useTablistKeys<HelpTabId>({
    tabs: HELP_TABS,
    active: activeTab,
    onActivate: setActiveTab,
    orientation: 'horizontal',
    idPrefix: 'help-tab-id-',
  });

  const close = (): void => {
    dispatch(closeHelpModal());
  };

  const activeSection: HelpSection | undefined = HELP_SECTIONS.find((s) => s.id === activeTab);

  return (
    <ModalShell
      title={t('modals:help.title')}
      onClose={close}
      size="lg"
      footer={
        <>
          <span className={styles.footerNote}>{t('modals:help.escToClose')}</span>
          <button type="button" className={styles.primary} onClick={close}>
            {t('modals:help.close')}
          </button>
        </>
      }
    >
      <p className={styles.intro}>{t('modals:help.intro')}</p>

      <div
        className={styles.tabs}
        role="tablist"
        aria-label={t('modals:help.tablistLabel')}
        aria-orientation="horizontal"
      >
        {HELP_TABS.map((tabId) => {
          // Explicit `: boolean` annotation — jsx-a11y/aria-proptypes rejects
          // a `boolean | undefined` expression for aria-selected (it wants a
          // narrowed bool). The `=== tabId` already returns boolean, but
          // jsx-a11y inspects the static type, not the runtime value. Same
          // pattern as settings-modal/index.tsx (Wave 28a a11y-audit fix).
          const isActive: boolean = activeTab === tabId;
          const className = `${styles.tab} ${isActive ? styles.tabActive : ''}`;
          return (
            <button
              key={tabId}
              type="button"
              role="tab"
              id={`help-tab-id-${tabId}`}
              aria-selected={isActive}
              aria-controls={`help-panel-${tabId}`}
              tabIndex={tabIndexFor(tabId)}
              className={className}
              onClick={() => setActiveTab(tabId)}
              onKeyDown={onKeyDown}
            >
              {t(`modals:help.tabs.${tabId}`)}
            </button>
          );
        })}
      </div>

      <div
        className={styles.panel}
        role="tabpanel"
        id={`help-panel-${activeTab}`}
        aria-labelledby={`help-tab-id-${activeTab}`}
        tabIndex={0}
      >
        {activeSection !== undefined && (
          <>
            <h3 className={styles.sectionHeading}>{t(activeSection.titleKey)}</h3>
            {activeSection.introKey !== undefined &&
              // Skip when intro key matches the heading (used by 'gettingStarted'
              // as a structure hint, not a separate paragraph).
              activeSection.introKey !== activeSection.titleKey && (
                <p className={styles.intro}>{t(activeSection.introKey)}</p>
              )}

            {activeTab === 'shortcuts' ? (
              <ShortcutsTable t={t} />
            ) : (
              activeSection.subsections.map((sub, idx) => renderSubSection(sub, idx, t))
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}
