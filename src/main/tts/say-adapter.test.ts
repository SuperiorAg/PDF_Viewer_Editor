// @vitest-environment node
// Phase 7.5 Wave 5a — macOS `say` adapter unit tests.
//
// Verifies the EXACT argv vector and the listVoices output parse against a
// recorded `say -v ?` excerpt.

import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createSayAdapter } from './say-adapter.js';

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

describe('say-adapter (macOS)', () => {
  it('listVoices spawns `say -v ?` and parses the column output', async () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const sample = [
      'Alex                en_US    # Most people recognize me by my voice.',
      'Alice               it_IT    # Salve, mi chiamo Alice e sono una voce italiana.',
      'Bad News            en_US    # The light you see at the end of the tunnel...',
      '',
    ].join('\n');
    const spawnFn = vi.fn((command: string, args: readonly string[]) => {
      calls.push({ command, args: [...args] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
      return makeFakeChild([sample]) as any;
    });
    const adapter = createSayAdapter({ spawnFn });
    const r = await adapter.listVoices();
    expect(r.engineName).toBe('say');
    expect(calls[0]!.command).toBe('say');
    expect(calls[0]!.args).toEqual(['-v', '?']);
    expect(r.voices.length).toBeGreaterThanOrEqual(3);
    const alex = r.voices.find((v) => v.name === 'Alex');
    expect(alex).toMatchObject({ id: 'Alex', locale: 'en-US' });
    // Names with spaces survive the split.
    const badNews = r.voices.find((v) => v.name === 'Bad News');
    expect(badNews).toBeDefined();
    expect(badNews!.locale).toBe('en-US');
  });

  it('spawnSpeech passes voice + rate as argv (NOT via stdin)', () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const spawnFn = vi.fn((command: string, args: readonly string[]) => {
      calls.push({ command, args: [...args] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
      return makeFakeChild([]) as any;
    });
    const adapter = createSayAdapter({ spawnFn });
    adapter.spawnSpeech(
      {
        text: 'Hello world.',
        voiceId: 'Alex',
        rate: 1.5,
        sentenceBoundaries: [{ offset: 0, length: 12 }],
      },
      () => undefined,
    );
    expect(calls[0]!.command).toBe('say');
    // [-v Alex, -r 263, "Hello world."]
    expect(calls[0]!.args).toEqual([
      '-v',
      'Alex',
      '-r',
      String(Math.round(175 * 1.5)),
      'Hello world.',
    ]);
  });

  it('emits sentence-start synchronously and finished after close', async () => {
    const spawnFn = vi.fn((_command: string, _args: readonly string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
      return makeFakeChild([], 0) as any;
    });
    const adapter = createSayAdapter({ spawnFn });
    const events: { kind: string; sentenceIndex?: number }[] = [];
    adapter.spawnSpeech(
      { text: 'one. two.', sentenceBoundaries: [{ offset: 0, length: 4 }] },
      (e) => events.push(e),
    );
    expect(events[0]).toEqual({ kind: 'sentence-start', sentenceIndex: 0 });
    // wait for close.
    await new Promise((r) => setTimeout(r, 25));
    expect(events.some((e) => e.kind === 'finished')).toBe(true);
  });
});
