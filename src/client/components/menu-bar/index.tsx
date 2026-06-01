// >200 lines: MenuBar is the single top-of-window menu strip for the entire
// app — File / Edit / View / Insert / Tools / Help. Per the convention §3.4
// escape hatch, the file is intentionally one component-per-file: each menu's
// items, shortcuts, enabled-state guards, and dispatched thunks are co-located
// so the cross-menu invariants (e.g. Save-state availability, designer-mode
// guards, undo/redo enablement, OCR overlay visibility, mail-merge entry) read
// top-to-bottom in one pass. Splitting per menu would scatter shared selectors
// + close-on-click handlers across 6 files and obscure the menu-bar's role as
// the canonical action surface. Subcomponent extraction was considered and
// rejected: each menu is a flat list of `<button>`s + dispatchers; there is no
// reusable interaction logic to factor out without inventing a synthetic shell.
import { useState } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { redoAction, undoAction } from '../../state/middleware/history-middleware';
import { selectCurrentDocument, selectIsDirty } from '../../state/slices/document-selectors';
import { openExportModal } from '../../state/slices/export-slice';
import { selectFormFields } from '../../state/slices/forms-selectors';
import { setDesignerMode, toggleDesignerMode } from '../../state/slices/forms-slice';
import { selectCanRedo, selectCanUndo } from '../../state/slices/history-selectors';
import { openWizard as openMailMergeWizard } from '../../state/slices/mail-merge-slice';
import { selectOcrOverlayVisible } from '../../state/slices/ocr-selectors';
import {
  openLanguagePackManagerModal,
  openRunModal as openOcrRunModal,
  toggleOverlay as toggleOcrOverlay,
} from '../../state/slices/ocr-slice';
import {
  openImageImportModal,
  openModal,
  pushToast,
  setSidebarTab,
  setTextEditMode,
  toggleBookmarksEditMode,
  toggleInspector,
  toggleSidebar,
} from '../../state/slices/ui-slice';
import {
  closeDocumentThunk,
  flattenFormsThunk,
  openDocumentThunk,
  printThunk,
  saveDocumentThunk,
} from '../../state/thunks';
// Phase 3
// Phase 5
// Phase 6 — Export-to-Office modal entry.

import styles from './menu-bar.module.css';

interface MenuItem {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  tooltip?: string;
  divider?: boolean;
}

interface MenuDef {
  label: string;
  items: MenuItem[];
}

export function MenuBar(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const isDirty = useAppSelector(selectIsDirty);
  const canUndo = useAppSelector(selectCanUndo);
  const canRedo = useAppSelector(selectCanRedo);
  const formFields = useAppSelector(selectFormFields);
  const ocrOverlayVisible = useAppSelector(selectOcrOverlayVisible);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const phase3 = (feature: string) => () => {
    dispatch(pushToast({ kind: 'info', message: t('common:comingInLaterPhase', { feature }) }));
  };

  const menus: MenuDef[] = [
    {
      label: t('menu:file'),
      items: [
        {
          label: t('menu:items.open'),
          shortcut: 'Ctrl+O',
          onClick: () => void dispatch(openDocumentThunk()),
        },
        {
          label: t('menu:items.save'),
          shortcut: 'Ctrl+S',
          disabled: !doc || !isDirty,
          onClick: () => void dispatch(saveDocumentThunk({ saveAs: false })),
        },
        {
          label: t('menu:items.saveAs'),
          shortcut: 'Ctrl+Shift+S',
          disabled: !doc,
          onClick: () => void dispatch(saveDocumentThunk({ saveAs: true })),
        },
        { label: '', divider: true },
        {
          label: t('menu:items.close'),
          shortcut: 'Ctrl+W',
          disabled: !doc,
          onClick: () => void dispatch(closeDocumentThunk()),
        },
        { label: '', divider: true },
        {
          label: t('menu:items.print'),
          shortcut: 'Ctrl+P',
          disabled: !doc,
          onClick: () => void dispatch(printThunk()),
        },
        {
          label: t('menu:items.exportPdf'),
          shortcut: 'Ctrl+Shift+P',
          disabled: !doc,
          onClick: () => dispatch(openModal('export-engine')),
        },
        // Phase 6 (ui-spec §15.2) — File menu Export to {Word, Excel, PowerPoint, Image}.
        { label: '', divider: true },
        {
          label: t('menu:items.exportWord'),
          shortcut: 'Ctrl+Shift+E',
          disabled: !doc,
          onClick: () => dispatch(openExportModal({ presetFormat: 'docx' })),
        },
        {
          label: t('menu:items.exportExcel'),
          disabled: !doc,
          onClick: () => dispatch(openExportModal({ presetFormat: 'xlsx' })),
        },
        {
          label: t('menu:items.exportPowerpoint'),
          disabled: !doc,
          onClick: () => dispatch(openExportModal({ presetFormat: 'pptx' })),
        },
        {
          label: t('menu:items.exportPng'),
          disabled: !doc,
          onClick: () => dispatch(openExportModal({ presetFormat: 'png' })),
        },
        {
          label: t('menu:items.exportJpeg'),
          disabled: !doc,
          onClick: () => dispatch(openExportModal({ presetFormat: 'jpeg' })),
        },
        {
          label: t('menu:items.exportTiff'),
          disabled: !doc,
          onClick: () => dispatch(openExportModal({ presetFormat: 'tiff' })),
        },
        { label: '', divider: true },
        { label: t('menu:items.combine'), onClick: () => dispatch(openModal('combine')) },
      ],
    },
    {
      label: t('menu:edit'),
      items: [
        {
          label: t('menu:items.undo'),
          shortcut: 'Ctrl+Z',
          disabled: !doc || !canUndo,
          onClick: () => dispatch(undoAction()),
        },
        {
          label: t('menu:items.redo'),
          shortcut: 'Ctrl+Y',
          disabled: !doc || !canRedo,
          onClick: () => dispatch(redoAction()),
        },
        { label: '', divider: true },
        {
          label: t('menu:items.replaceText'),
          shortcut: 'E',
          disabled: !doc,
          onClick: () => dispatch(setTextEditMode(true)),
        },
        {
          label: t('menu:items.find'),
          shortcut: 'Ctrl+F',
          disabled: true,
          tooltip: t('menu:tooltips.findComing'),
        },
        { label: '', divider: true },
        {
          label: t('menu:items.settings'),
          shortcut: 'Ctrl+,',
          onClick: () => dispatch(openModal('settings')),
        },
      ],
    },
    {
      label: t('menu:insert'),
      items: [
        {
          label: t('menu:items.insertImage'),
          shortcut: 'Ctrl+I',
          disabled: !doc,
          onClick: () => dispatch(openImageImportModal()),
        },
        {
          label: t('menu:items.pageFromFile'),
          disabled: !doc,
          onClick: phase3(t('menu:items.pageFromFile')),
        },
        {
          label: t('menu:items.blankPage'),
          disabled: !doc,
          onClick: phase3(t('menu:items.blankPage')),
        },
        { label: '', divider: true },
        // Phase 3 — "Form Field…" entries each enter designer mode pre-set
        // to the chosen type. Lighter-weight than a submenu; same outcome.
        {
          label: t('menu:items.formFieldText'),
          disabled: !doc,
          onClick: () => {
            dispatch(setDesignerMode(true));
            // designerFieldType is set via a separate slice; helper is exposed
            // via the toolbar's field-type pills. From the menu we just enter
            // designer mode — Phase 3.1 may add direct field-type seeding.
          },
        },
        {
          label: t('menu:items.formFieldCheckbox'),
          disabled: !doc,
          onClick: () => dispatch(setDesignerMode(true)),
        },
        {
          label: t('menu:items.formFieldSignature'),
          disabled: !doc,
          onClick: () => dispatch(setDesignerMode(true)),
        },
      ],
    },
    {
      label: t('menu:view'),
      items: [
        {
          label: t('menu:items.toggleSidebar'),
          shortcut: 'Ctrl+B',
          onClick: () => dispatch(toggleSidebar()),
        },
        {
          label: t('menu:items.toggleInspector'),
          shortcut: 'Ctrl+Alt+I',
          onClick: () => dispatch(toggleInspector()),
        },
        {
          label: t('menu:items.toggleBookmarksEdit'),
          disabled: !doc,
          onClick: () => dispatch(toggleBookmarksEditMode()),
        },
        {
          // Phase 3 — focus Forms sidebar tab. Auto-opens if collapsed.
          label: t('menu:items.toggleFormsSidebar'),
          disabled: !doc,
          onClick: () => dispatch(setSidebarTab('forms')),
        },
        {
          // Phase 3 — same as toolbar button (Ctrl+Shift+F).
          label: t('menu:items.toggleFormDesigner'),
          shortcut: 'Ctrl+Shift+F',
          disabled: !doc,
          onClick: () => dispatch(toggleDesignerMode()),
        },
        { label: '', divider: true },
        // Phase 5 — OCR confidence overlay toggle. Per ui-spec.md §14.2.
        // Enabled only when an OCR result has been loaded for the current doc;
        // we use the "doc is open" precondition as a conservative gate (the
        // overlay component handles the no-summary case by rendering nothing).
        {
          label: ocrOverlayVisible
            ? t('menu:items.hideOcrOverlay')
            : t('menu:items.showOcrOverlay'),
          disabled: !doc,
          onClick: () => dispatch(toggleOcrOverlay()),
        },
        { label: '', divider: true },
        {
          label: t('menu:items.fullscreen'),
          shortcut: 'F11',
          onClick: () => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen();
          },
        },
      ],
    },
    {
      label: t('menu:tools'),
      items: [
        {
          label: t('menu:items.textEditMode'),
          shortcut: 'E',
          disabled: !doc,
          onClick: () => dispatch(setTextEditMode(true)),
        },
        { label: '', divider: true },
        {
          // Phase 3 — toggles designer mode (ui-spec §12.2).
          label: t('menu:items.formDesigner'),
          shortcut: 'Ctrl+Shift+F',
          disabled: !doc,
          onClick: () => dispatch(toggleDesignerMode()),
        },
        ((): MenuItem => {
          const tip =
            !doc || formFields.length > 0 ? undefined : t('menu:tooltips.mailMergeNeedsField');
          const base: MenuItem = {
            label: t('menu:items.mailMerge'),
            shortcut: 'Ctrl+M',
            disabled: !doc || formFields.length === 0,
            onClick: () => dispatch(openMailMergeWizard()),
          };
          return tip === undefined ? base : { ...base, tooltip: tip };
        })(),
        {
          label: t('menu:items.flattenForms'),
          disabled: !doc || formFields.length === 0,
          onClick: () => {
            if (
              typeof window !== 'undefined' &&
              // eslint-disable-next-line no-alert -- Phase 3 confirm; modal in 3.1
              !window.confirm('Flatten all form fields? This is irreversible after Save.')
            ) {
              return;
            }
            void dispatch(flattenFormsThunk());
          },
        },
        {
          label: t('menu:items.fillAndSign'),
          disabled: true,
          tooltip: t('menu:tooltips.fillSignComing'),
        },
        { label: '', divider: true },
        // Phase 5 — Scan is intentionally disabled with tooltip per
        // architecture-phase-5.md §7 (Q-E deferral verdict). The Phase 5.1
        // implementation re-enables this item.
        {
          label: t('menu:items.scanDevice'),
          disabled: true,
          tooltip: t('menu:tooltips.scanComing'),
        },
        {
          label: t('menu:items.runOcr'),
          disabled: !doc,
          onClick: () => dispatch(openOcrRunModal()),
        },
        {
          label: t('menu:items.manageLanguagePacks'),
          onClick: () => dispatch(openLanguagePackManagerModal()),
        },
        { label: '', divider: true },
        // Phase 6 — Tools menu shortcuts mirror the File-menu entries.
        {
          label: t('menu:items.exportAsWord'),
          disabled: !doc,
          onClick: () => dispatch(openExportModal({ presetFormat: 'docx' })),
        },
        {
          label: t('menu:items.exportAsExcel'),
          disabled: !doc,
          onClick: () => dispatch(openExportModal({ presetFormat: 'xlsx' })),
        },
        {
          label: t('menu:items.exportAsPowerpoint'),
          disabled: !doc,
          onClick: () => dispatch(openExportModal({ presetFormat: 'pptx' })),
        },
        {
          label: t('menu:items.exportAsImage'),
          disabled: !doc,
          onClick: () => dispatch(openExportModal({ presetFormat: 'png' })),
        },
      ],
    },
    {
      label: t('menu:help'),
      items: [
        // Phase 1.1 R-1.1: in-app help modal (offline, no docs hosting yet).
        { label: t('menu:items.help'), shortcut: 'F1', onClick: () => dispatch(openModal('help')) },
        // Phase 7 — wire the standalone About modal (was a placeholder toast).
        { label: t('menu:items.about'), onClick: () => dispatch(openModal('about')) },
      ],
    },
  ];

  return (
    <nav className={styles.menuBar} aria-label={t('menu:barLabel')}>
      {menus.map((m) => {
        const isOpen: boolean = openMenu === m.label;
        return (
          <div key={m.label} className={styles.menuRoot} onMouseLeave={() => setOpenMenu(null)}>
            <button
              type="button"
              className={`${styles.menuTrigger} ${isOpen ? styles.menuTriggerOpen : ''}`}
              onClick={() => setOpenMenu(isOpen ? null : m.label)}
              onMouseEnter={() => openMenu !== null && setOpenMenu(m.label)}
            >
              {m.label}
            </button>
            {isOpen && (
              <div className={styles.menuList}>
                {m.items.map((item, i) =>
                  item.divider ? (
                    <hr key={`d-${i}`} className={styles.divider} />
                  ) : (
                    <button
                      key={item.label}
                      type="button"
                      className={styles.menuItem}
                      disabled={item.disabled}
                      title={item.tooltip}
                      onClick={() => {
                        item.onClick?.();
                        setOpenMenu(null);
                      }}
                    >
                      <span className={styles.menuItemLabel}>{item.label}</span>
                      {item.shortcut && (
                        <span className={styles.menuItemShortcut}>{item.shortcut}</span>
                      )}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
