// Phase 7.5 Wave 6 (David, 2026-06-18) — B14 Spell-check engine.
//
// Pure factory: takes (locale, nspell-instance, user-dictionary words) and
// exposes `check(text)` + `suggest(word)`. No I/O. Tests inject a minimal
// stub instance + a fixture word list; production wires nspell+dictionary-en
// via locale-loader.ts.
//
// Algorithm:
//   1. Tokenize the input text into (word, offset, length) triples. Words are
//      runs of letter / mark / number / apostrophe-internal characters per
//      `WORD_BREAK_REGEX` below. Whitespace + punctuation are skipped.
//   2. For each token, check the user dictionary first (case-sensitive +
//      case-insensitive fallback). Hit -> skip.
//   3. Else call nspell.correct(word). If correct -> skip.
//   4. Else collect nspell.suggest(word), trimmed to MAX_SUGGESTIONS.
//
// L-001..L-006 compliance: no pdf.js (operates on already-extracted text),
// no SQLite, no test channel, no native modules.

import type { NSpellInstance } from 'nspell';

export interface SpellCheckOptions {
  /** Max suggestions returned per misspelling. The renderer's popup shows 3-5. */
  maxSuggestions?: number;
}

export interface SpellMisspellingResult {
  offset: number;
  length: number;
  word: string;
  suggestions: string[];
}

export interface SpellCheckEngine {
  readonly locale: string;
  check(text: string, opts?: SpellCheckOptions): SpellMisspellingResult[];
  suggest(word: string, opts?: SpellCheckOptions): string[];
}

const DEFAULT_MAX_SUGGESTIONS = 5;

// Word-break heuristic: Unicode letter / mark / number, with internal
// apostrophes allowed (don't, can't). Uses `\p{...}` character classes which
// Node 18+ regex supports. Stop characters drop the token.
//
// We capture the WORD boundaries; the caller threads the offset.
const WORD_TOKENIZER = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;

/**
 * Construct a pure spell-check engine for one locale.
 *
 * @param locale  Stable locale id ('en-US', 'es-ES', etc.) — only used to
 *                identify the engine in logs / errors.
 * @param spell   The nspell instance for this locale (already loaded).
 * @param getUserWords  Returns the current user-dictionary word list. The
 *                      engine calls this on EVERY check (no caching here —
 *                      the user-dict store does its own caching).
 */
export function createSpellEngine(
  locale: string,
  spell: NSpellInstance,
  getUserWords: () => ReadonlyArray<string>,
): SpellCheckEngine {
  function isUserAllowed(word: string): boolean {
    const userWords = getUserWords();
    if (userWords.length === 0) return false;
    if (userWords.includes(word)) return true;
    const lower = word.toLowerCase();
    for (const w of userWords) {
      if (w.toLowerCase() === lower) return true;
    }
    return false;
  }

  function trimSuggestions(raw: ReadonlyArray<string>, limit: number): string[] {
    if (raw.length <= limit) return [...raw];
    return raw.slice(0, limit);
  }

  return {
    locale,
    check(text, opts) {
      if (typeof text !== 'string' || text.length === 0) return [];
      const limit = opts?.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS;
      const out: SpellMisspellingResult[] = [];
      // Reset lastIndex defensively (regex is module-scoped + sticky).
      WORD_TOKENIZER.lastIndex = 0;
      for (let m = WORD_TOKENIZER.exec(text); m !== null; m = WORD_TOKENIZER.exec(text)) {
        const word = m[0];
        const offset = m.index;
        if (word.length === 0) continue;
        // Skip all-digit tokens (Unicode \p{N}) — spellcheckers conventionally
        // ignore numbers. nspell flags '123' as incorrect; we don't want that.
        if (/^\p{N}+$/u.test(word)) continue;
        if (isUserAllowed(word)) continue;
        let correct = false;
        try {
          correct = spell.correct(word);
        } catch {
          // Defensive — if nspell throws on a weird input, treat as misspelled
          // and surface no suggestions. Better honest than silent miss.
          correct = false;
        }
        if (correct) continue;
        let raw: string[] = [];
        try {
          raw = spell.suggest(word);
        } catch {
          raw = [];
        }
        out.push({
          offset,
          length: word.length,
          word,
          suggestions: trimSuggestions(raw, limit),
        });
      }
      return out;
    },
    suggest(word, opts) {
      const limit = opts?.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS;
      if (typeof word !== 'string' || word.length === 0) return [];
      try {
        return trimSuggestions(spell.suggest(word), limit);
      } catch {
        return [];
      }
    },
  };
}
