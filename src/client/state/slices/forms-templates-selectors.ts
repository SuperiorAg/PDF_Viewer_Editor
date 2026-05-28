// Forms templates selectors — Phase 3.

import { type RootState } from '../store';

export const selectFormsTemplates = (s: RootState) => s.formsTemplates.items;
export const selectFormsTemplatesLoading = (s: RootState): boolean => s.formsTemplates.loading;
export const selectFormsTemplatesError = (s: RootState) => s.formsTemplates.lastError;
