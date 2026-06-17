// Handlers: tts:listVoices, tts:speakText, tts:pause, tts:resume, tts:stop.
//
// Contract: docs/api-contracts.md §19.5.
// Engine:   src/main/tts/tts-engine.ts.

import { z } from 'zod';

import type { TtsEngine, TtsEngineError } from '../../main/tts/tts-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  TtsControlError,
  TtsControlResponse,
  TtsListVoicesError,
  TtsListVoicesResponse,
  TtsSpeakTextError,
  TtsSpeakTextResponse,
} from '../contracts.js';

// ============================================================================
// Schemas
// ============================================================================

const sentenceBoundarySchema = z.object({
  offset: z.number().int().min(0),
  length: z.number().int().min(1),
});

const speakRequestSchema = z.object({
  text: z.string().min(1),
  voiceId: z.string().optional(),
  rate: z.number().min(0.5).max(2.0).optional(),
  pitch: z.number().min(0.5).max(2.0).optional(),
  sentenceBoundaries: z.array(sentenceBoundarySchema),
});

const controlRequestSchema = z.object({
  jobId: z.string().min(1),
});

// ============================================================================
// Handlers
// ============================================================================

export interface TtsHandlerDeps {
  engine: TtsEngine;
}

export async function handleTtsListVoices(
  _req: unknown,
  deps: TtsHandlerDeps,
): Promise<TtsListVoicesResponse> {
  try {
    const r = await deps.engine.listVoices();
    if (!r.ok) {
      return fail<TtsListVoicesError>('engine_unavailable', r.message);
    }
    return ok(r.value);
  } catch (e) {
    return fail<TtsListVoicesError>(
      'engine_unavailable',
      safeMessage(e, 'voice enumeration threw'),
    );
  }
}

export async function handleTtsSpeakText(
  req: unknown,
  deps: TtsHandlerDeps,
): Promise<TtsSpeakTextResponse> {
  const parsed = speakRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<TtsSpeakTextError>('invalid_payload', parsed.error.message);
  }
  // Conditional spread for exactOptionalPropertyTypes: omit fields the caller
  // did not supply so they don't become `undefined` (which strict mode rejects).
  const d = parsed.data;
  const opts = {
    text: d.text,
    sentenceBoundaries: d.sentenceBoundaries,
    ...(d.voiceId !== undefined ? { voiceId: d.voiceId } : {}),
    ...(d.rate !== undefined ? { rate: d.rate } : {}),
    ...(d.pitch !== undefined ? { pitch: d.pitch } : {}),
  };
  try {
    const r = await deps.engine.speakText(opts);
    if (!r.ok) {
      return mapSpeakError(r.error, r.message);
    }
    return ok(r.value);
  } catch (e) {
    return fail<TtsSpeakTextError>('engine_failed', safeMessage(e, 'speakText threw'));
  }
}

export async function handleTtsPause(
  req: unknown,
  deps: TtsHandlerDeps,
): Promise<TtsControlResponse> {
  const parsed = controlRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<TtsControlError>('invalid_payload', parsed.error.message);
  }
  const r = deps.engine.pause(parsed.data.jobId);
  if (!r.ok) return mapControlError(r.error, r.message);
  return ok(r.value);
}

export async function handleTtsResume(
  req: unknown,
  deps: TtsHandlerDeps,
): Promise<TtsControlResponse> {
  const parsed = controlRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<TtsControlError>('invalid_payload', parsed.error.message);
  }
  const r = deps.engine.resume(parsed.data.jobId);
  if (!r.ok) return mapControlError(r.error, r.message);
  return ok(r.value);
}

export async function handleTtsStop(
  req: unknown,
  deps: TtsHandlerDeps,
): Promise<TtsControlResponse> {
  const parsed = controlRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<TtsControlError>('invalid_payload', parsed.error.message);
  }
  const r = deps.engine.stop(parsed.data.jobId);
  if (!r.ok) return mapControlError(r.error, r.message);
  return ok(r.value);
}

// ============================================================================
// Helpers
// ============================================================================

function mapSpeakError(err: TtsEngineError, message: string): TtsSpeakTextResponse {
  switch (err) {
    case 'invalid_payload':
      return fail<TtsSpeakTextError>('invalid_payload', message);
    case 'engine_unavailable':
      return fail<TtsSpeakTextError>('engine_unavailable', message);
    case 'engine_busy':
      return fail<TtsSpeakTextError>('engine_busy', message);
    case 'job_not_found':
    case 'engine_failed':
    default:
      return fail<TtsSpeakTextError>('engine_failed', message);
  }
}

function mapControlError(err: TtsEngineError, message: string): TtsControlResponse {
  switch (err) {
    case 'invalid_payload':
      return fail<TtsControlError>('invalid_payload', message);
    case 'job_not_found':
      return fail<TtsControlError>('job_not_found', message);
    case 'engine_unavailable':
    case 'engine_busy':
    case 'engine_failed':
    default:
      return fail<TtsControlError>('engine_failed', message);
  }
}
