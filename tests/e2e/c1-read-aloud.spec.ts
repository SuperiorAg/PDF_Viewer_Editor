// Phase 7.5 Wave 11 (Diego, 2026-06-18) — C1 Read Aloud e2e skeleton.
//
// This is a SKELETON spec — it exercises the C1 IPC surface end-to-end
// through the preload bridge and asserts the honest engine_unavailable
// fallback surface. It does NOT yet drive the floating bar UI (open via
// Ctrl+Alt+R + click Play + verify highlight progression) — that flow
// lives on the Wave-13 release-ceremony e2e backlog because it requires
// a real OS-bundled TTS engine to be available (SAPI on Windows, say on
// macOS, espeak on Linux). On a CI runner without the engine, the
// honest fallback IS the assertion (engine_unavailable surfaced to the
// renderer with the §22.2 honest fallback copy — no fake "playing…"
// spinner).
//
// What's asserted here:
//   - window.pdfApi.tts surface mounts on the preload bridge
//     (speakText, pause, stop, listVoices subset).
//   - Calling tts.listVoices either returns a list (engine present) OR
//     surfaces engine_unavailable (engine absent). Both outcomes are
//     honest per the contract; the spec verifies the response shape is
//     ALWAYS a Result discriminator (no thrown promise rejection).
//
// What's deferred (release-ceremony / Wave 13):
//   - Open the Read Aloud bar via Ctrl+Alt+R + verify it renders.
//   - Drive a Play / Pause / Stop cycle on a fixture PDF + verify state
//     transitions in the renderer (Redux tts-slice).
//   - Verify boundary events advance activeSentenceIndex (the pdf-canvas
//     TextLayer highlight wires through subscribeTtsBoundary).
//   - Cross-OS coverage: SAPI on Windows, say on macOS, espeak on
//     Linux — each engine has a slightly different boundary-event
//     schedule and the e2e ceremony needs to verify each separately.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));

test.describe('C1 Read Aloud — IPC surface + honest engine_unavailable fallback', () => {
  test('tts.* IPC surface exists on the preload bridge', async () => {
    const app = await electron.launch({
      args: ['.'],
      cwd: resolve(__dirname, '../..'),
      timeout: 30_000,
    });

    try {
      const window = await app.firstWindow();
      await window.waitForLoadState('domcontentloaded');

      // Wait for the preload bridge to mount window.pdfApi.tts.
      await window.waitForFunction(
        () =>
          typeof (window as unknown as { pdfApi?: unknown }).pdfApi === 'object' &&
          typeof (window as unknown as { pdfApi?: { tts?: { speakText?: unknown } } }).pdfApi?.tts
            ?.speakText === 'function',
        undefined,
        { timeout: 15_000 },
      );

      const surface = await window.evaluate(() => {
        const api = (window as unknown as { pdfApi: Record<string, Record<string, unknown>> })
          .pdfApi;
        return {
          speakText: typeof api?.tts?.speakText === 'function',
          pause: typeof api?.tts?.pause === 'function',
          stop: typeof api?.tts?.stop === 'function',
          listVoices: typeof api?.tts?.listVoices === 'function',
        };
      });

      expect(surface).toEqual({
        speakText: true,
        pause: true,
        stop: true,
        listVoices: true,
      });
    } finally {
      await app.close();
    }
  });

  // The honest-fallback gate. listVoices either resolves with a real list
  // (engine present, ok:true) or surfaces engine_unavailable (engine
  // absent, ok:false). Both outcomes are honest per the contract. The
  // spec asserts the response shape is always a Result discriminator —
  // never a thrown rejection, never an undefined value. The
  // engine_unavailable code is what the §22.2 honest fallback in the
  // Read Aloud bar renders against.
  test('tts.listVoices returns a Result discriminator (ok:true with voices OR ok:false engine_unavailable)', async () => {
    const app = await electron.launch({
      args: ['.'],
      cwd: resolve(__dirname, '../..'),
      timeout: 30_000,
    });

    try {
      const window = await app.firstWindow();
      await window.waitForLoadState('domcontentloaded');

      await window.waitForFunction(
        () =>
          typeof (window as unknown as { pdfApi?: unknown }).pdfApi === 'object' &&
          typeof (window as unknown as { pdfApi?: { tts?: { listVoices?: unknown } } }).pdfApi?.tts
            ?.listVoices === 'function',
        undefined,
        { timeout: 15_000 },
      );

      const result = await window.evaluate(async () => {
        const api = (
          window as unknown as {
            pdfApi: {
              tts: {
                listVoices: () => Promise<
                  { ok: true; value: unknown } | { ok: false; error: string; message: string }
                >;
              };
            };
          }
        ).pdfApi;
        try {
          const res = await api.tts.listVoices();
          return { thrown: false as const, res };
        } catch (e) {
          return { thrown: true as const, message: (e as Error).message };
        }
      });

      // Never a thrown rejection — preload contract returns Result.
      expect(result.thrown).toBe(false);
      if (result.thrown) return; // narrowing for TS

      // Discriminated union: either ok:true with a value, or ok:false
      // with a string error code. The 'engine_unavailable' code is the
      // canonical signal the Read Aloud bar's §22.2 honest fallback
      // listens for; on a CI runner without TTS installed, that's the
      // expected branch.
      const res = result.res;
      expect(typeof res.ok).toBe('boolean');
      if (res.ok) {
        // Voice list present. The shape is contract-typed at
        // src/ipc/contracts.ts; we only assert the discriminator here.
        expect(res).toHaveProperty('value');
      } else {
        // Honest unavailable surface. The error code is one of the
        // documented union members; for the §22.2 fallback to trigger,
        // it must be 'engine_unavailable' on the platforms where no
        // engine is installed.
        expect(typeof res.error).toBe('string');
        expect(typeof res.message).toBe('string');
        // Don't pin the specific error code — the contract allows
        // 'engine_unavailable' on Linux-without-espeak and other
        // honest failure modes. The branch we care about is "ok was
        // false AND a string error code was surfaced AND a message
        // was surfaced", which the fall-through above already asserts.
      }
    } finally {
      await app.close();
    }
  });
});
