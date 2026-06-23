// useSpellCheckTextEdit — debounced spell-check trigger for the inline
// text-edit overlay. Post-v0.8.0 follow-up (Riley, 2026-06-18, Wave 6
// deferral close).
//
// Behavior:
//   - On mount (when the active span and draft are non-empty + enabled),
//     fires `checkSpellTextThunk` immediately so the underline appears for
//     the original text.
//   - On every `draftText` change, debounces the dispatch by 300ms (the
//     spell-check-slice already debounces aggressive consumers; matching
//     the same window keeps the underline responsive without overrunning
//     David's engine).
//   - Tears down the timer on unmount AND on span change so re-mounting
//     the overlay on a different span flushes any pending dispatch.
//   - Short-circuits entirely when spell-check is disabled — no IPC, no
//     toast, no timer. Re-enabling re-arms the hook through React's normal
//     re-render cycle.

import { useEffect, useRef } from 'react';

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectSpellCheckEnabled, selectSpellLocale } from '../../state/slices/spell-check-slice';
import { checkSpellTextThunk } from '../../state/thunks-phase7-5-wave6';

/** Debounce window — matches `spell-check-slice` consumer expectations. */
export const SPELL_CHECK_TEXT_EDIT_DEBOUNCE_MS = 300;

export interface UseSpellCheckTextEditArgs {
  /** Null while no span is active — hook becomes inert. */
  pageIndex: number | null;
  objectId: string | null;
  draftText: string;
}

export function useSpellCheckTextEdit(args: UseSpellCheckTextEditArgs): void {
  const dispatch = useAppDispatch();
  const enabled = useAppSelector(selectSpellCheckEnabled);
  const locale = useAppSelector(selectSpellLocale);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending dispatch from a prior render — span change,
    // disable toggle, or draft edit.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!enabled) return;
    if (args.pageIndex === null || args.objectId === null) return;
    if (args.draftText.length === 0) return;

    const pageIndex = args.pageIndex;
    const objectId = args.objectId;
    const text = args.draftText;

    timerRef.current = setTimeout(() => {
      void dispatch(checkSpellTextThunk({ pageIndex, objectId, locale, text }));
      timerRef.current = null;
    }, SPELL_CHECK_TEXT_EDIT_DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [args.pageIndex, args.objectId, args.draftText, enabled, locale, dispatch]);
}
