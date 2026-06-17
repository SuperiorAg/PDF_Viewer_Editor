// Phase 7.5 Wave 5a thunks — TTS Read Aloud (C1) + Preflight (C2).
//
// Follows the same parallel-wave coordination pattern Wave 2 established
// (see `thunks-phase7-4.ts` module header + `thunks-phase7-5-wave5.ts`):
// feature-detect the bridge method on `window.pdfApi?.{tts,pdf}?.<name>`
// and short-circuit with a structurally-correct
// `'bridge_unavailable'` Result when missing. The thunks never `as any`
// the api proxy — they only narrow the bridge namespace inline at call
// time so David's parallel preload-bridge commit can land without
// renderer re-mapping. When David lands the canonical types in
// `src/ipc/contracts.ts`, the locally-typed stubs in
// `types/{tts,preflight}-contract-stub.ts` will be promoted to re-export
// wrappers (mirroring the `links-contract-stub.ts` Wave-4 promotion
// path + the Wave-5 sanitize / properties stubs).

import { createAsyncThunk } from '@reduxjs/toolkit';

import {
  type PdfRunPreflightRequest,
  type PdfRunPreflightResponse,
} from '../types/preflight-contract-stub';
import {
  splitSentences,
  type TtsBoundaryEvent,
  type TtsBoundaryUnsubscribe,
  type TtsControlRequest,
  type TtsControlResponse,
  type TtsListVoicesResponse,
  type TtsSpeakTextRequest,
  type TtsSpeakTextResponse,
} from '../types/tts-contract-stub';

import {
  setPreflightLastError,
  setPreflightResults,
  setPreflightRunning,
} from './slices/preflight-slice';
import {
  setActiveSentenceIndex,
  setEngineUnavailable,
  setSpeakSession,
  setTtsLastError,
  setTtsStatus,
  setVoices,
  setVoicesLoading,
} from './slices/tts-slice';
import { pushToast } from './slices/ui-slice';
import { type AppDispatch, type RootState } from './store';

// ============================================================================
// Feature-detect adapters — same pattern as `thunks-phase7-5-wave5.ts`.
// ============================================================================

function bridgeOk(): boolean {
  return typeof window !== 'undefined' && window.pdfApi !== undefined;
}

/** Narrow `window.pdfApi.tts` to an object whose properties may be
 *  functions David's preload exposes. The renderer never assumes any
 *  particular method is present until it's been feature-detected. */
function ttsNs(): Record<string, unknown> | null {
  if (!bridgeOk()) return null;
  const ns = (window.pdfApi as unknown as { tts?: unknown }).tts;
  if (ns === null || ns === undefined) return null;
  return ns as Record<string, unknown>;
}

function pdfNs(): Record<string, unknown> | null {
  if (!bridgeOk()) return null;
  const ns = (window.pdfApi as unknown as { pdf?: unknown }).pdf;
  if (ns === null || ns === undefined) return null;
  return ns as Record<string, unknown>;
}

async function callListVoices(): Promise<TtsListVoicesResponse> {
  const ns = ttsNs();
  if (ns === null) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.tts is not exposed',
    };
  }
  const fn = ns['listVoices'];
  if (typeof fn !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.tts.listVoices is not exposed (David Wave 5a not yet landed)',
    };
  }
  return (await (fn as (req: Record<string, never>) => Promise<TtsListVoicesResponse>)(
    {} as Record<string, never>,
  )) as TtsListVoicesResponse;
}

async function callSpeakText(req: TtsSpeakTextRequest): Promise<TtsSpeakTextResponse> {
  const ns = ttsNs();
  if (ns === null) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.tts is not exposed',
    };
  }
  const fn = ns['speakText'];
  if (typeof fn !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.tts.speakText is not exposed (David Wave 5a not yet landed)',
    };
  }
  return (await (fn as (r: TtsSpeakTextRequest) => Promise<TtsSpeakTextResponse>)(
    req,
  )) as TtsSpeakTextResponse;
}

async function callTtsControl(
  method: 'pause' | 'resume' | 'stop',
  req: TtsControlRequest,
): Promise<TtsControlResponse> {
  const ns = ttsNs();
  if (ns === null) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.tts is not exposed',
    };
  }
  const fn = ns[method];
  if (typeof fn !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: `window.pdfApi.tts.${method} is not exposed (David Wave 5a not yet landed)`,
    };
  }
  return (await (fn as (r: TtsControlRequest) => Promise<TtsControlResponse>)(
    req,
  )) as TtsControlResponse;
}

async function callRunPreflight(req: PdfRunPreflightRequest): Promise<PdfRunPreflightResponse> {
  const ns = pdfNs();
  if (ns === null) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf is not exposed',
    };
  }
  const fn = ns['runPreflight'];
  if (typeof fn !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf.runPreflight is not exposed (David Wave 5a not yet landed)',
    };
  }
  return (await (fn as (r: PdfRunPreflightRequest) => Promise<PdfRunPreflightResponse>)(
    req,
  )) as PdfRunPreflightResponse;
}

/** Subscribe to `tts:boundary` if David's bridge exposes it. The
 *  returned unsubscribe is a no-op when the bridge isn't there yet so the
 *  cleanup paths in the bar don't blow up. The boundary events drive the
 *  active-sentence highlight in the renderer. */
export function subscribeTtsBoundary(dispatch: AppDispatch): TtsBoundaryUnsubscribe {
  const ns = ttsNs();
  if (ns === null) return () => undefined;
  const fn = ns['onBoundary'];
  if (typeof fn !== 'function') return () => undefined;
  return (fn as (listener: (event: TtsBoundaryEvent) => void) => TtsBoundaryUnsubscribe)(
    (event) => {
      switch (event.kind) {
        case 'sentence-start':
          if (typeof event.sentenceIndex === 'number') {
            dispatch(setActiveSentenceIndex(event.sentenceIndex));
          }
          break;
        case 'sentence-end':
          // Engine emits sentence-end before the next sentence-start; we
          // intentionally leave the active-sentence index in place so the
          // highlight doesn't flicker between sentences.
          break;
        case 'finished':
          dispatch(setTtsStatus('finished'));
          break;
        case 'error':
          dispatch(setTtsLastError(event.errorMessage ?? 'TTS engine reported an error.'));
          break;
      }
    },
  );
}

// ============================================================================
// Thunks.
// ============================================================================

/** Load the OS voice list. Idempotent — re-callable on every bar open
 *  to pick up newly-installed voices without restarting the app. */
export const loadTtsVoicesThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('tts/loadVoices', async (_arg, { dispatch }) => {
  dispatch(setVoicesLoading(true));
  try {
    const res = await callListVoices();
    if (!res.ok) {
      if (res.error === 'engine_unavailable') {
        dispatch(setEngineUnavailable({ message: res.message }));
        return;
      }
      // bridge_unavailable: keep engineStatus at 'unknown' so the bar can
      // surface the "engine pending" honesty state. We don't mark
      // unavailable on bridge_unavailable because the engine might still
      // exist — it just hasn't been wired yet.
      dispatch(setTtsLastError(res.message));
      return;
    }
    dispatch(setVoices({ voices: res.value.voices, engineName: res.value.engineName }));
  } finally {
    dispatch(setVoicesLoading(false));
  }
});

export interface SpeakTextArg {
  /** The text the user selected (or the visible page's text if no
   *  selection). Caller resolves the selection — the thunk is pure
   *  "speak this string". */
  text: string;
}

/** Send text to the engine. The slice records the speakId on success so
 *  the pause/resume/stop controls can find it. */
export const speakTextThunk = createAsyncThunk<
  void,
  SpeakTextArg,
  { dispatch: AppDispatch; state: RootState }
>('tts/speakText', async (arg, { dispatch, getState }) => {
  const text = arg.text.trim();
  if (text.length === 0) {
    dispatch(setTtsLastError('Select text or open a page with text before pressing Play.'));
    return;
  }
  const state = getState();
  const tts = state.tts;
  if (tts.engineStatus === 'unavailable') {
    dispatch(setTtsLastError(tts.engineUnavailableMessage ?? 'TTS engine unavailable.'));
    return;
  }
  const boundaries = splitSentences(text);
  dispatch(setTtsStatus('starting'));
  const req: TtsSpeakTextRequest = {
    text,
    sentenceBoundaries: boundaries,
    ...(tts.selectedVoiceId === null ? {} : { voiceId: tts.selectedVoiceId }),
    rate: tts.rate,
    pitch: tts.pitch,
  };
  const res = await callSpeakText(req);
  if (!res.ok) {
    dispatch(setTtsLastError(res.message));
    if (res.error !== 'bridge_unavailable') {
      dispatch(pushToast({ kind: 'error', message: res.message }));
    }
    dispatch(setTtsStatus('error'));
    return;
  }
  dispatch(
    setSpeakSession({
      jobId: res.value.jobId,
      text,
      boundaries,
    }),
  );
});

/** Pause / Resume / Stop a running session. The slice's status flips
 *  immediately on the engine's `state` echo so the bar UI stays in
 *  sync. */
export const controlSpeakThunk = createAsyncThunk<
  void,
  { method: 'pause' | 'resume' | 'stop' },
  { dispatch: AppDispatch; state: RootState }
>('tts/control', async (arg, { dispatch, getState }) => {
  const jobId = getState().tts.jobId;
  if (jobId === null) {
    // Nothing to do — bar shouldn't surface the controls in this case,
    // but defensive in case a keyboard shortcut fires while idle.
    return;
  }
  const res = await callTtsControl(arg.method, { jobId });
  if (!res.ok) {
    dispatch(setTtsLastError(res.message));
    if (res.error !== 'bridge_unavailable') {
      dispatch(pushToast({ kind: 'error', message: res.message }));
    }
    return;
  }
  switch (res.value.state) {
    case 'paused':
      dispatch(setTtsStatus('paused'));
      break;
    case 'resumed':
      dispatch(setTtsStatus('speaking'));
      break;
    case 'stopped':
      dispatch(setTtsStatus('idle'));
      break;
  }
});

// ============================================================================
// Preflight thunk.
// ============================================================================

/** Run the Preflight engine against the active document. The slice
 *  records the result + the `shippedRuleCount` for the honest
 *  disclosure. Does NOT auto-run on panel open — the panel's Run button
 *  is the sole trigger. */
export const runPreflightThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('preflight/run', async (_arg, { dispatch, getState }) => {
  const state = getState();
  const doc = state.document.current;
  if (!doc) {
    dispatch(setPreflightLastError('Open a document before running Preflight.'));
    return;
  }
  const profiles = state.preflight.selectedProfiles;
  if (profiles.length === 0) {
    dispatch(setPreflightLastError('Select at least one profile before running.'));
    return;
  }
  dispatch(setPreflightRunning(true));
  try {
    const res = await callRunPreflight({ handle: doc.handle, profiles: [...profiles] });
    if (!res.ok) {
      dispatch(setPreflightLastError(res.message));
      if (res.error !== 'bridge_unavailable') {
        dispatch(pushToast({ kind: 'error', message: res.message }));
      }
      return;
    }
    dispatch(setPreflightResults(res.value));
  } finally {
    // setPreflightResults / setPreflightLastError flip running to false
    // already; the finally is belt-and-braces in case of an unexpected
    // throw above (e.g. the bridge fn throws instead of returning a Result).
    if (getState().preflight.running) {
      dispatch(setPreflightRunning(false));
    }
  }
});
