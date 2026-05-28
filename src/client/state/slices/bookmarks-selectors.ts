import { type RootState } from '../store';

export const selectUserBookmarks = (s: RootState) => s.bookmarks.userBookmarks;
export const selectBookmarksTree = (s: RootState) => s.bookmarks.tree;
export const selectPdfOutline = (s: RootState) => s.bookmarks.pdfOutline;
export const selectBookmarksLoaded = (s: RootState) => s.bookmarks.loaded;
export const selectBookmarksExpandedIds = (s: RootState) => s.bookmarks.expandedIds;
export const selectBookmarkExpanded = (s: RootState, id: number): boolean =>
  s.bookmarks.expandedIds[id] !== false; // default expanded
