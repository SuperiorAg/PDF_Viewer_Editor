import { type RootState } from '../store';

export const selectActiveTool = (s: RootState) => s.annotations.activeTool;
export const selectSelectedAnnotationId = (s: RootState) => s.annotations.selectedAnnotationId;
export const selectDraftAnnotation = (s: RootState) => s.annotations.draft;
export const selectAnnotationDefaults = (s: RootState) => s.annotations.defaults;
