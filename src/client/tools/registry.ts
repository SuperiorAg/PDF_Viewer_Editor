// Tool registry — single source of truth for every user-facing tool surface.
// Phase 7.5 R1 (Riley). Spec: docs/tool-registry-spec.md. Architecture:
// docs/architecture-phase-7.5.md §2. Conventions: docs/conventions.md §19.
//
// The audit's §3 ("the menu lies") documented six real marking-lie defects
// rooted in toolbar / menu / shortcuts / i18n drift. The registry collapses
// the representations to ONE `ToolDef` per tool. Four contract tests in
// `registry.contract.test.ts` enforce the 7-dimension "well marked"
// definition. The L-007 lock (Wave 11) ratchets coverage in CI.
//
// Cutover discipline (R4 mitigation): this commit is REGISTRY-ADDITIVE only.
// The toolbar / menu-bar / shape-toolbar render paths are NOT rewired to read
// from this file in Wave 2 — that's a separate Wave-2-B cutover commit. Until
// then the registry exists as a SOURCE OF TRUTH for: (a) the four contract
// tests; (b) the Find-a-tool palette (A7) which IS a registry consumer
// landing in this wave; (c) tooling that wants to enumerate tools by id.
//
// L-004 / L-005 / L-006 do not apply to this file (no pdf.js, no test-only IPC).

import { type ShortcutId } from '../shortcuts';
import { redoAction, undoAction } from '../state/middleware/history-middleware';
import { setActiveTool } from '../state/slices/annotations-slice';
// Phase 7.5 Wave 5 (Riley) — B19 Auto-bookmark + B20 Sanitize + B21 Document
// Properties registry entries dispatch into their dedicated slices.
import { openAutoBookmark } from '../state/slices/auto-bookmark-slice';
import { openDocumentProperties } from '../state/slices/document-properties-slice';
import { applyEdit } from '../state/slices/document-slice';
import { openExportModal } from '../state/slices/export-slice';
import { toggleDesignerMode } from '../state/slices/forms-slice';
import { setLinkTool } from '../state/slices/links-slice';
import { openWizard as openMailMergeWizard } from '../state/slices/mail-merge-slice';
import { openRunModal as openOcrRunModal } from '../state/slices/ocr-slice';
import { openPageDesign } from '../state/slices/page-design-slice';
import { setActiveRedactionTool } from '../state/slices/redactions-slice';
// Phase 7.5 Wave 3 (Riley) — region clipboard cut/copy/paste delegate to the
// region-clipboard service shared with the menu mirrors.
import {
  regionClipboardCopy,
  regionClipboardCut,
  regionClipboardPaste,
  selectRegionClipboardCanPaste,
  selectRegionClipboardHasSelection,
} from '../state/slices/region-clipboard-slice';
// Phase 7.5 Wave 5 (Riley) — B20 Sanitize modal opener.
import { openSanitize } from '../state/slices/sanitize-slice';
// Phase 7.5 Wave 3 (Riley) — area-measure tool arms the shape sub-toolbar.
import { setActiveShapeTool } from '../state/slices/shapes-slice';
// Phase 7.5 Wave 5a (Riley) — C1 Read Aloud registry dispatcher.
import { openReadAloud } from '../state/slices/tts-slice';
// Phase 7.5 Wave 4 (Riley) — B4 page-design + B13 Add Link tool dispatchers.
import {
  openImageImportModal,
  openModal,
  rotateViewCw,
  setFindBarOpen,
  setReadMode,
  setRedactionApplyModalOpen,
  setRedactionPanelOpen,
  setShapesPanelOpen,
  setSidebarTab,
  setTextEditMode,
  toggleBookmarksEditMode,
  toggleInspector,
  toggleShapesPanel,
  toggleSidebar,
} from '../state/slices/ui-slice';
import { type AppDispatch, type RootState } from '../state/store';
import {
  closeDocumentThunk,
  openDocumentThunk,
  printThunk,
  saveDocumentThunk,
} from '../state/thunks';

// ============================================================================
// Type surface — `ToolDef` interface per docs/tool-registry-spec.md §1.
// ============================================================================

export type ToolId =
  // file group
  | 'file:open'
  | 'file:save'
  | 'file:save-as'
  | 'file:close'
  | 'file:print'
  | 'file:export-pdf'
  | 'file:export-office'
  | 'file:combine'
  | 'file:settings'
  // edit group
  | 'edit:undo'
  | 'edit:redo'
  | 'edit:find'
  // view group
  | 'view:toggle-sidebar'
  | 'view:toggle-inspector'
  | 'view:rotate-view'
  | 'view:read-mode'
  | 'view:page-display-single-continuous'
  | 'view:page-display-two-up-continuous'
  | 'view:page-display-single'
  | 'view:page-display-two-up'
  // pages
  | 'pages:insert-blank'
  | 'pages:insert-from-file'
  | 'pages:insert-image'
  | 'pages:delete'
  | 'pages:rotate-cw'
  | 'pages:rotate-ccw'
  // annotation
  | 'annotation:highlight'
  | 'annotation:sticky'
  | 'annotation:text-box'
  | 'annotation:underline'
  | 'annotation:strikethrough'
  | 'annotation:freehand'
  | 'annotation:text-edit'
  | 'annotation:shapes'
  | 'annotation:redact'
  | 'annotation:redact-apply'
  // cursor
  | 'cursor:default'
  // forms
  | 'forms:designer'
  | 'forms:mail-merge'
  | 'forms:fill-and-sign'
  // ocr
  | 'ocr:run'
  | 'ocr:confidence-overlay'
  // tools — Phase 7.5+ surfaces (not all dispatchers wired yet; menu mirrors only
  // for now where shipping deferred to later waves)
  | 'tools:text-edit-mode'
  // bookmarks
  | 'bookmarks:edit-mode'
  // Phase 7.5 Wave 3 (Riley) — stamps + area measure + page-content clipboard.
  | 'comment:stamps'
  | 'shape:area-measure'
  | 'edit:region-cut'
  | 'edit:region-copy'
  | 'edit:region-paste'
  // Phase 7.5 Wave 4 (Riley) — B4 page-design entries + B13 Add Link tool.
  | 'pages:watermark'
  | 'pages:header-footer'
  | 'pages:background'
  | 'annotation:add-link'
  // Phase 7.5 Wave 5 (Riley) — B21 Document Properties + B20 Sanitize + B19
  // Auto-bookmark UI entries. All three are menu / palette only — no toolbar
  // surface — but they are first-class registry entries so the Find-a-tool
  // palette discovers them and the L-007 ratchet has zero blind spots.
  | 'file:properties'
  | 'tools:sanitize'
  | 'bookmarks:auto-bookmark'
  // Phase 7.5 Wave 5a (Riley) — C1 Read Aloud + C2 Preflight registry entries.
  // Read Aloud is a View-menu toggle (opens the floating bar). Preflight is a
  // Tools-menu entry that switches the sidebar to the Preflight tab + opens
  // the sidebar if collapsed.
  | 'view:readAloud'
  | 'tools:preflight'
  // Phase 7.5 Wave 5b (Riley) — C3 Tag PDF tree editor. Tools-menu + palette
  // surface that switches the sidebar to the Accessibility tab.
  | 'tools:tag-pdf'
  // help
  | 'help:help'
  | 'help:about';

export type I18nKey = string;
export type IconName = string;

export type MenuTopId = 'file' | 'edit' | 'view' | 'insertAndPages' | 'comment' | 'tools' | 'help';

export type ToolbarGroupId =
  | 'file-ops'
  | 'history'
  | 'annotation'
  | 'shapes'
  | 'page-ops'
  | 'output'
  | 'forms'
  | 'ocr'
  | 'combine'
  | 'redaction';

export type ContextMenuTargetId =
  | 'page-thumbnail'
  | 'page-content-selection'
  | 'bookmark-tree-node'
  | 'link-annotation';

export interface ToolDef {
  readonly id: ToolId;
  readonly nameKey: I18nKey;
  readonly tooltipKey: I18nKey;
  readonly ariaLabelKey: I18nKey;
  readonly icon: IconName | null;
  readonly shortcutId: ShortcutId | null;
  readonly menu: { top: MenuTopId; section?: string };
  readonly surfaces: {
    toolbar?: ToolbarGroupId;
    menu: boolean;
    contextMenu?: ContextMenuTargetId;
    palette: boolean;
  };
  readonly enabledWhen: (state: RootState) => boolean;
  readonly dispatch: (dispatch: AppDispatch, state: RootState) => void;
  readonly searchKeywords: readonly string[];
  readonly deprecationNote?: string;
}

// Common predicates.
const docOpen = (s: RootState): boolean => s.document.current !== null;
const always = (_s: RootState): boolean => true;
const isDirty = (s: RootState): boolean => (s.document.current?.dirtyOps?.length ?? 0) > 0;

// Dispatch helpers that need RootState for page index etc.
const rotatePage =
  (cw: boolean) =>
  (dispatch: AppDispatch, state: RootState): void => {
    const doc = state.document.current;
    if (!doc) return;
    const currentPage = state.viewport.currentPage;
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

const insertBlankPage = (dispatch: AppDispatch, state: RootState): void => {
  if (state.document.current === null) return;
  const currentPage = state.viewport.currentPage;
  dispatch(
    applyEdit({
      kind: 'insert',
      meta: { ts: Date.now(), undoable: true, operationId: `i-${Date.now()}` },
      atIndex: currentPage + 1,
      source: { kind: 'blank', width: 612, height: 792 },
    }),
  );
};

const deletePageDispatch = (dispatch: AppDispatch, state: RootState): void => {
  const doc = state.document.current;
  if (!doc) return;
  const currentPage = state.viewport.currentPage;
  const page = doc.pages[currentPage];
  if (!page) return;
  if (doc.pageCount <= 1) return;
  dispatch(
    applyEdit({
      kind: 'delete',
      meta: { ts: Date.now(), undoable: true, operationId: `d-${Date.now()}` },
      pageIndex: currentPage,
      preservedSource: page.sourcePageRef,
    }),
  );
};

// ============================================================================
// Registry — every user-facing tool surface in Phase 7.5.
// Sorted by menu group for review-by-eye.
// ============================================================================

export const TOOLS: readonly ToolDef[] = [
  // ---- file ----
  {
    id: 'file:open',
    nameKey: 'toolbar:open',
    tooltipKey: 'toolbar:openTooltip',
    ariaLabelKey: 'toolbar:open',
    icon: 'folder-open',
    shortcutId: 'open',
    menu: { top: 'file' },
    surfaces: { toolbar: 'file-ops', menu: true, palette: true },
    enabledWhen: always,
    dispatch: (d) => {
      void d(openDocumentThunk());
    },
    searchKeywords: ['open', 'file', 'load'],
  },
  {
    id: 'file:save',
    nameKey: 'toolbar:save',
    tooltipKey: 'toolbar:saveTooltip',
    ariaLabelKey: 'toolbar:save',
    icon: 'save',
    shortcutId: 'save',
    menu: { top: 'file' },
    surfaces: { toolbar: 'file-ops', menu: true, palette: true },
    enabledWhen: (s) => docOpen(s) && isDirty(s),
    dispatch: (d) => {
      void d(saveDocumentThunk({ saveAs: false }));
    },
    searchKeywords: ['save'],
  },
  {
    id: 'file:save-as',
    nameKey: 'toolbar:saveAs',
    tooltipKey: 'toolbar:saveAsTooltip',
    ariaLabelKey: 'toolbar:saveAs',
    icon: 'save-as',
    shortcutId: 'save-as',
    menu: { top: 'file' },
    surfaces: { toolbar: 'file-ops', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => {
      void d(saveDocumentThunk({ saveAs: true }));
    },
    searchKeywords: ['save as', 'export'],
  },
  {
    id: 'file:close',
    nameKey: 'menu:items.close',
    tooltipKey: 'menu:items.close',
    ariaLabelKey: 'menu:items.close',
    icon: null,
    shortcutId: 'close-document',
    menu: { top: 'file' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => {
      void d(closeDocumentThunk());
    },
    searchKeywords: ['close', 'document'],
  },
  {
    id: 'file:print',
    nameKey: 'toolbar:print',
    tooltipKey: 'toolbar:printTooltip',
    ariaLabelKey: 'toolbar:print',
    icon: 'printer',
    shortcutId: 'print',
    menu: { top: 'file' },
    surfaces: { toolbar: 'output', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => {
      void d(printThunk());
    },
    searchKeywords: ['print', 'paper'],
  },
  {
    id: 'file:export-pdf',
    nameKey: 'toolbar:exportPdf',
    tooltipKey: 'toolbar:exportPdfTooltip',
    ariaLabelKey: 'toolbar:exportPdf',
    icon: 'file-export',
    shortcutId: 'export-pdf',
    menu: { top: 'file' },
    surfaces: { toolbar: 'output', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(openModal('export-engine')),
    searchKeywords: ['export', 'pdf'],
  },
  {
    id: 'file:export-office',
    nameKey: 'toolbar:exportOffice',
    tooltipKey: 'toolbar:exportOfficeTooltip',
    ariaLabelKey: 'toolbar:exportOffice',
    icon: 'file-export',
    shortcutId: 'open-export-office',
    menu: { top: 'file' },
    surfaces: { toolbar: 'output', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(openExportModal(undefined)),
    searchKeywords: ['export', 'office', 'word', 'excel', 'powerpoint', 'image'],
  },
  {
    id: 'file:combine',
    nameKey: 'toolbar:combine',
    tooltipKey: 'toolbar:combineTooltip',
    ariaLabelKey: 'toolbar:combine',
    icon: 'combine',
    shortcutId: 'combine-open',
    menu: { top: 'file' },
    surfaces: { toolbar: 'combine', menu: true, palette: true },
    enabledWhen: always,
    dispatch: (d) => d(openModal('combine')),
    searchKeywords: ['combine', 'merge', 'concatenate'],
  },
  {
    id: 'file:settings',
    nameKey: 'toolbar:settings',
    tooltipKey: 'toolbar:settingsTooltip',
    ariaLabelKey: 'toolbar:settings',
    icon: 'gear',
    shortcutId: 'open-settings',
    menu: { top: 'file' },
    surfaces: { toolbar: 'combine', menu: true, palette: true },
    enabledWhen: always,
    dispatch: (d) => d(openModal('settings')),
    searchKeywords: ['settings', 'preferences', 'options'],
  },

  // ---- edit ----
  {
    id: 'edit:undo',
    nameKey: 'toolbar:undo',
    tooltipKey: 'toolbar:undoTooltip',
    ariaLabelKey: 'toolbar:undo',
    icon: 'undo',
    shortcutId: 'undo',
    menu: { top: 'edit' },
    surfaces: { toolbar: 'history', menu: true, palette: true },
    enabledWhen: (s) => docOpen(s) && s.history.past.length > 0,
    dispatch: (d) => d(undoAction()),
    searchKeywords: ['undo', 'revert'],
  },
  {
    id: 'edit:redo',
    nameKey: 'toolbar:redo',
    tooltipKey: 'toolbar:redoTooltip',
    ariaLabelKey: 'toolbar:redo',
    icon: 'redo',
    shortcutId: 'redo',
    menu: { top: 'edit' },
    surfaces: { toolbar: 'history', menu: true, palette: true },
    enabledWhen: (s) => docOpen(s) && s.history.future.length > 0,
    dispatch: (d) => d(redoAction()),
    searchKeywords: ['redo'],
  },
  {
    id: 'edit:find',
    nameKey: 'menu:items.find',
    tooltipKey: 'menu:tooltips.findComing',
    ariaLabelKey: 'menu:items.find',
    icon: null,
    shortcutId: 'find',
    menu: { top: 'edit' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(setFindBarOpen(true)),
    searchKeywords: ['find', 'search', 'locate'],
  },

  // ---- view ----
  {
    id: 'view:toggle-sidebar',
    nameKey: 'menu:items.toggleSidebar',
    tooltipKey: 'menu:items.toggleSidebar',
    ariaLabelKey: 'menu:items.toggleSidebar',
    icon: null,
    shortcutId: 'toggle-sidebar',
    menu: { top: 'view' },
    surfaces: { menu: true, palette: true },
    enabledWhen: always,
    dispatch: (d) => d(toggleSidebar()),
    searchKeywords: ['sidebar', 'panel', 'toggle'],
  },
  {
    id: 'view:toggle-inspector',
    nameKey: 'menu:items.toggleInspector',
    tooltipKey: 'menu:items.toggleInspector',
    ariaLabelKey: 'menu:items.toggleInspector',
    icon: null,
    shortcutId: 'toggle-inspector',
    menu: { top: 'view' },
    surfaces: { menu: true, palette: true },
    enabledWhen: always,
    dispatch: (d) => d(toggleInspector()),
    searchKeywords: ['inspector', 'properties', 'toggle'],
  },
  {
    id: 'view:rotate-view',
    nameKey: 'menu:items.viewRotateCw',
    tooltipKey: 'menu:items.viewRotateCw',
    ariaLabelKey: 'menu:items.viewRotateCw',
    icon: null,
    shortcutId: 'view-rotate-cw',
    menu: { top: 'view' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(rotateViewCw()),
    searchKeywords: ['rotate', 'view', 'orientation', 'turn'],
  },
  {
    id: 'view:read-mode',
    nameKey: 'menu:items.readMode',
    tooltipKey: 'menu:items.readMode',
    ariaLabelKey: 'menu:items.readMode',
    icon: null,
    shortcutId: 'toggle-fullscreen',
    menu: { top: 'view' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(setReadMode(true)),
    searchKeywords: ['read', 'mode', 'fullscreen', 'chromeless', 'focus'],
  },
  {
    id: 'view:page-display-single-continuous',
    nameKey: 'menu:items.pageDisplaySinglePageContinuous',
    tooltipKey: 'menu:items.pageDisplaySinglePageContinuous',
    ariaLabelKey: 'menu:items.pageDisplaySinglePageContinuous',
    icon: null,
    shortcutId: null,
    menu: { top: 'view', section: 'page-display' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: () => {
      /* dispatched via menu wrapper that knows the action */
    },
    searchKeywords: ['page display', 'single', 'continuous', 'scroll'],
  },
  {
    id: 'view:page-display-two-up-continuous',
    nameKey: 'menu:items.pageDisplayTwoUpContinuous',
    tooltipKey: 'menu:items.pageDisplayTwoUpContinuous',
    ariaLabelKey: 'menu:items.pageDisplayTwoUpContinuous',
    icon: null,
    shortcutId: null,
    menu: { top: 'view', section: 'page-display' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: () => {
      /* dispatched via menu wrapper */
    },
    searchKeywords: ['page display', 'two up', 'spread', 'continuous', 'facing'],
  },
  {
    id: 'view:page-display-single',
    nameKey: 'menu:items.pageDisplaySinglePage',
    tooltipKey: 'menu:items.pageDisplaySinglePage',
    ariaLabelKey: 'menu:items.pageDisplaySinglePage',
    icon: null,
    shortcutId: null,
    menu: { top: 'view', section: 'page-display' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: () => {
      /* dispatched via menu wrapper */
    },
    searchKeywords: ['page display', 'single', 'one page'],
  },
  {
    id: 'view:page-display-two-up',
    nameKey: 'menu:items.pageDisplayTwoUp',
    tooltipKey: 'menu:items.pageDisplayTwoUp',
    ariaLabelKey: 'menu:items.pageDisplayTwoUp',
    icon: null,
    shortcutId: null,
    menu: { top: 'view', section: 'page-display' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: () => {
      /* dispatched via menu wrapper */
    },
    searchKeywords: ['page display', 'two up', 'spread', 'facing'],
  },

  // ---- pages ----
  {
    id: 'pages:insert-blank',
    nameKey: 'toolbar:insertBlank',
    tooltipKey: 'toolbar:insertBlankTooltip',
    ariaLabelKey: 'toolbar:insertBlank',
    icon: 'page-plus',
    shortcutId: null,
    menu: { top: 'insertAndPages' },
    surfaces: { toolbar: 'page-ops', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: insertBlankPage,
    searchKeywords: ['insert', 'blank', 'page'],
  },
  {
    id: 'pages:insert-from-file',
    nameKey: 'toolbar:insertFromFile',
    tooltipKey: 'toolbar:insertFromFileTooltip',
    ariaLabelKey: 'toolbar:insertFromFile',
    icon: 'page-import',
    shortcutId: null,
    menu: { top: 'insertAndPages' },
    surfaces: { toolbar: 'page-ops', menu: true, palette: true },
    enabledWhen: () => false, // deferred per A1 honesty
    dispatch: () => {
      /* no-op until later wave wires it */
    },
    searchKeywords: ['insert', 'pages', 'from', 'file', 'pdf'],
  },
  {
    id: 'pages:insert-image',
    nameKey: 'toolbar:insertImage',
    tooltipKey: 'toolbar:insertImageTooltip',
    ariaLabelKey: 'toolbar:insertImage',
    icon: 'image-plus',
    shortcutId: 'insert-image',
    menu: { top: 'insertAndPages' },
    surfaces: { toolbar: 'page-ops', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(openImageImportModal()),
    searchKeywords: ['insert', 'image', 'picture'],
  },
  {
    id: 'pages:delete',
    nameKey: 'toolbar:deletePage',
    tooltipKey: 'toolbar:deletePageTooltip',
    ariaLabelKey: 'toolbar:deletePage',
    icon: 'page-minus',
    shortcutId: null,
    menu: { top: 'insertAndPages' },
    surfaces: { toolbar: 'page-ops', menu: true, palette: true },
    enabledWhen: (s) => docOpen(s) && (s.document.current?.pageCount ?? 0) > 1,
    dispatch: deletePageDispatch,
    searchKeywords: ['delete', 'page', 'remove'],
  },
  {
    id: 'pages:rotate-cw',
    nameKey: 'toolbar:rotateCw',
    tooltipKey: 'toolbar:rotateCwTooltip',
    ariaLabelKey: 'toolbar:rotateCw',
    icon: 'rotate-cw',
    shortcutId: 'rotate-cw',
    menu: { top: 'insertAndPages' },
    surfaces: { toolbar: 'page-ops', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: rotatePage(true),
    searchKeywords: ['rotate', 'clockwise', 'page'],
  },
  {
    id: 'pages:rotate-ccw',
    nameKey: 'toolbar:rotateCcw',
    tooltipKey: 'toolbar:rotateCcwTooltip',
    ariaLabelKey: 'toolbar:rotateCcw',
    icon: 'rotate-ccw',
    shortcutId: 'rotate-ccw',
    menu: { top: 'insertAndPages' },
    surfaces: { toolbar: 'page-ops', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: rotatePage(false),
    searchKeywords: ['rotate', 'counter', 'clockwise', 'page'],
  },

  // ---- annotation ----
  {
    id: 'annotation:highlight',
    nameKey: 'toolbar:highlight',
    tooltipKey: 'toolbar:highlightTooltip',
    ariaLabelKey: 'toolbar:highlight',
    icon: 'highlight',
    shortcutId: 'tool-highlight',
    menu: { top: 'comment', section: 'mark-up' },
    surfaces: { toolbar: 'annotation', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(setActiveTool('highlight')),
    searchKeywords: ['highlight', 'mark', 'yellow'],
  },
  {
    id: 'annotation:sticky',
    nameKey: 'toolbar:sticky',
    tooltipKey: 'toolbar:stickyTooltip',
    ariaLabelKey: 'toolbar:sticky',
    icon: 'sticky',
    shortcutId: 'tool-sticky',
    menu: { top: 'comment', section: 'mark-up' },
    surfaces: { toolbar: 'annotation', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(setActiveTool('sticky')),
    searchKeywords: ['sticky', 'note', 'comment'],
  },
  {
    id: 'annotation:text-box',
    nameKey: 'toolbar:textBox',
    tooltipKey: 'toolbar:textBoxTooltip',
    ariaLabelKey: 'toolbar:textBox',
    icon: 'text',
    shortcutId: 'tool-text',
    menu: { top: 'comment', section: 'mark-up' },
    surfaces: { toolbar: 'annotation', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(setActiveTool('text')),
    searchKeywords: ['text', 'box', 'caption'],
  },
  {
    id: 'annotation:underline',
    nameKey: 'toolbar:underline',
    tooltipKey: 'toolbar:underlineTooltip',
    ariaLabelKey: 'toolbar:underline',
    icon: 'underline',
    shortcutId: 'tool-underline',
    menu: { top: 'comment', section: 'mark-up' },
    surfaces: { toolbar: 'annotation', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(setActiveTool('underline')),
    searchKeywords: ['underline'],
  },
  {
    id: 'annotation:strikethrough',
    nameKey: 'toolbar:strikethrough',
    tooltipKey: 'toolbar:strikethroughTooltip',
    ariaLabelKey: 'toolbar:strikethrough',
    icon: 'strikethrough',
    shortcutId: 'tool-strikethrough',
    menu: { top: 'comment', section: 'mark-up' },
    surfaces: { toolbar: 'annotation', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(setActiveTool('strikeout')),
    searchKeywords: ['strikethrough', 'strikeout'],
  },
  {
    id: 'annotation:freehand',
    nameKey: 'toolbar:freehand',
    tooltipKey: 'toolbar:freehandTooltip',
    ariaLabelKey: 'toolbar:freehand',
    icon: 'freehand',
    shortcutId: 'tool-freehand',
    menu: { top: 'comment', section: 'mark-up' },
    surfaces: { toolbar: 'annotation', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(setActiveTool('ink')),
    searchKeywords: ['freehand', 'ink', 'draw', 'pen'],
  },
  {
    id: 'annotation:text-edit',
    nameKey: 'toolbar:textEdit',
    tooltipKey: 'toolbar:textEditTooltip',
    ariaLabelKey: 'toolbar:textEdit',
    icon: 'type-cursor',
    shortcutId: 'tool-text-edit',
    menu: { top: 'tools' },
    surfaces: { toolbar: 'annotation', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(setTextEditMode(true)),
    searchKeywords: ['text edit', 'edit text', 'replace'],
  },
  {
    id: 'annotation:shapes',
    nameKey: 'toolbar:shapes',
    tooltipKey: 'toolbar:shapesTooltip',
    ariaLabelKey: 'toolbar:shapes',
    icon: 'shapes',
    shortcutId: null,
    menu: { top: 'comment', section: 'mark-up' },
    surfaces: { toolbar: 'annotation', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(toggleShapesPanel()),
    searchKeywords: ['shapes', 'rectangle', 'ellipse', 'arrow', 'line', 'callout'],
  },
  {
    id: 'annotation:redact',
    nameKey: 'toolbar:redact',
    tooltipKey: 'toolbar:redactTooltip',
    ariaLabelKey: 'toolbar:redact',
    icon: 'redact',
    shortcutId: 'redaction-mark-rect',
    menu: { top: 'tools' },
    surfaces: { toolbar: 'forms', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => {
      d(setRedactionPanelOpen(true));
      d(setActiveRedactionTool('rect'));
    },
    searchKeywords: ['redact', 'redaction', 'black out', 'mark'],
  },
  {
    id: 'annotation:redact-apply',
    nameKey: 'menu:items.redactApply',
    tooltipKey: 'menu:tooltips.redactIrreversible',
    ariaLabelKey: 'menu:items.redactApply',
    icon: null,
    shortcutId: 'redaction-apply',
    menu: { top: 'tools' },
    surfaces: { menu: true, palette: true },
    enabledWhen: (s) => docOpen(s) && s.redactions.totalMarks > 0,
    dispatch: (d) => d(setRedactionApplyModalOpen(true)),
    searchKeywords: ['apply', 'redactions', 'commit'],
  },

  // ---- cursor ----
  {
    id: 'cursor:default',
    nameKey: 'toolbar:cursorDefault',
    tooltipKey: 'toolbar:cursorDefaultTooltip',
    ariaLabelKey: 'toolbar:cursorDefault',
    icon: 'type-cursor',
    shortcutId: 'tool-cursor',
    menu: { top: 'tools' },
    surfaces: { toolbar: 'annotation', menu: true, palette: true },
    enabledWhen: always,
    dispatch: (d) => d(setActiveTool('cursor')),
    searchKeywords: ['cursor', 'select', 'pointer', 'hand'],
  },

  // ---- forms ----
  {
    id: 'forms:designer',
    nameKey: 'toolbar:formDesigner',
    tooltipKey: 'toolbar:formDesignerTooltip',
    ariaLabelKey: 'toolbar:formDesigner',
    icon: 'form-edit',
    shortcutId: 'toggle-form-designer',
    menu: { top: 'tools' },
    surfaces: { toolbar: 'forms', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(toggleDesignerMode()),
    searchKeywords: ['form', 'designer', 'fields'],
  },
  {
    id: 'forms:mail-merge',
    nameKey: 'toolbar:mailMerge',
    tooltipKey: 'toolbar:mailMergeTooltip',
    ariaLabelKey: 'toolbar:mailMerge',
    icon: 'mail-merge',
    shortcutId: 'open-mail-merge',
    menu: { top: 'tools' },
    surfaces: { toolbar: 'forms', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(openMailMergeWizard()),
    searchKeywords: ['mail merge', 'batch', 'csv', 'excel'],
  },
  {
    id: 'forms:fill-and-sign',
    nameKey: 'toolbar:fillAndSign',
    tooltipKey: 'toolbar:fillAndSignTooltip',
    ariaLabelKey: 'toolbar:fillAndSign',
    icon: 'pen-signature',
    shortcutId: null,
    menu: { top: 'tools' },
    surfaces: { toolbar: 'forms', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: () => {
      /* dispatched by toolbar/menu wrappers; openCaptureModal() */
    },
    searchKeywords: ['sign', 'signature', 'fill'],
  },

  // ---- ocr ----
  {
    id: 'ocr:run',
    nameKey: 'toolbar:runOcr',
    tooltipKey: 'toolbar:runOcrTooltip',
    ariaLabelKey: 'toolbar:runOcr',
    icon: 'scan-text',
    shortcutId: 'ocr-run',
    menu: { top: 'tools' },
    surfaces: { toolbar: 'ocr', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(openOcrRunModal()),
    searchKeywords: ['ocr', 'recognize', 'optical', 'character'],
  },
  {
    id: 'ocr:confidence-overlay',
    nameKey: 'toolbar:confidenceOverlay',
    tooltipKey: 'toolbar:confidenceOverlayTooltip',
    ariaLabelKey: 'toolbar:confidenceOverlay',
    icon: 'eye-low',
    shortcutId: null,
    menu: { top: 'tools' },
    surfaces: { toolbar: 'ocr', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: () => {
      /* dispatched via toolbar wrapper that knows toggleOcrOverlay() */
    },
    searchKeywords: ['ocr', 'overlay', 'confidence'],
  },

  // ---- tools (mode toggles) ----
  {
    id: 'tools:text-edit-mode',
    nameKey: 'menu:items.textEditMode',
    tooltipKey: 'toolbar:textEditTooltip',
    ariaLabelKey: 'menu:items.textEditMode',
    icon: null,
    shortcutId: null,
    menu: { top: 'tools' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(setTextEditMode(true)),
    searchKeywords: ['text edit', 'edit text'],
    deprecationNote: 'duplicate of annotation:text-edit; menu mirror only',
  },

  // ---- Phase 7.5 Wave 3 (Riley) — Stamps + Area measure + Region clipboard ----
  // Stamps panel toggle (opens the sidebar tab + ensures the sidebar is
  // expanded). The stamps:list / stamps:add / stamps:remove IPC channels are
  // open questions for Marcus; the panel renders the 10 built-in text stamps
  // from `services/builtin-stamps.ts` regardless of bridge availability.
  {
    id: 'comment:stamps',
    nameKey: 'toolbar:stamps',
    tooltipKey: 'toolbar:stampsTooltip',
    ariaLabelKey: 'toolbar:stamps',
    icon: 'stamps',
    shortcutId: 'comment-stamps',
    menu: { top: 'comment', section: 'stamps' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d, s) => {
      d(setSidebarTab('stamps'));
      if (s.ui.sidebarCollapsed) d(toggleSidebar());
    },
    searchKeywords: ['stamp', 'stamps', 'approved', 'draft', 'confidential', 'mark'],
  },
  // B17 area-measure — arms the shape sub-toolbar's area tool.
  {
    id: 'shape:area-measure',
    nameKey: 'toolbar:shapeTools.areaMeasure',
    tooltipKey: 'toolbar:shapeTools.areaMeasureTooltip',
    ariaLabelKey: 'toolbar:shapeTools.areaMeasureAria',
    icon: 'area-measure',
    shortcutId: 'tool-area-measure',
    menu: { top: 'comment', section: 'mark-up' },
    surfaces: { toolbar: 'shapes', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => {
      d(setShapesPanelOpen(true));
      d(setActiveShapeTool('area-measure'));
    },
    searchKeywords: ['area', 'measure', 'polygon', 'closed', 'calibrate'],
  },
  // B12 region clipboard — menu-only entries (Cut / Copy / Paste). The actual
  // Ctrl+X / Ctrl+C / Ctrl+V chords are context-sensitive and bound by the
  // region-clipboard overlay, NOT the global shortcuts table — so these tools
  // have `shortcutId: null`. The chord text is shown inside the tooltip as
  // documentation only.
  {
    id: 'edit:region-cut',
    nameKey: 'toolbar:regionCut',
    tooltipKey: 'toolbar:regionCutTooltip',
    ariaLabelKey: 'toolbar:regionCut',
    icon: null,
    shortcutId: null,
    menu: { top: 'edit', section: 'clipboard' },
    surfaces: { menu: true, palette: true, contextMenu: 'page-content-selection' },
    enabledWhen: selectRegionClipboardHasSelection,
    dispatch: (d) => d(regionClipboardCut()),
    searchKeywords: ['cut', 'region', 'clipboard'],
  },
  {
    id: 'edit:region-copy',
    nameKey: 'toolbar:regionCopy',
    tooltipKey: 'toolbar:regionCopyTooltip',
    ariaLabelKey: 'toolbar:regionCopy',
    icon: null,
    shortcutId: null,
    menu: { top: 'edit', section: 'clipboard' },
    surfaces: { menu: true, palette: true, contextMenu: 'page-content-selection' },
    enabledWhen: selectRegionClipboardHasSelection,
    dispatch: (d) => d(regionClipboardCopy()),
    searchKeywords: ['copy', 'region', 'clipboard'],
  },
  {
    id: 'edit:region-paste',
    nameKey: 'toolbar:regionPaste',
    tooltipKey: 'toolbar:regionPasteTooltip',
    ariaLabelKey: 'toolbar:regionPaste',
    icon: null,
    shortcutId: null,
    menu: { top: 'edit', section: 'clipboard' },
    surfaces: { menu: true, palette: true, contextMenu: 'page-content-selection' },
    enabledWhen: selectRegionClipboardCanPaste,
    dispatch: (d) => d(regionClipboardPaste()),
    searchKeywords: ['paste', 'region', 'clipboard'],
  },

  // ---- bookmarks ----
  {
    id: 'bookmarks:edit-mode',
    nameKey: 'toolbar:bookmarksEdit',
    tooltipKey: 'toolbar:bookmarksEditTooltip',
    ariaLabelKey: 'toolbar:bookmarksEdit',
    icon: 'bookmark-edit',
    shortcutId: 'bookmark-edit',
    menu: { top: 'view' },
    surfaces: { toolbar: 'output', menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(toggleBookmarksEditMode()),
    searchKeywords: ['bookmarks', 'edit', 'outline', 'toc'],
  },

  // ---- Phase 7.5 Wave 4 (Riley) — B4 Page Design + B13 Add Link ----
  // B4 — three menu entries open the same modal pre-selected to the right
  // tab so the user can land directly in Watermark / H&F / Background.
  {
    id: 'pages:watermark',
    nameKey: 'toolbar:watermark',
    tooltipKey: 'toolbar:watermarkTooltip',
    ariaLabelKey: 'toolbar:watermark',
    icon: null,
    shortcutId: null,
    menu: { top: 'insertAndPages', section: 'page-design' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(openPageDesign('watermark')),
    searchKeywords: ['watermark', 'overlay', 'draft', 'confidential'],
  },
  {
    id: 'pages:header-footer',
    nameKey: 'toolbar:headerFooter',
    tooltipKey: 'toolbar:headerFooterTooltip',
    ariaLabelKey: 'toolbar:headerFooter',
    icon: null,
    shortcutId: null,
    menu: { top: 'insertAndPages', section: 'page-design' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(openPageDesign('header-footer')),
    searchKeywords: ['header', 'footer', 'page number', 'date'],
  },
  {
    id: 'pages:background',
    nameKey: 'toolbar:background',
    tooltipKey: 'toolbar:backgroundTooltip',
    ariaLabelKey: 'toolbar:background',
    icon: null,
    shortcutId: null,
    menu: { top: 'insertAndPages', section: 'page-design' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(openPageDesign('background')),
    searchKeywords: ['background', 'color', 'image'],
  },
  // B13 — Add Link tool. Arms the Links overlay; user drags marquee and
  // the Add Link modal opens with the captured rect.
  {
    id: 'annotation:add-link',
    nameKey: 'toolbar:addLink',
    tooltipKey: 'toolbar:addLinkTooltip',
    ariaLabelKey: 'toolbar:addLinkAria',
    icon: 'link',
    shortcutId: 'tool-add-link',
    menu: { top: 'edit', section: 'links' },
    surfaces: { menu: true, palette: true, contextMenu: 'link-annotation' },
    enabledWhen: docOpen,
    dispatch: (d) => d(setLinkTool('add-link')),
    searchKeywords: ['link', 'hyperlink', 'url', 'add link'],
  },

  // ---- Phase 7.5 Wave 5 (Riley) — B21 Document Properties + B20 Sanitize + B19 Auto-bookmark ----
  {
    id: 'file:properties',
    nameKey: 'toolbar:properties',
    tooltipKey: 'toolbar:propertiesTooltip',
    ariaLabelKey: 'toolbar:propertiesAria',
    icon: null,
    shortcutId: 'file-properties',
    menu: { top: 'file' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(openDocumentProperties(undefined)),
    searchKeywords: ['properties', 'document', 'metadata', 'security', 'info', 'password'],
  },
  {
    id: 'tools:sanitize',
    nameKey: 'toolbar:sanitize',
    tooltipKey: 'toolbar:sanitizeTooltip',
    ariaLabelKey: 'toolbar:sanitizeAria',
    icon: null,
    shortcutId: null,
    menu: { top: 'tools' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(openSanitize()),
    searchKeywords: ['sanitize', 'remove hidden', 'metadata', 'scrub', 'clean', 'privacy'],
  },
  {
    id: 'bookmarks:auto-bookmark',
    nameKey: 'toolbar:autoBookmark',
    tooltipKey: 'toolbar:autoBookmarkTooltip',
    ariaLabelKey: 'toolbar:autoBookmarkAria',
    icon: null,
    shortcutId: null,
    menu: { top: 'view' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(openAutoBookmark()),
    searchKeywords: ['bookmark', 'auto', 'heading', 'outline', 'toc', 'generate'],
  },

  // ---- Phase 7.5 Wave 5a (Riley) — C1 Read Aloud + C2 Preflight ----
  // Both are menu + palette only (no toolbar surface in v0.8.0). The L-007
  // ratchet picks them up via the registry; the Find-a-tool palette
  // surfaces them by id so a user typing "read" or "preflight" lands here.
  {
    id: 'view:readAloud',
    nameKey: 'toolbar:readAloud',
    tooltipKey: 'toolbar:readAloudTooltip',
    ariaLabelKey: 'toolbar:readAloudAria',
    icon: null,
    shortcutId: 'read-aloud',
    menu: { top: 'view' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d) => d(openReadAloud()),
    searchKeywords: ['read', 'aloud', 'tts', 'speech', 'speak', 'voice', 'accessibility'],
  },
  {
    id: 'tools:preflight',
    nameKey: 'toolbar:preflight',
    tooltipKey: 'toolbar:preflightTooltip',
    ariaLabelKey: 'toolbar:preflightAria',
    icon: null,
    shortcutId: null,
    menu: { top: 'tools' },
    surfaces: { menu: true, palette: true },
    enabledWhen: docOpen,
    dispatch: (d, s) => {
      d(setSidebarTab('preflight'));
      if (s.ui.sidebarCollapsed) d(toggleSidebar());
    },
    searchKeywords: ['preflight', 'pdfx', 'pdfa', 'compliance', 'validation', 'subset', 'print'],
  },

  // ---- help ----
  {
    id: 'help:help',
    nameKey: 'menu:items.help',
    tooltipKey: 'menu:items.help',
    ariaLabelKey: 'menu:items.help',
    icon: null,
    shortcutId: 'help',
    menu: { top: 'help' },
    surfaces: { menu: true, palette: true },
    enabledWhen: always,
    dispatch: (d) => d(openModal('help')),
    searchKeywords: ['help', 'manual', 'shortcuts'],
  },
  {
    id: 'help:about',
    nameKey: 'menu:items.about',
    tooltipKey: 'menu:items.about',
    ariaLabelKey: 'menu:items.about',
    icon: null,
    shortcutId: null,
    menu: { top: 'help' },
    surfaces: { menu: true, palette: true },
    enabledWhen: always,
    dispatch: (d) => d(openModal('about')),
    searchKeywords: ['about', 'version', 'credits'],
  },
];

// ============================================================================
// Intrinsic shortcuts — viewport / page-nav / app-meta keys that are NOT tools.
// Per docs/tool-registry-spec.md §1.1.
// ============================================================================

export const INTRINSIC_SHORTCUTS: ReadonlySet<ShortcutId> = new Set<ShortcutId>([
  'quit',
  'select-all-pages',
  'zoom-in',
  'zoom-out',
  'zoom-100',
  'fit-width',
  'fit-page',
  'cycle-sidebar-tab',
  'find-a-tool', // Ctrl+/ opens the palette which itself isn't a tool
  'find-next', // F3 — subordinate to the Find bar's open state
  'find-prev',
  'view-rotate-ccw', // CCW rotates by the same tool entry; the binding is intrinsic
  'page-prev',
  'page-next',
  'page-first',
  'page-last',
  'delete', // global clear-selection on Backspace/Del
]);

// ============================================================================
// Helpers — fuzzy match for the Find-a-tool palette (A7).
// ============================================================================

/** Lightweight scoring: prefer substring matches in the resolved name + keywords. */
export function scoreTool(
  query: string,
  resolvedName: string,
  keywords: readonly string[],
): number {
  const q = query.toLowerCase().trim();
  if (q === '') return 0;
  const name = resolvedName.toLowerCase();
  let score = 0;
  if (name.startsWith(q)) score += 100;
  else if (name.includes(q)) score += 60;
  for (const kw of keywords) {
    if (kw.toLowerCase() === q) score += 40;
    else if (kw.toLowerCase().includes(q)) score += 20;
  }
  // Tighter substring proximity bonus.
  if (name.includes(q)) score += Math.max(0, 20 - name.indexOf(q));
  return score;
}
