// Phase 7.5 Wave 6 (David, 2026-06-18) — B14 spell-check locale loader.
//
// Lazy-loads nspell + a Hunspell .aff/.dic per locale. Caches loaded engines
// per (locale) — first checkText pays the load cost, subsequent calls are
// memory-only.
//
// License-vet results (2026-06-18, recorded in commit message + learnings):
//   - nspell@^2.1.5         => MIT       => SHIP
//   - dictionary-en@^4.0.0  => "(MIT AND BSD)" => SHIP
//   - dictionary-es@^4.0.0  => "(GPL-3.0 OR LGPL-3.0 OR MPL-1.1)" => DO NOT SHIP
//
// Per P7.5-L-10, es-ES is honestly surfaced as unavailable. The renderer's
// settings dialog labels it "Spanish dictionary not available in this build"
// per docs/ui-spec-phase-7.5.md §14.3.

import nspell, { type NSpellInstance, type NSpellDictionary } from 'nspell';

import { fail, ok, type Result } from '../../shared/result.js';

export type SpellLocaleLoaderError = 'locale_not_available' | 'dictionary_load_failed';

/**
 * Stable list of locales the engine recognizes. The `available` flag carries
 * the license-vet outcome — when false, the loader rejects load attempts and
 * `spell:listLocales` surfaces the reason verbatim.
 */
export interface SpellLocaleDescriptor {
  id: string;
  available: boolean;
  reason?: string;
}

export const SPELL_LOCALES: ReadonlyArray<SpellLocaleDescriptor> = [
  { id: 'en-US', available: true },
  {
    id: 'es-ES',
    available: false,
    // VERBATIM reason — renderer is expected to display this. Per P7.5-L-10
    // we do NOT silently omit; we surface the constraint with a concrete
    // explanation so users understand why and can request the Wave 11 vet
    // outcome if they want to dig deeper.
    reason:
      'Spanish dictionary not available in this build — Hunspell es-ES is GPL-3/LGPL-3/MPL-1.1 (per npm registry vet 2026-06-18), which does not meet the project policy of MIT/Apache/BSD permissive-only.',
  },
];

/**
 * The minimal contract we need from `dictionary-en`'s default export. The
 * package ships `index.aff` + `index.dic` as Uint8Array via a top-level await
 * (ESM). We dynamic-import it so the static main bundle doesn't pay the
 * fixed-cost top-level await at module load — only the first checkText
 * exercises the load.
 */
export type DictionaryModule = { default: NSpellDictionary };

export interface SpellLocaleLoaderDeps {
  /** Inject for tests; production wires the dynamic-import wrapper. */
  loadEnUsDictionary?: () => Promise<NSpellDictionary>;
  /** Inject for tests; production uses the nspell default export. */
  buildEngine?: (dict: NSpellDictionary) => NSpellInstance;
}

const DEFAULT_LOADERS: Required<SpellLocaleLoaderDeps> = {
  // The dictionary-en module performs `await fs.readFile(...)` at top level;
  // dynamic import resolves AFTER the file reads complete (Node's ESM loader
  // handles the top-level await transparently).
  loadEnUsDictionary: async () => {
    const mod = (await import('dictionary-en')) as DictionaryModule;
    return mod.default;
  },
  buildEngine: (dict: NSpellDictionary) => nspell(dict),
};

/**
 * Per-process cache. Module-scope (per playbook entry #3 we'd normally stash
 * on globalThis, but spell engines are constructed within registerIpcHandlers
 * — single instance per main-process — so module-scope is fine).
 */
export class SpellLocaleLoader {
  private readonly loadEnUs: () => Promise<NSpellDictionary>;
  private readonly buildEngine: (dict: NSpellDictionary) => NSpellInstance;
  private readonly cache = new Map<
    string,
    Promise<Result<NSpellInstance, SpellLocaleLoaderError>>
  >();

  constructor(deps: SpellLocaleLoaderDeps = {}) {
    this.loadEnUs = deps.loadEnUsDictionary ?? DEFAULT_LOADERS.loadEnUsDictionary;
    this.buildEngine = deps.buildEngine ?? DEFAULT_LOADERS.buildEngine;
  }

  /**
   * Returns the cached engine for the locale, OR loads it on first request.
   * `'locale_not_available'` for any unrecognized / unavailable locale.
   */
  loadEngine(locale: string): Promise<Result<NSpellInstance, SpellLocaleLoaderError>> {
    const descriptor = SPELL_LOCALES.find((l) => l.id === locale);
    if (!descriptor || !descriptor.available) {
      return Promise.resolve(
        fail<SpellLocaleLoaderError>(
          'locale_not_available',
          descriptor?.reason ?? `locale "${locale}" is not recognized`,
        ),
      );
    }
    const existing = this.cache.get(locale);
    if (existing) return existing;
    const pending = this.loadFresh(locale);
    this.cache.set(locale, pending);
    return pending;
  }

  private async loadFresh(locale: string): Promise<Result<NSpellInstance, SpellLocaleLoaderError>> {
    try {
      let dict: NSpellDictionary;
      if (locale === 'en-US') {
        dict = await this.loadEnUs();
      } else {
        // Future locales: branch here. Today the descriptor allowlist makes
        // this unreachable, but the fallthrough keeps the error path explicit.
        return fail<SpellLocaleLoaderError>('locale_not_available', `locale "${locale}" not wired`);
      }
      const engine = this.buildEngine(dict);
      return ok(engine);
    } catch (e) {
      // Drop the failed cache entry so a retry tries again.
      this.cache.delete(locale);
      return fail<SpellLocaleLoaderError>(
        'dictionary_load_failed',
        `dictionary load failed for "${locale}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Test-only reset. */
  _resetForTests(): void {
    this.cache.clear();
  }
}

/** The list of locales the user-dict store should accept writes for. */
export function availableSpellLocaleIds(): ReadonlySet<string> {
  return new Set(SPELL_LOCALES.filter((l) => l.available).map((l) => l.id));
}
