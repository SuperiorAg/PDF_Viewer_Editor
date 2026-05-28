// useT — the renderer's translation hook (i18n-strategy.md §3.3).
//
// Every component imports `useT` from here and calls `t('namespace:key')`. The
// hook is store-reactive: it reads the active locale from the i18n slice (the
// renderer mirror of settings 'i18n.locale') so a live locale switch re-renders
// every consuming component with the new strings — no restart.
//
// IMPLEMENTATION NOTE (the dep-pending decision, brief §file-ownership):
//   The translation ENGINE (interpolation, plural selection, en-US fallback) is
//   the pure `resolveKey` resolver in ./resolve.ts — it has NO i18next
//   dependency, so `useT` and every component that consumes it compile and TEST
//   green NOW, before Diego's Wave 29 install of i18next. The strategy's
//   `fallbackLng: 'en-US'` guarantee (a missing es-ES key renders English,
//   never a raw key) is delivered by `resolveKey` and asserted by resolve.test.
//   The i18next + react-i18next engine wired in ./index.ts is the LAZY-LOAD +
//   Suspense enhancement Diego's install enables; it does not change the t()
//   surface this hook exposes.

import { useCallback } from 'react';

import { useAppSelector } from '../state/hooks';
import { selectLocale } from '../state/slices/phase7-selectors';
import type { AppLocale } from '../types/ipc-contract';

import { resolveKey, type ResolveOptions } from './resolve';

/** A translation function: `t('settings:privacy.telemetryLabel')`. */
export type TFunction = (key: string, opts?: ResolveOptions) => string;

export function useT(): { t: TFunction; locale: AppLocale } {
  // selectLocale is defensive (defaults to 'en-US' if the slice is absent in a
  // partial-store test). Components rendered without ANY Provider must be
  // wrapped by the caller — useT is a renderer-app hook.
  const locale = useAppSelector(selectLocale);
  const t = useCallback<TFunction>((key, opts) => resolveKey(locale, key, opts), [locale]);
  return { t, locale };
}
