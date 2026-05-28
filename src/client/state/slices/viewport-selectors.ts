import { type RootState } from '../store';

export const selectZoom = (s: RootState) => s.viewport.zoom;
export const selectFitMode = (s: RootState) => s.viewport.fitMode;
export const selectCurrentPage = (s: RootState) => s.viewport.currentPage;
export const selectScrollTop = (s: RootState) => s.viewport.scrollTop;
