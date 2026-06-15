// >200 lines: Toolbar is the single horizontal action strip below the menu
// bar — selection tools, annotation tools (highlight / strikethrough / sticky /
// text-box / freehand / shape), measure tools, designer-mode toggle, mail-
// merge entry, OCR overlay toggle, save / undo / redo. Per convention §3.4 the
// escape hatch is justified because the file is the canonical WAI-ARIA roving-
// tabindex toolbar (one focusable element at a time, arrow keys move focus
// across the whole strip via useRovingToolbar). That a11y contract is a
// SINGLE-component invariant — splitting per tool-group would force every
// subcomponent to forward refs into the roving system and duplicate the
// strip's tabindex bookkeeping, which is exactly what useRovingToolbar exists
// to centralize. The current shape is the smallest one that keeps the roving
// contract local.
import { useRovingToolbar } from '../../hooks/use-roving-toolbar';
import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { redoAction, undoAction } from '../../state/middleware/history-middleware';
import { selectActiveTool } from '../../state/slices/annotations-selectors';
import { type AnnotationTool, setActiveTool } from '../../state/slices/annotations-slice';
import { selectCurrentDocument, selectIsDirty } from '../../state/slices/document-selectors';
import { applyEdit } from '../../state/slices/document-slice';
import { openExportModal } from '../../state/slices/export-slice';
import { selectDesignerMode } from '../../state/slices/forms-selectors';
import { toggleDesignerMode } from '../../state/slices/forms-slice';
import { selectCanRedo, selectCanUndo } from '../../state/slices/history-selectors';
// Phase 3
import { openWizard as openMailMergeWizard } from '../../state/slices/mail-merge-slice';
// Phase 5
import { selectOcrOverlayVisible } from '../../state/slices/ocr-selectors';
import {
  openRunModal as openOcrRunModal,
  toggleOverlay as toggleOcrOverlay,
} from '../../state/slices/ocr-slice';
import { selectBookmarksEditMode, selectTextEditMode } from '../../state/slices/ui-selectors';
import {
  openImageImportModal,
  openModal,
  pushToast,
  setTextEditMode,
  toggleBookmarksEditMode,
} from '../../state/slices/ui-slice';
// Phase 6 — Export-to-Office modal entry.
import { selectCurrentPage } from '../../state/slices/viewport-selectors';
import { openDocumentThunk, printThunk, saveDocumentThunk } from '../../state/thunks';

import { ToolbarButton } from './toolbar-button';
import styles from './toolbar.module.css';

// Total number of ToolbarButtons rendered below. Wave 28a (a11y-audit.md R-3):
// the toolbar is a single Tab stop with arrow-key roving between buttons. This
// count MUST match the number of `{...rb()}` spreads in the JSX — a mismatch
// would leave a button out of the roving order. Guarded by a dev assertion.
const TOOLBAR_BUTTON_COUNT = 30;

export function Toolbar(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const isDirty = useAppSelector(selectIsDirty);
  const activeTool = useAppSelector(selectActiveTool);
  const currentPage = useAppSelector(selectCurrentPage);
  const canUndo = useAppSelector(selectCanUndo);
  const canRedo = useAppSelector(selectCanRedo);
  const textEditActive = useAppSelector(selectTextEditMode);
  const bookmarksEditActive = useAppSelector(selectBookmarksEditMode);
  const designerActive = useAppSelector(selectDesignerMode);
  const ocrOverlayVisible = useAppSelector(selectOcrOverlayVisible);

  // Roving-tabindex controller (a11y-audit.md R-3). `rb()` allocates the next
  // sequential roving index in render order and returns the roving props to
  // spread onto a ToolbarButton. Render is deterministic, so indices are
  // stable across renders.
  const roving = useRovingToolbar(TOOLBAR_BUTTON_COUNT);
  let rovingCursor = 0;
  const rb = (): {
    tabIndex: 0 | -1;
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
    ref: (el: HTMLButtonElement | null) => void;
  } => {
    const i = rovingCursor++;
    return {
      tabIndex: roving.tabIndexFor(i),
      onKeyDown: roving.onKeyDown(i),
      ref: roving.registerRef(i),
    };
  };

  const rotate = (cw: boolean): void => {
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

  const insertBlank = (): void => {
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

  const deletePage = (): void => {
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

  return (
    <div className={styles.toolbar} role="toolbar" aria-label={t('toolbar:label')}>
      <div className={styles.group}>
        <ToolbarButton
          {...rb()}
          icon="folder-open"
          label={t('toolbar:open')}
          tooltip={t('toolbar:openTooltip')}
          onClick={() => void dispatch(openDocumentThunk())}
        />
        <ToolbarButton
          {...rb()}
          icon="save"
          label={t('toolbar:save')}
          tooltip={t('toolbar:saveTooltip')}
          disabled={!doc || !isDirty}
          onClick={() => void dispatch(saveDocumentThunk({ saveAs: false }))}
        />
        <ToolbarButton
          {...rb()}
          icon="save-as"
          label={t('toolbar:saveAs')}
          tooltip={t('toolbar:saveAsTooltip')}
          disabled={!doc}
          onClick={() => void dispatch(saveDocumentThunk({ saveAs: true }))}
        />
      </div>

      <div className={styles.divider} />

      <div className={styles.group}>
        <ToolbarButton
          {...rb()}
          icon="undo"
          label={t('toolbar:undo')}
          tooltip={t('toolbar:undoTooltip')}
          disabled={!doc || !canUndo}
          onClick={() => dispatch(undoAction())}
        />
        <ToolbarButton
          {...rb()}
          icon="redo"
          label={t('toolbar:redo')}
          tooltip={t('toolbar:redoTooltip')}
          disabled={!doc || !canRedo}
          onClick={() => dispatch(redoAction())}
        />
      </div>

      <div className={styles.divider} />

      <div className={styles.group} aria-label={t('toolbar:groups.annotation')}>
        <ToolbarButton
          {...rb()}
          icon="highlight"
          label={t('toolbar:highlight')}
          tooltip={t('toolbar:highlightTooltip')}
          disabled={!doc}
          active={activeTool === 'highlight'}
          onClick={setTool('highlight')}
        />
        <ToolbarButton
          {...rb()}
          icon="sticky"
          label={t('toolbar:sticky')}
          tooltip={t('toolbar:stickyTooltip')}
          disabled={!doc}
          active={activeTool === 'sticky'}
          onClick={setTool('sticky')}
        />
        <ToolbarButton
          {...rb()}
          icon="text"
          label={t('toolbar:textBox')}
          tooltip={t('toolbar:textBoxTooltip')}
          disabled={!doc}
          active={activeTool === 'text'}
          onClick={setTool('text')}
        />
        <ToolbarButton
          {...rb()}
          icon="underline"
          label={t('toolbar:underline')}
          tooltip={t('toolbar:underlineTooltip')}
          disabled={!doc}
          active={activeTool === 'underline'}
          onClick={setTool('underline')}
        />
        <ToolbarButton
          {...rb()}
          icon="strikethrough"
          label={t('toolbar:strikethrough')}
          tooltip={t('toolbar:strikethroughTooltip')}
          disabled={!doc}
          active={activeTool === 'strikeout'}
          onClick={setTool('strikeout')}
        />
        <ToolbarButton
          {...rb()}
          icon="freehand"
          label={t('toolbar:freehand')}
          tooltip={t('toolbar:freehandTooltip')}
          disabled={!doc}
          active={activeTool === 'ink'}
          onClick={setTool('ink')}
        />
        <ToolbarButton
          {...rb()}
          icon="type-cursor"
          label={t('toolbar:textEdit')}
          tooltip={t('toolbar:textEditTooltip')}
          disabled={!doc}
          active={textEditActive}
          onClick={() => dispatch(setTextEditMode(!textEditActive))}
        />
        {/* Shapes button: the underlying ShapeToolbar component exists but is
            not mounted in the production UI yet. Per Phase 7.4 A1 honesty
            refresh the tooltip no longer promises a specific phase, and the
            dead "coming later" toast (the button is disabled, so it never
            fired) is removed. Tracked for the future Shapes wave. */}
        <ToolbarButton
          {...rb()}
          icon="shapes"
          label={t('toolbar:shapes')}
          tooltip={t('toolbar:shapesTooltip')}
          disabled
          onClick={() => {
            // Disabled — nothing happens; the tooltip explains.
          }}
        />
      </div>

      <div className={styles.divider} />

      <div className={styles.group} aria-label={t('toolbar:groups.pageOps')}>
        <ToolbarButton
          {...rb()}
          icon="page-plus"
          label={t('toolbar:insertBlank')}
          tooltip={t('toolbar:insertBlankTooltip')}
          disabled={!doc}
          onClick={insertBlank}
        />
        {/* Insert from file: genuinely deferred (no shipped dispatcher for
            insert-pages-from-another-PDF). Phase 7.4 A1 honesty refresh:
            disable the button rather than fire a "coming later" toast on a
            visibly-enabled control. Tooltip explains the deferral. */}
        <ToolbarButton
          {...rb()}
          icon="page-import"
          label={t('toolbar:insertFromFile')}
          tooltip={t('toolbar:insertFromFileTooltip')}
          disabled
          onClick={() => {
            // Disabled — nothing happens; the tooltip explains.
          }}
        />
        <ToolbarButton
          {...rb()}
          icon="image-plus"
          label={t('toolbar:insertImage')}
          tooltip={t('toolbar:insertImageTooltip')}
          disabled={!doc}
          onClick={() => dispatch(openImageImportModal())}
        />
        <ToolbarButton
          {...rb()}
          icon="page-minus"
          label={t('toolbar:deletePage')}
          tooltip={t('toolbar:deletePageTooltip')}
          disabled={!doc}
          onClick={deletePage}
        />
        <ToolbarButton
          {...rb()}
          icon="rotate-cw"
          label={t('toolbar:rotateCw')}
          tooltip={t('toolbar:rotateCwTooltip')}
          disabled={!doc}
          onClick={() => rotate(true)}
        />
        <ToolbarButton
          {...rb()}
          icon="rotate-ccw"
          label={t('toolbar:rotateCcw')}
          tooltip={t('toolbar:rotateCcwTooltip')}
          disabled={!doc}
          onClick={() => rotate(false)}
        />
      </div>

      <div className={styles.divider} />

      <div className={styles.group} aria-label={t('toolbar:groups.output')}>
        <ToolbarButton
          {...rb()}
          icon="printer"
          label={t('toolbar:print')}
          tooltip={t('toolbar:printTooltip')}
          disabled={!doc}
          onClick={() => void dispatch(printThunk())}
        />
        <ToolbarButton
          {...rb()}
          icon="file-export"
          label={t('toolbar:exportPdf')}
          tooltip={t('toolbar:exportPdfTooltip')}
          disabled={!doc}
          onClick={() => dispatch(openModal('export-engine'))}
        />
        {/* Phase 6 — Export to Office button. Ctrl+Shift+E opens the modal
            blank (last-chosen format pre-selected on Step 1). */}
        <ToolbarButton
          {...rb()}
          icon="file-export"
          label={t('toolbar:exportOffice')}
          tooltip={t('toolbar:exportOfficeTooltip')}
          disabled={!doc}
          onClick={() => dispatch(openExportModal(undefined))}
        />
        <ToolbarButton
          {...rb()}
          icon="bookmark-edit"
          label={t('toolbar:bookmarksEdit')}
          tooltip={t('toolbar:bookmarksEditTooltip')}
          disabled={!doc}
          active={bookmarksEditActive}
          onClick={() => dispatch(toggleBookmarksEditMode())}
        />
      </div>

      <div className={styles.divider} />

      <div className={styles.group} aria-label={t('toolbar:groups.forms')}>
        <ToolbarButton
          {...rb()}
          icon="form-edit"
          label={t('toolbar:formDesigner')}
          tooltip={t('toolbar:formDesignerTooltip')}
          disabled={!doc}
          active={designerActive}
          onClick={() => dispatch(toggleDesignerMode())}
        />
        <ToolbarButton
          {...rb()}
          icon="mail-merge"
          label={t('toolbar:mailMerge')}
          tooltip={t('toolbar:mailMergeTooltip')}
          disabled={!doc}
          onClick={() => dispatch(openMailMergeWizard())}
        />
      </div>

      <div className={styles.divider} />

      {/* Phase 5 — OCR group. Per ui-spec.md §14.1. */}
      <div className={styles.group} aria-label={t('toolbar:groups.ocr')}>
        <ToolbarButton
          {...rb()}
          icon="scan-text"
          label={t('toolbar:runOcr')}
          tooltip={t('toolbar:runOcrTooltip')}
          disabled={!doc}
          onClick={() => dispatch(openOcrRunModal())}
        />
        <ToolbarButton
          {...rb()}
          icon="eye-low"
          label={t('toolbar:confidenceOverlay')}
          tooltip={t('toolbar:confidenceOverlayTooltip')}
          disabled={!doc}
          active={ocrOverlayVisible}
          onClick={() => dispatch(toggleOcrOverlay())}
        />
        {/* Scan button intentionally disabled — TWAIN/WIA deferred indefinitely
            per docs/architecture-phase-5.md §7 + groomed roadmap (0a09f4c) +
            Phase 7.4 A1 honesty refresh. Tooltip points users at the OS scan
            utility + drag-and-drop fallback — not a future-phase version promise. */}
        <ToolbarButton
          {...rb()}
          icon="scanner"
          label={t('toolbar:scanDevice')}
          tooltip={t('toolbar:scanDeviceTooltip')}
          disabled
          onClick={() => {
            // Disabled — nothing happens; the tooltip explains.
          }}
        />
      </div>

      <div className={styles.divider} />

      <div className={styles.group}>
        <ToolbarButton
          {...rb()}
          icon="combine"
          label={t('toolbar:combine')}
          tooltip={t('toolbar:combineTooltip')}
          onClick={() => dispatch(openModal('combine'))}
        />
        <ToolbarButton
          {...rb()}
          icon="gear"
          label={t('toolbar:settings')}
          tooltip={t('toolbar:settingsTooltip')}
          onClick={() => dispatch(openModal('settings'))}
        />
      </div>
    </div>
  );
}
