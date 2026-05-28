// TextEditOverlay — Phase 2 click-to-edit existing text spans.
// Per ui-spec.md §11.5 + edit-replay-engine.md §4.6 + §12.
//
// UX summary:
//  1. User enters text-edit mode (E key / toolbar button) — handled by
//     use-app-shortcuts + ui-slice.setTextEditMode.
//  2. User clicks into a text region on the canvas. The PdfCanvas wires the
//     click to identifyTextSpanThunk which fires pdf:identifyTextSpan and on
//     success populates ui.textEdit.activeSpan.
//  3. This component renders an inline <input> over the span's bounding rect,
//     prefilled with the original text. Width and missing-glyph checks are
//     performed renderer-side against the cached font.glyphWidths.
//  4. Esc cancels; Enter (or blur, if editing.commitTextOnBlur is true)
//     commits via replaceTextThunk.
//
// The overlay measurement model:
//  - glyphWidths is Record<codepoint, widthAt1pt>. For text at fontSize pt,
//    new-text-width = sum(glyphWidths[codepoint] * fontSize) over codepoints.
//  - missing glyph = codepoint not present as a key in glyphWidths AND not the
//    space char (' ' is implicitly available in every font; the engine treats
//    a missing space width as 250 / 1000 pt).

import { useEffect, useRef } from 'react';

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectTextEditState } from '../../state/slices/ui-selectors';
import {
  clearTextEditActiveSpan,
  setTextEditDraft,
  setTextEditMode,
} from '../../state/slices/ui-slice';
import { replaceTextThunk } from '../../state/thunks';

import styles from './text-edit-overlay.module.css';

interface MeasureResult {
  newWidth: number;
  willClip: boolean;
  missingChars: ReadonlyArray<{ char: string; codepoint: number; index: number }>;
}

function measureText(
  text: string,
  fontSize: number,
  glyphWidths: Record<number, number>,
): MeasureResult {
  let newWidth = 0;
  const missing: Array<{ char: string; codepoint: number; index: number }> = [];
  let idx = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const w = glyphWidths[cp];
    if (w === undefined) {
      // Space + tab are implicitly available; we treat them generously.
      if (cp === 0x20 || cp === 0x09) {
        newWidth += 0.25 * fontSize;
      } else {
        missing.push({ char: ch, codepoint: cp, index: idx });
        newWidth += 0.5 * fontSize; // pessimistic estimate; doesn't matter, we block commit
      }
    } else {
      newWidth += w * fontSize;
    }
    idx += 1;
  }
  return { newWidth, willClip: false, missingChars: missing };
}

export function TextEditOverlay(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const { active, identifying, activeSpan, draftText } = useAppSelector(selectTextEditState);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus the input on span activation.
  useEffect(() => {
    if (activeSpan) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [activeSpan]);

  if (!active) return null;

  if (identifying) {
    return (
      <div className={styles.banner}>
        <span className={styles.bannerText}>Identifying text span…</span>
      </div>
    );
  }

  if (!activeSpan) {
    return (
      <div className={styles.banner}>
        <span className={styles.bannerText}>
          Text Edit mode — click any text run to edit. Esc to exit.
        </span>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={() => dispatch(setTextEditMode(false))}
          aria-label="Exit text edit mode"
        >
          Cancel
        </button>
      </div>
    );
  }

  const measurement = measureText(draftText, activeSpan.font.size, activeSpan.font.glyphWidths);
  const willClip = measurement.newWidth > activeSpan.runBoundingRect.width;
  const hasMissingGlyph = measurement.missingChars.length > 0;
  const canCommit = !hasMissingGlyph && draftText.length > 0;

  const cancelEdit = (): void => {
    dispatch(clearTextEditActiveSpan());
  };

  const commitEdit = async (): Promise<void> => {
    if (!canCommit) return;
    await dispatch(
      replaceTextThunk({
        pageIndex: activeSpan.pageIndex,
        objectId: activeSpan.objectId,
        newText: draftText,
      }),
    );
    dispatch(clearTextEditActiveSpan());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void commitEdit();
    }
  };

  // Position the editor over the run's bounding rect. The canvas exposes its
  // origin via a fixed top-left coordinate frame; Phase-2 keeps this simple by
  // relying on the parent canvas wrapper having `position: relative`. PDF user
  // space has origin bottom-left, but for the overlay the rect.y is the
  // top-edge of the run already (PdfCanvas pre-translates before dispatching
  // identifyTextSpan).
  const editorStyle: React.CSSProperties = {
    left: activeSpan.runBoundingRect.x,
    top: activeSpan.runBoundingRect.y,
    width: Math.max(activeSpan.runBoundingRect.width, 40),
    height: Math.max(activeSpan.runBoundingRect.height, 18),
    fontSize: activeSpan.font.size,
    fontFamily: activeSpan.font.family,
  };

  return (
    <>
      <div className={styles.banner}>
        <span className={styles.bannerText}>Text Edit mode — Esc to cancel, Enter to commit.</span>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={() => dispatch(setTextEditMode(false))}
          aria-label="Exit text edit mode"
        >
          Cancel
        </button>
      </div>

      <div className={styles.editorContainer} style={editorStyle}>
        <input
          ref={inputRef}
          type="text"
          className={styles.editorInput}
          value={draftText}
          onChange={(e) => dispatch(setTextEditDraft(e.target.value))}
          onKeyDown={onKeyDown}
          aria-label="Edit text"
        />
        {hasMissingGlyph && (
          <div className={styles.missingGlyphTooltip} role="alert">
            Original font does not contain
            {measurement.missingChars.map((m) => ` "${m.char}"`).join(',')}. Use a FreeText
            annotation to add new text in a different font.
          </div>
        )}
        {!hasMissingGlyph && willClip && (
          <div className={styles.clipTooltip}>
            Text will be clipped on save (
            {(measurement.newWidth - activeSpan.runBoundingRect.width).toFixed(1)}
            pt overflow). Phase 4 will support reflow.
          </div>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.commitButton}
            disabled={!canCommit}
            onClick={() => void commitEdit()}
          >
            Save
          </button>
          <button type="button" className={styles.cancelEditButton} onClick={cancelEdit}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
