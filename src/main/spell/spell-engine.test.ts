// Tests for createSpellEngine (Phase 7.5 Wave 6 — B14 pure factory).

import type { NSpellInstance } from 'nspell';
import { describe, expect, it } from 'vitest';

import { createSpellEngine } from './spell-engine.js';

/**
 * Tiny stub of nspell — recognizes only words in `correctSet`, returns a
 * deterministic suggestion list per misspelling.
 */
function makeStub(correctSet: Set<string>, suggestions: Map<string, string[]>): NSpellInstance {
  return {
    correct(word) {
      return correctSet.has(word) || correctSet.has(word.toLowerCase());
    },
    suggest(word) {
      return suggestions.get(word) ?? suggestions.get(word.toLowerCase()) ?? [];
    },
    spell(word) {
      const correct = correctSet.has(word) || correctSet.has(word.toLowerCase());
      return { correct, forbidden: false, warn: false };
    },
    add() {
      return this as unknown as NSpellInstance;
    },
    remove() {
      return this as unknown as NSpellInstance;
    },
  };
}

describe('createSpellEngine.check', () => {
  it('returns empty list for empty input', () => {
    const stub = makeStub(new Set(['the']), new Map());
    const engine = createSpellEngine('en-US', stub, () => []);
    expect(engine.check('')).toEqual([]);
  });

  it('flags only misspelled words with proper offsets', () => {
    const stub = makeStub(
      new Set(['the', 'quick', 'fox']),
      new Map([['quik', ['quick', 'quirk']]]),
    );
    const engine = createSpellEngine('en-US', stub, () => []);
    const r = engine.check('the quik fox');
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({
      offset: 4,
      length: 4,
      word: 'quik',
    });
    expect(r[0]!.suggestions).toEqual(['quick', 'quirk']);
  });

  it('skips user-dictionary words', () => {
    const stub = makeStub(new Set(['the']), new Map([['superiorag', []]]));
    const userWords = ['superiorag'];
    const engine = createSpellEngine('en-US', stub, () => userWords);
    const r = engine.check('the superiorag was here');
    // Only 'was' and 'here' would normally fail. Stub says only 'the' is
    // correct, so 'was' and 'here' should fail; 'superiorag' is allowed by
    // the user dict.
    const flaggedWords = r.map((m) => m.word);
    expect(flaggedWords).not.toContain('superiorag');
  });

  it('caps suggestions to 5 by default', () => {
    const stub = makeStub(
      new Set(['the']),
      new Map([['xyz', ['a', 'b', 'c', 'd', 'e', 'f', 'g']]]),
    );
    const engine = createSpellEngine('en-US', stub, () => []);
    const r = engine.check('xyz');
    expect(r.length).toBe(1);
    expect(r[0]!.suggestions).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('respects an explicit maxSuggestions override', () => {
    const stub = makeStub(new Set(['the']), new Map([['xyz', ['a', 'b', 'c', 'd', 'e']]]));
    const engine = createSpellEngine('en-US', stub, () => []);
    const r = engine.check('xyz', { maxSuggestions: 2 });
    expect(r[0]!.suggestions).toEqual(['a', 'b']);
  });

  it('skips all-number tokens', () => {
    const stub = makeStub(new Set([]), new Map());
    const engine = createSpellEngine('en-US', stub, () => []);
    // 123 alone is not flagged even though the stub knows no correct words.
    expect(engine.check('123')).toEqual([]);
  });

  it('handles apostrophe-internal words as single tokens', () => {
    const stub = makeStub(new Set(["don't", 'know']), new Map());
    const engine = createSpellEngine('en-US', stub, () => []);
    const r = engine.check("I don't know");
    // 'I' is not in correctSet — gets flagged.
    expect(r.length).toBe(1);
    expect(r[0]!.word).toBe('I');
  });

  it('does not crash if the underlying nspell throws', () => {
    const throwing: NSpellInstance = {
      correct: () => {
        throw new Error('boom');
      },
      suggest: () => {
        throw new Error('boom');
      },
      spell: () => ({ correct: false, forbidden: false, warn: false }),
      add: () => throwing,
      remove: () => throwing,
    };
    const engine = createSpellEngine('en-US', throwing, () => []);
    const r = engine.check('hello world');
    // Both words flagged (engine fell through the throw to "misspelled");
    // suggestions empty (suggest also threw).
    expect(r.length).toBe(2);
    expect(r[0]!.suggestions).toEqual([]);
  });
});

describe('createSpellEngine.suggest', () => {
  it('returns trimmed suggestions for a word', () => {
    const stub = makeStub(
      new Set([]),
      new Map([['cat', ['bat', 'hat', 'mat', 'rat', 'sat', 'oat']]]),
    );
    const engine = createSpellEngine('en-US', stub, () => []);
    expect(engine.suggest('cat')).toEqual(['bat', 'hat', 'mat', 'rat', 'sat']);
  });
});
