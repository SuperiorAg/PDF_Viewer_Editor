// Read Aloud / TTS contract stub — Phase 7.5 C1 (Riley Wave 5a).
//
// David's canonical `tts:listVoices`, `tts:speakText`, `tts:pause`,
// `tts:resume`, `tts:stop`, and `tts:boundary` event-stream channels
// already live in `src/ipc/contracts.ts` (added in his parallel Wave 5a
// commit). The renderer gatekeeper (`./ipc-contract`) does not yet
// re-export the TTS types into the renderer-import surface, so the
// renderer types the surface LOCALLY here against the EXACT shape in
// `src/ipc/contracts.ts §tts:*`. When the gatekeeper gains the
// re-exports, this file becomes a thin re-export wrapper (the same
// promotion path that `links-contract-stub.ts` followed in Wave 4 +
// `sanitize-contract-stub.ts` in Wave 5).
//
// IMPORTANT: David's contract uses `jobId` (not `speakId`) and
// `onBoundary` (not `onProgress`). The api-contracts.md docs draft used
// the older `speakId` / `onProgress` names; the contracts.ts file is the
// gatekeeper. Renderer mirrors contracts.ts verbatim.
//
// The runtime dispatcher in `state/thunks-phase7-5-wave5a.ts` feature-
// detects the bridge methods (`window.pdfApi?.tts?.*`) so the renderer
// compiles and runs even before David's preload bridge exposes them —
// same `bridge_unavailable` fallback shape every prior wave used.

export interface TtsListVoicesRequest {
  // Intentionally empty per contracts.ts.
  readonly _empty?: never;
}

export type TtsListVoicesError = 'engine_unavailable';

export interface TtsVoice {
  id: string;
  name: string;
  /** BCP-47 (e.g. 'en-US'). */
  locale: string;
  gender: 'male' | 'female' | 'neutral' | 'unknown';
}

export interface TtsListVoicesValue {
  voices: TtsVoice[];
  engineName: 'sapi' | 'say' | 'espeak';
}

export type TtsListVoicesResponse =
  | { ok: true; value: TtsListVoicesValue }
  | { ok: false; error: TtsListVoicesError | 'bridge_unavailable'; message: string };

export interface TtsSentenceBoundary {
  offset: number;
  length: number;
}

export interface TtsSpeakTextRequest {
  text: string;
  /** Omit for OS default for active locale. */
  voiceId?: string;
  /** 0.5..2.0; default 1.0. */
  rate?: number;
  /** 0.5..2.0; default 1.0. */
  pitch?: number;
  sentenceBoundaries: TtsSentenceBoundary[];
}

export type TtsSpeakTextError =
  | 'invalid_payload'
  | 'engine_unavailable'
  | 'engine_busy'
  | 'engine_failed';

export interface TtsSpeakTextValue {
  /** Correlation id for pause/resume/stop + boundary events. */
  jobId: string;
}

export type TtsSpeakTextResponse =
  | { ok: true; value: TtsSpeakTextValue }
  | { ok: false; error: TtsSpeakTextError | 'bridge_unavailable'; message: string };

export interface TtsControlRequest {
  jobId: string;
}

export type TtsControlError = 'invalid_payload' | 'job_not_found' | 'engine_failed';
export type TtsControlState = 'paused' | 'resumed' | 'stopped';
export interface TtsControlValue {
  state: TtsControlState;
}

export type TtsControlResponse =
  | { ok: true; value: TtsControlValue }
  | { ok: false; error: TtsControlError | 'bridge_unavailable'; message: string };

/** Push event from David's `tts:boundary` channel. */
export interface TtsBoundaryEvent {
  jobId: string;
  kind: 'sentence-start' | 'sentence-end' | 'finished' | 'error';
  sentenceIndex?: number;
  errorMessage?: string;
}

export type TtsBoundaryUnsubscribe = () => void;
export type TtsBoundaryListener = (event: TtsBoundaryEvent) => void;

/** Sentinel rate / pitch defaults reused by the UI + thunks so the value
 *  the user sees matches the value the engine receives when "use default"
 *  is selected. */
export const TTS_DEFAULT_RATE = 1.0;
export const TTS_DEFAULT_PITCH = 1.0;
export const TTS_MIN_RATE = 0.5;
export const TTS_MAX_RATE = 2.0;

/** Naive sentence splitter — terminal punctuation followed by whitespace
 *  (or end-of-text). Keeps the punctuation with the sentence so the engine
 *  can use it to drive prosody. Returns `{offset, length}` ranges into the
 *  original text. The engine treats every entry as one sentence; if the
 *  text has no terminal punctuation we return one entry covering the whole
 *  string so boundary events still fire once. */
export function splitSentences(text: string): TtsSentenceBoundary[] {
  if (text.length === 0) return [];
  const out: TtsSentenceBoundary[] = [];
  const regex = /[^.!?\n]+[.!?\n]?\s*/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const trimmedLen = m[0].trimEnd().length;
    if (trimmedLen > 0) {
      out.push({ offset: m.index, length: trimmedLen });
    }
    // Defensive: zero-width matches would loop forever.
    if (m[0].length === 0) regex.lastIndex++;
  }
  if (out.length === 0) {
    out.push({ offset: 0, length: text.length });
  }
  return out;
}
