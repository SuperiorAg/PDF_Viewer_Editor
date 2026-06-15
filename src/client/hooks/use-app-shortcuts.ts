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
import { openWizard as openMailMergeWizard } from '../state/slices/mail-merge-slice';
// Phase 7.4 B1 — Redaction shortcuts dispatch into the redactions + ui slices.
import { setActiveRedactionTool } from '../state/slices/redactions-slice';
import { selectAll, clearSelection } from '../state/slices/selection-slice';
import {
  selectRedactionApplyModalOpen,
  selectRedactionPanelOpen,
  selectTextEditMode,
} from '../state/slices/ui-selectors';
import {
  cycleSidebarTab,
  openHelpModal,
  openImageImportModal,
  openModal,
  setRedactionApplyModalOpen,
  setRedactionPanelOpen,
  setTextEditMode,
  toggleInspector,
  toggleSidebar,
} from '../state/slices/ui-slice';
// Phase 3
// Phase 6
import { selectCurrentPage } from '../state/slices/viewport-selectors';
import { resetZoom, setCurrentPage, zoomIn, zoomOut } from '../state/slices/viewport-slice';
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
          e.preventDefault();
          if (document.fullscreenElement) {
            void document.exitFullscreen();
          } else {
            void document.documentElement.requestFullscreen();
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
          // Phase 7.4 A1 (Riley) — Find is genuinely deferred. The previous
          // toast read "Coming in Phase 3" three phases AFTER Phase 3 shipped.
          // Per honesty refresh: do nothing on Ctrl+F (the menu entry is the
          // single surface for the deferral message; broadcasting it from a
          // keypress added no value). The shortcut entry stays registered for
          // the future Find wave (Bucket B3) — that wave wires the search UI.
          e.preventDefault();
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
        case 'fit-width':
        case 'fit-page':
          // Phase 1 no-op — viewport fit modes not wired yet.
          e.preventDefault();
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
    ],
  );

  useKeyboardShortcut(handler);
}
