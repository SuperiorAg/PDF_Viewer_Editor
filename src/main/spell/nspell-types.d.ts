// Local type stub for nspell (no @types/nspell on npm).
// Wave 6 (David, 2026-06-18) — pinned to nspell@^2.1.5 MIT.
//
// Only the surface we actually use is typed. If a future wave needs more (e.g.
// `personal`, `wordCharacters`, etc.), extend this stub then.

declare module 'nspell' {
  export interface NSpellInstance {
    correct(word: string): boolean;
    suggest(word: string): string[];
    spell(word: string): { correct: boolean; forbidden: boolean; warn: boolean };
    add(word: string, model?: string): NSpellInstance;
    remove(word: string): NSpellInstance;
  }

  export interface NSpellDictionary {
    aff: Uint8Array | Buffer | string;
    dic: Uint8Array | Buffer | string;
  }

  function nspell(dict: NSpellDictionary): NSpellInstance;
  function nspell(
    aff: Uint8Array | Buffer | string,
    dic: Uint8Array | Buffer | string,
  ): NSpellInstance;

  export default nspell;
}
