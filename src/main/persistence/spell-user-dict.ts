// Phase 7.5 Wave 6 (David, 2026-06-18) — B14 Spell-check user-dictionary
// persistence.
//
// Per-locale user dictionaries persist to <userDataDir>/spell-user-dict-<locale>.json.
// The file format is a top-level JSON array of strings:
//   ["superiorag", "Adamhudson777"]
//
// Concurrency:
//   Multiple add/remove calls from the same locale race on the same file. We
//   serialize via a per-locale in-process mutex (a Promise chain). Cross-process
//   races are out of scope for a single-window Electron app; only the main
//   process touches these files.
//
// Resilience:
//   - Missing file -> empty list (lazy create on first write).
//   - Corrupt file -> empty list + warning (no throw). We never delete or
//     overwrite a corrupt file without an explicit write request; an operator
//     can restore from backup.

import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';

import { fail, ok, type Result } from '../../shared/result.js';

export type SpellUserDictError = 'invalid_payload' | 'locale_not_available' | 'persistence_failed';

export interface SpellUserDictDeps {
  /** Absolute path to the directory the store owns. Typically <userData>. */
  baseDir: string;
  /** Allowlist of locale ids the dictionary is willing to manage. */
  availableLocales: ReadonlySet<string>;
  /** Override for tests; defaults to node:fs/promises. */
  fs?: Pick<typeof fsPromises, 'mkdir' | 'readFile' | 'writeFile'>;
}

const MAX_WORD_LEN = 100;
const MAX_WORDS = 10_000;

function fileFor(baseDir: string, locale: string): string {
  // Locale ids are validated against the allowlist; safe to use as a path
  // component without additional sanitization (the allowlist gates the input).
  return join(baseDir, `spell-user-dict-${locale}.json`);
}

function validateWord(word: unknown): string | null {
  if (typeof word !== 'string') return null;
  const trimmed = word.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_WORD_LEN) return null;
  return trimmed;
}

export class SpellUserDictStore {
  private readonly baseDir: string;
  private readonly availableLocales: ReadonlySet<string>;
  private readonly fs: NonNullable<SpellUserDictDeps['fs']>;
  /** Per-locale mutex chain; serializes read-modify-write within one process. */
  private readonly mutexes = new Map<string, Promise<void>>();
  /** In-memory cache so callers (e.g. the spell engine) can synchronously
   *  consult the user-dict without paying disk I/O on every keystroke. */
  private readonly cache = new Map<string, Set<string>>();

  constructor(deps: SpellUserDictDeps) {
    this.baseDir = deps.baseDir;
    this.availableLocales = deps.availableLocales;
    this.fs = deps.fs ?? fsPromises;
  }

  private async withMutex<T>(locale: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.mutexes.get(locale) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => {
      release = r;
    });
    this.mutexes.set(
      locale,
      prev.then(() => next),
    );
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Read the persisted word list for the given locale. Returns an empty list
   * when the file does not exist or is unreadable. Populates the cache.
   */
  async list(locale: string): Promise<Result<string[], SpellUserDictError>> {
    if (!this.availableLocales.has(locale)) {
      return fail<SpellUserDictError>('locale_not_available', `locale "${locale}" not available`);
    }
    return this.withMutex(locale, async () => this.readUncached(locale));
  }

  private async readUncached(locale: string): Promise<Result<string[], SpellUserDictError>> {
    try {
      await this.fs.mkdir(this.baseDir, { recursive: true });
      const raw = await this.fs.readFile(fileFor(this.baseDir, locale), 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Corrupt file: treat as empty without overwriting.
        this.cache.set(locale, new Set());
        return ok([]);
      }
      if (!Array.isArray(parsed)) {
        this.cache.set(locale, new Set());
        return ok([]);
      }
      const words = parsed.filter((w): w is string => typeof w === 'string' && w.length > 0);
      this.cache.set(locale, new Set(words));
      return ok(words);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.cache.set(locale, new Set());
        return ok([]);
      }
      return fail<SpellUserDictError>(
        'persistence_failed',
        `readFile failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Synchronous lookup against the in-memory cache. Returns true when the
   * word has been previously added (and the file has been read at least
   * once). The spell engine uses this on every check call.
   *
   * Callers MUST pre-warm via `list()` (or `add()` / `remove()`) — the cache
   * is empty until the locale has been read at least once.
   */
  hasCached(locale: string, word: string): boolean {
    const set = this.cache.get(locale);
    if (!set) return false;
    return set.has(word);
  }

  /** Synchronous snapshot of cached words. Empty when not yet read. */
  cachedWords(locale: string): readonly string[] {
    const set = this.cache.get(locale);
    if (!set) return [];
    return Array.from(set);
  }

  async add(locale: string, word: string): Promise<Result<{ added: boolean }, SpellUserDictError>> {
    if (!this.availableLocales.has(locale)) {
      return fail<SpellUserDictError>('locale_not_available', `locale "${locale}" not available`);
    }
    const safe = validateWord(word);
    if (safe === null) {
      return fail<SpellUserDictError>(
        'invalid_payload',
        `word must be a non-empty string <= ${MAX_WORD_LEN} chars`,
      );
    }
    return this.withMutex(locale, async () => {
      const cur = await this.readUncached(locale);
      if (!cur.ok) return cur as unknown as Result<{ added: boolean }, SpellUserDictError>;
      const set = new Set(cur.value);
      if (set.has(safe)) return ok({ added: false });
      if (set.size >= MAX_WORDS) {
        return fail<SpellUserDictError>(
          'invalid_payload',
          `user dictionary capped at ${MAX_WORDS}`,
        );
      }
      set.add(safe);
      const writeRes = await this.write(locale, Array.from(set));
      if (!writeRes.ok) return fail<SpellUserDictError>(writeRes.error, writeRes.message);
      this.cache.set(locale, set);
      return ok({ added: true });
    });
  }

  async remove(
    locale: string,
    word: string,
  ): Promise<Result<{ removed: boolean }, SpellUserDictError>> {
    if (!this.availableLocales.has(locale)) {
      return fail<SpellUserDictError>('locale_not_available', `locale "${locale}" not available`);
    }
    const safe = validateWord(word);
    if (safe === null) {
      return fail<SpellUserDictError>(
        'invalid_payload',
        `word must be a non-empty string <= ${MAX_WORD_LEN} chars`,
      );
    }
    return this.withMutex(locale, async () => {
      const cur = await this.readUncached(locale);
      if (!cur.ok) return cur as unknown as Result<{ removed: boolean }, SpellUserDictError>;
      const set = new Set(cur.value);
      if (!set.has(safe)) return ok({ removed: false });
      set.delete(safe);
      const writeRes = await this.write(locale, Array.from(set));
      if (!writeRes.ok) return fail<SpellUserDictError>(writeRes.error, writeRes.message);
      this.cache.set(locale, set);
      return ok({ removed: true });
    });
  }

  private async write(locale: string, words: string[]): Promise<Result<void, SpellUserDictError>> {
    try {
      await this.fs.mkdir(this.baseDir, { recursive: true });
      await this.fs.writeFile(
        fileFor(this.baseDir, locale),
        JSON.stringify(words, null, 2),
        'utf8',
      );
      return ok(undefined);
    } catch (e) {
      return fail<SpellUserDictError>(
        'persistence_failed',
        `writeFile failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
