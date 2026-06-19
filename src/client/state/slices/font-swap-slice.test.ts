// Font-swap slice tests — Phase 7.5 Wave 6 (Riley).

import { describe, expect, test } from 'vitest';

import fontSwapReducer, {
  closeFontSwap,
  openFontSwap,
  resetFontSwap,
  selectFontSwap,
  selectFontSwapOpen,
  setEmbeddedFonts,
  setFontListError,
  setFontSwapScope,
  setFromFontName,
  setLoadingFonts,
  setSwapError,
  setSwapping,
  setSwapResult,
  setToFontName,
  type FontSwapState,
} from './font-swap-slice';

function initial(): FontSwapState {
  return fontSwapReducer(undefined, { type: '__init' });
}

describe('font-swap slice', () => {
  test('openFontSwap with no payload', () => {
    const s = fontSwapReducer(initial(), openFontSwap(undefined));
    expect(s.open).toBe(true);
    expect(s.fromFontName).toBeNull();
  });

  test('openFontSwap with fromFontName payload', () => {
    const s = fontSwapReducer(initial(), openFontSwap({ fromFontName: 'Arial-Bold' }));
    expect(s.open).toBe(true);
    expect(s.fromFontName).toBe('Arial-Bold');
  });

  test('openFontSwap clears prior result + warnings + error', () => {
    let s = fontSwapReducer(initial(), setSwapResult({ fontsRewritten: 3, warnings: ['w'] }));
    s = fontSwapReducer(s, setSwapError('boom'));
    s = fontSwapReducer(s, openFontSwap(undefined));
    expect(s.lastFontsRewritten).toBeNull();
    expect(s.lastWarnings).toEqual([]);
    expect(s.lastErrorMessage).toBeNull();
  });

  test('closeFontSwap returns to initial', () => {
    let s = fontSwapReducer(initial(), openFontSwap({ fromFontName: 'X' }));
    s = fontSwapReducer(s, closeFontSwap());
    expect(s).toEqual(initial());
  });

  test('setLoadingFonts(true) clears prior list error', () => {
    let s = fontSwapReducer(initial(), setFontListError('boom'));
    s = fontSwapReducer(s, setLoadingFonts(true));
    expect(s.lastListError).toBeNull();
  });

  test('setEmbeddedFonts clears loadingFonts', () => {
    let s = fontSwapReducer(initial(), setLoadingFonts(true));
    s = fontSwapReducer(
      s,
      setEmbeddedFonts([{ name: 'Arial', isEmbedded: true, isSubset: false, pageRefs: [0, 1] }]),
    );
    expect(s.loadingFonts).toBe(false);
    expect(s.embeddedFonts.length).toBe(1);
  });

  test('setFromFontName + setToFontName + scope', () => {
    let s = fontSwapReducer(initial(), setFromFontName('Arial'));
    expect(s.fromFontName).toBe('Arial');
    s = fontSwapReducer(s, setToFontName('Times-Roman'));
    expect(s.toFontName).toBe('Times-Roman');
    s = fontSwapReducer(s, setFontSwapScope('this-page'));
    expect(s.scope).toBe('this-page');
  });

  test('setSwapping(true) clears prior warnings + error', () => {
    let s = fontSwapReducer(initial(), setSwapResult({ fontsRewritten: 1, warnings: ['w'] }));
    s = fontSwapReducer(s, setSwapError('boom'));
    s = fontSwapReducer(s, setSwapping(true));
    expect(s.swapping).toBe(true);
    expect(s.lastWarnings).toEqual([]);
    expect(s.lastErrorMessage).toBeNull();
  });

  test('setSwapResult clears swapping + records counts + warnings', () => {
    let s = fontSwapReducer(initial(), setSwapping(true));
    s = fontSwapReducer(s, setSwapResult({ fontsRewritten: 7, warnings: ['warn-a'] }));
    expect(s.swapping).toBe(false);
    expect(s.lastFontsRewritten).toBe(7);
    expect(s.lastWarnings).toEqual(['warn-a']);
    expect(s.lastErrorMessage).toBeNull();
  });

  test('setSwapError clears swapping + records error', () => {
    let s = fontSwapReducer(initial(), setSwapping(true));
    s = fontSwapReducer(s, setSwapError('engine failed'));
    expect(s.swapping).toBe(false);
    expect(s.lastErrorMessage).toBe('engine failed');
  });

  test('selectors', () => {
    const s = fontSwapReducer(initial(), openFontSwap({ fromFontName: 'X' }));
    const state = { fontSwap: s };
    expect(selectFontSwapOpen(state)).toBe(true);
    expect(selectFontSwap(state).fromFontName).toBe('X');
  });

  test('resetFontSwap returns to initial', () => {
    let s = fontSwapReducer(initial(), openFontSwap({ fromFontName: 'X' }));
    s = fontSwapReducer(s, resetFontSwap());
    expect(s).toEqual(initial());
  });
});
