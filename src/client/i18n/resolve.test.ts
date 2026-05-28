// Tests for the pure i18n resolver — the load-bearing fallback + plural +
// interpolation guarantees of the framework (i18n-strategy.md §4 + §8.1). These
// run WITHOUT i18next installed (Diego Wave 29) because resolve.ts has no
// i18next dependency — that is the whole point of the resolve/index split.

import { describe, expect, it } from 'vitest';

import { NAMESPACES } from './locales-meta';
import { hasBaselineKey, resolveKey, _bundlesForTest } from './resolve';

describe('i18n resolveKey — baseline + fallback', () => {
  it('returns the en-US baseline value for a known key', () => {
    expect(resolveKey('en-US', 'toolbar:open')).toBe('Open');
    expect(resolveKey('en-US', 'common:cancel')).toBe('Cancel');
  });

  it('returns the es-ES value when the key is translated', () => {
    expect(resolveKey('es-ES', 'toolbar:open')).toBe('Abrir');
    expect(resolveKey('es-ES', 'common:cancel')).toBe('Cancelar');
  });

  it('falls back to en-US when an es-ES key is MISSING (never a raw key)', () => {
    // 'toolbar:shapes' is deliberately untranslated in es-ES (proof-locale gap).
    const resolved = resolveKey('es-ES', 'toolbar:shapes');
    // Falls back to the English value, NOT the raw 'shapes' key.
    expect(resolved).toBe('Shapes');
    expect(resolved).not.toBe('shapes');
    expect(resolved).not.toContain(':');
  });

  it('never renders a raw key for any key present in en-US', () => {
    // Sample a spread of keys across namespaces; each must resolve to a value
    // that is not the bare key path.
    const samples = [
      'common:ok',
      'toolbar:settings',
      'menu:items.about',
      'sidebar:tabs.thumbnails',
      'modals:about.title',
      'settings:privacy.telemetryLabel',
      'errors:fs_read_failed',
      'trustfloor:telemetry.offByDefault',
    ];
    for (const key of samples) {
      const path = key.slice(key.indexOf(':') + 1);
      expect(resolveKey('es-ES', key)).not.toBe(path);
      expect(hasBaselineKey(key)).toBe(true);
    }
  });

  it('interpolates {{vars}}', () => {
    expect(resolveKey('en-US', 'settings:saveError', { message: 'disk full' })).toBe(
      'Could not save: disk full',
    );
  });

  it('selects plural forms by count (one / other)', () => {
    expect(resolveKey('en-US', 'sidebar:pageCount', { count: 1 })).toBe('1 page');
    expect(resolveKey('en-US', 'sidebar:pageCount', { count: 5 })).toBe('5 pages');
    // es-ES shares one/other and IS translated for this key.
    expect(resolveKey('es-ES', 'sidebar:pageCount', { count: 1 })).toBe('1 página');
    expect(resolveKey('es-ES', 'sidebar:pageCount', { count: 3 })).toBe('3 páginas');
  });
});

describe('i18n bundles — structural completeness', () => {
  it('both locales ship all 8 namespace bundles', () => {
    for (const ns of NAMESPACES) {
      expect(_bundlesForTest['en-US'][ns]).toBeDefined();
      expect(_bundlesForTest['es-ES'][ns]).toBeDefined();
    }
  });

  it('en-US is the complete baseline (every namespace has keys)', () => {
    for (const ns of NAMESPACES) {
      expect(Object.keys(_bundlesForTest['en-US'][ns]).length).toBeGreaterThan(0);
    }
  });
});
