# Wave 4 Brief — Nathan (sequential, last)

**Author:** Marcus (Chief Delivery Officer)
**Date:** 2026-05-21
**Status:** STUB — takes effect only after Wave 3.5 closes GREEN. Do NOT dispatch Nathan before then.
**Why a stub now:** Wave 3.5 fixes three HIGH walking-skeleton bugs (H-1 persistence, H-2 memoization, H-3 save). Nathan documents the working app, not the broken one. Drafting the Wave 4 brief while Wave 3.5 is in flight lets Nathan start the moment Wave 3.5's verification (CI green + smoke pass) lands, with no orchestrator-side latency.

---

## 0. Precondition gate

Before dispatching Nathan, Marcus confirms ALL of the following:

- [ ] David and Riley have both returned Wave 3.5 deliverables.
- [ ] Marcus has appended both `.learnings/learnings.jsonl` entries serially (no parallel-write corruption).
- [ ] CI on the latest commit is GREEN on both `windows-latest` and `ubuntu-latest` (`typecheck:*`, `lint`, `test`, `build`, `dist:win` — Playwright e2e at minimum opens the empty state).
- [ ] Smoke launch (user or Marcus operator-skill): open a PDF, Ctrl+S surfaces success toast, app restart shows file in Recents. Annotate the result in `docs/build-report.md` Wave 3.5 section.
- [ ] No new HIGH findings from a Julian spot-check (or Julian explicitly signs off on Wave 3.5 closure).

If any of those fail, Marcus drafts a Wave 3.6 and does NOT dispatch Nathan.

---

## 1. Nathan — Head of Technical Writing (slug: `documentation-expert`)

### Owns (writes):

- `README.md` (root — replacing whatever Wave-1/Wave-2 stub exists)
- `docs/api-reference.md` (NEW — derived from `docs/api-contracts.md` but framed as developer-facing reference, not architectural spec)
- `docs/developer-guide.md` (NEW — local dev setup, build, run, test, package, sign, debug, common pitfalls)
- `LICENSES.md` (root — aggregate transitive dep licenses; flagged in Julian's review as a Phase-1 OSS-policy follow-up)
- Optional: `docs/user-guide.md` if Marcus + user agree it's in scope for Phase-1 ship

### Does NOT touch:

- `ARCHITECTURE.md`, `docs/api-contracts.md`, `docs/data-models.md`, `docs/ui-spec.md`, `docs/conventions.md` (Riley's Wave 1; frozen except for the H-2 §6.3 amendment Riley already made in Wave 3.5)
- `docs/project-plan.md`, `docs/project-roadmap.md` (Marcus)
- `docs/code-review.md` (Julian)
- `docs/build-report.md` (Marcus)
- Anything under `src/`, `migrations/`, root configs

---

## 2. Tasks (sketch — Marcus expands to full task list after Wave 3.5 closes)

### 2.1 README.md (root)

Sections required:

- **What this is** — Phase-1 walking-skeleton PDF viewer + light editor for Windows desktop. One paragraph.
- **Install** — link to release artifacts (the NSIS installer and the portable .exe) once Diego provides them; for now, link to the `release/` directory contents and explain.
- **Quick start** — five-step "open a PDF and save it" walkthrough using screenshots from Marcus's operator-skill smoke run (or placeholder text until screenshots land).
- **Build from source** — pointer to `docs/developer-guide.md` for full instructions; minimal `git clone` + `npm install` + `npm run dev` here.
- **Roadmap** — link to `docs/project-roadmap.md`. Note Phase 1 / Phase 2+ split.
- **Contributing** — link to swarm rules in `d:/Projects/CLAUDE.md` if appropriate; pointer to `docs/conventions.md` for code style.
- **License** — MIT (or whatever the user has decided; check `package.json` `license` field).

Keep under 150 lines. The README is the front door; not the dump-everything page.

### 2.2 docs/api-reference.md

Reference for developers extending the IPC surface. Source: `docs/api-contracts.md` is the spec, this doc is the **friendlier reference** — channel-by-channel, with example renderer + main usage, and error-variant decision tree.

Cover all 23 channels (David's Wave-2 count) + the 4 `window:*` channels documented in `api-contracts.md` §10. For each:

- Channel name + ICN
- Request shape (link to TS type)
- Response shape
- Error variants and what each means
- One-line renderer example
- One-line main-side handler example
- Phase 1 vs Phase 2 status (the 6 stub channels are clearly labelled)

This doc has overlap with `api-contracts.md` by design — `api-contracts.md` is the architect's spec frozen at Wave 1; `api-reference.md` is the developer-facing index Nathan keeps fresh as the codebase evolves.

### 2.3 docs/developer-guide.md

The hands-on operating manual. Sections:

- **Prerequisites** — Node 20 LTS (NOT 24 — the `better-sqlite3` ABI workaround Diego documented in `build-report.md`), Windows for full builds, Linux/macOS okay for partial. Reference Diego's Issue D-1 verbatim.
- **First-time setup** — `npm install` flags (`--ignore-scripts` on Node 24 hosts), `postinstall` behaviour, what `electron-builder install-app-deps` does.
- **Development loop** — `npm run dev`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run dist:win`.
- **Testing** — Vitest patterns Wave-2 agents established (deps-injected handlers, jsdom for renderer, `expectErr()` helper if Phase-1.1 lands it). Playwright Electron smoke.
- **Common pitfalls** — NODE_MODULE_VERSION mismatch (D-1), Python 3.14 distutils gone, electron-builder schema rejects unknown `build.//` keys, jsx-a11y `aria-proptypes` workaround (Wave-2 Open-item #1).
- **Debugging** — Electron DevTools, main-process debugger flags, log inspection (Phase-2 `log:emit` channel placeholder).
- **Adding a new IPC channel** — step-by-step: edit `src/ipc/contracts.ts`, add handler under `src/ipc/handlers/`, wire in `src/ipc/register.ts`, expose in `src/preload/index.ts`, consume from `src/client/services/api.ts`, add Vitest. Cross-reference `docs/conventions.md` §5 (IPC handler conventions).
- **Adding a new Redux slice** — step-by-step per `docs/conventions.md` §6 (now post-H-2 amendment). Parameterized memoized selectors emphasised.
- **Packaging + signing** — electron-builder + NSIS + code-signing cert env-var pattern Diego scoped.

Length budget: 300–500 lines. Aim for "I can onboard a new engineer in one afternoon using only this doc + the README + `docs/conventions.md`."

### 2.4 LICENSES.md

Aggregated transitive-dep license list. Tooling: `license-checker --production --csv` or equivalent; pipe into a sorted dedup'd markdown table. One row per top-level package, license short-id, link to upstream license file.

Cross-check against ARCHITECTURE §3 license whitelist (MIT / Apache-2.0 / BSD only) — flag any AGPL/GPL/commercial finding to Marcus immediately, do NOT silently include.

### 2.5 Optional — docs/user-guide.md

Only if Marcus + user agree this is in Phase-1 scope. Keyboard shortcuts table (sourced from `src/client/shortcuts.ts`), annotation workflow, save/export workflow, recents and bookmarks, file-association toggle in Settings. Screenshots from operator-skill smoke.

If deferred: log as Phase-1.1 doc backlog.

---

## 3. Inputs Nathan must read

- `README.md` (current state — replace, don't extend)
- `ARCHITECTURE.md`, `docs/api-contracts.md` (esp. §9 window namespace + §9.5 `'not_implemented'` convention), `docs/data-models.md`, `docs/ui-spec.md`, `docs/conventions.md` (post Wave-3.5 amendment)
- `docs/project-plan.md`, `docs/project-roadmap.md`, `docs/code-review.md`, `docs/build-report.md` (the Wave 3 + Wave 3.5 status rows)
- `.learnings/learnings.jsonl` (filter on `documentation-expert` for prior lessons; read Diego's Wave 3 entry for the common-pitfall material)
- `.learnings/locked-instructions.md` — L-001
- `package.json` — for the script catalog and license field
- Diego's CI workflow (`.github/workflows/ci.yml`) — to validate the developer-guide commands match what CI actually runs

---

## 4. Logging discipline

Nathan is sequential — no parallel-write contention. Nathan may write directly to `.learnings/learnings.jsonl` per the standard self-improvement protocol. Honesty clause applies.

---

## 5. Acceptance for Wave 4 closure

- All four (or five if optional user-guide is in scope) docs exist and render cleanly in GitHub markdown preview.
- `LICENSES.md` lists every transitive dep with a permitted license; no AGPL/GPL/commercial dep present.
- README.md walks a new user from clone to running app in under 5 minutes (Marcus verifies via operator-skill).
- developer-guide.md walks a new engineer from clone to a successful `npm run dist:win` in under 30 minutes (CI is the auto-verifier on the next push — if CI green, this is satisfied).
- Nathan's `.learnings/learnings.jsonl` entry appended.

After Wave 4 closes, Marcus writes the final "Phase 1 walking-skeleton ships" entry in `docs/build-report.md` and surfaces the remaining Phase-1.1 / Phase-2 backlog to the user for prioritization.

---

**End of Wave 4 stub.** Expand to full brief when Wave 3.5 closes GREEN.
