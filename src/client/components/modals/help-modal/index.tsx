// HelpModal — F1-bound in-app help overlay. Phase 1.1 R-1.1.
//
// Renders a hand-ported subset of docs/user-guide.md (Nathan Wave 4) as JSX:
//   - keyboard shortcuts table (Phase 1 enabled subset + Phase 2+ deferred rows)
//   - Phase 1 limitations summary (lead with Save fidelity boundary)
//   - "Coming in later phases" roadmap snapshot
//
// Why JSX not markdown-at-runtime: shipping a markdown renderer would force a
// bundler-config decision the project hasn't taken yet (raw .md imports + a
// sanitizer). Hand-port is cheaper and offline-safe. When Phase 2 picks a
// rendering pipeline this file becomes a thin wrapper over the imported guide.
//
// Modal-shell handles Escape + click-outside + close-button per its existing
// behavior (see modal-shell.tsx).
import { useT } from '../../../i18n/use-t';
import { useAppDispatch } from '../../../state/hooks';
import { closeHelpModal } from '../../../state/slices/ui-slice';
import { ModalShell } from '../modal-shell';

import styles from './help-modal.module.css';

interface ShortcutRow {
  category: string;
  action: string;
  shortcut: string;
  phase1: 'yes' | 'yes*' | 'Phase 2' | 'Phase 2+';
}

// Mirrors docs/user-guide.md §"Keyboard shortcuts (full list)" — Wave 4 Nathan.
// Single source of truth for the in-app help table. Re-sync if user-guide
// changes; the table is deliberately compact (Category/Action/Shortcut/Enabled).
const SHORTCUT_ROWS: ReadonlyArray<ShortcutRow> = [
  { category: 'File', action: 'Open PDF', shortcut: 'Ctrl+O', phase1: 'yes' },
  { category: 'File', action: 'Save', shortcut: 'Ctrl+S', phase1: 'yes*' },
  { category: 'File', action: 'Save As', shortcut: 'Ctrl+Shift+S', phase1: 'yes' },
  { category: 'File', action: 'Close document', shortcut: 'Ctrl+W', phase1: 'yes' },
  { category: 'File', action: 'Quit', shortcut: 'Ctrl+Q', phase1: 'yes' },
  { category: 'File', action: 'Print', shortcut: 'Ctrl+P', phase1: 'Phase 2' },
  { category: 'File', action: 'Export to PDF', shortcut: 'Ctrl+Shift+P', phase1: 'Phase 2' },
  { category: 'File', action: 'Settings', shortcut: 'Ctrl+,', phase1: 'yes' },
  { category: 'Edit', action: 'Undo', shortcut: 'Ctrl+Z', phase1: 'Phase 2' },
  { category: 'Edit', action: 'Redo', shortcut: 'Ctrl+Y / Ctrl+Shift+Z', phase1: 'Phase 2' },
  { category: 'Edit', action: 'Find', shortcut: 'Ctrl+F', phase1: 'Phase 2' },
  { category: 'Edit', action: 'Select all pages', shortcut: 'Ctrl+A', phase1: 'yes' },
  { category: 'Edit', action: 'Delete selection', shortcut: 'Delete / Backspace', phase1: 'yes' },
  { category: 'View', action: 'Zoom in', shortcut: 'Ctrl++', phase1: 'yes' },
  { category: 'View', action: 'Zoom out', shortcut: 'Ctrl+-', phase1: 'yes' },
  { category: 'View', action: 'Zoom 100%', shortcut: 'Ctrl+0', phase1: 'yes' },
  { category: 'View', action: 'Fit width', shortcut: 'Ctrl+1', phase1: 'yes' },
  { category: 'View', action: 'Fit page', shortcut: 'Ctrl+2', phase1: 'yes' },
  { category: 'View', action: 'Toggle sidebar', shortcut: 'Ctrl+B', phase1: 'yes' },
  { category: 'View', action: 'Toggle inspector', shortcut: 'Ctrl+I', phase1: 'yes' },
  { category: 'View', action: 'Toggle fullscreen', shortcut: 'F11', phase1: 'yes' },
  { category: 'Pages', action: 'Rotate clockwise', shortcut: 'Ctrl+R', phase1: 'yes' },
  {
    category: 'Pages',
    action: 'Rotate counter-clockwise',
    shortcut: 'Ctrl+Shift+R',
    phase1: 'yes',
  },
  { category: 'Pages', action: 'Previous page', shortcut: 'Page Up', phase1: 'yes' },
  { category: 'Pages', action: 'Next page', shortcut: 'Page Down', phase1: 'yes' },
  { category: 'Pages', action: 'First page', shortcut: 'Home', phase1: 'yes' },
  { category: 'Pages', action: 'Last page', shortcut: 'End', phase1: 'yes' },
  { category: 'Tools', action: 'Highlight', shortcut: 'H', phase1: 'yes' },
  { category: 'Tools', action: 'Sticky note', shortcut: 'S', phase1: 'yes' },
  { category: 'Tools', action: 'Text box', shortcut: 'T', phase1: 'yes' },
  { category: 'Tools', action: 'Cursor / select', shortcut: 'V / Esc', phase1: 'yes' },
  { category: 'Help', action: 'Help (this dialog)', shortcut: 'F1', phase1: 'yes' },
  {
    category: 'Sidebar',
    action: 'Cycle sidebar tab',
    shortcut: 'Tab (when sidebar focus)',
    phase1: 'yes',
  },
];

export function HelpModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const close = (): void => {
    dispatch(closeHelpModal());
  };

  return (
    <ModalShell
      title={t('modals:help.title')}
      onClose={close}
      size="lg"
      footer={
        <button type="button" className={styles.primary} onClick={close}>
          {t('modals:help.close')}
        </button>
      }
    >
      <section className={styles.section} aria-labelledby="help-shortcuts-heading">
        <h3 id="help-shortcuts-heading" className={styles.sectionHeading}>
          {t('modals:help.shortcutsHeading')}
        </h3>
        <p className={styles.sectionLead}>{t('modals:help.shortcutsLead')}</p>
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
                <td>{row.phase1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={styles.section} aria-labelledby="help-limitations-heading">
        <h3 id="help-limitations-heading" className={styles.sectionHeading}>
          {t('modals:help.limitationsHeading')}
        </h3>
        <ul className={styles.bulletList}>
          <li>
            <strong>{t('modals:help.limSaveFidelity')}</strong>
            {t('modals:help.limSaveFidelityBody')}
          </li>
          <li>
            <strong>{t('modals:help.limPrintExport')}</strong>
            {t('modals:help.limPrintExportBody')}
          </li>
          <li>
            <strong>{t('modals:help.limUndoRedo')}</strong>
            {t('modals:help.limUndoRedoBody')}
          </li>
          <li>
            <strong>{t('modals:help.limBookmarks')}</strong>
            {t('modals:help.limBookmarksBody')}
          </li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="help-roadmap-heading">
        <h3 id="help-roadmap-heading" className={styles.sectionHeading}>
          {t('modals:help.roadmapHeading')}
        </h3>
        <ul className={styles.bulletList}>
          <li>
            <strong>{t('modals:help.roadmapPhase2')}</strong>
            {t('modals:help.roadmapPhase2Body')}
          </li>
          <li>
            <strong>{t('modals:help.roadmapPhase3')}</strong>
            {t('modals:help.roadmapPhase3Body')}
          </li>
          <li>
            <strong>{t('modals:help.roadmapPhase4')}</strong>
            {t('modals:help.roadmapPhase4Body')}
          </li>
          <li>
            <strong>{t('modals:help.roadmapPhase5')}</strong>
            {t('modals:help.roadmapPhase5Body')}
          </li>
          <li>
            <strong>{t('modals:help.roadmapPhase6')}</strong>
            {t('modals:help.roadmapPhase6Body')}
          </li>
          <li>
            <strong>{t('modals:help.roadmapPhase7')}</strong>
            {t('modals:help.roadmapPhase7Body')}
          </li>
        </ul>
        <p className={styles.footnote}>{t('modals:help.escToClose')}</p>
      </section>
    </ModalShell>
  );
}
