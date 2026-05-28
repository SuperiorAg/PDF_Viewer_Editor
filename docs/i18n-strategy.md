# Localization Strategy — PDF_Viewer_Editor (Phase 7)

**Author:** Riley (front-end-architect)
**Date:** 2026-05-27 (Wave 27)
**Status:** Phase 7 i18n framework design. Companion to `docs/architecture-phase-7.md §7`. Wave 28 implementers (Riley) execute the big-bang extraction against §3 + §5; Wave 29 Julian audits against §9.
**Reads:** `ARCHITECTURE.md` + `architecture-phase-2..7.md`, `conventions.md §11` (the Phase-1 i18n placeholder), `ui-spec.md` (all UI string surfaces).
**Libraries:** `i18next` (MIT), `react-i18next` (MIT), `i18next-resources-to-backend` (MIT, optional lazy loader). Licenses verified at design time.

---

## 0. The Phase-1 promise this fulfills

`conventions.md §11` (Phase 1) said: *"Out of scope for Phase 1. All strings hard-coded English. Phase 7 introduces an i18n framework (`react-i18next` or similar)."* This document is that framework's design. It also resolves the §11 hint that strings *"may"* live in co-located `.strings.ts` files — in practice they did not, so Phase 7 extracts directly from JSX (§3).

---

## 1. Library choice + rationale

| Library | License | Role | Why |
|---|---|---|---|
| `i18next` | MIT | core engine (interpolation, plurals, namespaces, fallback) | de-facto standard; framework-agnostic core; rich plural + format support; no telemetry, no phone-home |
| `react-i18next` | MIT | React bindings (`useTranslation`, `<Trans>`, `Suspense` integration) | first-class React hooks; `<Trans>` handles embedded markup (links, bold) without string concatenation |
| `i18next-resources-to-backend` | MIT | lazy `import()` backend for locale chunks | lets non-active locales be Vite code-split chunks (zero initial-bundle cost) |

**License verification:** all three are MIT (`i18next/i18next`, `i18next/react-i18next`, `i18next/i18next-resources-to-backend`). No AGPL, no commercial SDK — clears the project's permissive-OSS-only policy (`CLAUDE.md`).

**Bundle impact:** i18next core ≈ 22 KB min+gz; react-i18next ≈ 12 KB; resources-to-backend ≈ 2 KB. Total ≈ **36-50 KB** added to the renderer initial chunk. The **en-US** resource bundle is part of the initial chunk (the app must render *something* immediately); **es-ES** (and any future locale) is a lazy `import()` code-split chunk that loads only when selected. So adding the proof locale costs ~0 KB to users who never switch to it.

**Rejected alternatives:** `react-intl` / FormatJS (heavier, ICU-message-syntax-only, larger bundle, more ceremony for the same outcome); `lingui` (compile-step macro complexity not worth it for ~1000 strings); hand-rolled (loses plural/format/fallback machinery i18next gives for free).

---

## 2. Setup + init

```ts
// src/client/i18n/index.ts (Riley Wave 28) — design shape
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import resourcesToBackend from 'i18next-resources-to-backend';

// en-US is imported EAGERLY (initial chunk); other locales lazy via the backend.
import enUSCommon from './locales/en-US/common.json';
// ...the other en-US namespaces eagerly imported...

void i18n
  .use(resourcesToBackend((language: string, namespace: string) =>
    // Vite code-splits this dynamic import per (language, namespace) — non-en-US chunks lazy.
    import(`./locales/${language}/${namespace}.json`),
  ))
  .use(initReactI18next)
  .init({
    lng: undefined,                 // set from settings 'i18n.locale' at bootstrap (see §7)
    fallbackLng: 'en-US',           // missing key / locale → English (never a raw key on screen)
    supportedLngs: ['en-US', 'es-ES'],
    ns: ['common', 'toolbar', 'menu', 'sidebar', 'modals', 'settings', 'errors', 'trustfloor'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },   // React already escapes
    returnNull: false,
    // en-US resources pre-loaded so first paint is synchronous; other locales fetched by backend.
    partialBundledLanguages: true,
    resources: { 'en-US': { common: enUSCommon /* ...other ns... */ } },
  });

export default i18n;
```

The locale is read from the existing `settings` store (`i18n.locale`, default `'en-US'` — `data-models.md §12`) at app bootstrap and applied via `i18n.changeLanguage(locale)`. The renderer never hardcodes the active locale.

---

## 3. String-extraction strategy (Q-A — big-bang)

### 3.1 Approach: big-bang sweep in Wave 28

**Recommendation: big-bang, NOT incremental.** Reasons:

1. **Phase 7 is the polish phase** — making the app translatable is its explicit job, not a side effect of touching a component.
2. **A half-extracted app is the worst state.** If only some strings go through `t()`, the proof locale (es-ES) renders a jarring English/Spanish mix that makes the framework look broken, not partial.
3. **The work is mechanical, not architectural.** Every change is `"Open"` → `{t('toolbar.open')}` plus an `en-US/toolbar.json` entry. No logic changes.
4. **The typed-key check (§6) gates correctness.** A missing key is a compile error, so the sweep is verifiable: when the renderer typechecks clean AND no literal user-facing string remains (grep §9), the sweep is complete.

### 3.2 Scope estimate (order of magnitude)

**~800-1200 user-facing strings.** Derivation:

| Surface | Approx strings |
|---|---|
| Toolbar buttons + tooltips (Phases 1-6, 5 groups, ~30 buttons) | ~60 |
| Menu bar (File/Edit/Insert/View/Tools/Help + items) | ~70 |
| Sidebar tabs + panel labels + empty states (Thumbnails/Bookmarks/Forms/Exports) | ~80 |
| Modals (combine, settings, confirm-close, export-engine, export, OCR, PAdES sign, mail-merge, form-designer, about) — titles + bodies + buttons + field labels | ~250 |
| Settings (every label + subtext across General/Files/Export/Editing/About + Phase-7 additions) | ~90 |
| Status bar + toasts + inline statuses | ~50 |
| Error messages (every `Result` error → user-facing message; conventions §5.4) | ~120 |
| Trust-floor + known-limitations copy (Phase 4 PAdES + Phase 5 OCR + Phase 6 export + Phase 7) — multi-sentence | ~90 |
| Annotation properties, inspector, page metadata, form-field labels | ~80 |
| **Total estimate** | **~890** (round to ~800-1200 with growth) |

This is **large but mechanical**. Budget it as the dominant Wave 28 renderer task (see §8 risk on whether it fits one wave).

### 3.3 Extraction mechanics

For each component:
1. Identify every user-facing literal (JSX text, `aria-label`, `title`, `placeholder`, toast/error strings, button labels).
2. Replace with `t('namespace.key')` (or `<Trans i18nKey="..." />` if the string has embedded markup like a link or bold).
3. Add the key + English value to the matching `en-US/<namespace>.json`.
4. Add the same key to `es-ES/<namespace>.json` with a Spanish value (or leave English as a deliberate proof-incompleteness — §8 obligation #4).

**`aria-label` strings go through `t()` too** (a11y-audit §8.1 grep #8) — a screen reader in Spanish must hear Spanish labels.

**Strings that DON'T get extracted:** developer-only logs (conventions §9 — never user-facing), internal enum values, IPC channel names, file extensions, the app name "PDF_Viewer_Editor" (a proper noun).

---

## 4. The proof locale (es-ES) — Q-A / obligation #4

**Recommendation: en-US baseline + es-ES proof locale.**

- **es-ES over fr-FR:** Spanish has two plural forms (one/other), like English, keeping the plural proof clean; large user base; widely understood for a sample.
- **It is a SAMPLE, not a complete professional localization.** Some strings may remain English. This is trust-floor obligation #4 and is disclosed in (a) the locale folder README, (b) the About-modal locale-picker subtext ("Spanish — translation sample, some strings may appear in English"), (c) the user-guide (Wave 30 Nathan).
- **Fallback guarantees no raw keys ever show.** `fallbackLng: 'en-US'` means any untranslated es-ES key renders the English value — never the raw `toolbar.open` key. So a half-translated proof locale degrades gracefully to English, never to gibberish.

Adding a third locale later (fr-FR, de-DE, etc.) is purely additive: a new `locales/<lng>/` folder + the `supportedLngs` + locale-picker entry. No code change.

---

## 5. Namespace structure

```
src/client/i18n/
  index.ts                    init (§2)
  locales/
    en-US/
      common.json             OK / Cancel / Save / Close / Yes / No / generic labels
      toolbar.json            toolbar button labels + tooltips
      menu.json               menu bar items
      sidebar.json            tab labels + panel headers + empty states
      modals.json             every modal's title/body/buttons (keyed by modal)
      settings.json           settings labels + subtext (incl. Phase-7 telemetry/locale/update)
      errors.json             every user-facing error message (keyed by error code)
      trustfloor.json         multi-phase honesty copy (Phase 4/5/6/7 limitations)
    es-ES/
      <same 8 namespaces>     partial translation; missing keys fall back to en-US
  i18next.d.ts                TS augmentation (§6)
```

**Why namespaces (not one giant file):** namespaces map to lazy-load boundaries (a locale chunk loads per-namespace as needed) and keep each JSON file under the 200-line modularization rule's spirit. `errors.json` keyed by the `Result` error code makes the error→message mapping auditable.

**Key naming scheme:** `namespace.dotPath` in `camelCase` segments. Examples: `toolbar.open`, `modals.export.title`, `modals.export.startButton`, `errors.fs_read_failed`, `settings.telemetry.optInLabel`, `trustfloor.ocr.notPublicationQuality`. Conventions §18.4 locks this scheme.

---

## 6. Typed keys (the structural defense)

```ts
// src/client/i18n/i18next.d.ts (Riley Wave 28) — design shape
import 'i18next';
import type common from './locales/en-US/common.json';
import type toolbar from './locales/en-US/toolbar.json';
// ...import each en-US namespace as a type...

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof common;
      toolbar: typeof toolbar;
      // ...each namespace...
    };
  }
}
```

This makes `t('toolbar.open')` **type-checked against `en-US/toolbar.json`**. A typo or a missing key is a **compile error**, not a runtime raw-key-on-screen. This is the mechanism that makes the big-bang sweep verifiable: when the renderer typechecks clean, every `t()` call resolves to a real en-US key.

**No `as any` on `t()`** (cross-check with the Julian H-21.1 code-comment-contradiction lesson; conventions §18.4). If the type system complains about a `t()` key, the key is missing from en-US — add it, don't cast.

---

## 7. Locale selection + persistence

1. **Source of truth:** the `settings` key `i18n.locale` (`data-models.md §12`, default `'en-US'`).
2. **Bootstrap:** the renderer reads `i18n.locale` at startup (the existing settings-slice load) and calls `i18n.changeLanguage(locale)` before first paint.
3. **Change:** the Settings → General → language picker (ui-spec §16) dispatches an `i18n:setLocale` IPC call to persist + a renderer `i18n.changeLanguage()` to apply live. No restart needed (i18next swaps resources reactively via react-i18next's `Suspense`).
4. **Available locales:** the `i18n:getAvailableLocales` IPC channel returns `['en-US', 'es-ES']` (sourced from `supportedLngs`) so the picker is data-driven, not hardcoded.
5. **No auto-detection in Phase 7.** The OS language is NOT auto-detected (it would surprise users mid-flow and the proof locale is incomplete). Default is en-US; the user opts into es-ES. (OS-language detection is a Phase 7.1 candidate once locales are complete.)

---

## 8. Pluralization, date/number formatting, RTL

### 8.1 Pluralization

i18next's plural suffix handling:

```json
// en-US/sidebar.json
{ "pageCount_one": "{{count}} page", "pageCount_other": "{{count}} pages" }
```

```ts
t('sidebar.pageCount', { count: n });   // "1 page" / "5 pages"
```

es-ES uses the same one/other forms. Languages with more plural categories (e.g. Polish, Arabic) would add `_few` / `_many` keys — handled automatically by i18next's CLDR plural rules when such a locale is added.

### 8.2 Date / number formatting

Use the platform `Intl` API (no extra dependency — conventions §12 already prefers `Intl.DateTimeFormat`), wired through i18next's `format` interpolation:

```ts
i18n.init({ interpolation: { /* ... */ } });
// formatting helper bound to the active locale:
const fmtDate = (ms: number) => new Intl.DateTimeFormat(i18n.language).format(new Date(ms));
const fmtNum  = (n: number)  => new Intl.NumberFormat(i18n.language).format(n);
```

Recents "5 hr ago", export "7147 B → 7.1 KB", file sizes, page counts all route through `Intl` keyed to `i18n.language`. **No `date-fns` / `numeral` dependency added** (conventions §12.3: add date-fns only if a real need surfaces; Intl covers Phase 7).

### 8.3 RTL — documented but DEFERRED

Right-to-left languages (Arabic, Hebrew) are **out of scope for Phase 7** (no RTL proof locale; es-ES is LTR). Documented for a future phase:

- RTL requires `dir="rtl"` on the document root keyed to the locale, plus CSS logical properties (`margin-inline-start` not `margin-left`) across the renderer.
- The toolbar/sidebar/inspector layout would need mirroring.
- This is a **non-trivial layout pass**, not a string-table addition — explicitly deferred. The Phase-7 framework does not block it (i18next supports RTL locales natively); the *CSS layout* work is the deferred part.

---

## 9. Wave 29 Julian audit checklist (mechanical)

```bash
# (1) No hardcoded user-facing JSX text outside t() / <Trans> (heuristic: capitalized literal in JSX)
#     Manual scan of flagged matches; some false positives (proper nouns) are acceptable.
rg -n '>[A-Z][a-z]+ [a-z]' src/client/components/    # review each for a missing t()

# (2) aria-label / title / placeholder go through t()
rg -n 'aria-label="[A-Za-z]|title="[A-Za-z]|placeholder="[A-Za-z]' src/client/   # literal = flag

# (3) Typed keys augmentation exists
rg -n 'CustomTypeOptions' src/client/i18n/i18next.d.ts    # >= 1 match

# (4) No as-any on t()
rg -n 't\(.*\) as any|as any.*t\(' src/client/    # ZERO matches

# (5) fallbackLng is en-US (no raw keys ever show)
rg -n "fallbackLng" src/client/i18n/index.ts    # must be 'en-US'

# (6) Both locales have all 8 namespace files (es-ES may be partial CONTENT but files must exist)
ls src/client/i18n/locales/en-US/ src/client/i18n/locales/es-ES/    # 8 files each

# (7) Locale is read from settings, not hardcoded
rg -n "changeLanguage|i18n.locale" src/client/    # locale sourced from settings 'i18n.locale'

# (8) No new date/number formatting dependency (Intl only)
rg -n "from 'date-fns'|from 'numeral'|from 'moment'" src/client/    # ZERO matches
```

### 9.1 Cross-reference checklist

- [x] Library choice + license verification + bundle impact (§1)
- [x] Init + lazy backend (§2)
- [x] Big-bang extraction recommendation + ~800-1200 string estimate (§3, Q-A)
- [x] es-ES proof locale + sample-not-complete honesty (§4, obligation #4)
- [x] Namespace structure + key-naming scheme (§5)
- [x] Typed keys as the structural defense + no-as-any (§6)
- [x] Locale selection + persistence via settings (§7)
- [x] Pluralization + Intl date/number formatting + RTL deferral (§8)
- [x] Wave 29 Julian mechanical greps (§9)
- [x] L-001 untouched — this strategy does not reference or weaken `enableDragDropFiles`

End of Phase-7 i18n strategy.
