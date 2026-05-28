import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { type RgbColor } from '../../types/ipc-contract';

// Phase 2 expands the tool union with subtypes activated per data-models.md §7.7
// (Underline, StrikeOut, Ink). 'shapes' remains Phase 4.
export type AnnotationTool =
  | 'cursor'
  | 'highlight'
  | 'sticky'
  | 'text'
  | 'underline'
  | 'strikeout'
  | 'ink';

interface DraftAnnotation {
  tool: AnnotationTool;
  pageIndex: number;
  // Screen-space rect being authored (in CSS pixels, top-left origin).
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface AnnotationsState {
  activeTool: AnnotationTool;
  selectedAnnotationId: string | null;
  draft: DraftAnnotation | null;
  defaults: {
    color: RgbColor;
    opacity: number;
    fontSize: number;
    fontFamily: string;
  };
}

const initialState: AnnotationsState = {
  activeTool: 'cursor',
  selectedAnnotationId: null,
  draft: null,
  defaults: {
    color: { r: 1.0, g: 0.92, b: 0.23 }, // yellow #FFEB3B
    opacity: 0.5,
    fontSize: 12,
    fontFamily: 'Helvetica',
  },
};

export const annotationsSlice = createSlice({
  name: 'annotations',
  initialState,
  reducers: {
    setActiveTool(state, action: PayloadAction<AnnotationTool>) {
      state.activeTool = action.payload;
      state.selectedAnnotationId = null;
      state.draft = null;
    },
    selectAnnotation(state, action: PayloadAction<string | null>) {
      state.selectedAnnotationId = action.payload;
    },
    beginDraft(state, action: PayloadAction<{ pageIndex: number; x: number; y: number }>) {
      state.draft = {
        tool: state.activeTool,
        pageIndex: action.payload.pageIndex,
        startX: action.payload.x,
        startY: action.payload.y,
        currentX: action.payload.x,
        currentY: action.payload.y,
      };
    },
    updateDraft(state, action: PayloadAction<{ x: number; y: number }>) {
      if (state.draft) {
        state.draft.currentX = action.payload.x;
        state.draft.currentY = action.payload.y;
      }
    },
    cancelDraft(state) {
      state.draft = null;
    },
    setDefaultColor(state, action: PayloadAction<RgbColor>) {
      state.defaults.color = action.payload;
    },
    setDefaultOpacity(state, action: PayloadAction<number>) {
      state.defaults.opacity = Math.max(0, Math.min(1, action.payload));
    },
  },
});

export const {
  setActiveTool,
  selectAnnotation,
  beginDraft,
  updateDraft,
  cancelDraft,
  setDefaultColor,
  setDefaultOpacity,
} = annotationsSlice.actions;

export default annotationsSlice.reducer;
