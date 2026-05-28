# Phase 7 — Polish & Cross-Platform

**Author:** Main session
**Date:** 2026-05-22
**Status:** Plan-on-disk. Final phase.

## Goals (locked: configure cross-platform; verify Windows-only)

1. macOS packaging config (DMG + universal binary intent) — config-only, unverified on hosts
2. Linux packaging config (AppImage, deb) — config-only, unverified on hosts
3. Auto-update via electron-updater (GitHub releases publisher placeholder)
4. Telemetry framework (opt-in, anonymous; client-side hook + opt-in UI)
5. Accessibility audit (keyboard nav for all critical paths; screen reader testing on Windows Narrator; ARIA labels)
6. Localization framework (i18next or similar; en-US strings extracted; 1-2 sample locales as proof)
7. Screenshots for user-guide.md (deferred from Phase 1.1 — operator-skill smoke run capturing real UI states)
8. Code-signing cert acquisition documentation (cert procurement is real-world; document the workflow)

## Locked design constraints

- **Configure but don't verify cross-platform.** electron-builder.yml gains macOS + Linux targets; CI matrix exercises Windows only.
- **Auto-update:** electron-updater with GitHub releases placeholder. User self-hosts release publishing; we wire the client.
- **Telemetry:** OPT-IN, default OFF. Anonymous (no user IDs, no doc contents). Client-side hook + Settings UI; no backend in Phase 7.
- **Localization:** i18next or react-intl (MIT). en-US source-of-truth; 1-2 sample locales (Spanish, French?) as proof — user decides which locales at Phase 7 start.
- **Accessibility:** Riley Wave 7's `jsx-a11y/aria-proptypes` warn-only workaround gets resolved here — proper tab semantics, ARIA roles audit, keyboard nav for every flow.

## Wave structure

| Wave | Owner | Mode |
|---|---|---|
| 27 | Riley | solo (architecture + a11y audit plan + i18n string extraction) |
| 28 | Diego + Riley | parallel (Diego: packaging configs + auto-update + telemetry hook; Riley: a11y fixes + i18n wiring) |
| 29 | Diego + Julian | parallel (Diego: cross-platform dist:dry-run + cert-acquisition docs; Julian: final security review across Phases 5-7) |
| 30 | Nathan | solo (final docs sweep + screenshots if operator-skill smoke runs cleanly) |

## File ownership

| Owner | Files |
|---|---|
| Riley (27 + 28) | `docs/architecture-phase-7.md` (NEW — short doc; mostly amendments), `docs/i18n-strategy.md` (NEW), `docs/accessibility-audit.md` (NEW), `src/client/i18n/` (NEW directory; en-US.json + locale loader), all renderer components touched for ARIA + i18n string extraction |
| Diego (28 + 29) | `electron-builder.yml` (mac + linux targets), `.github/workflows/ci.yml` (matrix expansion or doc-only deferral), `electron-builder-updater` integration in main process via main IPC handler `app:checkForUpdates`, telemetry-hook in main + renderer (no backend), `package.json` deps (electron-updater MIT, i18next MIT), `docs/code-signing-workflow.md` (NEW — how to acquire + apply a cert; non-engineer documentation) |
| Julian (29) | `docs/code-review.md` final section — security review of Phases 5/6/7 deltas, especially auto-update (signature verification of update bundles) and telemetry (no PII leakage) |
| Nathan (30) | docs updates, screenshots if operator-skill smoke runs cleanly, `docs/phase-7-release-notes.md` |

## Risk register

1. **MEDIUM — Auto-update signature verification.** electron-updater verifies release-bundle signatures; if our code-signing cert isn't acquired yet (Phase 7 polish), auto-update will not work in production. Document the dependency.
2. **MEDIUM — Localization regression risk.** Extracting hardcoded strings into i18n keys risks UI breakage if any string is missed. Mitigation: incremental rollout per component; en-US gets all keys; sample locale only as proof.
3. **LOW — Cross-platform configs untested.** That's the locked decision; ship configs as ready-to-use, await hosts for verification. Document explicitly.
4. **LOW — Telemetry scope.** Risk of opt-in becoming surveillance. Mitigation: anonymous events only; no doc contents, no file paths, no user IDs. Open-source the event list; user can audit.

## Acceptance criteria

- [ ] electron-builder.yml has mac + linux + win targets; Windows MSI + portable still produce
- [ ] electron-updater wired; Settings → "Check for updates" button works against the (placeholder) GitHub releases endpoint
- [ ] Telemetry framework opt-in via Settings; default OFF; no events fire without opt-in
- [ ] i18n: every user-facing string extracted to a key; 1 sample locale loads
- [ ] Accessibility: keyboard nav for all critical paths; ARIA labels verified; jsx-a11y/aria-proptypes restored to `error` from `warn` and renderer typecheck remains 0
- [ ] Phase 7 release notes (final phase) documents the project as v1.0.0 release-candidate state OR honestly notes remaining items
- [ ] Cross-platform binaries NOT produced by CI (config-only; documented)
- [ ] Code-signing workflow documented for the cert acquisition the user does manually
- [ ] L-001 holds (last verification)
- [ ] No regression on Phases 1-6

## Final close

After Wave 30 closes, the project is **v1.0.0 release candidate**. Bump `package.json` version 0.2.x → 1.0.0-rc.1. Final disk verification + final report. The full vision the user described in turn 1 is shipped (modulo the explicit Phase 4+ honest limitations and cross-platform-verification deferrals).
