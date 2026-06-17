// Shapes slice — Phase 4 live shape-draw state for the 7 new annotation tools.
// Per docs/architecture-phase-4.md §5 and docs/ui-spec.md §13.1/§13.6.
//
// This slice is purely transient (the in-progress draft). The persistent
// ShapeAnnotationModel for a finished shape rides through `applyEdit` as a
// new EditOperation variant (`annot-add-shape`); the slice does NOT mirror
// the persistent annotation list (that's the document slice).
//
// Per conventions §13 (and Wave 12 lesson): the slice does NOT import from
// selectors modules. Small comparators are local.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  type LineEndStyle,
  type RgbColor,
  type ShapeAnnotationSubtype,
} from '../../types/ipc-contract';

export type ShapeTool =
  | 'cursor'
  | 'square'
  | 'circle'
  | 'polygon'
  | 'line'
  | 'arrow'
  | 'callout'
  | 'line-measure'
  | 'polyline-measure'
  // Phase 7.5 B17 (Riley Wave 3) — closed-polygon area measure tool.
  // Vertex collection mirrors `polyline-measure`; on close (double-click /
  // Enter) the build-shape helper emits a Polygon annotation with a
  // measure block + computed area in calibrated units.
  | 'area-measure';

/** Map a ShapeTool to the underlying ShapeAnnotationSubtype. */
export function shapeToolToSubtype(tool: ShapeTool): ShapeAnnotationSubtype | null {
  switch (tool) {
    case 'cursor':
      return null;
    case 'square':
      return 'Square';
    case 'circle':
      return 'Circle';
    case 'polygon':
      return 'Polygon';
    case 'line':
    case 'arrow':
    case 'line-measure':
      return 'Line';
    case 'callout':
      return 'FreeTextCallout';
    case 'polyline-measure':
      return 'PolyLine';
    // Phase 7.5 B17 — closed-polygon area measure renders as a Polygon
    // (closed shape) carrying a measure block.
    case 'area-measure':
      return 'Polygon';
  }
}

export interface DraftShape {
  /** Page being drawn on. */
  pageIndex: number;
  /** Live tool that started the draft. */
  tool: ShapeTool;
  /** Click-down position in PDF user-space. */
  startX: number;
  startY: number;
  /** Pointer position. */
  currentX: number;
  currentY: number;
  /** For polygon / polyline / measure-polyline — accumulated vertices. */
  vertices?: number[];
}

export interface ShapeDefaults {
  color: RgbColor;
  opacity: number;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed' | 'dotted';
  fillEnabled: boolean;
  fillColor: RgbColor;
  fillOpacity: number;
  lineStartStyle: LineEndStyle;
  lineEndStyle: LineEndStyle;
  calloutFontFamily: string;
  calloutFontSize: number;
}

export interface ShapesState {
  activeTool: ShapeTool;
  draft: DraftShape | null;
  defaults: ShapeDefaults;
  /** Selected shape annotation by id (when cursor tool is active). */
  selectedShapeId: string | null;
}

const initialState: ShapesState = {
  activeTool: 'cursor',
  draft: null,
  defaults: {
    color: { r: 0.13, g: 0.27, b: 0.93 }, // material blue
    opacity: 1.0,
    borderWidth: 1,
    borderStyle: 'solid',
    fillEnabled: false,
    fillColor: { r: 1.0, g: 0.92, b: 0.23 }, // yellow
    fillOpacity: 0.3,
    lineStartStyle: 'None',
    lineEndStyle: 'OpenArrow',
    calloutFontFamily: 'Helvetica',
    calloutFontSize: 11,
  },
  selectedShapeId: null,
};

export const shapesSlice = createSlice({
  name: 'shapes',
  initialState,
  reducers: {
    setActiveShapeTool(state, action: PayloadAction<ShapeTool>) {
      state.activeTool = action.payload;
      state.draft = null;
      state.selectedShapeId = null;
    },
    beginShapeDraft(state, action: PayloadAction<{ pageIndex: number; x: number; y: number }>) {
      if (state.activeTool === 'cursor') return;
      // Phase 7.5 B17 — `area-measure` collects vertices like polygon /
      // polyline-measure.
      const useVertices =
        state.activeTool === 'polygon' ||
        state.activeTool === 'polyline-measure' ||
        state.activeTool === 'area-measure';
      const draft: DraftShape = {
        pageIndex: action.payload.pageIndex,
        tool: state.activeTool,
        startX: action.payload.x,
        startY: action.payload.y,
        currentX: action.payload.x,
        currentY: action.payload.y,
      };
      if (useVertices) {
        draft.vertices = [action.payload.x, action.payload.y];
      }
      state.draft = draft;
    },
    updateShapeDraft(state, action: PayloadAction<{ x: number; y: number }>) {
      if (state.draft) {
        state.draft.currentX = action.payload.x;
        state.draft.currentY = action.payload.y;
      }
    },
    addDraftVertex(state, action: PayloadAction<{ x: number; y: number }>) {
      if (!state.draft) return;
      if (!state.draft.vertices) state.draft.vertices = [];
      state.draft.vertices.push(action.payload.x, action.payload.y);
    },
    cancelShapeDraft(state) {
      state.draft = null;
    },
    selectShape(state, action: PayloadAction<string | null>) {
      state.selectedShapeId = action.payload;
    },
    setShapeDefaults(state, action: PayloadAction<Partial<ShapeDefaults>>) {
      state.defaults = { ...state.defaults, ...action.payload };
    },
    resetShapes() {
      return initialState;
    },
  },
});

export const {
  setActiveShapeTool,
  beginShapeDraft,
  updateShapeDraft,
  addDraftVertex,
  cancelShapeDraft,
  selectShape,
  setShapeDefaults,
  resetShapes,
} = shapesSlice.actions;

export default shapesSlice.reducer;
