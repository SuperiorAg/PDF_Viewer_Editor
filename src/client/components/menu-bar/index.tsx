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
// Phase 7.4 A4 — annotation tool menu mirrors dispatch the same setActiveTool
// action the toolbar uses. Single dispatcher; no duplicated state machine.
import { type AnnotationTool, setActiveTool } from '../../state/slices/annotations-slice';
// Phase 7.5 Wave 7 (Riley) — File → Compare Files… opens the setup dialog.
import { setupOpened as openCompareSetup } from '../../state/slices/compare-slice';
import { openDocumentProperties } from '../../state/slices/document-properties-slice';
import { selectCurrentDocument, selectIsDirty } from '../../state/slices/document-selectors';
import { applyEdit } from '../../state/slices/document-slice';
import { openExportModal } from '../../state/slices/export-slice';
import { selectFormFields } from '../../state/slices/forms-selectors';
import { setDesignerMode, toggleDesignerMode } from '../../state/slices/forms-slice';
import { selectCanRedo, selectCanUndo } from '../../state/slices/history-selectors';
import { setLinkTool } from '../../state/slices/links-slice';
import { openWizard as openMailMergeWizard } from '../../state/slices/mail-merge-slice';
import { selectOcrOverlayVisible } from '../../state/slices/ocr-selectors';
import {
  openLanguagePackManagerModal,
  openRunModal as openOcrRunModal,
  toggleOverlay as toggleOcrOverlay,
} from '../../state/slices/ocr-slice';
// Phase 7.4 B1 — Redact menu entries dispatch into the redactions slice +
// ui-slice flags. Same action shapes the toolbar's RedactionToolbar fires.
// Phase 7.5 Wave 5 (Riley) — File → Properties + Tools → Remove Hidden Info.
import { openPageDesign } from '../../state/slices/page-design-slice';
import {
  clearMarks,
  selectRedactionShowMarks,
  selectRedactionTotalMarks,
  setActiveRedactionTool,
  setShowMarks,
} from '../../state/slices/redactions-slice';
import { openSanitize } from '../../state/slices/sanitize-slice';
// Phase 7.4 A1 — Fill & Sign menu entry dispatches the existing signature-capture flow.
import { openCaptureModal } from '../../state/slices/signatures-slice';
// Phase 7.5 Wave 4 (Riley) — B4 page-design entries + B13 Add Link tool.
import { selectPageDisplayMode } from '../../state/slices/ui-selectors';
import {
  openImageImportModal,
  openModal,
  // Phase 7.4 A4 — Delete Page menu mirror reuses the toolbar's "cannot delete
  // the only page" warning toast.
  pushToast,
  rotateViewCcw,
  rotateViewCw,
  setFindAToolOpen,
  setFindBarOpen,
  setPageDisplayMode,
  setReadMode,
  setRedactionApplyModalOpen,
  setRedactionPanelOpen,
  setSidebarTab,
  setTextEditMode,
  setViewRotation,
  toggleBookmarksEditMode,
  toggleInspector,
  toggleSidebar,
} from '../../state/slices/ui-slice';
// Phase 7.5 B15 — page display mode selector in the View menu.
import { selectCurrentPage } from '../../state/slices/viewport-selectors';
import {
  closeDocumentThunk,
  flattenFormsThunk,
  openDocumentThunk,
  printThunk,
  saveDocumentThunk,
} from '../../state/thunks';
// Phase 7.5 Wave 5d (Riley) — Tools → Accessibility Check menu mirror runs
// the same thunk the Ctrl+Shift+A shortcut + registry entry dispatch.
import { runAccessibilityCheckThunk } from '../../state/thunks-phase7-5-wave5d';
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
  const currentPage = useAppSelector(selectCurrentPage);
  const redactionShowMarks = useAppSelector(selectRedactionShowMarks);
  const redactionTotalMarks = useAppSelector(selectRedactionTotalMarks);
  const pageDisplayMode = useAppSelector(selectPageDisplayMode);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // Phase 7.4 A1 (Riley) — Honest dispatcher for the previously toast-only
  // Blank Page menu item. The toolbar's insertBlank button already wires this
  // operation; the menu mirror must dispatch the SAME applyEdit action — never
  // a "coming later" toast for a shipped feature. Per acrobat-parity-audit.md
  // §3.5 + Bucket A1.
  const insertBlankMenu = (): void => {
    if (!doc) return;
    dispatch(
      applyEdit({
        kind: 'insert',
        meta: { ts: Date.now(), undoable: true, operationId: `i-${Date.now()}` },
        atIndex: currentPage + 1,
        source: { kind: 'blank', width: 612, height: 792 },
      }),
    );
  };

  // Phase 7.4 A4 (Riley) — page-op + annotation-tool menu mirrors. Each one
  // dispatches the SAME action the corresponding toolbar button uses — never a
  // duplicated state machine. The audit's §3.5 finding was that nine toolbar-
  // only tools (annotation H/S/T/U/K/Shift+F + rotate CW/CCW + delete page)
  // had no menu entry, leaving keyboard-first + screen-reader users with no
  // discoverability path. These helpers and the new menu items below close
  // that gap.
  //
  // Shortcut choices for the new menu entries mirror Acrobat Pro DC where
  // possible:
  //   - Ctrl+R / Ctrl+Shift+R for rotate (already registered in shortcuts.ts,
  //     matches Acrobat's "Rotate View" Shift+Ctrl+Plus/Minus only by spirit;
  //     the shortcut registry's existing assignment wins).
  //   - Del for Delete Page (matches Acrobat's Ctrl+Shift+D — we already
  //     surface Del through the thumbnail context menu; standardizing on Del
  //     keeps the muscle memory).
  //   - Single-letter shortcuts H/S/T/U/K/Shift+F for annotation tools — these
  //     are our existing Phase 1/2 registrations, already documented in the
  //     in-app Help modal.
  const rotatePageMenu = (cw: boolean): void => {
    if (!doc) return;
    const page = doc.pages[currentPage];
    if (!page) return;
    const next: 0 | 90 | 180 | 270 = ((page.rotation + (cw ? 90 : 270)) % 360) as
      | 0
      | 90
      | 180
      | 270;
    dispatch(
      applyEdit({
        kind: 'rotate',
        meta: { ts: Date.now(), undoable: true, operationId: `r-${Date.now()}` },
        pageIndex: currentPage,
        fromRotation: page.rotation,
        toRotation: next,
      }),
    );
  };

  const deletePageMenu = (): void => {
    if (!doc || doc.pageCount <= 1) {
      dispatch(pushToast({ kind: 'warning', message: t('errors:cannotDeleteOnlyPage') }));
      return;
    }
    const page = doc.pages[currentPage];
    if (!page) return;
    dispatch(
      applyEdit({
        kind: 'delete',
        meta: { ts: Date.now(), undoable: true, operationId: `d-${Date.now()}` },
        pageIndex: currentPage,
        preservedSource: page.sourcePageRef,
      }),
    );
  };

  const setTool = (tool: AnnotationTool) => () => dispatch(setActiveTool(tool));

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
        // Phase 7.5 Wave 7 (Riley) — Compare Files… (Ctrl+Shift+C). No doc
        // required — the setup dialog itself lets the user pick from disk.
        {
          label: t('menu:items.compareFiles'),
          shortcut: 'Ctrl+Shift+C',
          onClick: () => dispatch(openCompareSetup()),
        },
        // Phase 7.5 B21 (Riley Wave 5) — File → Properties... (Ctrl+D mirrors
        // Acrobat). Opens the Document Properties dialog on the Description tab.
        { label: '', divider: true },
        {
          label: t('menu:items.properties'),
          shortcut: 'Ctrl+D',
          disabled: !doc,
          onClick: () => dispatch(openDocumentProperties(undefined)),
        },
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
        // Phase 7.4 A4 — page-op menu mirrors. Same dispatchers the toolbar
        // uses (Rotate CW, Rotate CCW, Delete Current Page). Closes the
        // toolbar-only discoverability gap documented in acrobat-parity-audit
        // §3.5. Shortcuts already registered in src/client/shortcuts.ts and
        // wired in use-app-shortcuts.ts — listing them here is purely cosmetic
        // (the global shortcut handler fires regardless of menu visibility).
        { label: '', divider: true },
        {
          label: t('menu:items.rotateCw'),
          shortcut: 'Ctrl+R',
          disabled: !doc,
          onClick: () => rotatePageMenu(true),
        },
        {
          label: t('menu:items.rotateCcw'),
          shortcut: 'Ctrl+Shift+R',
          disabled: !doc,
          onClick: () => rotatePageMenu(false),
        },
        {
          label: t('menu:items.deletePage'),
          shortcut: 'Del',
          disabled: !doc,
          onClick: deletePageMenu,
        },
        { label: '', divider: true },
        {
          label: t('menu:items.replaceText'),
          shortcut: 'E',
          disabled: !doc,
          onClick: () => dispatch(setTextEditMode(true)),
        },
        // Phase 7.5 B3 (Riley) — Find ships in this wave. The menu item now
        // opens the Find bar (anchored top-right of the viewer) via the same
        // setFindBarOpen action Ctrl+F dispatches. Replaces the previous
        // honest-deferral disabled-with-tooltip state.
        {
          label: t('menu:items.find'),
          shortcut: 'Ctrl+F',
          disabled: !doc,
          onClick: () => dispatch(setFindBarOpen(true)),
        },
        // Phase 7.5 A7 — Find a tool palette (Ctrl+/).
        {
          label: t('menu:items.findATool'),
          shortcut: 'Ctrl+/',
          onClick: () => dispatch(setFindAToolOpen(true)),
        },
        { label: '', divider: true },
        // Phase 7.5 B13 (Riley Wave 4) — Add Link tool menu mirror. Arms
        // the Links overlay marquee; user drags on a page → Add Link modal.
        {
          label: t('menu:items.addLink'),
          shortcut: 'Shift+L',
          disabled: !doc,
          onClick: () => dispatch(setLinkTool('add-link')),
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
        // Phase 7.4 A1 — Page from File is genuinely deferred (no shipped
        // insert-pages-from-PDF dispatcher). Honest UX: visible-but-disabled
        // with a refreshed tooltip — NOT a "coming later" toast that looked
        // enabled then surprised the user.
        {
          label: t('menu:items.pageFromFile'),
          disabled: true,
          tooltip: t('menu:tooltips.pageFromFileComing'),
        },
        // Phase 7.4 A1 — Blank Page IS shipped via the toolbar's insertBlank
        // button. The menu mirror now dispatches the same applyEdit call instead
        // of toasting "coming later".
        {
          label: t('menu:items.blankPage'),
          disabled: !doc,
          onClick: insertBlankMenu,
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
        { label: '', divider: true },
        // Phase 7.5 B4 (Riley Wave 4) — Page Design entries open the same
        // three-tab modal pre-selected to the chosen tab.
        {
          label: t('menu:items.watermark'),
          disabled: !doc,
          onClick: () => dispatch(openPageDesign('watermark')),
        },
        {
          label: t('menu:items.headerFooter'),
          disabled: !doc,
          onClick: () => dispatch(openPageDesign('header-footer')),
        },
        {
          label: t('menu:items.background'),
          disabled: !doc,
          onClick: () => dispatch(openPageDesign('background')),
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
        // Phase 7.5 B15 — Page Display modes. Single Page Continuous remains
        // the default; the other three preserve virtualization (PdfCanvas owns
        // the per-page IntersectionObserver). Per docs/ui-spec-phase-7.5.md §15.
        {
          label:
            (pageDisplayMode === 'single-page-continuous' ? '• ' : '  ') +
            t('menu:items.pageDisplaySinglePageContinuous'),
          disabled: !doc,
          onClick: () => dispatch(setPageDisplayMode('single-page-continuous')),
        },
        {
          label:
            (pageDisplayMode === 'two-up-continuous' ? '• ' : '  ') +
            t('menu:items.pageDisplayTwoUpContinuous'),
          disabled: !doc,
          onClick: () => dispatch(setPageDisplayMode('two-up-continuous')),
        },
        {
          label:
            (pageDisplayMode === 'single-page' ? '• ' : '  ') +
            t('menu:items.pageDisplaySinglePage'),
          disabled: !doc,
          onClick: () => dispatch(setPageDisplayMode('single-page')),
        },
        {
          label: (pageDisplayMode === 'two-up' ? '• ' : '  ') + t('menu:items.pageDisplayTwoUp'),
          disabled: !doc,
          onClick: () => dispatch(setPageDisplayMode('two-up')),
        },
        { label: '', divider: true },
        // Phase 7.5 B16 — view-only rotation (renderer CSS only — does NOT
        // mutate the PDF). Distinct from "Rotate Page" under Edit menu.
        {
          label: t('menu:items.viewRotateCw'),
          shortcut: 'Ctrl+Shift+→',
          disabled: !doc,
          onClick: () => dispatch(rotateViewCw()),
        },
        {
          label: t('menu:items.viewRotateCcw'),
          shortcut: 'Ctrl+Shift+←',
          disabled: !doc,
          onClick: () => dispatch(rotateViewCcw()),
        },
        {
          label: t('menu:items.viewRotateReset'),
          disabled: !doc,
          onClick: () => dispatch(setViewRotation(0)),
        },
        { label: '', divider: true },
        // Phase 7.5 B16 — True Read Mode (chromeless). F11.
        {
          label: t('menu:items.readMode'),
          shortcut: 'F11',
          disabled: !doc,
          onClick: () => dispatch(setReadMode(true)),
        },
        {
          label: t('menu:items.fullscreen'),
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
        // Phase 7.4 A4 — annotation tool menu mirrors. Highlight / Sticky Note
        // / Text Box / Underline / Strikethrough / Freehand were toolbar-only
        // until now; keyboard-first users and Acrobat-trained users expecting
        // menu access could not find them. Acrobat puts these under a top-level
        // "Comment" menu — to avoid restructuring the menu surface in this
        // dispatch (Bucket A scope), they land under Tools alongside the other
        // mode-toggle tools. Shortcuts mirror src/client/shortcuts.ts.
        { label: '', divider: true },
        {
          label: t('menu:items.toolHighlight'),
          shortcut: 'H',
          disabled: !doc,
          onClick: setTool('highlight'),
        },
        {
          label: t('menu:items.toolSticky'),
          shortcut: 'S',
          disabled: !doc,
          onClick: setTool('sticky'),
        },
        {
          label: t('menu:items.toolTextBox'),
          shortcut: 'T',
          disabled: !doc,
          onClick: setTool('text'),
        },
        {
          label: t('menu:items.toolUnderline'),
          shortcut: 'U',
          disabled: !doc,
          onClick: setTool('underline'),
        },
        {
          label: t('menu:items.toolStrikethrough'),
          shortcut: 'K',
          disabled: !doc,
          onClick: setTool('strikeout'),
        },
        {
          label: t('menu:items.toolFreehand'),
          shortcut: 'Shift+F',
          disabled: !doc,
          onClick: setTool('ink'),
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
        // Phase 7.4 A1 — Fill & Sign IS the shipped signature-capture flow
        // (Phase 4 visual signatures + Phase 4 PAdES). Previously the menu
        // entry read "Coming in Phase 4" three phases AFTER Phase 4 shipped.
        // The menu item now opens the shipped signature-capture modal — making
        // this the first top-level entry point for the workflow.
        {
          label: t('menu:items.fillAndSign'),
          disabled: !doc,
          onClick: () => dispatch(openCaptureModal()),
        },
        { label: '', divider: true },
        // Phase 7.4 B1 — Redact menu mirrors. Same actions the
        // RedactionToolbar sub-toolbar dispatches:
        //   - Mark Rectangle: opens the panel + arms the rect tool.
        //   - Show Markups:   toggles the overlay flag.
        //   - Clear Marks:    clears pending marks (disabled when none).
        //   - Apply Redactions...: opens the confirmation modal.
        //
        // The Apply entry is enabled only when there is at least one pending
        // mark — same disable rule the toolbar uses. Tooltip surfaces the
        // honesty obligation ("irreversible; consider Save As first").
        {
          label: t('menu:items.redactMarkRect'),
          disabled: !doc,
          onClick: () => {
            dispatch(setRedactionPanelOpen(true));
            dispatch(setActiveRedactionTool('rect'));
          },
        },
        {
          label: redactionShowMarks
            ? t('menu:items.redactShowMarks')
            : t('menu:items.redactShowMarks'),
          disabled: !doc,
          onClick: () => dispatch(setShowMarks(!redactionShowMarks)),
        },
        {
          label: t('menu:items.redactClearMarks'),
          disabled: !doc || redactionTotalMarks === 0,
          onClick: () => dispatch(clearMarks()),
        },
        ((): MenuItem => {
          const enabled = !!doc && redactionTotalMarks > 0;
          const base: MenuItem = {
            label: t('menu:items.redactApply'),
            shortcut: 'Ctrl+Shift+Y',
            disabled: !enabled,
            onClick: () => dispatch(setRedactionApplyModalOpen(true)),
          };
          if (!doc) return base;
          const tip = enabled
            ? t('menu:tooltips.redactIrreversible')
            : t('menu:tooltips.redactNeedsMarks');
          return { ...base, tooltip: tip };
        })(),
        { label: '', divider: true },
        // Phase 7.4 A1 — Scan tooltip refresh. TWAIN/WIA bindings are deferred
        // indefinitely (no MIT-compatible Node binding survives the project's
        // OSS maturity bar — see groomed roadmap 0a09f4c). The tooltip now
        // matches the scan-modal body copy: scan with your OS utility, then
        // drag the PDF into this app. No false "Phase 5.1" version promise.
        {
          label: t('menu:items.scanDevice'),
          disabled: true,
          tooltip: t('menu:tooltips.scanDeferred'),
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
        // Phase 7.5 B20 (Riley Wave 5) — Tools → Remove Hidden Information.
        // Opens the Sanitize alertdialog with the v0.8.0-supported categories.
        { label: '', divider: true },
        {
          label: t('menu:items.sanitize'),
          disabled: !doc,
          onClick: () => dispatch(openSanitize()),
        },
        // Phase 7.5 C6 (Riley Wave 5d follow-up) — Tools → Accessibility
        // Check. Mirrors the registry entry tools:run-accessibility-check
        // and shares its Ctrl+Shift+A binding (advertised here so keyboard
        // discoverability matches the palette + menu surfaces). The thunk
        // opens the Accessibility sidebar tab and fires the engine
        // immediately, same as the registry path.
        {
          label: t('menu:items.runAccessibilityCheck'),
          shortcut: 'Ctrl+Shift+A',
          disabled: !doc,
          onClick: () => {
            dispatch(setSidebarTab('accessibility'));
            void dispatch(runAccessibilityCheckThunk());
          },
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
