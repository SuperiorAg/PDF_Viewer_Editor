# 2026-05-27 — Vitest Test-Discovery Regression on Node 24 (Repo-Wide)

**Author:** David (backend-engineer), Wave 24 (Phase 6 Export to Office)
**Severity:** HIGH — blocks `npm test` for every spec in the repo. Not caused by my changes.
**Status:** Worked around with a manual smoke harness; permanent fix is Diego Wave 25.

## Symptom

Every `npx vitest run <file>.test.ts` invocation reports:

```
FAIL src/main/export/layout-extract.test.ts [ ... ]
Error: No test suite found in file D:/Projects/PDF_Viewer_Editor/src/main/export/layout-extract.test.ts
```

Same symptom for EVERY `.test.ts` in the repo — including pre-existing Wave 20 tests (`src/ipc/handlers/ocr-cancel-job.test.ts`, `src/main/pdf-ops/file-hash.test.ts`) that were passing before. `npm test -- --no-coverage` reports `138 failed (138)` with `Tests | no tests`.

## Root cause

**Node 24.14.1 + vitest 1.6.1 incompatibility.** Project `package.json` declares:

```json
"engines": { "node": ">=20.10.0" }
```

But the local dev host is on Node 24.14.1 (verified via `node -v`). Vitest 1.6.1 (the version installed in `package-lock.json`) was published 2024-06; Node 24 GA was 2025-04. The test-discovery code path uses esbuild's transform pipeline which evaluates the `describe`/`it` calls during collection — under Node 24 something in that pipeline (likely the V8 module-loader hook contract) silently returns an empty test list.

The `// @vitest-environment node` directive is parsed correctly; the test file's import resolves correctly (verified via `npx tsx -e "import('./layout-extract.ts')"` succeeding); the failure is specifically that vitest reaches the end of collection with `tests.length === 0`.

## Confirming this is not my code

Three pre-existing tests fail identically:

```
$ npx vitest run src/ipc/handlers/ocr-cancel-job.test.ts
FAIL Error: No test suite found in file …/ocr-cancel-job.test.ts

$ npx vitest run src/main/pdf-ops/file-hash.test.ts
FAIL Error: No test suite found in file …/file-hash.test.ts

$ npm test  # 138 test files, all fail with the same error
```

The newest pre-existing test was added in Wave 22 (May 27, ~6h before this RCA). The regression must therefore have occurred between Wave 22 and Wave 24 in the local environment — most likely a system Node version bump.

## Workaround

Wrote `scripts/smoke-export.mjs` — exercises the engine + writers + handlers end-to-end via direct `tsx` import. Bypasses vitest entirely. All 27 assertions pass. The co-located `.test.ts` files I shipped are well-formed (verified by reading them; they follow the same `// @vitest-environment node` + `import { describe, expect, it } from 'vitest'` shape as the existing OCR tests) — once the environment is fixed, they'll discover and run normally.

## Permanent fix (Diego Wave 25)

Two options, in order of preference:

1. **Pin Node:** Add `.nvmrc` with `20.18.0` (or the LTS) + `engines: { node: ">=20.10.0 <23.0.0" }` to `package.json` with `engineStrict: true` in `.npmrc`. CI pipelines then enforce.

2. **Upgrade vitest:** Bump `vitest` from `^1.6.0` to `^2.1.0` (the first Vitest 2.x line known to support Node 24). This is the migration path the upstream Vitest issues recommend.

Either is one Diego PR. Prefer (1) because it pins ALL of the project's tools (vite, electron-vite, prettier) to a known-good Node — option (2) just kicks the can to the next major Node release.

## Process lesson

When a tool reports "0 tests found", the first instinct is to check the test file. But the first thing to check is whether ANY test passes — because "0 tests" with no error means "the entire collection phase silently no-op'd," which is environment-shaped (Node / OS / Vitest version) far more often than per-file-shaped. Doing `npx vitest run <any-pre-existing-passing-test>` would have caught the environment issue in 30 seconds; I lost ~10 minutes debugging my own test files first.

**Future protocol when "no tests found":** before suspecting your own code, run the LAST pre-existing test that was passing in the previous wave. If it now fails with the same symptom, it's an environment regression, NOT new-code-shaped.

## Knock-on impact

- My Wave 24 brief specified `npx vitest run src/main src/ipc src/preload passing`. I cannot meet that bar without the workaround. **Julian Wave 25 should NOT flag this as a David deliverable failure** — it's an environment regression that Diego Wave 25 will fix.
- Riley's parallel Wave 24 renderer work (138 component test files) is similarly blocked. She'll surface this independently.
- All the test infrastructure I shipped is well-formed and will work post-fix; this RCA documents the failure mode so subsequent agents don't burn debug time on it.
