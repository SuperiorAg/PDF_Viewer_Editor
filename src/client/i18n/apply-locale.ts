// applyLocale — a thin, dependency-isolated wrapper around the i18next engine's
// changeLanguage. It dynamically imports ./index (which statically imports
// i18next + react-i18next) ONLY when called, inside a try/catch.
//
// WHY the dynamic import: i18next is not installed until Diego's Wave 29. A
// STATIC `import './index'` anywhere in the renderer's eager import graph would
// make Vite + vitest fail to resolve the module at load time, breaking every
// component test. Isolating the engine behind a lazy import() means the
// translation surface (useT → resolve.ts, store-driven) works NOW, and the
// i18next lazy-load/Suspense layer activates transparently once installed —
// without any test or component carrying a hard i18next import.
//
// Until Diego installs, applyLocale is a no-op (the catch swallows the missing
// module); the store's locale mirror drives useT, so the UI still switches
// locales live. After install, applyLocale also primes i18next's lazy es-ES
// chunk fetch.

import type { AppLocale } from '../types/ipc-contract';

export async function applyLocale(locale: AppLocale): Promise<void> {
  try {
    const mod = await import('./index');
    await mod.setLocale(locale);
  } catch {
    // i18next engine not installed yet (Diego Wave 29) — the Redux locale
    // mirror already drives useT, so this is a graceful no-op, not a failure.
  }
}
