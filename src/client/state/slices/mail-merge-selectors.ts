// Mail Merge selectors — Phase 3.

import { type RootState } from '../store';

export const selectMailMergeState = (s: RootState) => s.mailMerge;
export const selectMailMergeOpen = (s: RootState): boolean => s.mailMerge.modalOpen;
export const selectMailMergeStep = (s: RootState) => s.mailMerge.step;
export const selectMailMergeData = (s: RootState) => s.mailMerge.data;
export const selectMailMergeMapping = (s: RootState) => s.mailMerge.columnMapping;
export const selectMailMergeOutputMode = (s: RootState) => s.mailMerge.outputMode;
export const selectMailMergeProgress = (s: RootState) => s.mailMerge.progress;
export const selectMailMergeResult = (s: RootState) => s.mailMerge.result;
export const selectMailMergeActiveJobId = (s: RootState) => s.mailMerge.activeJobId;
export const selectMailMergeError = (s: RootState) => s.mailMerge.errorMessage;
export const selectMailMergeTemplateSource = (s: RootState) => s.mailMerge.templateSource;
export const selectMailMergeFlatten = (s: RootState): boolean => s.mailMerge.flattenInOutput;
