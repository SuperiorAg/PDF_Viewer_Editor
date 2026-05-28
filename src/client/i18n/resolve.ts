// Pure key-resolution + fallback logic — the testable core of the i18n
// framework's correctness guarantee, with NO i18next dependency.
//
// Why this module exists separately from index.ts:
//   index.ts wires the real i18next engine (the React binding, lazy backend,
//   Suspense). That engine is not installed until Diego's Wave 29, so a test
//   that imports index.ts cannot run yet. The single load-bearing behavior the
//   strategy promises — "fallbackLng: 'en-US' means a missing es-ES key renders
//   the English value, never a raw `toolbar:open` key" (i18n-strategy.md §4) —
//   is implemented and TESTED here against the same JSON bundles i18next loads.
//   When i18next lands, index.ts configures it with the identical fallback
//   semantics; this module remains the spec-by-test of that behavior + the
//   interpolation/plural surface the renderer relies on.

import type { AppLocale } from '../types/ipc-contract';

import enCommon from './locales/en-US/common.json';
import enErrors from './locales/en-US/errors.json';
import enMenu from './locales/en-US/menu.json';
import enModals from './locales/en-US/modals.json';
import enSettings from './locales/en-US/settings.json';
import enSidebar from './locales/en-US/sidebar.json';
import enToolbar from './locales/en-US/toolbar.json';
import enTrustfloor from './locales/en-US/trustfloor.json';
import esCommon from './locales/es-ES/common.json';
import esErrors from './locales/es-ES/errors.json';
import esMenu from './locales/es-ES/menu.json';
import esModals from './locales/es-ES/modals.json';
import esSettings from './locales/es-ES/settings.json';
import esSidebar from './locales/es-ES/sidebar.json';
import esToolbar from './locales/es-ES/toolbar.json';
import esTrustfloor from './locales/es-ES/trustfloor.json';
import { FALLBACK_LOCALE, type Namespace } from './locales-meta';

type ResourceTree = Record<string, unknown>;

const BUNDLES: Record<AppLocale, Record<Namespace, ResourceTree>> = {
  'en-US': {
    common: enCommon,
    toolbar: enToolbar,
    menu: enMenu,
    sidebar: enSidebar,
    modals: enModals,
    settings: enSettings,
    errors: enErrors,
    trustfloor: enTrustfloor,
  },
  'es-ES': {
    common: esCommon,
    toolbar: esToolbar,
    menu: esMenu,
    sidebar: esSidebar,
    modals: esModals,
    settings: esSettings,
    errors: esErrors,
    trustfloor: esTrustfloor,
  },
};

/** Look up a dotted path inside a namespace tree; undefined when absent. */
function lookup(tree: ResourceTree, dottedPath: string): string | undefined {
  const segments = dottedPath.split('.');
  let node: unknown = tree;
  for (const seg of segments) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as ResourceTree)[seg];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * i18next plural-suffix selection. en-US + es-ES share the CLDR one/other
 * categories (i18n-strategy.md §4 rationale for picking Spanish). When a
 * `count` is supplied we try `<key>_one` / `<key>_other` first, then the bare
 * key. This mirrors i18next's plural resolution so a test can assert "1 page"
 * vs "5 pages" without the engine installed.
 */
function pluralKey(key: string, count: number | undefined): string[] {
  if (count === undefined) return [key];
  const category = count === 1 ? 'one' : 'other';
  return [`${key}_${category}`, `${key}_other`, key];
}

/** Replace `{{name}}` interpolation tokens with stringified values. */
function interpolate(template: string, vars?: Record<string, unknown>): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export interface ResolveOptions {
  count?: number;
  [param: string]: unknown;
}

/**
 * Resolve a `namespace:dotted.key` for a locale, with en-US fallback +
 * interpolation + plural support. Guarantees a non-raw-key result: if the key
 * is missing from BOTH the active locale and en-US (a programming error caught
 * by the typed-key augmentation at compile time), the bare key is returned only
 * as a last resort — but every key shipped in en-US.json resolves.
 */
export function resolveKey(locale: AppLocale, fullKey: string, opts?: ResolveOptions): string {
  const colon = fullKey.indexOf(':');
  const ns = (colon === -1 ? 'common' : fullKey.slice(0, colon)) as Namespace;
  const path = colon === -1 ? fullKey : fullKey.slice(colon + 1);
  const count = opts?.count;

  const candidates = pluralKey(path, count);
  const locales: AppLocale[] =
    locale === FALLBACK_LOCALE ? [FALLBACK_LOCALE] : [locale, FALLBACK_LOCALE];

  for (const loc of locales) {
    const tree = BUNDLES[loc]?.[ns];
    if (!tree) continue;
    for (const candidate of candidates) {
      const hit = lookup(tree, candidate);
      if (hit !== undefined) {
        return interpolate(hit, count === undefined ? opts : { ...opts, count });
      }
    }
  }
  // Unreachable for any en-US-present key (the typed-key gate ensures presence).
  return path;
}

/** Whether a key exists in en-US (used by tests + the no-raw-key assertion). */
export function hasBaselineKey(fullKey: string): boolean {
  const colon = fullKey.indexOf(':');
  const ns = (colon === -1 ? 'common' : fullKey.slice(0, colon)) as Namespace;
  const path = colon === -1 ? fullKey : fullKey.slice(colon + 1);
  const tree: ResourceTree | undefined = BUNDLES[FALLBACK_LOCALE][ns];
  if (!tree) return false;
  return (
    lookup(tree, path) !== undefined ||
    lookup(tree, `${path}_one`) !== undefined ||
    lookup(tree, `${path}_other`) !== undefined
  );
}

export { BUNDLES as _bundlesForTest };
