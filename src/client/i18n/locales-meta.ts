// Locale metadata — the static supported-locale list + the i18next namespace
// list. Both are SINGLE SOURCES OF TRUTH consumed by the init (index.ts), the
// fallback resolver (resolve.ts), the format helpers (format.ts), and the
// language picker (Settings General). No i18next dependency here, so this
// module is testable before Diego's Wave 29 install.
//
// i18n-strategy.md §2 (supportedLngs) + §5 (namespaces).

import type { AppLocale, LocaleDescriptor } from '../types/ipc-contract';

/** The eight namespaces (i18n-strategy.md §5). Order is stable. */
export const NAMESPACES = [
  'common',
  'toolbar',
  'menu',
  'sidebar',
  'modals',
  'settings',
  'errors',
  'trustfloor',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** The default namespace — bare keys (`t('ok')`) resolve here. */
export const DEFAULT_NS: Namespace = 'common';

/** The fallback locale — a missing key/locale renders English, never a raw key. */
export const FALLBACK_LOCALE: AppLocale = 'en-US';

export const SUPPORTED_LOCALES: readonly AppLocale[] = ['en-US', 'es-ES'];

/**
 * The descriptor list the language picker renders. Mirrors the
 * `i18n:getAvailableLocales` IPC value (api-contracts.md §18.8) so the renderer
 * has a synchronous fallback if the IPC call is in flight. The IPC channel is
 * the live source of truth (David), but the `complete` flags here MUST match.
 *
 * `complete: false` on es-ES is load-bearing for trust-floor obligation #4 —
 * the picker shows the "translation sample" subtext when es-ES is selected.
 */
export const LOCALE_DESCRIPTORS: readonly LocaleDescriptor[] = [
  { locale: 'en-US', nativeName: 'English (US)', complete: true },
  { locale: 'es-ES', nativeName: 'Español (España)', complete: false },
];

export function isSupportedLocale(value: string): value is AppLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function descriptorFor(locale: AppLocale): LocaleDescriptor {
  return LOCALE_DESCRIPTORS.find((d) => d.locale === locale) ?? LOCALE_DESCRIPTORS[0]!;
}
