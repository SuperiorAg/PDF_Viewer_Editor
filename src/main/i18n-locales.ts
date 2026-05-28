// Phase 7 — i18n locale registry (main-process side).
//
// ARCHITECTURE: architecture-phase-7.md §7 (P7-L-5) + api-contracts.md §18.7-§18.8.
//
// SCOPE: the ACTUAL i18next runtime lives in the RENDERER (Riley Wave 28b).
// The main process's only i18n role is (a) persisting the selected locale to
// settings (`i18n.locale`) and (b) exposing the supported-locale list so the
// renderer's picker is data-driven (NOT hardcoded). This module is that single
// source of truth. We deliberately do NOT bundle i18next in main.
//
// TRUST-FLOOR (P7-L-6 obligation #4): es-ES is the PROOF locale — a translation
// sample, NOT a complete professional localization. Its `complete: false` flag
// is load-bearing: the renderer's locale-picker subtext reads it to show
// "translation sample, some strings may appear in English".

import type { AppLocale, LocaleDescriptor } from '../ipc/contracts.js';

// The supported-locale list. en-US is the complete baseline; es-ES is the
// proof locale (complete: false). Order is the picker display order.
export const SUPPORTED_LOCALES: readonly LocaleDescriptor[] = [
  { locale: 'en-US', nativeName: 'English (US)', complete: true },
  // es-ES: proof locale — sample, NOT a complete localization (obligation #4).
  { locale: 'es-ES', nativeName: 'Español (España)', complete: false },
];

const SUPPORTED_LOCALE_CODES: ReadonlySet<AppLocale> = new Set<AppLocale>(
  SUPPORTED_LOCALES.map((l) => l.locale),
);

export function isSupportedLocale(value: string): value is AppLocale {
  return SUPPORTED_LOCALE_CODES.has(value as AppLocale);
}
