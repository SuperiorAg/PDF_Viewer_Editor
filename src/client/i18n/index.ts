// i18next + react-i18next initialization (i18n-strategy.md §2).
//
// DEP-PENDING (Diego Wave 29): `i18next`, `react-i18next`, and
// `i18next-resources-to-backend` (all MIT) are NOT in package.json yet — Diego
// installs them in Wave 29. Until then this module's imports do not resolve and
// the renderer build is RED on these three specifiers only. The pure logic the
// framework guarantees (en-US fallback, plurals, interpolation, Intl
// formatting) lives in `resolve.ts` / `format.ts` and is testable now; this
// file is the production wiring that goes green the moment Diego installs.
//
// Design (frozen by i18n-strategy.md §2):
//   - en-US is imported EAGERLY so first paint is synchronous.
//   - es-ES (and any future locale) is lazy `import()`ed per (lng, ns) via
//     `i18next-resources-to-backend` so non-active locales are Vite code-split
//     chunks that cost ~0 KB until selected.
//   - fallbackLng: 'en-US' — a missing key/locale renders English, never a raw
//     key on screen (trust-floor obligation #4 degrades gracefully).
//   - The active locale is read from the settings store at bootstrap (§7) and
//     applied via setLocale(); the renderer never hardcodes the active locale.

import i18n from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';

// en-US namespaces — eager (initial chunk).
import type { AppLocale } from '../types/ipc-contract';

import enCommon from './locales/en-US/common.json';
import enErrors from './locales/en-US/errors.json';
import enMenu from './locales/en-US/menu.json';
import enModals from './locales/en-US/modals.json';
import enSettings from './locales/en-US/settings.json';
import enSidebar from './locales/en-US/sidebar.json';
import enToolbar from './locales/en-US/toolbar.json';
import enTrustfloor from './locales/en-US/trustfloor.json';
import {
  DEFAULT_NS,
  FALLBACK_LOCALE,
  NAMESPACES,
  SUPPORTED_LOCALES,
  isSupportedLocale,
} from './locales-meta';

void i18n
  // Lazy backend: Vite code-splits this dynamic import per (language, namespace)
  // so es-ES chunks load only when the locale is selected. en-US is already in
  // `resources` below (eager), so the backend only ever fetches non-en-US.
  .use(
    resourcesToBackend(
      (language: string, namespace: string) => import(`./locales/${language}/${namespace}.json`),
    ),
  )
  .use(initReactI18next)
  .init({
    // lng is set explicitly at bootstrap via setLocale() once the settings
    // store has loaded; OMITTING it here (rather than `lng: undefined`) avoids
    // a flash of a detector-guessed locale (no OS auto-detection in Phase 7 —
    // §7.5). NOTE (Diego, Wave 29 — EMERGENCY CROSS-BOUNDARY UNBLOCK, pending
    // Riley ratification): the original line was `lng: undefined`, which the
    // installed i18next 26.3.0 (react-i18next 17.0.8 requires i18next >= 26.2)
    // types as `lng?: string` (NOT `string | undefined`). Under the project's
    // `exactOptionalPropertyTypes: true` (tsconfig.json:17), passing an
    // EXPLICIT `undefined` to an optional `string` property is TS2769 — the
    // sole remaining renderer typecheck error after the Wave-29 i18next
    // install. Omitting the key is SEMANTICALLY IDENTICAL (i18next treats an
    // absent `lng` exactly as the comment intends) and clears the error without
    // any behavior change. This is a Riley-owned file; Diego made the minimal
    // one-line change only to unblock the roadmap-closing v0.7.0 build. Riley:
    // please ratify (or relocate the rationale) at your next renderer touch.
    fallbackLng: FALLBACK_LOCALE,
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    ns: NAMESPACES as unknown as string[],
    defaultNS: DEFAULT_NS,
    // React already escapes interpolated values; double-escaping mangles output.
    interpolation: { escapeValue: false },
    // Empty/null values should fall through to fallbackLng, not render ''.
    returnNull: false,
    returnEmptyString: false,
    // en-US pre-loaded so the very first paint is synchronous; other locales are
    // fetched by the lazy backend on demand.
    partialBundledLanguages: true,
    resources: {
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
    },
  });

/**
 * Apply a locale live (no restart). react-i18next swaps resources reactively
 * via Suspense; the lazy backend fetches the es-ES chunk on first switch.
 * Persisting the choice to settings is the caller's job (Settings General
 * dispatches `i18n:setLocale`); this only applies it in the renderer.
 */
export async function setLocale(locale: AppLocale): Promise<void> {
  if (!isSupportedLocale(locale)) return;
  await i18n.changeLanguage(locale);
}

/** The currently-active locale, narrowed to AppLocale (defaults to en-US). */
export function currentLocale(): AppLocale {
  const lng = i18n.language;
  return isSupportedLocale(lng) ? lng : FALLBACK_LOCALE;
}

export default i18n;
