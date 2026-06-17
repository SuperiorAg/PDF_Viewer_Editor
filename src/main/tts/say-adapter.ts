// macOS `say` adapter.
//
// `say` is OS-bundled and accepts:
//   say -v <voice>     # voice name
//   say -r <wpm>       # words-per-minute (~175 default)
//   say -o <file>      # output to file (we DON'T use this; live playback)
//   say "<text>"       # text to speak
//
// `say -v ?` enumerates voices: lines look like:
//   "Alex                en_US    # Most people recognize me by my voice."
//   We parse the first three whitespace-separated columns (name, locale,
//   comment) — the comment may contain `# ...` we discard.
//
// `say` does NOT emit word boundaries on stdout. We synthesize sentence-start
// for each sentence at a coarse interval based on text length; not perfectly
// synchronized but adequate for the v1 highlight UX (Read Aloud is best-effort
// on platforms without true boundary events per docs/api-contracts.md §19.5.4).

import { spawn, type ChildProcess } from 'node:child_process';

import type {
  SpawnFn,
  TtsAdapter,
  TtsListVoicesResult,
  TtsSpeakOptions,
  TtsVoice,
} from './tts-engine.js';

export interface SayAdapter extends TtsAdapter {
  readonly engineName: 'say';
}

export interface SayAdapterOptions {
  spawnFn?: SpawnFn;
}

export function createSayAdapter(opts: SayAdapterOptions = {}): SayAdapter {
  const spawnFn = opts.spawnFn ?? (spawn as SpawnFn);

  const listVoices = async (): Promise<TtsListVoicesResult> => {
    return await new Promise<TtsListVoicesResult>((resolve, reject) => {
      const child = spawnFn('say', ['-v', '?'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      child.stdout?.on('data', (b: Buffer) => chunks.push(b));
      child.stderr?.on('data', (b: Buffer) => errChunks.push(b));
      child.on('error', (e) => reject(e));
      child.on('close', (code: number | null) => {
        if (code !== 0) {
          reject(new Error(Buffer.concat(errChunks).toString('utf8') || `say exited ${code}`));
          return;
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        const voices: TtsVoice[] = [];
        for (const rawLine of raw.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          // Format: "<name padded><locale padded># comment".
          // Split first on '#' to strip the comment, then on whitespace.
          const hashIdx = line.indexOf('#');
          const head = (hashIdx >= 0 ? line.slice(0, hashIdx) : line).trim();
          // Voice names may contain spaces ("Bad News"); split off the LAST
          // whitespace-separated token as the locale, then re-join the rest as
          // the name.
          const m = /^(.+?)\s+([a-z]{2}_[A-Z]{2})$/.exec(head);
          if (!m) continue;
          const name = m[1]!.trim();
          const locale = m[2]!.replace('_', '-');
          voices.push({
            id: name,
            name,
            locale,
            gender: 'unknown',
          });
        }
        resolve({ voices, engineName: 'say' });
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
      // Map [0.5..2.0] to ~[85..350] wpm centered on 175.
      const wpm = Math.round(175 * Math.max(0.5, Math.min(2.0, opts.rate)));
      args.push('-r', String(wpm));
    }
    // Text is the final positional argument — pass via argv (NOT stdin) so
    // `say` reads it as a single utterance.
    args.push(opts.text);

    const child = spawnFn('say', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    // Synthesize coarse sentence-start events at evenly-spaced intervals.
    // `say` does not emit progress; this is best-effort highlight pacing.
    const sortedBoundaries = [...opts.sentenceBoundaries].sort((a, b) => a.offset - b.offset);
    if (sortedBoundaries.length > 0) {
      emitBoundary({ kind: 'sentence-start', sentenceIndex: 0 });
    }

    let nextSentenceIdx = 1;
    let timer: NodeJS.Timeout | null = null;
    if (sortedBoundaries.length > 1) {
      // Rough estimate: ~5 chars/word at 175 wpm => ~36 chars/sec at rate=1.0.
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
        emitBoundary({ kind: 'error', errorMessage: `say exited ${code}` });
      }
    });

    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      emitBoundary({ kind: 'error', errorMessage: e.message });
    });

    return child;
  };

  return {
    engineName: 'say',
    listVoices,
    spawnSpeech,
  };
}
