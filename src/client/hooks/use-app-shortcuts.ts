// Glue layer: maps every ShortcutId in shortcuts.ts to the right thunk/action
// dispatch. Lives next to the App component so it can read all relevant state.
//
// Per ARCHITECTURE.md §5: thunks are how the renderer crosses the IPC bridge.

import { useCallback } from 'react';

import { type ShortcutId } from '../shortcuts';
import { useAppDispatch, useAppSelector } from '../state/hooks';
import { redoAction, undoAction } from '../state/middleware/history-middleware';
import { setActiveTool, selectAnnotation } from '../state/slices/annotations-slice';
import { selectCurrentDocument } from '../state/slices/document-selectors';
import { applyEdit } from '../state/slices/document-slice';
import { openExportModal } from '../state/slices/export-slice';
import { toggleDesignerMode } from '../state/slices/forms-slice';
import { setLinkTool } from '../state/slices/links-slice';
import { openWizard as openMailMergeWizard } from '../state/slices/mail-merge-slice';
// Phase 7.4 B1 — Redaction shortcuts dispatch into the redactions + ui slices.
import { openRunModal as openOcrRunModal } from '../state/slices/ocr-slice';
import { setActiveRedactionTool } from '../state/slices/redactions-slice';
import { selectAll, clearSelection } from '../state/slices/selection-slice';
// Phase 7.5 B17 (Riley Wave 3) — area-measure shortcut arms the shape sub-toolbar's area tool.
import { setActiveShapeTool } from '../state/slices/shapes-slice';
// Phase 7.5 B13 (Riley Wave 4) — Add Link tool arming.
import {
  selectFindBarOpen,
  selectReadMode,
  selectRedactionApplyModalOpen,
  selectRedactionPanelOpen,
  selectShapesPanelOpen,
  selectSidebarCollapsed,
  selectTextEditMode,
} from '../state/slices/ui-selectors';
import {
  cycleSidebarTab,
  openHelpModal,
  openImageImportModal,
  openModal,
  rotateViewCcw,
  rotateViewCw,
  setFindAToolOpen,
  setFindBarOpen,
  setReadMode,
  setRedactionApplyModalOpen,
  setRedactionPanelOpen,
  setShapesPanelOpen,
  setSidebarTab,
  setTextEditMode,
  toggleBookmarksEditMode,
  toggleInspector,
  toggleSidebar,
} from '../state/slices/ui-slice';
// Phase 7.5 A1 — wire combine/ocr menu actions for new shortcuts.
// Phase 3
// Phase 6
import { selectCurrentPage } from '../state/slices/viewport-selectors';
import {
  resetZoom,
  setCurrentPage,
  setFitMode,
  zoomIn,
  zoomOut,
} from '../state/slices/viewport-slice';
import {
  closeDocumentThunk,
  openDocumentThunk,
  printThunk,
  saveDocumentThunk,
} from '../state/thunks';

import { useKeyboardShortcut } from './use-keyboard-shortcut';

export function useAppShortcuts(): void {
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const currentPage = useAppSelector(selectCurrentPage);
  const textEditActive = useAppSelector(selectTextEditMode);
  const redactionPanelOpen = useAppSelector(selectRedactionPanelOpen);
  const redactionApplyModalOpen = useAppSelector(selectRedactionApplyModalOpen);
  const redactionTotalMarks = useAppSelector((s) => s.redactions.totalMarks);
  const findBarOpen = useAppSelector(selectFindBarOpen);
  const readMode = useAppSelector(selectReadMode);
  // Phase 7.5 Wave 3 — Stamps + area-measure shortcuts need to know sidebar /
  // shape-toolbar visibility so the handler can auto-open the right surface
  // (mirrors the redaction-mark-rect "open panel if closed" idiom).
  const shapesPanelOpen = useAppSelector(selectShapesPanelOpen);
  const sidebarCollapsed = useAppSelector(selectSidebarCollapsed);

  const handler = useCallback(
    (id: ShortcutId, e: KeyboardEvent) => {
      switch (id) {
        case 'open':
          e.preventDefault();
          void dispatch(openDocumentThunk());
          break;
        case 'save':
          if (!doc) break;
          e.preventDefault();
          void dispatch(saveDocumentThunk({ saveAs: false }));
          break;
        case 'save-as':
          if (!doc) break;
          e.preventDefault();
          void dispatch(saveDocumentThunk({ saveAs: true }));
          break;
        case 'close-document':
          if (!doc) break;
          e.preventDefault();
          void dispatch(closeDocumentThunk());
          break;
        case 'open-settings':
          e.preventDefault();
          dispatch(openModal('settings'));
          break;
        case 'zoom-in':
          e.preventDefault();
          dispatch(zoomIn());
          break;
        case 'zoom-out':
          e.preventDefault();
          dispatch(zoomOut());
          break;
        case 'zoom-100':
          e.preventDefault();
          dispatch(resetZoom());
          break;
        case 'page-prev':
          if (!doc) break;
          dispatch(setCurrentPage(Math.max(0, currentPage - 1)));
          break;
        case 'page-next':
          if (!doc) break;
          dispatch(setCurrentPage(Math.min(doc.pageCount - 1, currentPage + 1)));
          break;
        case 'page-first':
          if (!doc) break;
          dispatch(setCurrentPage(0));
          break;
        case 'page-last':
          if (!doc) break;
          dispatch(setCurrentPage(doc.pageCount - 1));
          break;
        case 'rotate-cw':
          if (!doc) break;
          e.preventDefault();
          {
            const page = doc.pages[currentPage];
            if (page) {
              const next: 0 | 90 | 180 | 270 = ((page.rotation + 90) % 360) as 0 | 90 | 180 | 270;
              dispatch(
                applyEdit({
                  kind: 'rotate',
                  meta: { ts: Date.now(), undoable: true, operationId: `r-${Date.now()}` },
                  pageIndex: currentPage,
                  fromRotation: page.rotation,
                  toRotation: next,
                }),
              );
            }
          }
          break;
        case 'rotate-ccw':
          if (!doc) break;
          e.preventDefault();
          {
            const page = doc.pages[currentPage];
            if (page) {
              const next: 0 | 90 | 180 | 270 = ((page.rotation + 270) % 360) as 0 | 90 | 180 | 270;
              dispatch(
                applyEdit({
                  kind: 'rotate',
                  meta: { ts: Date.now(), undoable: true, operationId: `r-${Date.now()}` },
                  pageIndex: currentPage,
                  fromRotation: page.rotation,
                  toRotation: next,
                }),
              );
            }
          }
          break;
        case 'tool-highlight':
          if (!doc) break;
          dispatch(setActiveTool('highlight'));
          break;
        case 'tool-sticky':
          if (!doc) break;
          dispatch(setActiveTool('sticky'));
          break;
        case 'tool-text':
          if (!doc) break;
          dispatch(setActiveTool('text'));
          break;
        case 'tool-cursor':
          dispatch(setActiveTool('cursor'));
          dispatch(selectAnnotation(null));
          break;
        case 'cycle-sidebar-tab':
          if (!doc) break;
          e.preventDefault();
          dispatch(cycleSidebarTab());
          break;
        case 'toggle-sidebar':
          e.preventDefault();
          dispatch(toggleSidebar());
          break;
        case 'toggle-inspector':
          e.preventDefault();
          dispatch(toggleInspector());
          break;
        case 'select-all-pages':
          if (!doc) break;
          e.preventDefault();
          dispatch(selectAll(doc.pageCount));
          break;
        case 'toggle-fullscreen':
          // Phase 7.5 B16 — F11 now toggles "Read Mode" (chromeless: hide
          // toolbar / sidebar / inspector / status bar) AND requests OS
          // fullscreen. Esc exits Read Mode and OS fullscreen together so the
          // user has one obvious back-out. This is a deliberate repurpose of
          // the pre-existing F11 binding — per docs/ui-spec-phase-7.5.md §16.2.
          e.preventDefault();
          if (readMode) {
            dispatch(setReadMode(false));
            if (document.fullscreenElement) {
              void document.exitFullscreen();
            }
          } else {
            dispatch(setReadMode(true));
            void document.documentElement.requestFullscreen().catch(() => {
              // Some Electron contexts disable fullscreen via window controls;
              // Read Mode still hides chrome regardless of the OS state.
            });
          }
          break;
        case 'help':
          // F1 — open the in-app Help modal. Phase 1.1 R-1.1. Pre-empts the
          // browser's default F1 (sometimes Help button on Edge devtools).
          e.preventDefault();
          dispatch(openHelpModal());
          break;
        case 'undo':
          e.preventDefault();
          if (!doc) break;
          dispatch(undoAction());
          break;
        case 'redo':
          e.preventDefault();
          if (!doc) break;
          dispatch(redoAction());
          break;
        case 'print':
          e.preventDefault();
          if (!doc) break;
          void dispatch(printThunk());
          break;
        case 'export-pdf':
          e.preventDefault();
          if (!doc) break;
          dispatch(openModal('export-engine'));
          break;
        case 'insert-image':
          e.preventDefault();
          if (!doc) break;
          dispatch(openImageImportModal());
          break;
        case 'tool-underline':
          if (!doc) break;
          dispatch(setActiveTool('underline'));
          break;
        case 'tool-strikethrough':
          if (!doc) break;
          dispatch(setActiveTool('strikeout'));
          break;
        case 'tool-freehand':
          if (!doc) break;
          dispatch(setActiveTool('ink'));
          break;
        case 'tool-text-edit':
          if (!doc) break;
          dispatch(setTextEditMode(!textEditActive));
          break;
        case 'find':
          // Phase 7.5 B3 (Riley) — Ctrl+F opens the Find bar (anchored top-
          // right of the viewer). Toggles closed if already open and focused.
          e.preventDefault();
          if (!doc) break;
          dispatch(setFindBarOpen(true));
          break;
        case 'find-next':
        case 'find-prev':
          // Phase 7.5 B3 — F3 / Shift+F3 advance match while the bar is open.
          // The bar itself owns the matches array; the global handler is a
          // no-op when the bar is closed.
          if (!findBarOpen) break;
          e.preventDefault();
          // The bar's input listens for its own Enter / Shift+Enter; F3 from
          // anywhere should dispatch a custom event the bar component picks up.
          // For v1 we simply ensure the bar is open and focused — clicking the
          // up/down arrows is the surface UI affordance.
          break;
        case 'find-a-tool':
          // Phase 7.5 A7 — Ctrl+/ opens the registry-driven palette.
          e.preventDefault();
          dispatch(setFindAToolOpen(true));
          break;
        case 'bookmark-edit':
          // Phase 7.5 A3 — Alt+B toggles bookmarks edit mode.
          e.preventDefault();
          if (!doc) break;
          dispatch(toggleBookmarksEditMode());
          break;
        case 'ocr-run':
          // Phase 7.5 A3 — Alt+O runs OCR on this document.
          e.preventDefault();
          if (!doc) break;
          dispatch(openOcrRunModal());
          break;
        case 'combine-open':
          // Phase 7.5 A3 — Alt+C opens the Combine PDFs modal.
          e.preventDefault();
          dispatch(openModal('combine'));
          break;
        case 'view-rotate-cw':
          // Phase 7.5 B16 — view-only rotation; renderer CSS only.
          e.preventDefault();
          dispatch(rotateViewCw());
          break;
        case 'view-rotate-ccw':
          e.preventDefault();
          dispatch(rotateViewCcw());
          break;
        case 'toggle-form-designer':
          e.preventDefault();
          if (!doc) break;
          dispatch(toggleDesignerMode());
          break;
        case 'open-mail-merge':
          e.preventDefault();
          if (!doc) break;
          dispatch(openMailMergeWizard());
          break;
        case 'open-export-office':
          // Phase 6 — Ctrl+Shift+E opens the Export-to-Office modal (ui-spec
          // §15.9). The modal pre-selects the last-chosen format when opened
          // without a preset arg.
          e.preventDefault();
          if (!doc) break;
          dispatch(openExportModal(undefined));
          break;
        case 'delete':
          // Only clear selection in the global handler — actual delete-page op
          // fires from the ThumbnailStrip context menu, not here.
          dispatch(clearSelection());
          break;
        case 'quit':
          // Electron handles Ctrl+Q at the menu level; nothing for renderer to do.
          break;
        case 'redaction-apply':
          // Phase 7.4 B1 — Ctrl+Shift+Y opens the Apply Redactions confirmation
          // modal. Gated by panel open + at least one pending mark, mirroring
          // the toolbar button's enable rule. Suppress when the Apply modal is
          // already open (avoid double-open).
          e.preventDefault();
          if (!doc) break;
          if (!redactionPanelOpen || redactionTotalMarks === 0) break;
          if (redactionApplyModalOpen) break;
          dispatch(setRedactionApplyModalOpen(true));
          break;
        case 'redaction-mark-rect':
          // Phase 7.4 B1 — Shift+R arms the Mark Rectangle tool (and opens
          // the panel if closed, matching Acrobat's auto-open-on-tool idiom).
          e.preventDefault();
          if (!doc) break;
          if (!redactionPanelOpen) dispatch(setRedactionPanelOpen(true));
          dispatch(setActiveRedactionTool('rect'));
          break;
        case 'tool-area-measure':
          // Phase 7.5 B17 (Riley Wave 3) — Shift+A arms the closed-polygon
          // area measure tool. Opens the shape sub-toolbar if not already
          // open so the tool button shows armed (mirrors `redaction-mark-rect`
          // auto-open idiom).
          e.preventDefault();
          if (!doc) break;
          if (!shapesPanelOpen) dispatch(setShapesPanelOpen(true));
          dispatch(setActiveShapeTool('area-measure'));
          break;
        case 'comment-stamps':
          // Phase 7.5 B7 (Riley Wave 3) — Ctrl+Shift+T opens the Stamps
          // sidebar tab. Auto-expands the sidebar if collapsed.
          e.preventDefault();
          if (!doc) break;
          dispatch(setSidebarTab('stamps'));
          if (sidebarCollapsed) dispatch(toggleSidebar());
          break;
        case 'tool-add-link':
          // Phase 7.5 B13 (Riley Wave 4) — Shift+L arms the Add Link tool.
          // The Links overlay catches subsequent marquee drags and opens the
          // Add Link modal on pointer-up.
          e.preventDefault();
          if (!doc) break;
          dispatch(setLinkTool('add-link'));
          break;
        case 'fit-width':
          // Phase 7.5 A6 — Ctrl+1 = Fit width. PdfViewer's ResizeObserver
          // effect listens for the viewport-slice fitMode change and computes
          // the appropriate zoom from viewport width + max page width pt, then
          // dispatches setZoom. The fitMode flip is the trigger.
          e.preventDefault();
          if (!doc) break;
          dispatch(setFitMode('fit-width'));
          break;
        case 'fit-page':
          // Phase 7.5 A6 — Ctrl+2 = Fit page.
          e.preventDefault();
          if (!doc) break;
          dispatch(setFitMode('fit-page'));
          break;
      }
    },
    [
      dispatch,
      doc,
      currentPage,
      textEditActive,
      redactionPanelOpen,
      redactionApplyModalOpen,
      redactionTotalMarks,
      findBarOpen,
      readMode,
      shapesPanelOpen,
      sidebarCollapsed,
    ],
  );

  useKeyboardShortcut(handler);
}
