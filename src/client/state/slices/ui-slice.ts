import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// Phase 5: 'ocr-results' tab joins the existing trio. Tab order is preserved
// (Pages -> Bookmarks -> Forms -> OCR); cycleSidebarTab below extends the
// rotation. Per docs/ui-spec.md §14 amendment.
// Phase 6: 'exports' joins as the 5th tab (Pages -> Bookmarks -> Forms ->
// OCR -> Exports). Per docs/ui-spec.md §15.4.
// Phase 7.5 B7 (Riley Wave 3): 'stamps' joins as the 6th tab — sidebar
// sibling of Bookmarks per docs/ui-spec-phase-7.5.md §7.1.
export type SidebarTab =
  | 'thumbnails'
  | 'bookmarks'
  | 'forms'
  | 'ocr-results'
  | 'exports'
  | 'stamps';
export type ModalKind =
  | 'combine'
  | 'settings'
  | 'confirm-close-unsaved'
  | 'export-engine'
  | 'add-bookmark'
  | 'help'
  | 'image-import'
  // Phase 3
  | 'mail-merge'
  | 'save-template'
  | 'confirm-flatten'
  // Phase 7 — standalone About modal (Help → About). Settings → About tab is
  // distinct (lives inside the settings modal); this is the menu-reachable one.
  | 'about'
  | null;

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
  // Phase 2 may add action buttons. Phase 1: dismissible only.
}

// Phase 2 — image-import modal pre-loaded state. Set by drag-drop handlers
// before the modal opens so it can pre-select overlay mode w/ a derived rect.
export interface ImageImportPreload {
  /** Bytes of the dropped/picked image. Lives ONLY while the modal is open;
   * cleared on submit/cancel. Per conventions §10 NOT stored in any other
   * slice — transient by design. */
  bytes: Uint8Array | null;
  mimeType: 'image/png' | 'image/jpeg' | 'image/tiff' | null;
  fileName: string | null;
  intrinsicWidth: number | null;
  intrinsicHeight: number | null;
  /** Default mode based on drag-drop target. */
  initialMode: 'new-page' | 'overlay';
  /** When initialMode is 'overlay', the rect derived from the drop point. */
  initialOverlayRect: { x: number; y: number; width: number; height: number } | null;
  /** When initialMode is 'overlay', the target page. */
  initialOverlayPageIndex: number | null;
}

// Phase 2 — text-edit overlay state. Renderer-only; main has no equivalent.
// Per ui-spec.md §11.5.
export interface TextEditOverlayState {
  /** True when text-edit mode is toggled on (E key / toolbar). */
  active: boolean;
  /** The currently-resolving identify-span request. */
  identifying: boolean;
  /** The span the user clicked into, populated by pdf:identifyTextSpan. */
  activeSpan: {
    pageIndex: number;
    objectId: string;
    runBoundingRect: { x: number; y: number; width: number; height: number };
    originalText: string;
    font: {
      family: string;
      size: number;
      glyphWidths: Record<number, number>;
      glyphMapSize: number;
    };
  } | null;
  /** Buffer for the in-progress edit. */
  draftText: string;
}

interface UiState {
  sidebarTab: SidebarTab;
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  activeModal: ModalKind;
  toasts: Toast[];
  isLoading: boolean;
  loadingMessage: string;
  // Phase 2:
  imageImport: ImageImportPreload;
  textEdit: TextEditOverlayState;
  bookmarksEditMode: boolean;
  // Phase 7.4 A5 — Shapes sub-toolbar visibility. Mirrors the
  // FormDesignerToolbar pattern: a boolean here drives a sibling sub-toolbar
  // mounted right under the main Toolbar in app.tsx. Toggled by the main
  // toolbar's Shapes button; closed by Esc while focus is inside the
  // sub-toolbar. The active shape tool itself lives in the shapes slice
  // (shapes.activeTool) — this flag only controls visibility of the picker.
  shapesPanelOpen: boolean;
  // Phase 7.4 B1 — Redaction sub-toolbar visibility. Same shape + mount
  // discipline as `shapesPanelOpen`; the active redaction tool itself lives
  // in the redactions slice (redactions.activeTool). The Apply confirmation
  // dialog has its own flag below (redactionApplyModalOpen) so it can compose
  // with other modals — the Apply modal is `role="alertdialog"` and the body
  // copy is too important to truncate through `window.confirm`.
  redactionPanelOpen: boolean;
  /** Phase 7.4 B1 — Apply-confirmation modal open flag. Independent of activeModal. */
  redactionApplyModalOpen: boolean;
  /** Phase 7.5 B3 — Find bar visibility. Opened by Ctrl+F; closed by Esc/×. */
  findBarOpen: boolean;
  /** Phase 7.5 A7 — Find-a-tool palette visibility. Opened by Ctrl+/. */
  findAToolOpen: boolean;
  /** Phase 7.5 B15 — Page display mode (single-page-continuous default). */
  pageDisplayMode: 'single-page-continuous' | 'two-up-continuous' | 'single-page' | 'two-up';
  /** Phase 7.5 B16 — View-only rotation in 90° increments. Renderer-only CSS;
   * does NOT mutate the PDF (distinct from page rotation in document-slice). */
  viewRotation: 0 | 90 | 180 | 270;
  /** Phase 7.5 B16 — True Read Mode hides toolbar / sidebar / inspector /
   * status bar. F11 enters; Esc exits. Per-session only. */
  readMode: boolean;
}

const initialState: UiState = {
  sidebarTab: 'thumbnails',
  sidebarCollapsed: false,
  inspectorCollapsed: true,
  activeModal: null,
  toasts: [],
  isLoading: false,
  loadingMessage: '',
  imageImport: {
    bytes: null,
    mimeType: null,
    fileName: null,
    intrinsicWidth: null,
    intrinsicHeight: null,
    initialMode: 'new-page',
    initialOverlayRect: null,
    initialOverlayPageIndex: null,
  },
  textEdit: {
    active: false,
    identifying: false,
    activeSpan: null,
    draftText: '',
  },
  bookmarksEditMode: false,
  shapesPanelOpen: false,
  redactionPanelOpen: false,
  redactionApplyModalOpen: false,
  findBarOpen: false,
  findAToolOpen: false,
  pageDisplayMode: 'single-page-continuous',
  viewRotation: 0,
  readMode: false,
};

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setSidebarTab(state, action: PayloadAction<SidebarTab>) {
      state.sidebarTab = action.payload;
    },
    cycleSidebarTab(state) {
      // Phase 7.5 B7 (Riley Wave 3): rotate Thumbnails -> Bookmarks -> Forms ->
      // OCR results -> Exports -> Stamps -> Thumbnails. Order matches sidebar
      // tab visual order (ui-spec §15.4 + ui-spec-phase-7.5 §7.1).
      const next: Record<SidebarTab, SidebarTab> = {
        thumbnails: 'bookmarks',
        bookmarks: 'forms',
        forms: 'ocr-results',
        'ocr-results': 'exports',
        exports: 'stamps',
        stamps: 'thumbnails',
      };
      state.sidebarTab = next[state.sidebarTab];
    },
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    toggleInspector(state) {
      state.inspectorCollapsed = !state.inspectorCollapsed;
    },
    openModal(state, action: PayloadAction<ModalKind>) {
      state.activeModal = action.payload;
    },
    closeModal(state) {
      state.activeModal = null;
    },
    pushToast(state, action: PayloadAction<Omit<Toast, 'id'>>) {
      state.toasts.push({
        id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...action.payload,
      });
    },
    dismissToast(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
    setLoading(state, action: PayloadAction<{ loading: boolean; message?: string }>) {
      state.isLoading = action.payload.loading;
      state.loadingMessage = action.payload.message ?? '';
    },
    // Phase 2 — image-import modal preload.
    setImageImportPreload(state, action: PayloadAction<Partial<ImageImportPreload>>) {
      // Immer-friendly assignment of all writable fields. PayloadAction with
      // Uint8Array is non-serializable; store.ts adds 'payload.bytes' to the
      // serializableCheck ignored paths (already present per Phase 1 — bytes
      // routinely transit through save thunks).
      Object.assign(state.imageImport, action.payload);
    },
    clearImageImportPreload(state) {
      state.imageImport.bytes = null;
      state.imageImport.mimeType = null;
      state.imageImport.fileName = null;
      state.imageImport.intrinsicWidth = null;
      state.imageImport.intrinsicHeight = null;
      state.imageImport.initialMode = 'new-page';
      state.imageImport.initialOverlayRect = null;
      state.imageImport.initialOverlayPageIndex = null;
    },
    // Phase 2 — text-edit overlay mode toggle.
    setTextEditMode(state, action: PayloadAction<boolean>) {
      state.textEdit.active = action.payload;
      if (!action.payload) {
        state.textEdit.activeSpan = null;
        state.textEdit.draftText = '';
        state.textEdit.identifying = false;
      }
    },
    setTextEditIdentifying(state, action: PayloadAction<boolean>) {
      state.textEdit.identifying = action.payload;
    },
    setTextEditActiveSpan(state, action: PayloadAction<TextEditOverlayState['activeSpan']>) {
      state.textEdit.activeSpan = action.payload;
      state.textEdit.draftText = action.payload?.originalText ?? '';
      state.textEdit.identifying = false;
    },
    setTextEditDraft(state, action: PayloadAction<string>) {
      state.textEdit.draftText = action.payload;
    },
    clearTextEditActiveSpan(state) {
      state.textEdit.activeSpan = null;
      state.textEdit.draftText = '';
      state.textEdit.identifying = false;
    },
    // Phase 2 — bookmarks panel edit-mode toggle.
    setBookmarksEditMode(state, action: PayloadAction<boolean>) {
      state.bookmarksEditMode = action.payload;
    },
    toggleBookmarksEditMode(state) {
      state.bookmarksEditMode = !state.bookmarksEditMode;
    },
    // Phase 7.4 A5 — Shapes sub-toolbar visibility actions. Mirror the
    // bookmarksEditMode pair above (toggle + explicit set) so the main toolbar
    // can flip the panel and the panel itself can close on Esc.
    toggleShapesPanel(state) {
      state.shapesPanelOpen = !state.shapesPanelOpen;
    },
    setShapesPanelOpen(state, action: PayloadAction<boolean>) {
      state.shapesPanelOpen = action.payload;
    },
    // Phase 7.4 B1 — Redaction sub-toolbar visibility actions. Mirror the
    // shapesPanelOpen pair above. Opening also disarms the active tool when
    // the panel reopens — handled in the redactions slice via the redact-tool
    // dispatcher on the toolbar button click, NOT here. Keep this slice
    // strictly UI-visibility.
    toggleRedactionPanel(state) {
      state.redactionPanelOpen = !state.redactionPanelOpen;
    },
    setRedactionPanelOpen(state, action: PayloadAction<boolean>) {
      state.redactionPanelOpen = action.payload;
    },
    setRedactionApplyModalOpen(state, action: PayloadAction<boolean>) {
      state.redactionApplyModalOpen = action.payload;
    },
    // Phase 7.5 B3 — Find bar open/close.
    setFindBarOpen(state, action: PayloadAction<boolean>) {
      state.findBarOpen = action.payload;
    },
    toggleFindBar(state) {
      state.findBarOpen = !state.findBarOpen;
    },
    // Phase 7.5 A7 — Find-a-tool palette open/close.
    setFindAToolOpen(state, action: PayloadAction<boolean>) {
      state.findAToolOpen = action.payload;
    },
    // Phase 7.5 B15 — Page display mode.
    setPageDisplayMode(state, action: PayloadAction<UiState['pageDisplayMode']>) {
      state.pageDisplayMode = action.payload;
    },
    // Phase 7.5 B16 — View-only rotation. 0/90/180/270 only.
    setViewRotation(state, action: PayloadAction<UiState['viewRotation']>) {
      state.viewRotation = action.payload;
    },
    rotateViewCw(state) {
      const next = ((state.viewRotation + 90) % 360) as UiState['viewRotation'];
      state.viewRotation = next;
    },
    rotateViewCcw(state) {
      const next = ((state.viewRotation + 270) % 360) as UiState['viewRotation'];
      state.viewRotation = next;
    },
    // Phase 7.5 B16 — Read Mode (chromeless).
    setReadMode(state, action: PayloadAction<boolean>) {
      state.readMode = action.payload;
    },
    toggleReadMode(state) {
      state.readMode = !state.readMode;
    },
  },
});

export const {
  setSidebarTab,
  cycleSidebarTab,
  toggleSidebar,
  toggleInspector,
  openModal,
  closeModal,
  pushToast,
  dismissToast,
  setLoading,
  // Phase 2
  setImageImportPreload,
  clearImageImportPreload,
  setTextEditMode,
  setTextEditIdentifying,
  setTextEditActiveSpan,
  setTextEditDraft,
  clearTextEditActiveSpan,
  setBookmarksEditMode,
  toggleBookmarksEditMode,
  toggleShapesPanel,
  setShapesPanelOpen,
  // Phase 7.4 B1
  toggleRedactionPanel,
  setRedactionPanelOpen,
  setRedactionApplyModalOpen,
  // Phase 7.5
  setFindBarOpen,
  toggleFindBar,
  setFindAToolOpen,
  setPageDisplayMode,
  setViewRotation,
  rotateViewCw,
  rotateViewCcw,
  setReadMode,
  toggleReadMode,
} = uiSlice.actions;

// Phase 2 — image-import modal convenience action creators.
export const openImageImportModal = (): PayloadAction<ModalKind> => openModal('image-import');
export const closeImageImportModal = (): ReturnType<typeof closeModal> => closeModal();

// Help modal convenience action creators — thin wrappers over openModal/closeModal
// so consumers can dispatch by intent name. The underlying state lives in
// activeModal ('help' kind) per the single-modal-at-a-time pattern used by every
// other modal (combine, settings, export-engine, etc.). See Phase 1.1 R-1.1.
export const openHelpModal = (): PayloadAction<ModalKind> => openModal('help');
export const closeHelpModal = (): ReturnType<typeof closeModal> => closeModal();

export default uiSlice.reducer;
