// Linux espeak adapter — SUBPROCESS-ONLY.
//
// LICENSE NOTE (P7.5 Wave 5a, project-plan §2):
//   espeak is GPL-3. Subprocess-only usage is the safe pattern (we shell out;
//   we don't link, embed, or redistribute). We do NOT bundle the espeak
//   binary in the Electron installer; Diego confirms in Wave 11. If the
//   binary is not on PATH, Linux degrades to `engine_unavailable` and the
//   renderer surfaces an honest "Install espeak (apt install espeak) to use
//   Read Aloud on Linux" message. Do not change this without re-vetting.
//
// espeak invocation:
//   espeak --voices             # list voices (column-delimited)
//   espeak -v <voice> -s <wpm>  # rate + voice
//   espeak -p <pitch>           # pitch in [0..99], default 50
//   espeak "<text>"             # speak text
//
// Boundary events:
//   espeak emits word indices on stderr ONLY when invoked with --pho or
//   special args; we don't enable those because the format is fragile across
//   distros. Boundary events are coarse — we synthesize them on the Node
//   side via the same time-based heuristic the `say` adapter uses.

import { spawn, type ChildProcess } from 'node:child_process';

import type {
  SpawnFn,
  TtsAdapter,
  TtsListVoicesResult,
  TtsSpeakOptions,
  TtsVoice,
} from './tts-engine.js';

export interface EspeakAdapter extends TtsAdapter {
  readonly engineName: 'espeak';
}

export interface EspeakAdapterOptions {
  spawnFn?: SpawnFn;
}

export function createEspeakAdapter(opts: EspeakAdapterOptions = {}): EspeakAdapter {
  const spawnFn = opts.spawnFn ?? (spawn as SpawnFn);

  const listVoices = async (): Promise<TtsListVoicesResult> => {
    return await new Promise<TtsListVoicesResult>((resolve, reject) => {
      const child = spawnFn('espeak', ['--voices'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      child.stdout?.on('data', (b: Buffer) => chunks.push(b));
      child.stderr?.on('data', (b: Buffer) => errChunks.push(b));
      child.on('error', (e) => reject(e));
      child.on('close', (code: number | null) => {
        if (code !== 0) {
          reject(new Error(Buffer.concat(errChunks).toString('utf8') || `espeak exited ${code}`));
          return;
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        const lines = raw.split(/\r?\n/);
        const voices: TtsVoice[] = [];
        // espeak --voices output:
        //   Pty Language Age/Gender VoiceName       File         Other Languages
        //    5  af              -   afrikaans      gmw/af
        // Skip the header line.
        for (let i = 1; i < lines.length; i += 1) {
          const line = lines[i]!.trim();
          if (!line) continue;
          const cols = line.split(/\s+/);
          if (cols.length < 5) continue;
          const language = cols[1]!;
          const agGender = cols[2]!;
          const voiceName = cols[3]!;
          const file = cols[4]!;
          voices.push({
            id: file,
            name: voiceName,
            locale: language,
            gender: agGender === 'M' ? 'male' : agGender === 'F' ? 'female' : 'unknown',
          });
        }
        resolve({ voices, engineName: 'espeak' });
      });
    });
  };

  const spawnSpeech = (
    opts: TtsSpeakOptions,
    emitBoundary: (event: {
      kind: 'sentence-start' | 'sentence-end' | 'finished' | 'error';
      sentenceIndex?: number;
      errorMessage?: string;
    }) => void,
  ): ChildProcess => {
    const args: string[] = [];
    if (opts.voiceId) {
      args.push('-v', opts.voiceId);
    }
    if (opts.rate !== undefined) {
      // espeak default ~175 wpm; map [0.5..2.0] -> [88..350].
      const wpm = Math.round(175 * Math.max(0.5, Math.min(2.0, opts.rate)));
      args.push('-s', String(wpm));
    }
    if (opts.pitch !== undefined) {
      // espeak pitch is [0..99], default 50. Map [0.5..2.0] -> [25..99].
      const p = Math.round(50 * Math.max(0.5, Math.min(2.0, opts.pitch)));
      args.push('-p', String(Math.min(99, p)));
    }
    args.push(opts.text);

    const child = spawnFn('espeak', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const sortedBoundaries = [...opts.sentenceBoundaries].sort((a, b) => a.offset - b.offset);
    if (sortedBoundaries.length > 0) {
      emitBoundary({ kind: 'sentence-start', sentenceIndex: 0 });
    }

    let nextSentenceIdx = 1;
    let timer: NodeJS.Timeout | null = null;
    if (sortedBoundaries.length > 1) {
      const charsPerMs = (175 / 60_000) * 5 * Math.max(0.5, Math.min(2.0, opts.rate ?? 1.0));
      const tick = (): void => {
        if (nextSentenceIdx >= sortedBoundaries.length) return;
        const prev = sortedBoundaries[nextSentenceIdx - 1]!;
        const curr = sortedBoundaries[nextSentenceIdx]!;
        const delayMs = Math.max(50, (curr.offset - prev.offset) / Math.max(charsPerMs, 0.001));
        timer = setTimeout(() => {
          emitBoundary({ kind: 'sentence-end', sentenceIndex: nextSentenceIdx - 1 });
          emitBoundary({ kind: 'sentence-start', sentenceIndex: nextSentenceIdx });
          nextSentenceIdx += 1;
          tick();
        }, delayMs);
      };
      tick();
    }

    child.on('close', (code: number | null) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        if (sortedBoundaries.length > 0) {
          emitBoundary({ kind: 'sentence-end', sentenceIndex: sortedBoundaries.length - 1 });
        }
        emitBoundary({ kind: 'finished' });
      } else if (code !== null) {
        emitBoundary({ kind: 'error', errorMessage: `espeak exited ${code}` });
      }
    });

    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      emitBoundary({ kind: 'error', errorMessage: e.message });
    });

    return child;
  };

  return {
    engineName: 'espeak',
    listVoices,
    spawnSpeech,
  };
}
