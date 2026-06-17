// @vitest-environment node
// Phase 7.5 Wave 5a — SAPI adapter unit tests.
//
// Verifies the EXACT argv vector the adapter passes to `spawn()` for both
// `listVoices` and `spawnSpeech`. The subprocess seam is injected so the
// test never launches PowerShell.

import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createSapiAdapter } from './sapi-adapter.js';

interface FakeChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  kill: (signal?: string) => boolean;
}

function makeFakeChild(
  stdoutChunks: string[] = [],
  exitCode = 0,
  stderrChunks: string[] = [],
): FakeChild {
  const emitter = new EventEmitter() as FakeChild;
  emitter.stdout = Readable.from(stdoutChunks.map((s) => Buffer.from(s)));
  emitter.stderr = Readable.from(stderrChunks.map((s) => Buffer.from(s)));
  emitter.kill = vi.fn(() => true);
  // Defer the close event so the streams have time to drain.
  setImmediate(() => emitter.emit('close', exitCode));
  return emitter;
}

describe('sapi-adapter (Windows)', () => {
  it('listVoices spawns powershell with the expected argv and parses JSON output', async () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const spawnFn = vi.fn((command: string, args: readonly string[]) => {
      calls.push({ command, args: [...args] });
      const json = JSON.stringify([
        { id: 'voice-en-1', name: 'Microsoft David', locale: 'en-US', gender: 'male' },
        { id: 'voice-es-1', name: 'Microsoft Helena', locale: 'es-ES', gender: 'female' },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
      return makeFakeChild([json]) as any;
    });
    const adapter = createSapiAdapter({ spawnFn });
    const r = await adapter.listVoices();
    expect(r.engineName).toBe('sapi');
    expect(r.voices).toHaveLength(2);
    expect(r.voices[0]).toMatchObject({
      id: 'voice-en-1',
      name: 'Microsoft David',
      locale: 'en-US',
      gender: 'male',
    });
    // Verify argv shape (load-bearing per Hard-Won Playbook #19 line 5).
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('powershell');
    expect(calls[0]!.args).toEqual(
      expect.arrayContaining([
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-OutputFormat',
        'Text',
        '-Command',
      ]),
    );
    // The script string is the LAST arg and must reference SpeechSynthesizer.
    const cmd = calls[0]!.args[calls[0]!.args.length - 1]!;
    expect(cmd).toContain('System.Speech');
    expect(cmd).toContain('GetInstalledVoices');
  });

  it('spawnSpeech passes the text in a single-quoted PowerShell literal with escaped apostrophes', () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const spawnFn = vi.fn((command: string, args: readonly string[]) => {
      calls.push({ command, args: [...args] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
      return makeFakeChild(['PROGRESS 6\n', 'PROGRESS 13\n', 'DONE\n']) as any;
    });
    const adapter = createSapiAdapter({ spawnFn });
    const events: { kind: string; sentenceIndex?: number }[] = [];
    adapter.spawnSpeech(
      {
        text: "Hello world. It's good.",
        sentenceBoundaries: [
          { offset: 0, length: 12 }, // "Hello world."
          { offset: 13, length: 10 }, // "It's good."
        ],
        rate: 1.0,
      },
      (e) => events.push(e),
    );
    expect(calls[0]!.command).toBe('powershell');
    const script = calls[0]!.args[calls[0]!.args.length - 1]!;
    // The apostrophe in "It's" must be doubled inside the single-quoted PS literal.
    expect(script).toContain("It''s good.");
    expect(script).toContain('SpeechSynthesizer');
    // The first sentence-start fires synchronously.
    expect(events[0]).toEqual({ kind: 'sentence-start', sentenceIndex: 0 });
  });

  it('maps SAPI rate from [0.5..2.0] to [-10..10] correctly', () => {
    const spawnFn = vi.fn((_command: string, _args: readonly string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
      return makeFakeChild() as any;
    });
    const adapter = createSapiAdapter({ spawnFn });
    adapter.spawnSpeech({ text: 'one two', sentenceBoundaries: [], rate: 2.0 }, () => undefined);
    const script = (spawnFn.mock.calls[0]![1] as readonly string[]).at(-1)!;
    expect(script).toMatch(/\$s\.Rate = 10/);
    spawnFn.mockClear();

    adapter.spawnSpeech({ text: 'one two', sentenceBoundaries: [], rate: 0.5 }, () => undefined);
    const script2 = (spawnFn.mock.calls[0]![1] as readonly string[]).at(-1)!;
    expect(script2).toMatch(/\$s\.Rate = -10/);
  });

  it('SelectVoice is wired only when voiceId is supplied', () => {
    const spawnFn = vi.fn((_command: string, _args: readonly string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
      return makeFakeChild() as any;
    });
    const adapter = createSapiAdapter({ spawnFn });
    adapter.spawnSpeech(
      { text: 'hi', sentenceBoundaries: [], voiceId: 'voice-en-1' },
      () => undefined,
    );
    let script = (spawnFn.mock.calls[0]![1] as readonly string[]).at(-1)!;
    expect(script).toContain("SelectVoice('voice-en-1')");
    spawnFn.mockClear();
    adapter.spawnSpeech({ text: 'hi', sentenceBoundaries: [] }, () => undefined);
    script = (spawnFn.mock.calls[0]![1] as readonly string[]).at(-1)!;
    expect(script).not.toContain('SelectVoice');
  });
});
