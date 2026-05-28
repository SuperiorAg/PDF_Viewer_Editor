// Handler: i18n:getAvailableLocales (Phase 7, api-contracts.md §18.8)
//
// Returns the supported-locale list so the picker is data-driven (NOT
// hardcoded in the renderer). Each descriptor carries a `complete` flag; the
// proof locale (es-ES) is `complete: false`, which is load-bearing for the
// trust-floor obligation #4 picker subtext ("translation sample, some strings
// may appear in English"). Always succeeds (static list).

import { SUPPORTED_LOCALES } from '../../main/i18n-locales.js';
import { ok } from '../../shared/result.js';
import type { I18nGetAvailableLocalesResponse, LocaleDescriptor } from '../contracts.js';

export async function handleI18nGetAvailableLocales(
  _req: unknown,
): Promise<I18nGetAvailableLocalesResponse> {
  // Defensive copy so the caller cannot mutate the registry.
  const locales: LocaleDescriptor[] = SUPPORTED_LOCALES.map((l) => ({
    locale: l.locale,
    nativeName: l.nativeName,
    complete: l.complete,
  }));
  return ok({ locales });
}
