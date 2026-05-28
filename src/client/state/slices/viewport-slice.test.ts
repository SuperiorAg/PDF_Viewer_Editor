import { describe, expect, it } from 'vitest';

import viewportReducer, {
  resetZoom,
  setCurrentPage,
  setFitMode,
  setZoom,
  zoomIn,
  zoomOut,
} from './viewport-slice';

describe('viewportSlice', () => {
  it('should start at 100% fit-width', () => {
    const state = viewportReducer(undefined, { type: 'init' });
    expect(state.zoom).toBe(1.0);
    expect(state.fitMode).toBe('fit-width');
  });

  it('zoomIn should step up through preset levels', () => {
    let state = viewportReducer(undefined, { type: 'init' });
    state = viewportReducer(state, zoomIn());
    expect(state.zoom).toBe(1.25);
    expect(state.fitMode).toBe('custom');
  });

  it('zoomOut should step down', () => {
    let state = viewportReducer(undefined, { type: 'init' });
    state = viewportReducer(state, zoomOut());
    expect(state.zoom).toBe(0.75);
  });

  it('resetZoom should restore 100%', () => {
    let state = viewportReducer(undefined, { type: 'init' });
    state = viewportReducer(state, setZoom(2.0));
    state = viewportReducer(state, resetZoom());
    expect(state.zoom).toBe(1.0);
  });

  it('setFitMode should change mode without touching zoom', () => {
    let state = viewportReducer(undefined, { type: 'init' });
    state = viewportReducer(state, setZoom(1.5));
    state = viewportReducer(state, setFitMode('fit-page'));
    expect(state.fitMode).toBe('fit-page');
    expect(state.zoom).toBe(1.5);
  });

  it('setCurrentPage should clamp negative', () => {
    let state = viewportReducer(undefined, { type: 'init' });
    state = viewportReducer(state, setCurrentPage(-5));
    expect(state.currentPage).toBe(0);
  });
});
