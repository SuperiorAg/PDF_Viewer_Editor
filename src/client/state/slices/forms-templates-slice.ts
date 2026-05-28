// Forms templates slice — list cache for `forms:listTemplates`.
// Per docs/architecture-phase-3.md §7 and ui-spec.md §12.3 (Templates dropdown).
//
// This slice holds the LIST of templates (id, name, fieldCount). Full field
// definitions arrive via `forms:loadTemplate` (forms-slice handles applying
// them as form-design-add ops); we do NOT cache fields here to keep the
// list-fetch cheap (api-contracts §13.6).

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { type FormTemplateListItem } from '../../types/ipc-contract';

export interface FormsTemplatesState {
  items: FormTemplateListItem[];
  loading: boolean;
  lastError: string | null;
}

const initialState: FormsTemplatesState = {
  items: [],
  loading: false,
  lastError: null,
};

export const formsTemplatesSlice = createSlice({
  name: 'formsTemplates',
  initialState,
  reducers: {
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setItems(state, action: PayloadAction<FormTemplateListItem[]>) {
      state.items = action.payload;
      state.loading = false;
      state.lastError = null;
    },
    addItem(state, action: PayloadAction<FormTemplateListItem>) {
      // Replace if name conflicts (saveTemplate enforces unique name; this
      // protects against stale cache on rapid save-then-list).
      const i = state.items.findIndex((t) => t.id === action.payload.id);
      if (i >= 0) state.items[i] = action.payload;
      else state.items.unshift(action.payload);
    },
    setError(state, action: PayloadAction<string>) {
      state.lastError = action.payload;
      state.loading = false;
    },
    clearError(state) {
      state.lastError = null;
    },
  },
});

export const { setLoading, setItems, addItem, setError, clearError } = formsTemplatesSlice.actions;

export default formsTemplatesSlice.reducer;
