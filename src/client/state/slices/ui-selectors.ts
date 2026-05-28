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
export const selectToasts = (s: RootState) => s.ui.toasts;
export const selectIsLoading = (s: RootState) => s.ui.isLoading;
export const selectLoadingMessage = (s: RootState) => s.ui.loadingMessage;
