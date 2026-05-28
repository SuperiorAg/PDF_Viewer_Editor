# ARCHITECTURE — Phase 7 Additions (Polish & Cross-Platform)

**Author:** Riley (front-end-architect)
**Date:** 2026-05-27 (Wave 27)
**Status:** Phase 7 design, locked at end of Wave 27. This is the **FINAL roadmap phase**. Additions to Phase-1 `ARCHITECTURE.md` and Phase-2..6 `docs/architecture-phase-{2,3,4,5,6}.md` — all six frozen per the P{N}-L-FREEZE rule, extended below as P7-L-FREEZE.
**Scope:** Architectural deltas needed for Phase 7 features — cross-platform packaging config (macOS + Linux, UNVERIFIED), auto-update via electron-updater, an opt-in/default-OFF telemetry framework, the WCAG 2.1 AA accessibility audit + remediation map, and an i18next localization framework with one proof locale.
**Reads:** all six prior architecture docs + the engine companion docs (`edit-replay-engine.md`, `form-engine.md`, `signature-engine.md`, `ocr-engine.md`, `export-engine.md`), `docs/phase-7-plan.md`, `docs/project-roadmap.md`.

> **Companion documents.** This file describes the system additions. The detailed
> accessibility audit (every critical user path, keyboard-nav requirements, ARIA
> roles, focus management, Narrator expectations, the Wave-28 implementer checklist)
> lives in [`docs/a11y-audit.md`](a11y-audit.md). The localization framework design
> (i18next setup, string-extraction strategy, namespace structure, lazy-loading,
> the proof locale, pluralization + date/number formatting, RTL deferral) lives in
> [`docs/i18n-strategy.md`](i18n-strategy.md). Read all three together.

---

## 0. Scope

Phase 7 is the **polish phase**. It adds **no new document-editing capability**. Instead it makes the existing feature-complete app (open / render / edit / annotate / forms / mail-merge / sign / OCR / Office-export, shipped through v0.6.1) shippable beyond a single developer's Windows box, updatable, measurable (opt-in), accessible, and translatable. Specifically:

1. **macOS packaging config (DMG + universal binary intent)** — `electron-builder.yml` gains a `mac` target. **UNVERIFIED on hosts** (locked decision; see §1 P7-L-1). Diego owns the config; CI does NOT build it.
2. **Linux packaging config (AppImage + deb)** — `electron-builder.yml` gains a `linux` target. **UNVERIFIED on hosts.** Diego owns; CI does NOT build it.
3. **Auto-update via electron-updater (MIT)** — GitHub releases provider, **publish target is a PLACEHOLDER** (repo not published). Main-process update controller + three IPC channels + an opt-in "check on launch" setting (default OFF) + an explicit "Check for updates" button in the About modal.
4. **Telemetry framework** — opt-in, **default OFF**, anonymous, no PII, no third-party phone-home SDK. Client-side event hook with an **explicit event-name allowlist**, a **no-op local-ring-buffer transport** (Q-B), a Settings opt-in toggle, and a debug panel to inspect the buffer. No network endpoint ships in Phase 7.
5. **Accessibility audit (WCAG 2.1 AA target)** — every critical path keyboard-navigable; the deferred Phase-1 ARIA tab patterns fixed (sidebar tabs, settings tabs, toolbar); Windows Narrator as the test screen reader. The full audit + remediation map is in `a11y-audit.md`.
6. **Localization framework (i18next + react-i18next, MIT)** — en-US baseline extracted from six phases of hardcoded strings (big-bang sweep, Q-A) + ONE proof locale (es-ES recommended). Lazy-loaded locale bundles. The full strategy is in `i18n-strategy.md`.

Phase 1-6 chapters that aren't amended remain authoritative. **No `src/main/**`, `src/db/**`, or engine code is touched by this wave — it is design-only.**

---

## 1. Locked decisions encoded (Wave 27 self-check)

| ID | Decision | Encoded where | Cross-ref |
|---|---|---|---|
| **P7-L-1** | **Cross-platform: configure all, verify Windows only.** `electron-builder.yml` gains `mac` (dmg, universal) + `linux` (AppImage, deb) targets. The CI matrix exercises **Windows packaging only**. Configs are correct + reusable; mac/linux verification is deferred to a future **Phase 7.1** once hosts exist. Docs state UNVERIFIED loudly. | §2 (build matrix), §6 (native-module story) | `phase-7-plan.md` risk #3; roadmap Out-of-scope |
| **P7-L-2** | **Auto-update: electron-updater (MIT) + GitHub releases provider, publish target is a PLACEHOLDER.** Full flow designed (check → notify → download → quit-and-install) but the `publish` block is a documented placeholder; updates do not function until a real release channel is configured. Update check is **explicit by default** + opt-in "check on launch" (default OFF). Never auto-downloads unless the channel setting allows it. | §3 (auto-update flow) | `data-models.md §12`; `api-contracts.md §18`; `ui-spec.md §16` |
| **P7-L-3** | **Telemetry: opt-in, default OFF, anonymous, no PII, no third-party SDK.** Client-side event hook + **explicit event-name allowlist** (counts only — no document content, no file paths, no user identity). Transport is a **no-op local ring buffer** (Q-B); no endpoint ships. The framework + opt-in UI + allowlist are the deliverable. Real transport = Phase 7.1. | §4 (telemetry architecture) | `conventions.md §18`; `data-models.md §12`; `api-contracts.md §18`; `ui-spec.md §16` |
| **P7-L-4** | **a11y: WCAG 2.1 AA target.** Audit all critical paths; fix the deferred Phase-1 ARIA tab patterns; keyboard nav for every critical path; Windows Narrator as the test SR. Restore `jsx-a11y/aria-proptypes` to `error` from `warn`. | §5 (a11y plan) | `a11y-audit.md`; `ui-spec.md §16`; `conventions.md §18`; `code-review.md` LOW (sidebar/index.tsx:11-16) |
| **P7-L-5** | **i18n: i18next + react-i18next (MIT).** en-US baseline extracted from six phases of hardcoded strings (big-bang) + ONE proof locale (es-ES). Lazy-load locale bundles. String extraction is a large-but-mechanical Wave 28 task. | §7 (i18n architecture) | `i18n-strategy.md`; `conventions.md §18`; `ui-spec.md §16` |
| **P7-L-6** | **Trust-floor honesty obligations (SIXTH instance — the project's strongest pattern, after H-3 + Phase 3 forms + Phase 4 PAdES + Phase 5 OCR + Phase 6 export).** Six Phase-7 obligations enumerated §8 — surface at four locations per the proven ratchet. The four highest-stakes claims: telemetry-OFF-by-default; update-publish-target-is-placeholder; mac/linux-UNVERIFIED; proof-locale-is-a-sample-not-complete. | §8 (trust-floor) | `conventions.md §18`; `ui-spec.md §16`; README + user-guide (Wave 30 Nathan) |
| **P7-L-7** | **Schema delta: NO new table; THREE new `settings` keys + ZERO new in-memory model.** Telemetry opt-in, selected locale, update channel, last-update-check timestamp all fold into the existing `settings` key-value store (keys `telemetry.*`, `i18n.*`, `update.*`). Forward-only migration v7. No Phase 1-6 table touched. | §9 (schema v7), `data-models.md §12` | `data-models.md §12` |
| **P7-L-8** | **No new process, no new window, no new bundled binary requiring a copy step.** electron-updater + i18next + react-i18next are pure-JS; the locale bundles are JSON lazy-imported by the renderer (Vite code-split chunks). No native module added. The mac/linux native-module story (§6) is about **rebuilding existing** native deps per-platform, not adding new ones. | §2.1, §6 | `phase-7-plan.md` acceptance criteria |

**Cross-check against the sentinel-default lesson (global JSONL 2026-05-26, four-times-bitten):** Phase 7 uses **nullable + late-init** for `UpdateState.availableVersion: string | null` (null until a check returns an update), `UpdateState.lastCheckedAt: number | null` (null until first check), and `TelemetryStatus.lastEventAt: number | null`. No sentinel `''` / `0` / `-1`. See §3.3 and §4.4.

**Cross-check against the stub-shipped-with-TODO lesson (global JSONL 2026-05-27, Wave 18 + reaffirmed P5-L-2, P6 §17.4):** Phase 7 has TWO honest, *intentional* placeholders that are NOT the stub anti-pattern, and the distinction is load-bearing:

- The **telemetry transport** is a real, fully-wired `NoOpRingBufferTransport` — it is the *complete* Phase 7 implementation, exercisable end-to-end via the debug panel. It is not an optional dep with a sentinel fallback; it is the shipped transport. Phase 7.1 swaps it for a network transport *behind the same `TelemetryTransport` interface*. The interface field is **required** (`transport: TelemetryTransport`), never optional. See §4.3.
- The **auto-update publish target** is a documented configuration placeholder in `electron-builder.yml` (`publish: { provider: github, owner: PLACEHOLDER, repo: PLACEHOLDER }`). This is honest config that produces a working *client*; it is not a code stub that silently returns success. The update controller's "no publish target configured" path returns an explicit `Result<never, 'update_not_configured'>`, NOT a fake "up to date" — see §3.4. This is the anti-stub discipline applied to config.

**Cross-check against the as-any / code-comment-contradiction lesson (Julian Wave 21 H-21.1, P6 §17.5):** The i18n migration touches every renderer component. The risk is a translator helper typed as `any` to escape i18next's key-typing. Phase 7 generates a **typed key union** from `en-US.json` (`i18next` augmentation module; see `i18n-strategy.md §6`) so `t('toolbar.open')` is type-checked. NO `as any` on `t()` calls. Conventions §18.4 codifies.

**Cross-check against the renderer-vs-main asset-path divergence lesson (global JSONL 2026-05-27, Phase 6.1 promotion candidate):** Phase 7's locale JSON bundles are **renderer-only** assets, lazy-imported by Vite (`import('./locales/es-ES/...')` becomes a code-split chunk under `dist/renderer/`). They do NOT go through a main-process `require.resolve` path, so the divergence does not bite. The native-module rebuild story (§6) is the place that *does* interact with packaging, and it is documented as the riskiest part of the unverified configs.

---

## 2. Cross-platform build matrix (P7-L-1)

### 2.1 No new processes, no new windows, no new bundled assets

Phase 7 adds **no new BrowserWindow**, **no new long-lived OS process**, and **no new native binary copy step**. The update controller runs in the existing main process; i18next runs in the existing renderer; locale bundles are renderer code-split chunks. Diego's packaging config is the only file that grows a new *target*.

**L-001 cross-check:** `enableDragDropFiles: true` on the main BrowserWindow is untouched. Phase 7 introduces no new file-picker channels and no drag-drop entry points. The mac/linux targets package the SAME `BrowserWindow` factory; the drag-drop `File.path` reliance is a renderer concern that the cross-platform config does not alter. **Phase 7 does not weaken or extend L-001.** (Note for Phase 7.1 verification: Electron's `File.path` is available on macOS and Linux too, so L-001's mechanism is cross-platform-safe in principle — but this is UNVERIFIED until a real host runs it.)

### 2.2 The target matrix

`electron-builder.yml` (Diego owns) gains `mac` + `linux` blocks alongside the existing `win` block:

| Platform | Targets | Arch | CI builds? | Verified? |
|---|---|---|---|---|
| Windows | `nsis` (installer) + `portable` | x64 | **YES** (test-of-record) | YES (L-002 screenshot every packaging wave) |
| macOS | `dmg` | universal (x64 + arm64) | **NO** (config-only) | **NO — UNVERIFIED** |
| Linux | `AppImage` + `deb` | x64 | **NO** (config-only) | **NO — UNVERIFIED** |

The CI matrix (`.github/workflows/ci.yml`, Diego) keeps a **single `windows-latest` packaging job**. Diego may add `macos-latest` / `ubuntu-latest` *typecheck + unit-test* jobs (cheap, no packaging) if useful, but the `dist` packaging step runs on Windows only. The locked decision is explicit: configs are ready-to-use, awaiting hosts.

### 2.3 macOS config shape (design intent for Diego)

```yaml
# electron-builder.yml — mac block (Diego authors in Wave 28; UNVERIFIED)
mac:
  target:
    - target: dmg
      arch: [universal]          # universal binary intent (x64 + arm64 merged)
  category: public.app-category.productivity
  hardenedRuntime: true          # required for notarization (Phase 7.1 step)
  gatekeeperAssess: false        # we are not notarizing in Phase 7
  entitlements: build/entitlements.mac.plist   # NEW file Diego authors (file-access entitlements)
  # NOTE: code-signing + notarization deferred to Phase 7.1 (cert acquisition is real-world;
  #       Diego documents the workflow in docs/code-signing-workflow.md). An UNSIGNED dmg
  #       will trigger Gatekeeper quarantine on the user's machine — documented limitation.
```

### 2.4 Linux config shape (design intent for Diego)

```yaml
# electron-builder.yml — linux block (Diego authors in Wave 28; UNVERIFIED)
linux:
  target:
    - AppImage
    - deb
  category: Office
  maintainer: PLACEHOLDER <placeholder@example.com>   # honest placeholder until publish
  desktop:
    Name: PDF_Viewer_Editor
    Comment: View, edit, annotate, sign, and export PDFs
    MimeType: application/pdf
```

### 2.5 Why "configure but don't verify" is the right call here

Documented rationale (so a future maintainer does not "fix" this by enabling cross-platform CI prematurely):

1. **No mac/linux host exists** in the current build environment. CI runners would be the only verification surface, and a green CI package step does NOT prove the binary runs (L-002's entire lesson: process metadata ≠ working UI; the equivalent for mac/linux would need a headed runner + screenshot, which is the Phase 7.1 follow-up already tracked in L-002's "to unlock" note).
2. **Native modules are the real risk** (§6) — `better-sqlite3`, `@napi-rs/canvas`, `tesseract.js-core`. These rebuild per-platform; the config can be syntactically perfect and still produce a binary that crashes on launch because a native dep failed to rebuild for the target ABI. Shipping an UNVERIFIED mac binary as if it were verified would be the dishonest move the trust-floor pattern exists to prevent.
3. **The config is reusable.** When a host appears (Phase 7.1), the verification is a matter of running `electron-builder --mac` / `--linux` on that host + the L-002 screenshot drill — no design work remains.

---

## 3. Auto-update flow (P7-L-2)

### 3.1 Library

**`electron-updater` (MIT)** — part of the `electron-builder` ecosystem already in the project (Diego owns `electron-builder.yml`). License verified: electron-updater is MIT (the `electron-userland/electron-builder` monorepo, `packages/electron-updater`). No AGPL, no commercial SDK. It reads the `publish` block from `electron-builder.yml` to know where to fetch update metadata (`latest.yml` / `latest-mac.yml` / `latest-linux.yml`).

### 3.2 The publish placeholder (honest config, NOT a stub)

```yaml
# electron-builder.yml — publish block (Diego authors in Wave 28)
publish:
  provider: github
  owner: PLACEHOLDER        # repo not published yet
  repo: PLACEHOLDER
  releaseType: release
```

Because `owner`/`repo` are placeholders, electron-updater's `checkForUpdates()` will fail to resolve a real feed. The main-process update controller (§3.4) detects the placeholder at startup and routes every update call to a **`update_not_configured`** error — a loud, honest "updates are not wired to a real release channel yet" — rather than a fake "you're up to date". This is the trust-floor obligation #2 made executable.

### 3.3 State model (renderer-facing, nullable + late-init)

```ts
// src/client/state/slices/update-slice.ts (Riley Wave 28) — design shape
type UpdateChannel = 'manual' | 'check-on-launch';   // 'manual' = explicit only (DEFAULT)

interface UpdateState {
  channel: UpdateChannel;                  // mirrors settings 'update.channel'; DEFAULT 'manual'
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date'
        | 'error' | 'not-configured';
  availableVersion: string | null;         // null until a check returns an update (NO sentinel '')
  downloadProgressPercent: number | null;  // null unless status === 'downloading'
  lastCheckedAt: number | null;            // null until first check (NO sentinel 0)
  errorMessage: string | null;             // null unless status === 'error'
}
```

### 3.4 The full flow (designed; placeholder-gated)

```
1. Trigger:
   - EXPLICIT: user clicks "Check for updates" in About modal  → always available
   - AUTO: app launch, ONLY IF settings.update.channel === 'check-on-launch' (DEFAULT 'manual', so OFF)
        ↓
2. Renderer dispatches update:check IPC
        ↓
3. Main update-controller:
   3a. If publish target is placeholder → return Result<never,'update_not_configured'>  (status → 'not-configured')
   3b. Else autoUpdater.checkForUpdates()
        - no update          → status 'up-to-date', lastCheckedAt = now
        - update-available    → status 'available', availableVersion = X.Y.Z
        - network/feed error  → status 'error', errorMessage
        ↓
4. If available, renderer shows a non-modal notice (status-bar widget + About-modal banner).
   Download is NEVER automatic — user clicks "Download update" (update:download IPC).
        ↓
5. Main autoUpdater.downloadUpdate(); emits progress events → downloadProgressPercent
        ↓
6. On download complete → status 'downloaded'. Renderer shows "Restart to install".
        ↓
7. User clicks "Restart and install" → update:install IPC → autoUpdater.quitAndInstall()
```

**Q-C answer (auto-update UX):** explicit "Check for updates" in the About modal is the primary path; the opt-in `update.channel = 'check-on-launch'` setting is the secondary path, **default OFF** because the publish target is a placeholder (auto-checking against a non-existent feed produces noise). Silent-background-download is explicitly NOT implemented — every download is user-initiated.

### 3.5 Signature-verification dependency (carried from phase-7-plan risk #1)

electron-updater verifies the update bundle's code-signature before applying it (on Windows: Authenticode; on mac: notarization/signature). **Until the code-signing cert is acquired (Diego documents the workflow in `docs/code-signing-workflow.md`, Phase 7.1), auto-update will refuse to apply downloaded bundles on a properly-configured production channel.** This is correct security behavior and is documented as a trust-floor obligation, not a bug. The Phase 7 deliverable is the wired *client*; the cert + publish target are the user's real-world Phase 7.1 steps.

---

## 4. Telemetry architecture (P7-L-3)

### 4.1 Privacy stance (loud, by design)

Telemetry is **OFF by default**. It is **opt-in** via an explicit Settings toggle with clear privacy copy. When enabled, it records **anonymous feature-usage counts only** — never document content, never file paths, never the user's identity, never any free-text. The transport ships as a **no-op local ring buffer** (Q-B): nothing leaves the machine in Phase 7. The user can open a debug panel and read every event the framework has recorded, so the opt-in is auditable.

This is the strongest privacy posture among the libraries surveyed (§4.5): no Google Analytics, no Sentry-auto-send, no SDK that defaults to ON or phones home on import.

### 4.2 The event hook + allowlist

```ts
// src/client/telemetry/telemetry-events.ts (Riley Wave 28) — design shape
// EXPLICIT ALLOWLIST. Adding an event = adding a literal to this union AND the runtime Set.
// Anything not in the allowlist is dropped (and a dev-mode console.warn fires).
export type TelemetryEventName =
  | 'app.launch'
  | 'doc.open'
  | 'doc.save'
  | 'feature.annotate.add'
  | 'feature.page.reorder'
  | 'feature.combine.run'
  | 'feature.form.fill'
  | 'feature.mailmerge.run'
  | 'feature.sign.pades'
  | 'feature.ocr.run'
  | 'feature.export.docx'
  | 'feature.export.xlsx'
  | 'feature.export.pptx'
  | 'feature.export.image'
  | 'feature.update.checked'
  | 'feature.locale.changed';

// The ONLY payload allowed is a count + a coarse, non-identifying bucket.
// NO document content. NO file paths. NO field values. NO error strings. NO timestamps with
// sub-day resolution (day-bucketed only, to defeat session fingerprinting).
export interface TelemetryEvent {
  name: TelemetryEventName;
  count: 1;                          // always 1 per call; aggregation is the transport's job
  dayBucket: string;                 // 'YYYY-MM-DD' — coarse; never a precise timestamp
}
```

### 4.3 The transport (required-on-interface; no-op ring buffer is the shipped impl — Q-B)

```ts
// src/client/telemetry/telemetry-transport.ts (Riley Wave 28) — design shape
export interface TelemetryTransport {
  record(event: TelemetryEvent): void;     // called only when opt-in is TRUE
  snapshot(): readonly TelemetryEvent[];   // for the debug panel
  clear(): void;
}

// Phase 7 shipped implementation — NOTHING leaves the machine.
export class NoOpRingBufferTransport implements TelemetryTransport {
  // bounded ring buffer (default 500 events); oldest evicted; never written to disk; never sent.
}
```

The telemetry hook takes a **required** `transport: TelemetryTransport` (no optional fallback, no stub-default — per the anti-stub discipline, P6 §17.4). Phase 7.1 may add a `NetworkBatchTransport implements TelemetryTransport` behind the same interface; the opt-in UI and allowlist do not change.

### 4.4 The gate (opt-in is checked at the hook, not the call site)

```ts
// src/client/telemetry/use-telemetry.ts (Riley Wave 28) — design shape
export function useTelemetry() {
  const optedIn = useAppSelector((s) => s.settings['telemetry.optIn']);   // DEFAULT false
  return useCallback((name: TelemetryEventName) => {
    if (!optedIn) return;                                  // hard gate; no event when OFF
    if (!TELEMETRY_ALLOWLIST.has(name)) {                  // belt-and-suspenders
      if (import.meta.env.DEV) console.warn(`telemetry: dropped non-allowlisted '${name}'`);
      return;
    }
    transport.record({ name, count: 1, dayBucket: toDayBucket(Date.now()) });
  }, [optedIn]);
}
```

`TelemetryStatus` (renderer-facing): `{ optedIn: boolean; bufferedCount: number; lastEventAt: number | null }` — `lastEventAt` is nullable + late-init.

### 4.5 Library survey (why no third-party SDK)

| Candidate | Verdict | Reason |
|---|---|---|
| Google Analytics / GA4 | **REJECTED** | Phones home by default; sends to Google; cookie/identity surface; defaults ON once initialized. |
| Sentry | **REJECTED** | Auto-sends crash + breadcrumb data by default; captures stack traces that may include file paths / doc content; opt-out model, not opt-in. |
| PostHog / Mixpanel / Amplitude | **REJECTED** | All assume a network endpoint + identity; overkill for anonymous counts; opt-out culture. |
| `electron-telemetry` style wrappers | **REJECTED** | Thin wrappers over the above; same defaults-ON problem. |
| **Hand-rolled hook + allowlist + no-op transport** | **CHOSEN** | Zero new dependency; default OFF; auditable; nothing leaves the machine in Phase 7; Phase 7.1 can add a self-hosted transport behind the interface. |

The chosen approach adds **no new dependency** — it is ~3 small renderer modules + 1 settings key + 1 IPC trio (to persist the opt-in + expose the buffer for the debug panel).

---

## 5. Accessibility audit plan (P7-L-4)

Full audit + per-path remediation map + Wave-28 implementer checklist is in [`docs/a11y-audit.md`](a11y-audit.md). Architectural summary:

### 5.1 Target

**WCAG 2.1 Level AA.** Test screen reader: **Windows Narrator** (the locked SR per roadmap). The Phase 1 floor (ui-spec §13) is upgraded from "floor" to "audited + remediated".

### 5.2 The deferred Phase-1 fix (the headline a11y debt)

Phase 1 Riley dropped proper ARIA tab semantics to work around `jsx-a11y/aria-proptypes` (downgraded to `warn`). The affected surfaces, from `code-review.md`:

- `src/client/components/sidebar/index.tsx:11-16` — sidebar tabs (Thumbnails / Bookmarks / Forms / Exports) lack the `role="tablist"` / `role="tab"` / `role="tabpanel"` + `aria-selected` + roving-tabindex pattern.
- Settings modal tabs (General / Files / Export / Editing / About) — same gap.
- Toolbar — needs `role="toolbar"` + arrow-key navigation within groups.

Wave 28 implements the **proper ARIA tab pattern** and **restores `jsx-a11y/aria-proptypes` to `error`** (acceptance criterion). The remediation map in `a11y-audit.md §4` is the checklist.

### 5.3 Remediation priority (Q-D)

| Tier | Critical paths | Phase 7 verdict |
|---|---|---|
| **MUST (Wave 28)** | open · render/navigate · annotate · save · the deferred ARIA tab patterns (sidebar + settings + toolbar) | the walking-skeleton core; ships in Wave 28 |
| **SHOULD (Wave 28 if budget; else 7.1)** | fill form · sign · OCR · export | ranked: forms > export > OCR > sign |
| **DOCUMENT-ONLY (defer to 7.1)** | canvas annotation freehand drawing via keyboard (inherently pointer-centric); full Narrator narration of per-page render | documented as known a11y gaps in `a11y-audit.md §7` |

See §8 obligation and `a11y-audit.md` for the full inventory of eight critical paths.

---

## 6. Cross-platform native-module story (Q-E) — the riskiest part of the unverified configs

The project ships THREE native / platform-specific binary dependencies. On Windows they are verified every packaging wave (L-002). On mac/linux they are UNVERIFIED. This section documents how the configs *intend* to handle them, and flags the precise risk.

| Native dep | What it is | Cross-platform handling | Risk on mac/linux |
|---|---|---|---|
| `better-sqlite3` | N-API native addon (SQLite). Used by Ravi's `src/db`. | electron-builder runs `electron-rebuild` (via `@electron/rebuild`, invoked by `app/install-app-deps`) to compile the addon against the **target platform + Electron ABI**. Per-platform prebuilds or from-source compile. | **HIGH.** The build-report already records `better-sqlite3` Node-24 ABI recovery failures on the dev host (2026-05-27). A from-source compile on a mac/linux CI runner needs the platform toolchain (Xcode CLT / build-essential). If the rebuild fails, the DB layer crashes on launch → white-screen app. This is exactly the class of defect a config-only ship cannot catch. |
| `@napi-rs/canvas` | Prebuilt N-API canvas (Skia). Used by the main-process raster pipeline (Phase 4.1 metadata + Phase 5 OCR + Phase 6 image export). | `@napi-rs/canvas` ships **per-platform prebuilt `.node` binaries** (darwin-x64, darwin-arm64, linux-x64-gnu, win32-x64-msvc). electron-builder bundles the matching prebuild for the target. | **MEDIUM.** Prebuilds usually "just work" but the universal-mac target needs BOTH darwin-x64 AND darwin-arm64 `.node` files merged into the universal app. electron-builder's universal merge must include both — UNVERIFIED. linux-musl (Alpine) is NOT targeted (deb/AppImage are glibc). |
| `tesseract.js-core` | WASM (not a native `.node`) + the `.traineddata` language packs. Used by Phase 5 OCR. | WASM is platform-agnostic; the language packs are data files copied via the existing Phase 5 `extraResources` step. No per-platform rebuild needed. | **LOW.** WASM runs the same everywhere. The only cross-platform concern is the asar-unpack path for the tessdata (already solved on Windows; the SAME `asarUnpack` glob applies to mac/linux). |

**Q-E answer summarized:** electron-builder's per-platform rebuild (`better-sqlite3`) + per-platform prebuild bundling (`@napi-rs/canvas`) is the mechanism. The **universal-mac merge of `@napi-rs/canvas`** and the **from-source `better-sqlite3` rebuild on the target toolchain** are the two failure modes most likely to make an UNVERIFIED mac/linux binary crash on launch. The configs declare the intent; Phase 7.1 verification on a real host + an L-002-equivalent screenshot is the only thing that proves they work. **Documenting this risk is itself a trust-floor obligation** (§8 obligation #3).

### 6.1 asarUnpack carry-over (from Phase 6.1 lesson)

The Phase 6.1 lesson (renderer-vs-main asset-path divergence) means `pdfjs-dist/{standard_fonts,cmaps}` + `tesseract.js` wasm/tessdata + the three native `.node` files must be `asarUnpack`'d. The SAME `asarUnpack` globs in `electron-builder.yml` apply to all three platforms (electron-builder applies the top-level `asarUnpack` across `mac`/`linux`/`win`). Diego's Wave 28 config must ensure the globs are NOT nested under the `win:` block. Documented so the cross-platform config inherits the hard-won Windows asarUnpack fix.

---

## 7. i18n architecture (P7-L-5)

Full strategy (setup, extraction, namespaces, lazy-loading, proof locale, pluralization, RTL deferral) is in [`docs/i18n-strategy.md`](i18n-strategy.md). Architectural summary:

### 7.1 Libraries

- **`i18next` (MIT)** — the core i18n engine. License verified (MIT, `i18next/i18next`).
- **`react-i18next` (MIT)** — React bindings (`useTranslation`, `<Trans>`). License verified (MIT).
- **`i18next-resources-to-backend` (MIT)** (optional) — enables lazy `import()` of locale chunks so non-active locales are not in the initial bundle.

Bundle impact: i18next + react-i18next ≈ 40-50 KB min+gz added to the renderer. The en-US resource bundle is part of the initial chunk; non-active locales are lazy `import()`ed (Vite code-split) so they cost nothing until selected.

### 7.2 String-extraction scope (Q-A)

**Recommendation: big-bang sweep in Wave 28** (not incremental). Rationale: Phase 7 is the polish phase — its explicit job is to make the app translatable, and a half-extracted app (some strings via `t()`, some hardcoded) is worse than either extreme because the proof locale renders a confusing English/Spanish mix. A single mechanical sweep across six phases of components, gated by the typed-key check (§7.3), is the right scope.

**String-count estimate: order of ~800-1200 user-facing strings.** Derivation: 6 phases × roughly 12-18 components each with surfaces (toolbar labels, menu items, modal titles + body + buttons, sidebar tab labels, status-bar text, error messages, tooltips, empty-states, settings labels, trust-floor copy). The trust-floor + known-limitations copy alone (Phase 4 PAdES, Phase 5 OCR, Phase 6 export) is several dozen multi-sentence strings. This is **large but mechanical** — no logic changes, just `t('namespace.key')` substitution + a `en-US.json` entry per string.

### 7.3 Namespace structure + typed keys

```
src/client/i18n/
  index.ts                    (i18next init; lazy backend; language detector reads settings 'i18n.locale')
  locales/
    en-US/
      common.json             (buttons, generic labels, OK/Cancel/Save/etc.)
      toolbar.json
      menu.json
      sidebar.json
      modals.json             (all modal titles + bodies)
      settings.json
      errors.json             (every user-facing error message)
      trustfloor.json         (the multi-phase honesty copy — Phase 4/5/6 limitations)
    es-ES/                    (the proof locale — SAME namespace files; partial translation)
  i18next.d.ts                (TS augmentation: `resources` typed from en-US → t() key autocomplete + type-check)
```

The `i18next.d.ts` augmentation makes `t('toolbar.open')` type-checked against `en-US/toolbar.json`. A missing key is a **compile error**, which is the structural defense against the half-extracted-mix problem. Conventions §18.4 codifies "no hardcoded user-facing strings; all via `t()`; key naming = `namespace.dot.path`".

### 7.4 The proof locale (es-ES recommended)

**Recommendation: en-US baseline + es-ES proof locale.** es-ES is chosen over fr-FR because Spanish has slightly simpler pluralization (two forms, like English) which keeps the proof clean, and a large user base. The proof locale is a **translation sample, not a complete professional localization** — some strings may remain in English (trust-floor obligation #4). This honesty is documented in the locale README and surfaced in the About modal's locale picker subtext.

---

## 8. Trust-floor honesty obligations (P7-L-6 — SIXTH instance)

Per the proven five-times pattern (H-3 + Phase 3 forms + Phase 4 PAdES + Phase 5 OCR + Phase 6 export), Phase 7 introduces the **sixth instance** — and it is the one with the most claims a careless agent could overstate. The six Phase-7 obligations:

1. **Telemetry is OFF by default.** "When enabled it sends anonymous feature-usage counts only — never document content, file paths, or any personal information. In Phase 7 nothing leaves your machine at all (the transport is a local buffer you can inspect)."
2. **Auto-update publish target is a placeholder.** "Auto-update checks GitHub releases; the publish target is a placeholder until the project is published — updates will not function until a real release channel is configured. The update *client* is wired and ready."
3. **macOS and Linux builds are UNVERIFIED.** "macOS and Linux builds are configured but UNVERIFIED — they are produced by the build config but have not been tested on real hardware. Native modules (database, canvas) may fail to load on these platforms until a maintainer verifies on a real host (Phase 7.1)."
4. **The proof locale is a sample, not a complete localization.** "Spanish (es-ES) is a translation sample to prove the localization framework works — some strings may remain in English. It is not a complete professional translation."
5. **Accessibility is audited to WCAG 2.1 AA for critical paths, with documented gaps.** "Keyboard navigation and screen-reader (Windows Narrator) support cover the critical paths. Freehand annotation drawing and some canvas interactions remain pointer-centric — documented as known gaps."
6. **Code-signing cert is the user's real-world step.** "Auto-update requires a code-signing certificate to apply updates in production. Acquiring the cert is a manual real-world step documented in the code-signing workflow; until then, downloaded updates cannot be applied."

**Required surface placement (four-location ratchet — the proven pattern):**

- Top-of-guide preamble — Wave 30 Nathan
- Dedicated user-guide trust-floor section — Wave 30 Nathan
- Inline at every Phase-7-touching subsection (Settings, About, locale picker) — Wave 30 Nathan
- README front-door Known Limitations — Wave 30 Nathan
- **UI surfaces (Wave 28 Riley) — the load-bearing point-of-action placements:**
  - Settings → General → telemetry toggle: privacy copy inline (obligation #1)
  - Settings → General → locale picker subtext: "proof locale, some strings English" (obligation #4)
  - About modal → update status area: "publish target placeholder" when `status === 'not-configured'` (obligations #2 + #6)

The UI surfaces (Wave 28) are where the user reads the honesty at the moment of action — not buried in docs. This mirrors the Phase 6 `PerFormatLimitationsPanel` load-bearing-UI lesson.

---

## 9. Schema delta (P7-L-7) — three settings keys, no new table

Full DDL + per-key rationale in [`data-models.md §12`](data-models.md). Summary: migration v7 (`migrations/0007_phase7_polish.sql`, Ravi Wave 28) adds NO new table and NO new column on any existing table. It seeds (via `INSERT OR IGNORE INTO settings`) the Phase-7 setting keys:

| Key | Type | Default | Obligation |
|---|---|---|---|
| `telemetry.optIn` | `boolean` | **`false`** | #1 — default OFF |
| `i18n.locale` | `'en-US' \| 'es-ES'` | `'en-US'` | #4 — baseline |
| `update.channel` | `'manual' \| 'check-on-launch'` | **`'manual'`** | #2 — no auto-check against placeholder |
| `update.lastCheckedAt` | `number \| null` | `null` | nullable + late-init |

(Four keys; the brief's "three new settings" counts the three behavioral toggles plus the nullable timestamp.) The `EditOperation` union is FROZEN — Phase 7 produces no edit. The in-memory document model is unchanged.

---

## 10. P7-L-FREEZE rule

After Wave 27 closes, `ARCHITECTURE.md` + `architecture-phase-2..7.md` are ALL frozen. Wave 28 implementers extend behavior, not architecture. Any architectural change in Wave 28+ requires a Marcus-approved amendment with a `### Phase 7.x amendment` banner. This is the same freeze discipline applied at the end of every prior design wave.

Since Phase 7 is the **final roadmap phase**, this freeze is also the **v1.0.0-rc design freeze** — see `phase-7-plan.md` "Final close". After Wave 30, the project is a v1.0.0 release candidate with the honest limitations enumerated in §8.

---

## 11. Wave 27 self-check cross-reference checklist

- [x] All 8 locked decisions encoded with cross-refs (§1)
- [x] Cross-platform build matrix + UNVERIFIED honesty (§2) — P7-L-1
- [x] Auto-update full flow + placeholder-as-honest-config (§3) — P7-L-2, Q-C
- [x] Telemetry architecture: opt-in, default OFF, allowlist, no-op ring buffer (§4) — P7-L-3, Q-B
- [x] a11y plan + deferred-tab-pattern fix + remediation priority (§5) — P7-L-4, Q-D → `a11y-audit.md`
- [x] Native-module cross-platform story (§6) — Q-E (the riskiest part, documented)
- [x] i18n architecture + extraction scope + count estimate (§7) — P7-L-5, Q-A → `i18n-strategy.md`
- [x] Trust-floor SIXTH instance, six obligations, four-location ratchet (§8) — P7-L-6
- [x] Schema delta: settings keys only, no new table (§9) — P7-L-7
- [x] Sentinel-default / stub-shipped-with-TODO / as-any / asset-path lessons cross-checked (§1)
- [x] L-001 untouched (§2.1); L-002 referenced for the Phase-7.1 verification path (§2.5)

End of Phase-7 architecture additions.
