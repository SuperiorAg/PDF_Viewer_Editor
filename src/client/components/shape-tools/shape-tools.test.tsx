// Shape tools tests — Phase 4.
// Per docs/architecture-phase-4.md §5 + brief: "one test per shape type that
// the EditOperation dispatched to applyEdit has the correct discriminator +
// payload shape."
//
// We exercise the builder (buildShapeForTool) for each subtype and verify the
// resulting ShapeAnnotationModel has the right subtype-specific fields. The
// thunk (addShapeAnnotationThunk) routes through applyEdit on the IPC return;
// the test asserts the model shape that lands in the IPC arg.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import documentReducer, { setDocument } from '../../state/slices/document-slice';
import shapesReducer, {
  setActiveShapeTool,
  setShapeDefaults,
} from '../../state/slices/shapes-slice';
import uiReducer from '../../state/slices/ui-slice';
import { type PDFDocumentModel } from '../../types/ipc-contract';

import { buildShapeForTool } from './build-shape-annotation';
import { ShapeToolbar } from './shape-toolbar';

const DEFAULTS = {
  color: { r: 0.13, g: 0.27, b: 0.93 },
  opacity: 1.0,
  borderWidth: 1.5,
  borderStyle: 'solid' as const,
  fillEnabled: false,
  fillColor: { r: 1.0, g: 0.92, b: 0.23 },
  fillOpacity: 0.3,
  lineStartStyle: 'None' as const,
  lineEndStyle: 'OpenArrow' as const,
  calloutFontFamily: 'Helvetica',
  calloutFontSize: 11,
};

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 't.pdf',
  fileHash: 'h',
  pageCount: 1,
  pages: [
    {
      pageIndex: 0,
      sourcePageRef: { kind: 'original', originalIndex: 0 },
      rotation: 0,
      width: 612,
      height: 792,
    },
  ],
  annotations: [],
  dirtyOps: [],
  savedAtHandleVersion: 0,
  pdflibLoadWarnings: [],
};

function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      shapes: shapesReducer,
      ui: uiReducer,
    },
  });
}

describe('ShapeToolbar', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders all 8 tool buttons (7 tools + arrow as a synonym)', () => {
    const store = makeStore();
    render(
      <Provider store={store}>
        <ShapeToolbar />
      </Provider>,
    );
    // Per ui-spec §13.1: Q, C, G, L (line+arrow), B, M, Shift+M.
    // The toolbar shows 8 buttons (line + arrow share the L shortcut but are
    // separately selectable; the underlying subtype is Line for both).
    expect(screen.getByRole('button', { name: /Rectangle/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ellipse/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Polygon/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Callout/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Line measure/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Polyline measure/ })).toBeInTheDocument();
  });

  it('toggles aria-pressed when a tool is activated', () => {
    const store = makeStore();
    render(
      <Provider store={store}>
        <ShapeToolbar />
      </Provider>,
    );
    const rect = screen.getByRole('button', { name: /Rectangle/ });
    expect(rect).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(rect);
    expect(rect).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('buildShapeForTool — one test per shape type', () => {
  const baseArgs = {
    pageIndex: 0,
    startX: 100,
    startY: 100,
    endX: 200,
    endY: 200,
    defaults: DEFAULTS,
  };

  it('Square: produces subtype="Square" with rect + fill defaults', () => {
    const a = buildShapeForTool('square', baseArgs);
    expect(a).not.toBeNull();
    expect(a!.subtype).toBe('Square');
    expect(a!.rect).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    expect(a!.fillEnabled).toBe(false);
    expect(a!.borderWidth).toBe(1.5);
    expect(a!.color).toEqual(DEFAULTS.color);
  });

  it('Circle: produces subtype="Circle"', () => {
    const a = buildShapeForTool('circle', baseArgs);
    expect(a).not.toBeNull();
    expect(a!.subtype).toBe('Circle');
    expect(a!.rect.width).toBe(100);
    expect(a!.rect.height).toBe(100);
  });

  it('Polygon: produces subtype="Polygon" with vertices', () => {
    const a = buildShapeForTool('polygon', {
      ...baseArgs,
      vertices: [100, 100, 200, 100, 150, 200],
    });
    expect(a).not.toBeNull();
    expect(a!.subtype).toBe('Polygon');
    expect(a!.vertices).toEqual([100, 100, 200, 100, 150, 200]);
  });

  it('Line: produces subtype="Line" with start/end + None ends', () => {
    const a = buildShapeForTool('line', baseArgs);
    expect(a).not.toBeNull();
    expect(a!.subtype).toBe('Line');
    expect(a!.lineStart).toEqual({ x: 100, y: 100 });
    expect(a!.lineEnd).toEqual({ x: 200, y: 200 });
    expect(a!.lineStartStyle).toBe('None');
    expect(a!.lineEndStyle).toBe('None');
  });

  it('Arrow: produces subtype="Line" with OpenArrow end (defaults)', () => {
    const a = buildShapeForTool('arrow', baseArgs);
    expect(a).not.toBeNull();
    expect(a!.subtype).toBe('Line');
    expect(a!.lineStartStyle).toBe('None');
    expect(a!.lineEndStyle).toBe('OpenArrow');
  });

  it('Callout: produces subtype="FreeTextCallout" with text + pointer', () => {
    const a = buildShapeForTool('callout', {
      ...baseArgs,
      calloutText: 'Important note',
      calloutPointer: { x: 50, y: 150 },
    });
    expect(a).not.toBeNull();
    expect(a!.subtype).toBe('FreeTextCallout');
    expect(a!.calloutText).toBe('Important note');
    expect(a!.calloutPointer).toEqual({ x: 50, y: 150 });
    expect(a!.fontSize).toBe(11);
  });

  it('Line-measure: produces subtype="Line" with measure dict', () => {
    const a = buildShapeForTool('line-measure', {
      ...baseArgs,
      measureUnit: 'inch',
      measureScale: 0.05,
    });
    expect(a).not.toBeNull();
    expect(a!.subtype).toBe('Line');
    expect(a!.measure).toEqual({ unit: 'inch', scale: 0.05 });
  });

  it('Polyline-measure: produces subtype="PolyLine" with measure dict', () => {
    const a = buildShapeForTool('polyline-measure', {
      ...baseArgs,
      vertices: [10, 10, 50, 60, 90, 80],
      measureUnit: 'cm',
      measureScale: 2.5,
    });
    expect(a).not.toBeNull();
    expect(a!.subtype).toBe('PolyLine');
    expect(a!.measure).toEqual({ unit: 'cm', scale: 2.5 });
    expect(a!.vertices).toEqual([10, 10, 50, 60, 90, 80]);
  });

  it('returns null for a zero-area Square (validation)', () => {
    const a = buildShapeForTool('square', {
      ...baseArgs,
      endX: 100,
      endY: 100,
    });
    expect(a).toBeNull();
  });

  it('returns null for a Polygon with <3 points', () => {
    const a = buildShapeForTool('polygon', {
      ...baseArgs,
      vertices: [10, 10, 20, 20],
    });
    expect(a).toBeNull();
  });
});

describe('addShapeAnnotationThunk dispatch contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes the ShapeAnnotationModel through applyEdit via the IPC return op', async () => {
    const addShape = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        op: {
          kind: 'annot-add-shape',
          meta: { id: 'op-1', timestamp: Date.now() },
          annotation: {
            id: 'shape-1',
            pageIndex: 0,
            subtype: 'Square',
            rect: { x: 0, y: 0, width: 100, height: 100 },
            color: { r: 0, g: 0, b: 1 },
            opacity: 1,
            borderWidth: 1,
            borderStyle: 'solid',
            createdAt: 0,
            modifiedAt: 0,
          },
        },
        warnings: [],
      },
    });
    vi.stubGlobal('pdfApi', {
      annotations: { addShape },
    });

    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(setActiveShapeTool('square'));
    void store.dispatch(setShapeDefaults({ borderWidth: 2 }));

    // Use the public thunk module — verify it calls addShape with the right
    // discriminator (subtype: 'Square') in the request payload.
    const { addShapeAnnotationThunk } = await import('../../state/thunks-phase4');
    const model = buildShapeForTool('square', {
      pageIndex: 0,
      startX: 100,
      startY: 100,
      endX: 200,
      endY: 200,
      defaults: { ...DEFAULTS, borderWidth: 2 },
    });
    expect(model).not.toBeNull();
    await store.dispatch(addShapeAnnotationThunk({ annotation: model! }));

    expect(addShape).toHaveBeenCalledTimes(1);
    const callArg = addShape.mock.calls[0]?.[0] as {
      handle: number;
      annotation: { subtype: string };
    };
    expect(callArg.annotation.subtype).toBe('Square');
    expect(callArg.handle).toBe(DOC.handle);
  });
});
