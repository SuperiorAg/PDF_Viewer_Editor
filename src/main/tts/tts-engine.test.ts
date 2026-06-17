// @vitest-environment node
// Phase 7.5 Wave 5a — TTS engine unit tests.
//
// Verifies engine-level behavior with an injected adapter — adapter-specific
// subprocess wiring is covered by sapi/say/espeak-adapter.test.ts.

import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { TtsEngine, type TtsAdapter, type TtsBoundaryEvent } from './tts-engine.js';

function makeFakeChild(): EventEmitter & Pick<ChildProcess, 'kill'> {
  const e = new EventEmitter() as EventEmitter & Pick<ChildProcess, 'kill'>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
  (e as any).kill = (_signal?: string): boolean => true;
  return e;
}

function makeAdapter(
  opts: {
    voices?: {
      id: string;
      name: string;
      locale: string;
      gender: 'male' | 'female' | 'neutral' | 'unknown';
    }[];
    onSpawn?: (emit: (e: Omit<TtsBoundaryEvent, 'jobId'>) => void) => void;
  } = {},
): TtsAdapter {
  return {
    engineName: 'sapi',
    listVoices: async () => ({
      voices: opts.voices ?? [{ id: 'v1', name: 'Voice 1', locale: 'en-US', gender: 'female' }],
      engineName: 'sapi',
    }),
    spawnSpeech: (_opts, emit) => {
      const child = makeFakeChild();
      if (opts.onSpawn) {
        // Defer so the caller receives the jobId before the boundary fires.
        setImmediate(() => opts.onSpawn!(emit));
      }
      return child as unknown as ChildProcess;
    },
  };
}

describe('TtsEngine', () => {
  it('listVoices returns the adapter result', async () => {
    const engine = new TtsEngine({ adapter: makeAdapter() });
    const r = await engine.listVoices();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.engineName).toBe('sapi');
    expect(r.value.voices).toHaveLength(1);
  });

  it('returns engine_unavailable on unsupported platform', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
    const engine = new TtsEngine({ platform: 'freebsd' as any });
    const r = await engine.listVoices();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('engine_unavailable');
  });

  it('validates text + rate + pitch + sentenceBoundaries', async () => {
    const engine = new TtsEngine({ adapter: makeAdapter() });
    const empty = await engine.speakText({ text: '', sentenceBoundaries: [] });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toBe('invalid_payload');

    const badRate = await engine.speakText({ text: 'hi', sentenceBoundaries: [], rate: 5 });
    expect(badRate.ok).toBe(false);

    const badPitch = await engine.speakText({ text: 'hi', sentenceBoundaries: [], pitch: 5 });
    expect(badPitch.ok).toBe(false);

    const oob = await engine.speakText({
      text: 'hi',
      sentenceBoundaries: [{ offset: 0, length: 100 }],
    });
    expect(oob.ok).toBe(false);

    const overlapping = await engine.speakText({
      text: 'hello world',
      sentenceBoundaries: [
        { offset: 0, length: 5 },
        { offset: 3, length: 5 }, // overlaps
      ],
    });
    expect(overlapping.ok).toBe(false);
    if (!overlapping.ok) expect(overlapping.error).toBe('invalid_payload');
  });

  it('speakText returns a jobId and forwards boundary events to subscribers', async () => {
    let capturedEmit: ((e: Omit<TtsBoundaryEvent, 'jobId'>) => void) | null = null;
    const engine = new TtsEngine({
      adapter: makeAdapter({
        onSpawn: (emit) => {
          capturedEmit = emit;
        },
      }),
    });

    const events: TtsBoundaryEvent[] = [];
    engine.subscribeBoundaries((e) => events.push(e));

    const r = await engine.speakText({
      text: 'Hello world. Goodbye.',
      sentenceBoundaries: [
        { offset: 0, length: 12 },
        { offset: 13, length: 8 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const jobId = r.value.jobId;
    expect(typeof jobId).toBe('string');
    expect(jobId.length).toBeGreaterThan(8);

    // Wait for the setImmediate that schedules adapter emissions.
    await new Promise((res) => setImmediate(res));
    capturedEmit!({ kind: 'sentence-start', sentenceIndex: 0 });
    capturedEmit!({ kind: 'finished' });

    expect(events).toContainEqual({ jobId, kind: 'sentence-start', sentenceIndex: 0 });
    expect(events).toContainEqual({ jobId, kind: 'finished' });
  });

  it('pause / resume / stop control by jobId', async () => {
    const engine = new TtsEngine({ adapter: makeAdapter() });
    const r = await engine.speakText({ text: 'one two', sentenceBoundaries: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.value.jobId;

    const paused = engine.pause(id);
    expect(paused.ok).toBe(true);
    expect(engine.__getJobState(id)).toBe('paused');

    const resumed = engine.resume(id);
    expect(resumed.ok).toBe(true);
    expect(engine.__getJobState(id)).toBe('running');

    const stopped = engine.stop(id);
    expect(stopped.ok).toBe(true);
    // Stopped job is removed from the table.
    expect(engine.__getJobState(id)).toBeNull();

    const missing = engine.pause('not-a-job');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe('job_not_found');
  });
});
