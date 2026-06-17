import { type RootState } from '../store';

export const selectSidebarTab = (s: RootState) => s.ui.sidebarTab;
export const selectSidebarCollapsed = (s: RootState) => s.ui.sidebarCollapsed;
export const selectInspectorCollapsed = (s: RootState) => s.ui.inspectorCollapsed;
export const selectActiveModal = (s: RootState) => s.ui.activeModal;
export const selectHelpModalOpen = (s: RootState): boolean => s.ui.activeModal === 'help';
export const selectImageImportModalOpen = (s: RootState): boolean =>
  s.ui.activeModal === 'image-import';
export const selectImageImportPreload = (s: RootState) => s.ui.imageImport;
export const selectTextEditMode = (s: RootState): boolean => s.ui.textEdit.active;
export const selectTextEditState = (s: RootState) => s.ui.textEdit;
export const selectBookmarksEditMode = (s: RootState): boolean => s.ui.bookmarksEditMode;
// Phase 7.4 A5 — Shapes sub-toolbar visibility. Drives the Shapes button's
// `active` state in the main Toolbar and the conditional render of the
// ShapeToolbar sub-toolbar in app.tsx.
export const selectShapesPanelOpen = (s: RootState): boolean => s.ui.shapesPanelOpen;
// Phase 7.4 B1 — Redaction sub-toolbar visibility. Same shape as shapes.
export const selectRedactionPanelOpen = (s: RootState): boolean => s.ui.redactionPanelOpen;
export const selectRedactionApplyModalOpen = (s: RootState): boolean =>
  s.ui.redactionApplyModalOpen;
export const selectToasts = (s: RootState) => s.ui.toasts;
export const selectIsLoading = (s: RootState) => s.ui.isLoading;
export const selectLoadingMessage = (s: RootState) => s.ui.loadingMessage;
// Phase 7.5 B3 — Find bar visibility.
export const selectFindBarOpen = (s: RootState): boolean => s.ui.findBarOpen;
// Phase 7.5 A7 — Find-a-tool palette visibility.
export const selectFindAToolOpen = (s: RootState): boolean => s.ui.findAToolOpen;
// Phase 7.5 B15 — Page display mode.
export const selectPageDisplayMode = (s: RootState) => s.ui.pageDisplayMode;
// Phase 7.5 B16 — View-only rotation (renderer CSS only).
export const selectViewRotation = (s: RootState) => s.ui.viewRotation;
// Phase 7.5 B16 — Read Mode (chromeless).
export const selectReadMode = (s: RootState): boolean => s.ui.readMode;
