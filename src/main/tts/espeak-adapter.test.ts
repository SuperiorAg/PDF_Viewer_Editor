// @vitest-environment node
// Phase 7.5 Wave 5a — Linux espeak adapter unit tests.

import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createEspeakAdapter } from './espeak-adapter.js';

interface FakeChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  kill: (signal?: string) => boolean;
}

function makeFakeChild(stdoutChunks: string[] = [], exitCode = 0): FakeChild {
  const emitter = new EventEmitter() as FakeChild;
  emitter.stdout = Readable.from(stdoutChunks.map((s) => Buffer.from(s)));
  emitter.stderr = Readable.from([]);
  emitter.kill = vi.fn(() => true);
  setImmediate(() => emitter.emit('close', exitCode));
  return emitter;
}

describe('espeak-adapter (Linux)', () => {
  it('listVoices spawns `espeak --voices` and parses output', async () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const sample = [
      'Pty Language Age/Gender VoiceName       File         Other Languages',
      ' 5  af              -   afrikaans      gmw/af',
      ' 5  en-us           M   english-us     en-us',
      ' 5  es              F   spanish        roa/es',
      '',
    ].join('\n');
    const spawnFn = vi.fn((command: string, args: readonly string[]) => {
      calls.push({ command, args: [...args] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
      return makeFakeChild([sample]) as any;
    });
    const adapter = createEspeakAdapter({ spawnFn });
    const r = await adapter.listVoices();
    expect(r.engineName).toBe('espeak');
    expect(calls[0]!.command).toBe('espeak');
    expect(calls[0]!.args).toEqual(['--voices']);
    expect(r.voices.length).toBe(3);
    const enUs = r.voices.find((v) => v.locale === 'en-us');
    expect(enUs).toMatchObject({ id: 'en-us', name: 'english-us', gender: 'male' });
  });

  it('spawnSpeech passes -v / -s / -p / text in the correct order', () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const spawnFn = vi.fn((command: string, args: readonly string[]) => {
      calls.push({ command, args: [...args] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
      return makeFakeChild() as any;
    });
    const adapter = createEspeakAdapter({ spawnFn });
    adapter.spawnSpeech(
      {
        text: 'Hello world.',
        voiceId: 'en-us',
        rate: 1.5,
        pitch: 1.0,
        sentenceBoundaries: [{ offset: 0, length: 12 }],
      },
      () => undefined,
    );
    expect(calls[0]!.command).toBe('espeak');
    expect(calls[0]!.args).toEqual([
      '-v',
      'en-us',
      '-s',
      String(Math.round(175 * 1.5)),
      '-p',
      '50',
      'Hello world.',
    ]);
  });

  it('clamps rate / pitch to [0.5, 2.0] and emits finished on success', async () => {
    const spawnFn = vi.fn((_command: string, _args: readonly string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
      return makeFakeChild([], 0) as any;
    });
    const adapter = createEspeakAdapter({ spawnFn });
    const events: { kind: string; sentenceIndex?: number }[] = [];
    adapter.spawnSpeech(
      { text: 'one.', sentenceBoundaries: [{ offset: 0, length: 4 }], rate: 5.0, pitch: 5.0 },
      (e) => events.push(e),
    );
    const args = spawnFn.mock.calls[0]![1] as readonly string[];
    expect(args).toContain(String(Math.round(175 * 2.0))); // rate clamped to 2.0
    expect(args).toContain('99'); // pitch clamped to 99
    await new Promise((r) => setTimeout(r, 25));
    expect(events.some((e) => e.kind === 'finished')).toBe(true);
  });
});
