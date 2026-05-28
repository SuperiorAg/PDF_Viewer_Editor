// i18next type augmentation — the structural defense for the big-bang sweep.
//
// i18n-strategy.md §6 + conventions §18.4.3: the `CustomTypeOptions.resources`
// map is typed from the en-US namespace JSON files. This makes every `t()` call
// type-checked against the en-US baseline: `t('toolbar:open')` resolves to a
// real key, and a typo or a missing key is a COMPILE ERROR rather than a raw
// `toolbar:open` rendered on screen. There is NO `as any` escape hatch on `t()`
// — if the type system rejects a key, the key is missing from en-US: add it.
//
// NOTE (Diego Wave 29): `i18next` is not installed until Wave 29. Until then
// this `declare module 'i18next'` augmentation cannot resolve the base module
// and `tsc -p tsconfig.renderer.json` will report the i18next import as
// unresolved. That is the expected dep-pending state flagged in the brief; once
// Diego installs `i18next` + `react-i18next` + `i18next-resources-to-backend`
// (all MIT), this augmentation type-checks the entire renderer's `t()` surface.

import 'i18next';

import type common from './locales/en-US/common.json';
import type errors from './locales/en-US/errors.json';
import type menu from './locales/en-US/menu.json';
import type modals from './locales/en-US/modals.json';
import type settings from './locales/en-US/settings.json';
import type sidebar from './locales/en-US/sidebar.json';
import type toolbar from './locales/en-US/toolbar.json';
import type trustfloor from './locales/en-US/trustfloor.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    // Colon separates namespace from key path; dot separates nested segments
    // (i18next default). Example: t('settings:privacy.telemetryLabel').
    resources: {
      common: typeof common;
      toolbar: typeof toolbar;
      menu: typeof menu;
      sidebar: typeof sidebar;
      modals: typeof modals;
      settings: typeof settings;
      errors: typeof errors;
      trustfloor: typeof trustfloor;
    };
  }
}
