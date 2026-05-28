// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { ShapeAnnotationModel } from '../contracts.js';

import { handleAnnotationsAddShape } from './annotations-add-shape.js';

function baseModel(overrides: Partial<ShapeAnnotationModel> = {}): ShapeAnnotationModel {
  return {
    id: 'a-1',
    pageIndex: 0,
    subtype: 'Square',
    rect: { x: 100, y: 100, width: 200, height: 100 },
    color: { r: 1, g: 0, b: 0 },
    opacity: 0.8,
    borderWidth: 1,
    borderStyle: 'solid',
    createdAt: 1_700_000_000_000,
    modifiedAt: 1_700_000_000_000,
    dirty: true,
    ...overrides,
  };
}

const deps = {
  getBytes: (h: number) => (h === 1 ? new Uint8Array(0) : null),
  getPageCount: (h: number) => (h === 1 ? 5 : null),
};

describe('handleAnnotationsAddShape', () => {
  it('happy path: Square', async () => {
    const r = await handleAnnotationsAddShape({ handle: 1, annotation: baseModel() }, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.op.kind).toBe('annot-add-shape');
      expect(r.value.warnings).toEqual([]);
    }
  });

  it('rejects handle_not_found', async () => {
    const r = await handleAnnotationsAddShape({ handle: 99, annotation: baseModel() }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('handle_not_found');
  });

  it('rejects pageIndex out of range', async () => {
    const r = await handleAnnotationsAddShape(
      { handle: 1, annotation: baseModel({ pageIndex: 10 }) },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('out_of_range');
  });

  it('rejects Polygon without enough vertices', async () => {
    const r = await handleAnnotationsAddShape(
      { handle: 1, annotation: baseModel({ subtype: 'Polygon', vertices: [10, 10] }) },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects Line missing endpoints', async () => {
    const r = await handleAnnotationsAddShape(
      { handle: 1, annotation: baseModel({ subtype: 'Line' }) },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects FreeTextCallout missing pointer', async () => {
    const r = await handleAnnotationsAddShape(
      {
        handle: 1,
        annotation: baseModel({ subtype: 'FreeTextCallout', calloutText: 'X' }),
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects fillEnabled without fillColor', async () => {
    const r = await handleAnnotationsAddShape(
      { handle: 1, annotation: baseModel({ fillEnabled: true }) },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('happy path: Polygon with 3 vertices', async () => {
    const r = await handleAnnotationsAddShape(
      {
        handle: 1,
        annotation: baseModel({
          subtype: 'Polygon',
          vertices: [10, 10, 20, 10, 15, 30],
        }),
      },
      deps,
    );
    expect(r.ok).toBe(true);
  });

  it('happy path: arrow (Line with OpenArrow end style)', async () => {
    const r = await handleAnnotationsAddShape(
      {
        handle: 1,
        annotation: baseModel({
          subtype: 'Line',
          lineStart: { x: 0, y: 0 },
          lineEnd: { x: 100, y: 100 },
          lineEndStyle: 'OpenArrow',
        }),
      },
      deps,
    );
    expect(r.ok).toBe(true);
  });

  it('happy path: callout with text + pointer', async () => {
    const r = await handleAnnotationsAddShape(
      {
        handle: 1,
        annotation: baseModel({
          subtype: 'FreeTextCallout',
          calloutText: 'Important',
          calloutPointer: { x: 300, y: 300 },
        }),
      },
      deps,
    );
    expect(r.ok).toBe(true);
  });
});
