// Handler: i18n:setLocale (Phase 7, api-contracts.md §18.7)
//
// Persists the selected locale to settings.i18n.locale (default 'en-US'). The
// renderer applies it live via i18next.changeLanguage; this channel ONLY
// persists. The locale is validated against the supported list — anything else
// is rejected with `unsupported_locale` (api-contracts.md §18.10).

import { z } from 'zod';

import { isSupportedLocale } from '../../main/i18n-locales.js';
import { fail, ok } from '../../shared/result.js';
import type { AppLocale, I18nSetLocaleError, I18nSetLocaleResponse } from '../contracts.js';

// Accept any string at the structural level; the semantic locale check follows.
const requestSchema = z
  .object({
    locale: z.string().min(1),
  })
  .strict();

export interface I18nSetLocaleDeps {
  /** Persist the locale to settings. Throws on write failure. */
  persistLocale: (locale: AppLocale) => void;
}

export async function handleI18nSetLocale(
  req: unknown,
  deps: I18nSetLocaleDeps,
): Promise<I18nSetLocaleResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<I18nSetLocaleError>('invalid_payload', parsed.error.message);
  }
  if (!isSupportedLocale(parsed.data.locale)) {
    return fail<I18nSetLocaleError>(
      'unsupported_locale',
      `locale '${parsed.data.locale}' is not supported`,
    );
  }
  const locale: AppLocale = parsed.data.locale;
  try {
    deps.persistLocale(locale);
    return ok({ locale });
  } catch (e) {
    return fail<I18nSetLocaleError>('settings_write_failed', (e as Error).message);
  }
}
