// Locale-aware date / number formatting via the platform `Intl` API.
//
// conventions §18.4.7 + §12.3: NO date-fns / moment / numeral dependency. All
// date/number/relative formatting routes through `Intl`, keyed to the active
// locale. The active locale is passed in by callers (sourced from i18next's
// `i18n.language` in production, or the settings `i18n.locale` at bootstrap) so
// this module stays free of the i18next dependency and is testable now.

import type { AppLocale } from '../types/ipc-contract';

/** Localized absolute date-time, e.g. for "Last checked". */
export function formatDateTime(locale: AppLocale, ms: number): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ms));
}

/** Localized date only. */
export function formatDate(locale: AppLocale, ms: number): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms));
}

/** Localized integer / decimal number. */
export function formatNumber(locale: AppLocale, n: number): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** Localized percentage from a 0-100 value. */
export function formatPercent(locale: AppLocale, percent0to100: number): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(percent0to100 / 100);
}

/**
 * Human byte size, locale-formatted. Mirrors the Phase 6 export "7147 B →
 * 7.1 KB" surface but keyed to the active locale's number formatting.
 */
export function formatBytes(locale: AppLocale, bytes: number): string {
  if (bytes < 1024) return `${formatNumber(locale, bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(value)} ${units[unitIndex]}`;
}
