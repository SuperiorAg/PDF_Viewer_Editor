// Form Designer component tests.
// Per ui-spec.md §12.4.

import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import formsReducer, {
  setDesignerFieldType,
  setDesignerMode,
} from '../../state/slices/forms-slice';

import {
  CLICK_THRESHOLD_PX,
  DEFAULT_FIELD_SIZE_PTS,
  FormDesignerToolbar,
  computePlacementPdfRect,
  nextUnusedName,
} from './index';

function makeStore() {
  return configureStore({
    reducer: { forms: formsReducer },
  });
}

describe('FormDesignerToolbar', () => {
  it('renders nothing when designer mode is off', () => {
    const store = makeStore();
    const { container } = render(
      <Provider store={store}>
        <FormDesignerToolbar />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the field-type pills when designer mode is on', () => {
    const store = makeStore();
    store.dispatch(setDesignerMode(true));
    render(
      <Provider store={store}>
        <FormDesignerToolbar />
      </Provider>,
    );
    expect(screen.getByRole('button', { name: 'Text' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checkbox' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Signature' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
  });

  it('renders the Exit button when designer mode is on', () => {
    const store = makeStore();
    store.dispatch(setDesignerMode(true));
    render(
      <Provider store={store}>
        <FormDesignerToolbar />
      </Provider>,
    );
    expect(screen.getByRole('button', { name: /Exit/i })).toBeInTheDocument();
  });

  it('highlights the active field-type pill', () => {
    const store = makeStore();
    store.dispatch(setDesignerMode(true));
    store.dispatch(setDesignerFieldType('checkbox'));
    render(
      <Provider store={store}>
        <FormDesignerToolbar />
      </Provider>,
    );
    const checkboxBtn = screen.getByRole('button', { name: 'Checkbox' });
    // Active class name contains 'Active' substring per CSS module convention.
    expect(checkboxBtn.className).toMatch(/Active/);
  });
});

describe('nextUnusedName', () => {
  it('returns "<type>_1" when no fields exist', () => {
    expect(nextUnusedName([], 'text')).toBe('text_1');
  });

  it('finds the next free index', () => {
    expect(nextUnusedName(['text_1', 'text_2'], 'text')).toBe('text_3');
  });

  it('ignores names of different types', () => {
    expect(nextUnusedName(['text_1', 'checkbox_1', 'checkbox_2'], 'checkbox')).toBe('checkbox_3');
  });
});

/**
 * Phase 3.1 click-to-place — pins the bug fix where a pure click (no drag, or
 * drag < CLICK_THRESHOLD_PX on either axis) used to return early with no
 * feedback. Now it must seed a default-sized rect at the click point.
 */
describe('computePlacementPdfRect — click-to-place (Phase 3.1)', () => {
  // 792 = US Letter height in points; matches the test-doc convention.
  const PAGE_HEIGHT = 792;
  const ZOOM = 1;

  it('seeds a default-sized text rect at the click point when the user does not drag', () => {
    const r = computePlacementPdfRect({
      drag: { start: { x: 50, y: 100 }, current: { x: 50, y: 100 } },
      fieldType: 'text',
      zoom: ZOOM,
      pageHeight: PAGE_HEIGHT,
    });
    expect(r.width).toBe(DEFAULT_FIELD_SIZE_PTS.text.width);
    expect(r.height).toBe(DEFAULT_FIELD_SIZE_PTS.text.height);
    // x maps straight through at zoom=1; y is flipped (top-left semantics).
    expect(r.x).toBe(50);
    expect(r.y).toBe(PAGE_HEIGHT - 100 - DEFAULT_FIELD_SIZE_PTS.text.height);
  });

  it('seeds a default-sized checkbox rect when a click lands inside the click threshold', () => {
    const r = computePlacementPdfRect({
      // 3 px nudge — below CLICK_THRESHOLD_PX (4) on both axes.
      drag: { start: { x: 200, y: 300 }, current: { x: 202, y: 302 } },
      fieldType: 'checkbox',
      zoom: ZOOM,
      pageHeight: PAGE_HEIGHT,
    });
    expect(r.width).toBe(DEFAULT_FIELD_SIZE_PTS.checkbox.width);
    expect(r.height).toBe(DEFAULT_FIELD_SIZE_PTS.checkbox.height);
    expect(r.width).toBe(14);
    expect(r.height).toBe(14);
  });

  it('seeds a default-sized signature rect on click — distinct from text defaults', () => {
    const r = computePlacementPdfRect({
      drag: { start: { x: 10, y: 20 }, current: { x: 10, y: 20 } },
      fieldType: 'signature',
      zoom: ZOOM,
      pageHeight: PAGE_HEIGHT,
    });
    expect(r.width).toBe(DEFAULT_FIELD_SIZE_PTS.signature.width);
    expect(r.height).toBe(DEFAULT_FIELD_SIZE_PTS.signature.height);
    expect(r.width).toBe(180);
    expect(r.height).toBe(36);
  });

  it('exposes a default size for every FormFieldType', () => {
    // Sentinel — if anyone adds a new field type without a default, this fails
    // before the click-to-place path breaks at runtime.
    const types = ['text', 'checkbox', 'radio', 'dropdown', 'signature', 'date'] as const;
    for (const t of types) {
      const s = DEFAULT_FIELD_SIZE_PTS[t];
      expect(s.width).toBeGreaterThan(0);
      expect(s.height).toBeGreaterThan(0);
    }
  });

  it('uses the drag rect when the drag is at or above the click threshold on both axes', () => {
    const r = computePlacementPdfRect({
      drag: {
        start: { x: 100, y: 200 },
        current: { x: 100 + CLICK_THRESHOLD_PX + 6, y: 200 + CLICK_THRESHOLD_PX + 6 },
      },
      fieldType: 'text',
      zoom: ZOOM,
      pageHeight: PAGE_HEIGHT,
    });
    expect(r.x).toBe(100);
    expect(r.width).toBe(CLICK_THRESHOLD_PX + 6);
    expect(r.height).toBe(CLICK_THRESHOLD_PX + 6);
    expect(r.y).toBe(PAGE_HEIGHT - 200 - (CLICK_THRESHOLD_PX + 6));
  });

  it('honours zoom when seeding a default on click (default sizes are in PDF points, not pixels)', () => {
    const r = computePlacementPdfRect({
      drag: { start: { x: 100, y: 100 }, current: { x: 100, y: 100 } },
      fieldType: 'text',
      zoom: 2,
      pageHeight: PAGE_HEIGHT,
    });
    // Default size is in points and must NOT be divided by zoom.
    expect(r.width).toBe(DEFAULT_FIELD_SIZE_PTS.text.width);
    expect(r.height).toBe(DEFAULT_FIELD_SIZE_PTS.text.height);
    // But the click point is in screen px, so it IS divided by zoom.
    expect(r.x).toBe(50);
    expect(r.y).toBe(PAGE_HEIGHT - 50 - DEFAULT_FIELD_SIZE_PTS.text.height);
  });
});
