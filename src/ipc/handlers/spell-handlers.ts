// Phase 7.5 Wave 6 (David, 2026-06-18) — B14 Spell-check handlers.
//
// Five channels:
//   spell:listLocales            - list available locales + honest reasons for unavailable
//   spell:checkText              - check a string of text against a locale's nspell engine
//   spell:addWordToDictionary    - persist a custom word for a locale
//   spell:removeWordFromDictionary - delete a custom word for a locale
//   spell:listUserDictionary     - read all custom words for a locale
//
// Contract:    src/ipc/contracts.ts (Wave 6 block).
// Engine:      src/main/spell/spell-engine.ts (pure factory).
// Loader:      src/main/spell/locale-loader.ts (lazy nspell + dict-en load).
// User dict:   src/main/persistence/spell-user-dict.ts.

import { z } from 'zod';

import type { SpellUserDictStore } from '../../main/persistence/spell-user-dict.js';
import type { SpellLocaleLoader } from '../../main/spell/locale-loader.js';
import { SPELL_LOCALES } from '../../main/spell/locale-loader.js';
import { createSpellEngine } from '../../main/spell/spell-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  SpellAddWordToDictionaryError,
  SpellAddWordToDictionaryResponse,
  SpellAddWordToDictionaryValue,
  SpellCheckTextError,
  SpellCheckTextResponse,
  SpellCheckTextValue,
  SpellListLocalesError,
  SpellListLocalesResponse,
  SpellListLocalesValue,
  SpellListUserDictionaryError,
  SpellListUserDictionaryResponse,
  SpellListUserDictionaryValue,
  SpellLocaleDescriptor,
  SpellMisspelling,
  SpellRemoveWordFromDictionaryError,
  SpellRemoveWordFromDictionaryResponse,
  SpellRemoveWordFromDictionaryValue,
} from '../contracts.js';

// =============================================================================
// Shared deps
// =============================================================================

export interface SpellHandlersDeps {
  loader: SpellLocaleLoader;
  userDict: SpellUserDictStore;
}

// =============================================================================
// Schemas
// =============================================================================

const listLocalesSchema = z.object({}).optional();

const checkTextSchema = z.object({
  locale: z.string().min(1).max(20),
  // Cap incoming text at 64 KB per request — the renderer is expected to
  // chunk longer documents. Keeps engine latency bounded.
  text: z.string().max(64 * 1024),
});

const wordSchema = z.object({
  locale: z.string().min(1).max(20),
  word: z.string().min(1).max(100),
});

const listUserDictSchema = z.object({
  locale: z.string().min(1).max(20),
});

// =============================================================================
// Handlers
// =============================================================================

export function handleSpellListLocales(req: unknown): SpellListLocalesResponse {
  const parsed = listLocalesSchema.safeParse(req);
  if (!parsed.success) {
    return fail<SpellListLocalesError>('engine_failed', parsed.error.message);
  }
  // Static; sourced from the loader's allowlist + the per-locale license vet
  // outcome. Mapped directly into the response shape.
  const locales: SpellLocaleDescriptor[] = SPELL_LOCALES.map((l) =>
    l.reason !== undefined
      ? { id: l.id, available: l.available, reason: l.reason }
      : { id: l.id, available: l.available },
  );
  const value: SpellListLocalesValue = { locales };
  return ok(value);
}

export async function handleSpellCheckText(
  req: unknown,
  deps: SpellHandlersDeps,
): Promise<SpellCheckTextResponse> {
  const parsed = checkTextSchema.safeParse(req);
  if (!parsed.success) {
    return fail<SpellCheckTextError>('invalid_payload', parsed.error.message);
  }
  // Load the engine (lazy; first call pays the dictionary parse cost).
  const loaded = await deps.loader.loadEngine(parsed.data.locale);
  if (!loaded.ok) {
    if (loaded.error === 'locale_not_available') {
      return fail<SpellCheckTextError>('locale_not_available', loaded.message);
    }
    return fail<SpellCheckTextError>('engine_failed', loaded.message);
  }
  // Warm the user-dict cache (no-op after the first call per locale).
  const userListRes = await deps.userDict.list(parsed.data.locale);
  if (!userListRes.ok) {
    return fail<SpellCheckTextError>(
      'engine_failed',
      `user dictionary read failed: ${userListRes.message}`,
    );
  }
  try {
    const engine = createSpellEngine(parsed.data.locale, loaded.value, () =>
      deps.userDict.cachedWords(parsed.data.locale),
    );
    const misspellings = engine.check(parsed.data.text).map<SpellMisspelling>((m) => ({
      offset: m.offset,
      length: m.length,
      word: m.word,
      suggestions: m.suggestions,
    }));
    const value: SpellCheckTextValue = { misspellings };
    return ok(value);
  } catch (e) {
    return fail<SpellCheckTextError>('engine_failed', safeMessage(e, 'spell engine threw'));
  }
}

export async function handleSpellAddWordToDictionary(
  req: unknown,
  deps: SpellHandlersDeps,
): Promise<SpellAddWordToDictionaryResponse> {
  const parsed = wordSchema.safeParse(req);
  if (!parsed.success) {
    return fail<SpellAddWordToDictionaryError>('invalid_payload', parsed.error.message);
  }
  try {
    const r = await deps.userDict.add(parsed.data.locale, parsed.data.word);
    if (!r.ok) {
      switch (r.error) {
        case 'invalid_payload':
          return fail<SpellAddWordToDictionaryError>('invalid_payload', r.message);
        case 'locale_not_available':
          return fail<SpellAddWordToDictionaryError>('locale_not_available', r.message);
        default:
          return fail<SpellAddWordToDictionaryError>('persistence_failed', r.message);
      }
    }
    const value: SpellAddWordToDictionaryValue = { added: r.value.added };
    return ok(value);
  } catch (e) {
    return fail<SpellAddWordToDictionaryError>(
      'persistence_failed',
      safeMessage(e, 'user dictionary store threw'),
    );
  }
}

export async function handleSpellRemoveWordFromDictionary(
  req: unknown,
  deps: SpellHandlersDeps,
): Promise<SpellRemoveWordFromDictionaryResponse> {
  const parsed = wordSchema.safeParse(req);
  if (!parsed.success) {
    return fail<SpellRemoveWordFromDictionaryError>('invalid_payload', parsed.error.message);
  }
  try {
    const r = await deps.userDict.remove(parsed.data.locale, parsed.data.word);
    if (!r.ok) {
      switch (r.error) {
        case 'invalid_payload':
          return fail<SpellRemoveWordFromDictionaryError>('invalid_payload', r.message);
        case 'locale_not_available':
          return fail<SpellRemoveWordFromDictionaryError>('locale_not_available', r.message);
        default:
          return fail<SpellRemoveWordFromDictionaryError>('persistence_failed', r.message);
      }
    }
    const value: SpellRemoveWordFromDictionaryValue = { removed: r.value.removed };
    return ok(value);
  } catch (e) {
    return fail<SpellRemoveWordFromDictionaryError>(
      'persistence_failed',
      safeMessage(e, 'user dictionary store threw'),
    );
  }
}

export async function handleSpellListUserDictionary(
  req: unknown,
  deps: SpellHandlersDeps,
): Promise<SpellListUserDictionaryResponse> {
  const parsed = listUserDictSchema.safeParse(req);
  if (!parsed.success) {
    return fail<SpellListUserDictionaryError>('invalid_payload', parsed.error.message);
  }
  try {
    const r = await deps.userDict.list(parsed.data.locale);
    if (!r.ok) {
      switch (r.error) {
        case 'invalid_payload':
          return fail<SpellListUserDictionaryError>('invalid_payload', r.message);
        case 'locale_not_available':
          return fail<SpellListUserDictionaryError>('locale_not_available', r.message);
        default:
          return fail<SpellListUserDictionaryError>('persistence_failed', r.message);
      }
    }
    const value: SpellListUserDictionaryValue = { words: r.value };
    return ok(value);
  } catch (e) {
    return fail<SpellListUserDictionaryError>(
      'persistence_failed',
      safeMessage(e, 'user dictionary store threw'),
    );
  }
}
