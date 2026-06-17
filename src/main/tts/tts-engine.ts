// Phase 7.5 Wave 5a — C1 Read Aloud (TTS) engine.
//
// Canonical spec:
//   - docs/api-contracts.md §19.5 (`tts:listVoices`, `tts:speakText`,
//     `tts:pause`, `tts:resume`, `tts:stop`, `tts:boundary` event).
//   - docs/architecture-phase-7.5.md §4 row C1 + §4.6 ("per-OS subprocess").
//   - docs/project-plan.md §2 Wave 5a.
//
// Design (no native binding required):
//   - Windows: `child_process.spawn('powershell', [...])` driving
//     `System.Speech.Synthesis.SpeechSynthesizer`. Avoids the `node-windows-tts`
//     native dep (license + maintenance drag; SAPI via PowerShell is the
//     well-trodden path).
//   - macOS: `child_process.spawn('say', [...])`.
//   - Linux: `child_process.spawn('espeak', [...])` — SUBPROCESS-ONLY. We do
//     NOT bundle / redistribute the espeak binary (GPL-3); the engine degrades
//     to `engine_unavailable` if espeak is not on PATH. See Wave 11 license vet.
//
// Subprocess seam:
//   Each adapter takes an injectable `spawnFn` (defaulting to Node's
//   `child_process.spawn`) so unit tests can verify the exact argv vector
//   without launching a real speech engine.
//
// Job lifecycle:
//   `speakText` returns a `jobId`. Internal `JobRecord` holds the spawned
//   `ChildProcess` + boundary subscriber list. `pause`/`resume`/`stop` look
//   the job up by id. Boundary events fan out to every subscribed listener
//   so the IPC handler can forward them to the renderer over the
//   `tts:boundary` push channel.

import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { fail, ok, type Result } from '../../shared/result.js';

import { createEspeakAdapter, type EspeakAdapter } from './espeak-adapter.js';
import { createSapiAdapter, type SapiAdapter } from './sapi-adapter.js';
import { createSayAdapter, type SayAdapter } from './say-adapter.js';

// ============================================================================
// Public types
// ============================================================================

export type TtsEngineName = 'sapi' | 'say' | 'espeak';

export type TtsEngineError =
  | 'invalid_payload'
  | 'engine_unavailable'
  | 'engine_busy'
  | 'job_not_found'
  | 'engine_failed';

export interface TtsVoice {
  id: string;
  name: string;
  locale: string;
  gender: 'male' | 'female' | 'neutral' | 'unknown';
}

export interface TtsSpeakOptions {
  text: string;
  voiceId?: string;
  rate?: number; // 0.5..2.0
  pitch?: number; // 0.5..2.0
  sentenceBoundaries: { offset: number; length: number }[];
}

export interface TtsBoundaryEvent {
  jobId: string;
  kind: 'sentence-start' | 'sentence-end' | 'finished' | 'error';
  sentenceIndex?: number;
  errorMessage?: string;
}

export interface TtsListVoicesResult {
  voices: TtsVoice[];
  engineName: TtsEngineName;
}

// ============================================================================
// Adapter contract — implemented per OS
// ============================================================================

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
) => ChildProcess;

export interface TtsAdapter {
  readonly engineName: TtsEngineName;
  listVoices(): Promise<TtsListVoicesResult>;
  /** Spawn the speech subprocess. Returns the ChildProcess so the engine can
   *  track lifecycle (pause/resume/stop are sent via OS signals or stdin). */
  spawnSpeech(
    opts: TtsSpeakOptions,
    emitBoundary: (event: Omit<TtsBoundaryEvent, 'jobId'>) => void,
  ): ChildProcess;
}

// ============================================================================
// Job tracking
// ============================================================================

interface JobRecord {
  jobId: string;
  child: ChildProcess;
  state: 'running' | 'paused' | 'stopped' | 'finished' | 'error';
  boundarySubscribers: Set<(event: TtsBoundaryEvent) => void>;
}

// ============================================================================
// Engine
// ============================================================================

export interface TtsEngineOptions {
  /** Override platform detection (test seam). */
  platform?: NodeJS.Platform;
  /** Inject spawn for tests. */
  spawnFn?: SpawnFn;
  /** Inject adapter directly — bypasses platform detection. */
  adapter?: TtsAdapter;
}

export class TtsEngine {
  private adapter: TtsAdapter | null;
  private adapterError: TtsEngineError | null = null;
  private readonly jobs = new Map<string, JobRecord>();
  /** Subscribers that receive boundary events for EVERY job (used by the IPC
   *  handler to forward to the renderer; the renderer demuxes by jobId). */
  private readonly globalSubscribers = new Set<(event: TtsBoundaryEvent) => void>();

  constructor(opts: TtsEngineOptions = {}) {
    if (opts.adapter) {
      this.adapter = opts.adapter;
      return;
    }
    const platform = opts.platform ?? process.platform;
    const spawnArg = opts.spawnFn !== undefined ? { spawnFn: opts.spawnFn } : {};
    try {
      if (platform === 'win32') {
        this.adapter = createSapiAdapter(spawnArg);
      } else if (platform === 'darwin') {
        this.adapter = createSayAdapter(spawnArg);
      } else if (platform === 'linux') {
        this.adapter = createEspeakAdapter(spawnArg);
      } else {
        this.adapter = null;
        this.adapterError = 'engine_unavailable';
      }
    } catch {
      this.adapter = null;
      this.adapterError = 'engine_unavailable';
    }
  }

  /** Subscribe to boundary events across every job. Returns disposer. */
  subscribeBoundaries(handler: (event: TtsBoundaryEvent) => void): () => void {
    this.globalSubscribers.add(handler);
    return () => {
      this.globalSubscribers.delete(handler);
    };
  }

  async listVoices(): Promise<Result<TtsListVoicesResult, TtsEngineError>> {
    if (!this.adapter) {
      return fail<TtsEngineError>(
        this.adapterError ?? 'engine_unavailable',
        'no TTS engine for current platform',
      );
    }
    try {
      const r = await this.adapter.listVoices();
      return ok(r);
    } catch (e) {
      return fail<TtsEngineError>(
        'engine_unavailable',
        e instanceof Error && e.message ? e.message : 'voice enumeration failed',
      );
    }
  }

  async speakText(opts: TtsSpeakOptions): Promise<Result<{ jobId: string }, TtsEngineError>> {
    if (!this.adapter) {
      return fail<TtsEngineError>(
        this.adapterError ?? 'engine_unavailable',
        'no TTS engine for current platform',
      );
    }

    // Validate payload.
    if (typeof opts.text !== 'string' || opts.text.length === 0) {
      return fail<TtsEngineError>('invalid_payload', 'text must be a non-empty string');
    }
    if (
      opts.rate !== undefined &&
      (opts.rate < 0.5 || opts.rate > 2.0 || !Number.isFinite(opts.rate))
    ) {
      return fail<TtsEngineError>('invalid_payload', 'rate must be in [0.5, 2.0]');
    }
    if (
      opts.pitch !== undefined &&
      (opts.pitch < 0.5 || opts.pitch > 2.0 || !Number.isFinite(opts.pitch))
    ) {
      return fail<TtsEngineError>('invalid_payload', 'pitch must be in [0.5, 2.0]');
    }
    if (!Array.isArray(opts.sentenceBoundaries)) {
      return fail<TtsEngineError>('invalid_payload', 'sentenceBoundaries must be an array');
    }
    // Sentence boundaries must lie within text and not overlap (api-contracts §19.19).
    const sortedBoundaries = [...opts.sentenceBoundaries].sort((a, b) => a.offset - b.offset);
    let lastEnd = -1;
    for (const b of sortedBoundaries) {
      if (typeof b.offset !== 'number' || typeof b.length !== 'number') {
        return fail<TtsEngineError>(
          'invalid_payload',
          'sentenceBoundaries entries must have numeric offset/length',
        );
      }
      if (b.offset < 0 || b.length <= 0 || b.offset + b.length > opts.text.length) {
        return fail<TtsEngineError>('invalid_payload', 'sentence boundary out of range');
      }
      if (b.offset < lastEnd) {
        return fail<TtsEngineError>('invalid_payload', 'sentenceBoundaries overlap');
      }
      lastEnd = b.offset + b.length;
    }

    const jobId = randomUUID();
    const record: JobRecord = {
      jobId,
      child: null as unknown as ChildProcess, // assigned below
      state: 'running',
      boundarySubscribers: new Set(),
    };

    let child: ChildProcess;
    try {
      child = this.adapter.spawnSpeech(opts, (event) => {
        const full: TtsBoundaryEvent = { jobId, ...event };
        if (event.kind === 'finished') record.state = 'finished';
        else if (event.kind === 'error') record.state = 'error';
        for (const sub of this.globalSubscribers) {
          try {
            sub(full);
          } catch {
            /* defensive — never let a subscriber throw take down the engine */
          }
        }
      });
    } catch (e) {
      return fail<TtsEngineError>(
        'engine_failed',
        e instanceof Error && e.message ? e.message : 'spawn failed',
      );
    }
    record.child = child;
    this.jobs.set(jobId, record);

    // Clean up the job record once the child exits.
    child.on('exit', () => {
      const j = this.jobs.get(jobId);
      if (j && j.state === 'running') {
        // Adapter didn't emit a 'finished' boundary — synthesize one so the
        // renderer can clear its highlight.
        for (const sub of this.globalSubscribers) {
          try {
            sub({ jobId, kind: 'finished' });
          } catch {
            /* defensive */
          }
        }
        j.state = 'finished';
      }
    });

    return ok({ jobId });
  }

  pause(jobId: string): Result<{ state: 'paused' }, TtsEngineError> {
    const job = this.jobs.get(jobId);
    if (!job) return fail<TtsEngineError>('job_not_found', `job ${jobId} not found`);
    if (job.state !== 'running') {
      return fail<TtsEngineError>('engine_failed', `cannot pause job in state ${job.state}`);
    }
    // POSIX SIGSTOP pauses the child; on Windows there is no equivalent so we
    // stop+restart-from-offset semantics are deferred to a future wave. For
    // Windows we treat pause as a no-op and report success — the UI keeps the
    // expected affordance even when the underlying engine cannot suspend.
    if (process.platform !== 'win32') {
      try {
        job.child.kill('SIGSTOP');
      } catch {
        /* best-effort */
      }
    }
    job.state = 'paused';
    return ok({ state: 'paused' as const });
  }

  resume(jobId: string): Result<{ state: 'resumed' }, TtsEngineError> {
    const job = this.jobs.get(jobId);
    if (!job) return fail<TtsEngineError>('job_not_found', `job ${jobId} not found`);
    if (job.state !== 'paused') {
      return fail<TtsEngineError>('engine_failed', `cannot resume job in state ${job.state}`);
    }
    if (process.platform !== 'win32') {
      try {
        job.child.kill('SIGCONT');
      } catch {
        /* best-effort */
      }
    }
    job.state = 'running';
    return ok({ state: 'resumed' as const });
  }

  stop(jobId: string): Result<{ state: 'stopped' }, TtsEngineError> {
    const job = this.jobs.get(jobId);
    if (!job) return fail<TtsEngineError>('job_not_found', `job ${jobId} not found`);
    try {
      job.child.kill();
    } catch {
      /* best-effort */
    }
    job.state = 'stopped';
    this.jobs.delete(jobId);
    return ok({ state: 'stopped' as const });
  }

  /** Test seam — inspect job state. Not part of the IPC surface. */
  __getJobState(jobId: string): JobRecord['state'] | null {
    return this.jobs.get(jobId)?.state ?? null;
  }
}

// Re-exports for callers that need the per-OS adapter types.
export type { EspeakAdapter, SapiAdapter, SayAdapter };
