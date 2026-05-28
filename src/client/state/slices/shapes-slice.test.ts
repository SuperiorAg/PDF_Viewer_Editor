// Shapes slice tests — Phase 4.
// Per docs/architecture-phase-4.md §5 + ui-spec §13.1.

import { describe, expect, it } from 'vitest';

import shapesReducer, {
  addDraftVertex,
  beginShapeDraft,
  cancelShapeDraft,
  setActiveShapeTool,
  setShapeDefaults,
  shapeToolToSubtype,
  updateShapeDraft,
} from './shapes-slice';

const INITIAL = shapesReducer(undefined, { type: '@@INIT' });

describe('shapesSlice', () => {
  it('initial state has cursor tool, no draft', () => {
    expect(INITIAL.activeTool).toBe('cursor');
    expect(INITIAL.draft).toBeNull();
  });

  it('setActiveShapeTool sets tool + clears draft + selection', () => {
    const s = shapesReducer(INITIAL, setActiveShapeTool('square'));
    expect(s.activeTool).toBe('square');
    expect(s.draft).toBeNull();
  });

  it('beginShapeDraft is a no-op when cursor is active', () => {
    const s = shapesReducer(INITIAL, beginShapeDraft({ pageIndex: 0, x: 10, y: 20 }));
    expect(s.draft).toBeNull();
  });

  it('beginShapeDraft initializes draft for a non-cursor tool', () => {
    let s = shapesReducer(INITIAL, setActiveShapeTool('square'));
    s = shapesReducer(s, beginShapeDraft({ pageIndex: 2, x: 50, y: 60 }));
    expect(s.draft).not.toBeNull();
    expect(s.draft?.pageIndex).toBe(2);
    expect(s.draft?.tool).toBe('square');
    expect(s.draft?.startX).toBe(50);
    expect(s.draft?.startY).toBe(60);
  });

  it('beginShapeDraft seeds vertices for polygon', () => {
    let s = shapesReducer(INITIAL, setActiveShapeTool('polygon'));
    s = shapesReducer(s, beginShapeDraft({ pageIndex: 0, x: 1, y: 2 }));
    expect(s.draft?.vertices).toEqual([1, 2]);
  });

  it('updateShapeDraft updates currentX/Y', () => {
    let s = shapesReducer(INITIAL, setActiveShapeTool('line'));
    s = shapesReducer(s, beginShapeDraft({ pageIndex: 0, x: 0, y: 0 }));
    s = shapesReducer(s, updateShapeDraft({ x: 100, y: 200 }));
    expect(s.draft?.currentX).toBe(100);
    expect(s.draft?.currentY).toBe(200);
  });

  it('addDraftVertex appends to vertices', () => {
    let s = shapesReducer(INITIAL, setActiveShapeTool('polygon'));
    s = shapesReducer(s, beginShapeDraft({ pageIndex: 0, x: 0, y: 0 }));
    s = shapesReducer(s, addDraftVertex({ x: 10, y: 20 }));
    s = shapesReducer(s, addDraftVertex({ x: 30, y: 40 }));
    expect(s.draft?.vertices).toEqual([0, 0, 10, 20, 30, 40]);
  });

  it('cancelShapeDraft clears the draft', () => {
    let s = shapesReducer(INITIAL, setActiveShapeTool('square'));
    s = shapesReducer(s, beginShapeDraft({ pageIndex: 0, x: 0, y: 0 }));
    s = shapesReducer(s, cancelShapeDraft());
    expect(s.draft).toBeNull();
  });

  it('setShapeDefaults merges partial defaults', () => {
    const s = shapesReducer(INITIAL, setShapeDefaults({ borderWidth: 4 }));
    expect(s.defaults.borderWidth).toBe(4);
    expect(s.defaults.opacity).toBe(1.0); // unchanged
  });
});

describe('shapeToolToSubtype', () => {
  it('maps every tool to a ShapeAnnotationSubtype (or null for cursor)', () => {
    expect(shapeToolToSubtype('cursor')).toBeNull();
    expect(shapeToolToSubtype('square')).toBe('Square');
    expect(shapeToolToSubtype('circle')).toBe('Circle');
    expect(shapeToolToSubtype('polygon')).toBe('Polygon');
    expect(shapeToolToSubtype('line')).toBe('Line');
    expect(shapeToolToSubtype('arrow')).toBe('Line');
    expect(shapeToolToSubtype('callout')).toBe('FreeTextCallout');
    expect(shapeToolToSubtype('line-measure')).toBe('Line');
    expect(shapeToolToSubtype('polyline-measure')).toBe('PolyLine');
  });
});
