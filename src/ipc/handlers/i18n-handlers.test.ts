// @vitest-environment node
//
// Phase 7 (Wave 28a, David) — i18n:setLocale + i18n:getAvailableLocales tests.
//
// Pins:
//   - setLocale persists the locale (en-US / es-ES); rejects unsupported
//   - settings_write_failed when persistence throws
//   - getAvailableLocales returns en-US (complete) + es-ES (proof, complete:false)
//   - the proof-locale complete:false flag is load-bearing (trust-floor #4)

import { describe, expect, it } from 'vitest';

import type { AppLocale } from '../contracts.js';

import { handleI18nGetAvailableLocales } from './i18n-get-available-locales.js';
import { handleI18nSetLocale } from './i18n-set-locale.js';

function makePersist(opts: { throwOnSet?: boolean } = {}): {
  persistLocale: (l: AppLocale) => void;
  persisted: AppLocale[];
} {
  const persisted: AppLocale[] = [];
  return {
    persisted,
    persistLocale: (l: AppLocale) => {
      if (opts.throwOnSet) throw new Error('disk full');
      persisted.push(l);
    },
  };
}

describe('handleI18nSetLocale', () => {
  it('persists the baseline locale en-US', async () => {
    const deps = makePersist();
    const r = await handleI18nSetLocale({ locale: 'en-US' }, deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.locale).toBe('en-US');
    expect(deps.persisted).toEqual(['en-US']);
  });

  it('persists the proof locale es-ES', async () => {
    const deps = makePersist();
    const r = await handleI18nSetLocale({ locale: 'es-ES' }, deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.locale).toBe('es-ES');
    expect(deps.persisted).toEqual(['es-ES']);
  });

  it('rejects an unsupported locale (unsupported_locale)', async () => {
    const deps = makePersist();
    const r = await handleI18nSetLocale({ locale: 'fr-FR' }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unsupported_locale');
    // Nothing persisted for an unsupported locale.
    expect(deps.persisted).toEqual([]);
  });

  it('rejects a missing locale (invalid_payload)', async () => {
    const deps = makePersist();
    const r = await handleI18nSetLocale({}, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects extra properties (strict)', async () => {
    const deps = makePersist();
    const r = await handleI18nSetLocale({ locale: 'en-US', extra: 1 }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('returns settings_write_failed when persistence throws', async () => {
    const deps = makePersist({ throwOnSet: true });
    const r = await handleI18nSetLocale({ locale: 'es-ES' }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('settings_write_failed');
  });
});

describe('handleI18nGetAvailableLocales', () => {
  it('returns en-US (complete) + es-ES (proof, complete:false)', async () => {
    const r = await handleI18nGetAvailableLocales({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.locales).toEqual([
        { locale: 'en-US', nativeName: 'English (US)', complete: true },
        { locale: 'es-ES', nativeName: 'Español (España)', complete: false },
      ]);
    }
  });

  it('marks the proof locale complete:false (trust-floor obligation #4)', async () => {
    const r = await handleI18nGetAvailableLocales({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      const esES = r.value.locales.find((l) => l.locale === 'es-ES');
      expect(esES?.complete).toBe(false);
    }
  });

  it('is a defensive copy — mutating the response does not affect later calls', async () => {
    const r1 = await handleI18nGetAvailableLocales({});
    if (r1.ok) r1.value.locales.pop();
    const r2 = await handleI18nGetAvailableLocales({});
    if (r2.ok) expect(r2.value.locales).toHaveLength(2);
  });
});
