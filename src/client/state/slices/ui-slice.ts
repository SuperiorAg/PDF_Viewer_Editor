import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// Phase 5: 'ocr-results' tab joins the existing trio. Tab order is preserved
// (Pages -> Bookmarks -> Forms -> OCR); cycleSidebarTab below extends the
// rotation. Per docs/ui-spec.md §14 amendment.
// Phase 6: 'exports' joins as the 5th tab (Pages -> Bookmarks -> Forms ->
// OCR -> Exports). Per docs/ui-spec.md §15.4.
export type SidebarTab = 'thumbnails' | 'bookmarks' | 'forms' | 'ocr-results' | 'exports';
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
};

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setSidebarTab(state, action: PayloadAction<SidebarTab>) {
      state.sidebarTab = action.payload;
    },
    cycleSidebarTab(state) {
      // Phase 6 (was Phase 5): rotate Thumbnails -> Bookmarks -> Forms ->
      // OCR results -> Exports -> Thumbnails. Order matches sidebar tab
      // visual order (ui-spec §15.4).
      const next: Record<SidebarTab, SidebarTab> = {
        thumbnails: 'bookmarks',
        bookmarks: 'forms',
        forms: 'ocr-results',
        'ocr-results': 'exports',
        exports: 'thumbnails',
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
