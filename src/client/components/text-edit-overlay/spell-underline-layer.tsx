// Spell-check wavy-underline layer for the inline text-edit overlay.
//
// Post-v0.8.0 follow-up (Riley, 2026-06-18, Wave 6 deferral close): the
// spell-check `selectMisspellingsFor` selector was ready in Wave 6 but the
// text-edit overlay didn't consume it. This component closes that gap:
//   - Mounted by `<TextEditOverlay>` when an active span exists AND
//     spell-check is enabled (the parent gates the dispatch + render).
//   - Reads misspellings from the slice for `(pageIndex, objectId)`.
//   - For each `{ offset, length, word, suggestions }`, computes the
//     x + width from the activeSpan's `font.glyphWidths` (same width
//     source `measureText` uses in `index.tsx` — they're guaranteed to
//     agree at the glyph-pixel level so the underline lines up).
//   - Right-click on an underline dispatches `showSpellSuggestionPopup`
//     with the misspelling + anchor — Wave 6 already shipped the popup.
//
// Honesty: per-character widths come from the active span's font, not from
// CSS-measured glyph runs. On non-Helvetica system fonts the visual CSS
// glyphs may drift slightly from the pdf-lib-measured glyphs. The trade-off
// is correctness: lining the underline up with the CSS glyphs would
// hide the very mismatches the missing-glyph + clip detectors surface
// using glyphWidths. Aligning with glyphWidths keeps the data sources
// consistent at the cost of a small drift on exotic fonts.

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  selectMisspellingsFor,
  selectSpellCheckEnabled,
  showSpellSuggestionPopup,
} from '../../state/slices/spell-check-slice';

import styles from './text-edit-overlay.module.css';

export interface SpellUnderlineLayerProps {
  pageIndex: number;
  objectId: string;
  /** Same source `measureText()` reads; per-codepoint width at 1pt. */
  glyphWidths: Record<number, number>;
  /** Font point-size used to scale glyphWidths to CSS px. */
  fontSize: number;
  /** Text the user is currently editing (drives the offset lookups). */
  draftText: string;
  /** Page-viewport-relative anchor for the popup. The overlay is at
   *  `runBoundingRect.x|y`; the popup wants a page-relative point. */
  anchorBaseX: number;
  anchorBaseY: number;
}

/** Pixel-width of `text[start..start+len)` using the active span's
 *  `glyphWidths`. Mirrors `measureText` in `index.tsx` so the underline
 *  aligns with the same width source. */
function measureRange(
  text: string,
  start: number,
  length: number,
  fontSize: number,
  glyphWidths: Record<number, number>,
): { x: number; width: number } {
  let cursor = 0;
  let x = 0;
  let width = 0;
  let idx = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) {
      idx += 1;
      continue;
    }
    let glyphWidth: number;
    const w = glyphWidths[cp];
    if (w === undefined) {
      // Space + tab implicit width (matches measureText fallback).
      glyphWidth = cp === 0x20 || cp === 0x09 ? 0.25 * fontSize : 0.5 * fontSize;
    } else {
      glyphWidth = w * fontSize;
    }
    if (idx < start) {
      x += glyphWidth;
    } else if (idx < start + length) {
      width += glyphWidth;
    } else {
      break;
    }
    idx += 1;
    cursor += 1;
  }
  void cursor;
  return { x, width };
}

export function SpellUnderlineLayer({
  pageIndex,
  objectId,
  glyphWidths,
  fontSize,
  draftText,
  anchorBaseX,
  anchorBaseY,
}: SpellUnderlineLayerProps): JSX.Element | null {
  const dispatch = useAppDispatch();
  const enabled = useAppSelector(selectSpellCheckEnabled);
  const misspellings = useAppSelector((s) => selectMisspellingsFor(s, pageIndex, objectId));

  // Honor the master enabled flag — the slice's selectMisspellingsFor
  // ALSO returns [] when disabled, but the explicit check here lets the
  // layer short-circuit rendering even if a stale cache exists somehow.
  if (!enabled) return null;
  if (misspellings.length === 0) return null;

  return (
    <div className={styles.spellUnderlineLayer}>
      {misspellings.map((m) => {
        const { x, width } = measureRange(draftText, m.offset, m.length, fontSize, glyphWidths);
        // Skip zero-width or off-screen renders defensively (engine should
        // never emit them, but a stale cache after a length-shrinking edit
        // could).
        if (width <= 0) return null;
        const openPopup = (): void => {
          dispatch(
            showSpellSuggestionPopup({
              pageIndex,
              objectId,
              word: m.word,
              suggestions: m.suggestions,
              // anchor at the misspelling's left edge in page-viewport
              // coordinates (overlay origin + per-glyph offset).
              anchorX: anchorBaseX + x,
              anchorY: anchorBaseY,
            }),
          );
        };
        const onMouse = (e: React.MouseEvent<HTMLSpanElement>): void => {
          e.preventDefault();
          openPopup();
        };
        const onKey = (e: React.KeyboardEvent<HTMLSpanElement>): void => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'F10' || e.key === 'ContextMenu') {
            e.preventDefault();
            openPopup();
          }
        };
        return (
          <span
            key={`${m.offset}:${m.length}:${m.word}`}
            className={styles.spellUnderline}
            style={{ left: x, width }}
            onContextMenu={onMouse}
            onClick={onMouse}
            onKeyDown={onKey}
            role="button"
            tabIndex={0}
            aria-label={`Misspelling: ${m.word}`}
          />
        );
      })}
    </div>
  );
}
