// Read Aloud floating bar — Phase 7.5 C1 (Riley Wave 5a).
// Per docs/ui-spec-phase-7.5.md §22. Anchored bottom-center of the
// viewport; opens via View → Read Aloud or Ctrl+Alt+R; closes via the ×
// button or the same shortcut. The bar is OUTSIDE the document scroll
// container so it stays put as the user scrolls.
//
// Visual flow:
//   Play  -> dispatches David's `tts:speakText` with the current text
//            selection (or the active page's text if no selection).
//   Pause -> dispatches `tts:pause`; the active highlight pauses too.
//   Stop  -> dispatches `tts:stop`; status returns to idle.
//   Voice -> select from David's `tts:listVoices`; null = OS default.
//   Rate  -> slider 0.5..2.0×; pitch is held at 1.0 in v1 (slider lives in
//            tts-slice for the C1 follow-up wave but the bar surfaces rate
//            only per the §22.1 mock-up).
//
// Engine-unavailable state: when David's engine reports
// `engine_unavailable` (Linux without espeak), the bar renders the
// honest fallback from §22.2 — no fake "playing..." spinner.
//
// Sentence highlighting: David's `tts:boundary` event stream advances
// activeSentenceIndex on every sentence-start. The actual on-page text
// highlight lives in the pdf-canvas TextLayer (Wave 11 wires the
// listener); the bar surfaces the sentence counter so the user has a
// progress signal regardless of canvas state.

import { useEffect, useRef } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  closeReadAloud,
  setRate,
  setSelectedVoiceId,
  setTtsLastError,
} from '../../state/slices/tts-slice';
import {
  controlSpeakThunk,
  loadTtsVoicesThunk,
  speakTextThunk,
  subscribeTtsBoundary,
} from '../../state/thunks-phase7-5-wave5a';
import { TTS_MAX_RATE, TTS_MIN_RATE } from '../../types/tts-contract-stub';

import styles from './read-aloud-bar.module.css';
import { VoicePicker } from './voice-picker';

/** Pull the currently-selected text from the renderer; if the user has
 *  nothing selected, return an empty string. The owner thunk handles the
 *  "no selection" case with an honest message — we don't second-guess
 *  the source-of-text decision here. */
function getCurrentSelectionText(): string {
  if (typeof window === 'undefined') return '';
  const sel = window.getSelection();
  if (sel === null) return '';
  return sel.toString();
}

export function ReadAloudBar(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const open = useAppSelector((s) => s.tts.open);
  const tts = useAppSelector((s) => s.tts);
  const doc = useAppSelector(selectCurrentDocument);
  const lastDocHandleRef = useRef<number | null>(null);

  // Load voices on first open + on document change. The list isn't huge
  // (a typical machine has 5–30 voices) so refreshing is cheap and lets
  // newly-installed voices surface without a restart.
  useEffect(() => {
    if (!open) return;
    void dispatch(loadTtsVoicesThunk());
  }, [dispatch, open]);

  // Subscribe to boundary events once when the bar opens. The thunk
  // returns a no-op unsubscribe when David's bridge isn't there yet, so
  // the cleanup is safe regardless.
  useEffect(() => {
    if (!open) return;
    const unsubscribe = subscribeTtsBoundary(dispatch);
    return () => {
      unsubscribe();
    };
  }, [dispatch, open]);

  // Stop any active session when the document changes — speaking text
  // from the previous document while the user navigates away would be
  // surprising. Best-effort: we fire stop; if no active session the
  // thunk no-ops.
  useEffect(() => {
    const handle = doc?.handle ?? null;
    if (lastDocHandleRef.current !== null && handle !== lastDocHandleRef.current) {
      void dispatch(controlSpeakThunk({ method: 'stop' }));
    }
    lastDocHandleRef.current = handle;
  }, [dispatch, doc]);

  if (!open) return null;

  const onClose = (): void => {
    if (tts.jobId !== null) {
      void dispatch(controlSpeakThunk({ method: 'stop' }));
    }
    dispatch(closeReadAloud());
  };

  const onPlay = (): void => {
    dispatch(setTtsLastError(null));
    const selection = getCurrentSelectionText();
    // No selection -> fall through; the thunk surfaces the honest "select
    // text or open a page with text" message when text is empty. The
    // "current page text" mode wires up in Wave 11 when pdf-canvas
    // exposes the visible-page text store; for now Play either speaks the
    // selection or honestly tells the user to select text.
    void dispatch(speakTextThunk({ text: selection }));
  };

  const onPause = (): void => {
    void dispatch(controlSpeakThunk({ method: 'pause' }));
  };

  const onResume = (): void => {
    void dispatch(controlSpeakThunk({ method: 'resume' }));
  };

  const onStop = (): void => {
    void dispatch(controlSpeakThunk({ method: 'stop' }));
  };

  const sentenceTotal = tts.currentBoundaries.length;
  // activeSentenceIndex is 0-based; display 1-based for the user.
  const sentenceCurrent =
    tts.activeSentenceIndex >= 0
      ? Math.min(tts.activeSentenceIndex + 1, sentenceTotal)
      : tts.status === 'speaking' || tts.status === 'paused'
        ? 1
        : 0;

  const isSpeaking = tts.status === 'speaking';
  const isPaused = tts.status === 'paused';
  const hasJob = tts.jobId !== null;

  // Engine-unavailable honest fallback (ui-spec §22.2). We still render
  // the close button + region so the user can dismiss the bar without
  // losing keyboard focus into the void.
  if (tts.engineStatus === 'unavailable') {
    return (
      <section
        className={styles.bar}
        aria-label={t('modals:readAloud.regionAria')}
        aria-live="polite"
      >
        <div className={styles.row}>
          <span className={styles.title}>{t('modals:readAloud.title')}</span>
          <div className={styles.spacer} />
          <button
            type="button"
            className={styles.closeButton}
            aria-label={t('modals:readAloud.close')}
            title={t('modals:readAloud.close')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className={styles.engineUnavailable}>
          <strong>{t('modals:readAloud.engineUnavailable')}</strong>
          {tts.engineUnavailableMessage ?? t('modals:readAloud.engineUnavailableHelp')}
        </div>
      </section>
    );
  }

  return (
    <section
      className={styles.bar}
      aria-label={t('modals:readAloud.regionAria')}
      aria-live="polite"
    >
      <div className={styles.row}>
        <span className={styles.title}>{t('modals:readAloud.title')}</span>

        {isSpeaking ? (
          <button
            type="button"
            className={`${styles.button} ${styles.buttonActive}`}
            aria-pressed
            aria-label={t('modals:readAloud.pause')}
            title={t('modals:readAloud.pause')}
            onClick={onPause}
          >
            {t('modals:readAloud.pause')}
          </button>
        ) : isPaused ? (
          <button
            type="button"
            className={styles.button}
            aria-label={t('modals:readAloud.resume')}
            title={t('modals:readAloud.resume')}
            onClick={onResume}
          >
            {t('modals:readAloud.resume')}
          </button>
        ) : (
          <button
            type="button"
            className={styles.button}
            aria-label={t('modals:readAloud.play')}
            title={t('modals:readAloud.play')}
            onClick={onPlay}
            disabled={tts.status === 'starting'}
          >
            {tts.status === 'starting'
              ? t('modals:readAloud.starting')
              : t('modals:readAloud.play')}
          </button>
        )}

        <button
          type="button"
          className={styles.button}
          aria-label={t('modals:readAloud.stop')}
          title={t('modals:readAloud.stop')}
          onClick={onStop}
          disabled={!hasJob}
        >
          {t('modals:readAloud.stop')}
        </button>

        <span className={styles.label}>{t('modals:readAloud.voice')}</span>
        <VoicePicker
          voices={tts.voices}
          selectedVoiceId={tts.selectedVoiceId}
          onSelect={(id) => dispatch(setSelectedVoiceId(id))}
          disabled={tts.voicesLoading}
        />

        <div className={styles.spacer} />
        <button
          type="button"
          className={styles.closeButton}
          aria-label={t('modals:readAloud.close')}
          title={t('modals:readAloud.close')}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className={styles.row}>
        <label className={styles.label} htmlFor="read-aloud-rate">
          {t('modals:readAloud.rate')}
        </label>
        <input
          id="read-aloud-rate"
          type="range"
          className={styles.rateSlider}
          min={TTS_MIN_RATE}
          max={TTS_MAX_RATE}
          step={0.1}
          value={tts.rate}
          onChange={(e) => dispatch(setRate(Number(e.target.value)))}
          aria-valuetext={t('modals:readAloud.rateValue', { value: tts.rate.toFixed(1) })}
        />
        <span className={styles.rateValue}>{tts.rate.toFixed(1)}×</span>

        <div className={styles.spacer} />
        {sentenceTotal > 0 && (
          <span className={styles.sentenceProgress}>
            {t('modals:readAloud.sentenceProgress', {
              current: sentenceCurrent,
              total: sentenceTotal,
            })}
          </span>
        )}
      </div>

      {tts.lastErrorMessage !== null && (
        <div className={styles.error} role="alert">
          {tts.lastErrorMessage}
        </div>
      )}
    </section>
  );
}
