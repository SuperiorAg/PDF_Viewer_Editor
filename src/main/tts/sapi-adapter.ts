// SAPI adapter — Windows TTS via PowerShell + System.Speech.Synthesis.
//
// Why PowerShell instead of a native binding (e.g. node-windows-tts):
//   - Zero new native deps; no rebuild-per-Electron-ABI step.
//   - SAPI is OS-bundled — no installer changes.
//   - The subprocess seam is uniform with `say` (macOS) and `espeak` (Linux).
//
// Subprocess invocation pattern (mirrors Hard-Won Playbook #19 line 5):
//   We use `-NoProfile -ExecutionPolicy Bypass -Command "& { ... }"` (NOT
//   `-File`) so stdout is unbuffered — `tts:boundary` events flow back to
//   the renderer in real time. The PowerShell script wires SpeakProgress
//   events to `[Console]::Out.WriteLine(...)` + `[Console]::Out.Flush()`
//   inside the event handler.
//
// Boundary events:
//   SAPI raises `SpeakProgress` per word; we emit one structured `boundary`
//   line per sentence boundary by matching the cumulative character offset
//   against the renderer-provided `sentenceBoundaries` array. The mapping
//   happens in the parent (Node) side so the PowerShell stays small.

import { spawn, type ChildProcess } from 'node:child_process';

import type {
  SpawnFn,
  TtsAdapter,
  TtsListVoicesResult,
  TtsSpeakOptions,
  TtsVoice,
} from './tts-engine.js';

export interface SapiAdapter extends TtsAdapter {
  readonly engineName: 'sapi';
}

export interface SapiAdapterOptions {
  spawnFn?: SpawnFn;
}

const POWERSHELL_LIST_VOICES_SCRIPT = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$out = @()
foreach ($v in $s.GetInstalledVoices()) {
  $info = $v.VoiceInfo
  $out += [PSCustomObject]@{
    id = $info.Id
    name = $info.Name
    locale = $info.Culture.Name
    gender = $info.Gender.ToString().ToLower()
  }
}
$out | ConvertTo-Json -Compress -Depth 3
`;

export function createSapiAdapter(opts: SapiAdapterOptions = {}): SapiAdapter {
  const spawnFn = opts.spawnFn ?? (spawn as SpawnFn);

  const listVoices = async (): Promise<TtsListVoicesResult> => {
    return await new Promise<TtsListVoicesResult>((resolve, reject) => {
      const args = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-OutputFormat',
        'Text',
        '-Command',
        POWERSHELL_LIST_VOICES_SCRIPT,
      ];
      const child = spawnFn('powershell', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      child.stdout?.on('data', (b: Buffer) => chunks.push(b));
      child.stderr?.on('data', (b: Buffer) => errChunks.push(b));
      child.on('error', (e) => reject(e));
      child.on('close', (code: number | null) => {
        if (code !== 0) {
          const errMsg = Buffer.concat(errChunks).toString('utf8') || `powershell exited ${code}`;
          reject(new Error(errMsg));
          return;
        }
        try {
          const raw = Buffer.concat(chunks).toString('utf8').trim();
          if (raw.length === 0) {
            resolve({ voices: [], engineName: 'sapi' });
            return;
          }
          const parsed = JSON.parse(raw) as unknown;
          const list = Array.isArray(parsed) ? parsed : [parsed];
          const voices: TtsVoice[] = [];
          for (const item of list) {
            if (item && typeof item === 'object') {
              const o = item as Record<string, unknown>;
              voices.push({
                id: String(o['id'] ?? ''),
                name: String(o['name'] ?? ''),
                locale: String(o['locale'] ?? ''),
                gender: normalizeGender(String(o['gender'] ?? 'unknown')),
              });
            }
          }
          resolve({ voices, engineName: 'sapi' });
        } catch (e) {
          reject(e instanceof Error ? e : new Error('parse failed'));
        }
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
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-OutputFormat',
      'Text',
      '-Command',
      buildSpeakScript(opts),
    ];
    const child = spawnFn('powershell', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    // Track the cumulative char offset of completed words to map word
    // progress -> sentence boundaries.
    let cumulativeOffset = 0;
    let lastEmittedSentenceIndex = -1;
    const sortedBoundaries = [...opts.sentenceBoundaries].sort((a, b) => a.offset - b.offset);

    // Emit sentence-start for the FIRST sentence immediately so the renderer
    // can highlight before the speech engine warms up.
    if (sortedBoundaries.length > 0) {
      emitBoundary({ kind: 'sentence-start', sentenceIndex: 0 });
      lastEmittedSentenceIndex = 0;
    }

    let stdoutBuf = '';
    child.stdout?.on('data', (b: Buffer) => {
      stdoutBuf += b.toString('utf8');
      let nl: number;
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        // Lines from the PowerShell helper look like:
        //   PROGRESS <charPosition>
        //   DONE
        //   ERROR <message>
        if (line.startsWith('PROGRESS ')) {
          const pos = Number.parseInt(line.slice(9), 10);
          if (Number.isFinite(pos)) {
            cumulativeOffset = pos;
            const idx = findSentenceIndex(sortedBoundaries, cumulativeOffset);
            if (idx > lastEmittedSentenceIndex) {
              if (lastEmittedSentenceIndex >= 0) {
                emitBoundary({ kind: 'sentence-end', sentenceIndex: lastEmittedSentenceIndex });
              }
              emitBoundary({ kind: 'sentence-start', sentenceIndex: idx });
              lastEmittedSentenceIndex = idx;
            }
          }
        } else if (line === 'DONE') {
          if (lastEmittedSentenceIndex >= 0) {
            emitBoundary({ kind: 'sentence-end', sentenceIndex: lastEmittedSentenceIndex });
          }
          emitBoundary({ kind: 'finished' });
        } else if (line.startsWith('ERROR ')) {
          emitBoundary({ kind: 'error', errorMessage: line.slice(6) });
        }
      }
    });

    child.on('error', (e) => {
      emitBoundary({ kind: 'error', errorMessage: e.message });
    });

    return child;
  };

  return {
    engineName: 'sapi',
    listVoices,
    spawnSpeech,
  };
}

function normalizeGender(raw: string): TtsVoice['gender'] {
  const v = raw.toLowerCase();
  if (v === 'male' || v === 'female' || v === 'neutral') return v;
  return 'unknown';
}

function findSentenceIndex(
  boundaries: { offset: number; length: number }[],
  charOffset: number,
): number {
  let lo = 0;
  let hi = boundaries.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = boundaries[mid]!;
    if (b.offset <= charOffset) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Build the PowerShell script that drives SpeechSynthesizer. ALL inputs flow
 * through escapePsSingleQuotedString — never via argv. The script emits
 * one PROGRESS line per SpeakProgressEvent, then DONE on completion.
 *
 * Pure-ASCII per Hard-Won Playbook #19 line 4: no smart quotes / em-dashes.
 */
function buildSpeakScript(opts: TtsSpeakOptions): string {
  const text = escapePsSingleQuotedString(opts.text);
  const voiceId = opts.voiceId ? escapePsSingleQuotedString(opts.voiceId) : '';
  // SAPI rate is in [-10..10]; map our [0.5..2.0] linearly with 1.0 -> 0.
  // 0.5 -> -10, 2.0 -> +10 (clamped).
  const rate = mapRateToSapi(opts.rate ?? 1.0);
  // SAPI does not expose pitch directly via Rate; we accept the request but
  // ignore pitch on this adapter (documented limitation). Documented in
  // user-guide §C1.
  return `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = ${rate}
${voiceId ? `try { $s.SelectVoice('${voiceId}') } catch { }\n` : ''}$s.add_SpeakProgress({
  param($sender, $e)
  [Console]::Out.WriteLine('PROGRESS ' + $e.CharacterPosition)
  [Console]::Out.Flush()
})
$s.add_SpeakCompleted({
  param($sender, $e)
  if ($e.Error) {
    [Console]::Out.WriteLine('ERROR ' + $e.Error.Message)
  } else {
    [Console]::Out.WriteLine('DONE')
  }
  [Console]::Out.Flush()
})
$s.Speak('${text}')
`;
}

function mapRateToSapi(rate: number): number {
  // Clamp to [0.5, 2.0]; map 1.0 -> 0, 0.5 -> -10, 2.0 -> 10.
  const clamped = Math.max(0.5, Math.min(2.0, rate));
  if (clamped >= 1.0) {
    return Math.round((clamped - 1.0) * 10); // 1.0 -> 0, 2.0 -> 10
  }
  return Math.round((clamped - 1.0) * 20); // 0.5 -> -10
}

/** Escape a string for safe embedding inside a single-quoted PowerShell
 *  literal. Per PS 5.1 rules: a single quote is escaped by doubling it. */
function escapePsSingleQuotedString(s: string): string {
  return s.replace(/'/g, "''");
}
