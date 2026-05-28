# Third-party licenses

PDF_Viewer_Editor depends on open-source software. Every direct and transitive dependency is under a permissive license (MIT, Apache-2.0, BSD, ISC, or equivalent). No AGPL, GPL, LGPL, EPL, or commercial code is bundled. This document lists each license, the packages that ship under it, and any items flagged for follow-up.

**Project license:** **MIT**. The authoritative text lives in [`LICENSE`](LICENSE) at the repo root; `package.json` declares the same (`"license": "MIT"`). The MIT file was added in Phase 1.1; before that, the formal license file was tracked as a Phase-1.1 follow-up.

**Scan basis:** dependencies in `package.json` (direct) plus every package under `node_modules/` (transitive) as installed against the locked `package-lock.json`. Counts in this document reflect the current install on a Windows host. Last walked: 2026-05-28 (Backlog-fix toolchain wave by Diego — added two **devDependencies** `husky@^9.1.7` (MIT, the git-hook manager wiring `.husky/pre-commit` + `.husky/pre-push`) and `lint-staged@^17.0.5` (MIT, runs eslint/prettier on staged files). A recursive `package.json` walk of the reachable subtree from these two roots = **25 packages, ALL permissive**: MIT (husky, lint-staged, listr2, log-update, ansi-escapes, ansi-regex, ansi-styles, cli-cursor, color-convert, color-name, emoji-regex, environment, eventemitter3, is-fullwidth-code-point, mimic-fn, onetime, picomatch, restore-cursor, rfdc, string-argv, string-width, strip-ansi, tinyexec, wrap-ansi) + ISC (`signal-exit@3.0.7`, already in the ISC count). `husky` itself has ZERO runtime dependencies; all 24 others arrive via `lint-staged`. **ZERO AGPL/GPL/LGPL/EPL/undeclared ingress.** Both are pure-JS build/test tooling — they do NOT ship in the production binary (no asar entry). No native module, no new runtime dep. Prior: 2026-05-28 (Phase 7 Wave 29 by Diego — added the four Phase-7 direct deps `electron-updater@^6.8.3` (MIT, auto-update client; library-injected runtime-require, reads the `publish` block in `electron-builder.yml`), `i18next@^26.3.0` (MIT, the i18n engine), `react-i18next@^17.0.8` (MIT, React bindings; peer-requires `i18next >= 26.2`), and `i18next-resources-to-backend@^1.2.1` (MIT, lazy locale `import()`). A license-walk of the full reachable subtree from these four roots (`scripts/walk-newcomers` ad-hoc, 23 reachable packages) found every package permissive: MIT (electron-updater + i18next family + builder-util-runtime + lazy-val + fs-extra + jsonfile + tiny-typed-emitter + debug + ms + html-parse-stringify + void-elements + use-sync-external-store + @babel/runtime + lodash.escaperegexp + lodash.isequal), ISC (graceful-fs, semver), BlueOak-1.0.0 (sax), Python-2.0 (argparse). **ZERO AGPL/GPL/LGPL/EPL/undeclared ingress.** No native module added — all four are pure-JS (electron-updater + i18next stack), so no new `asar`-unpack entry. The locale JSON bundles are renderer assets (Riley's `src/client/i18n/locales/**`) inlined into the Vite renderer bundle (`dist/renderer/assets/index-*.js`), shipped inside `app.asar` — verified via `npx asar list`. Total package count rose from 817 (Phase 6) to ~915 (Phase 7 Wave 29 install; the delta includes the electron-updater/i18next families plus re-materialized optional per-platform subpackages). Install used `--legacy-peer-deps` (carried over from Phase 4.1.1, see note below). Prior: 2026-05-27 (Phase 6 Wave 25 re-verification by Diego — added `docx@^9.7.1` (MIT, primary `.docx` writer for the Export-to-Word path), `pptxgenjs@^4.0.1` (MIT, primary `.pptx` writer for the Export-to-PowerPoint path) as direct runtime deps + `nanoid@5.1.11` (MIT, nested transitive of `docx`) — total Phase-6 transitive delta is **one** new in-tree package because `docx` and `pptxgenjs` are otherwise self-contained pure-JS bundles. Also bumped `vitest@^1.6.0 → ^2.1.9` and `@vitest/ui@^1.6.0 → ^2.1.9` (both MIT) to resolve the Node 24 test-discovery regression documented in `.learnings/failures/2026-05-27-vitest-node24-discovery-regression.md`; the bump removed ~33 transitives net (vitest 2.x has a tighter dep graph than 1.6) so the total package count dropped from 826 (Phase 5) to **817 packages** (Phase 6 Wave 25). Verified every newcomer is permissive (MIT only); zero AGPL/LGPL/GPL/EPL ingress. Prior walks: 2026-05-27 (Phase 5 Wave 21 — added `tesseract.js@^7.0.0`, `@tesseract.js-data/eng@^1.0.0`, `@napi-rs/canvas@^1.0.0` + 12 transitives + 11 optional platform subpackages); 2026-05-26 (Phase 4 Wave 17 — added `node-signpdf@^3`, `node-forge@^1.3`, `pkijs@^3`, `asn1js@^3` + 4 transitives; `node-forge` is dual-licensed `(BSD-3-Clause OR GPL-2.0)` — BSD-3-Clause arm exercised per the `jszip` precedent); 2026-05-22 (Phase 3 Wave 13 — `exceljs@^4.4.0` + ~100 transitives); 2026-05 Phase 2 (`utif@^3.1.0`). The npm install required `--legacy-peer-deps` (carried over from Phase 4.1.1 — `vite-plugin-static-copy@^4` declares a peer of `vite@^6 || ^7 || ^8` but the project pins `vite@^5` via `electron-vite@2.3.0`; runtime-compatible despite the peer mismatch). The data was gathered by `scripts/wave25-license-walk.mjs` — a hand-rolled Node script that recursively reads every `package.json` in `node_modules/` and rolls up the `license` field. `license-checker@25.0.1` itself remains broken on Node 24 (`slide` module resolution failure), unchanged from the Phase 5 baseline.

**Permissive only.** The project policy ([`CLAUDE.md`](CLAUDE.md)) forbids AGPL, GPL, and commercial licenses. The scan below confirms none are present.

---

## Summary

| License | Count | Permissive? |
|---|---|---|
| MIT | 649 | yes |
| ISC | 79 | yes |
| Apache-2.0 | 32 | yes |
| BSD-2-Clause | 17 | yes |
| BSD-3-Clause | 13 | yes |
| BlueOak-1.0.0 | 6 | yes |
| MIT/X11 | 2 | yes (MIT/X11 is equivalent in effect to MIT) |
| 0BSD | 2 | yes |
| MIT OR CC0-1.0 | 2 | yes (dual; MIT selected) |
| MIT-0 | 1 | yes |
| MPL-2.0 | 1 | yes (copyleft is file-scoped, not viral — compatible) |
| Unlicense | 1 | yes (public domain dedication) |
| CC-BY-4.0 | 1 | yes (attribution required; data file, no code linkage) |
| Python-2.0 | 1 | yes |
| WTFPL | 1 | yes (extremely permissive) |
| WTFPL OR ISC | 1 | yes (dual; ISC selected) |
| MIT OR WTFPL | 1 | yes (dual; MIT selected) |
| MIT OR GPL-3.0-or-later | 1 | yes (dual; **MIT selected** — `jszip`, see notes below) |
| BSD-3-Clause OR GPL-2.0 | 1 | yes (dual; **BSD-3-Clause selected** — `node-forge`, see Phase 4 notes below) |
| CC0-1.0 | 1 | yes (public domain dedication) |
| BSD-2-Clause OR MIT OR Apache-2.0 | 1 | yes (tri-licensed; MIT selected) |
| MIT AND Zlib | 1 | yes (both permissive) |
| BlueOak-1.0.0 (Phase 7 add: `sax`) | (incl. in BlueOak row above) | yes |
| Python-2.0 (Phase 7 confirm: `argparse`) | (incl. in Python-2.0 row above) | yes |
| UNKNOWN | 1 | flagged — see "Items flagged for follow-up" below (`buffers@0.1.1`) |
| **Total packages scanned** | **~915** (Phase 7 Wave 29; was 817 in Phase 6) | — |

**No AGPL, GPL, LGPL, EPL, or commercial licenses are present** in the dependency graph. One transitive package (`buffers@0.1.1`, pulled in by `exceljs → unzipper → binary → buffers`) ships **without a declared license field** — flagged as a follow-up item below (same pattern as the historical Phase 1.1 `spawn-command@0.0.2` flag, since resolved by bumping `concurrently`). Two transitives are dual-licensed with a copyleft arm — `jszip@3.10.1` is `(MIT OR GPL-3.0-or-later)` (Phase 3) and `node-forge@1.4.0` is `(BSD-3-Clause OR GPL-2.0)` (Phase 4 direct dep); we exercise the permissive arm in each case per the SPDX dual-license expression. Neither GPL arm is selected; no GPL obligation flows into PDF_Viewer_Editor's distribution. Phase 5 (Wave 21) added zero dual-license transitives — every Phase-5 newcomer is single-licensed (MIT, Apache-2.0, or BSD-2-Clause).

---

## Direct dependencies (runtime)

These ship in the production binary.

| Package | Version | License | Source |
|---|---|---|---|
| @dnd-kit/core | ^6.1.0 | MIT | https://github.com/clauderic/dnd-kit |
| @dnd-kit/sortable | ^8.0.0 | MIT | https://github.com/clauderic/dnd-kit |
| @napi-rs/canvas | ^1.0.0 | MIT | https://github.com/Brooooooklyn/canvas |
| @reduxjs/toolkit | ^2.2.7 | MIT | https://github.com/reduxjs/redux-toolkit |
| @tesseract.js-data/eng | ^1.0.0 | MIT (package); Apache-2.0 (bundled data) | https://github.com/naptha/tessdata |
| asn1js | ^3.0.10 | BSD-3-Clause | https://github.com/PeculiarVentures/ASN1.js |
| better-sqlite3 | ^11.1.2 | MIT | https://github.com/WiseLibs/better-sqlite3 |
| docx | ^9.7.1 | MIT | https://github.com/dolanmiu/docx |
| electron-updater | ^6.8.3 | MIT | https://github.com/electron-userland/electron-builder (packages/electron-updater) |
| exceljs | ^4.4.0 | MIT | https://github.com/exceljs/exceljs |
| i18next | ^26.3.0 | MIT | https://github.com/i18next/i18next |
| i18next-resources-to-backend | ^1.2.1 | MIT | https://github.com/i18next/i18next-resources-to-backend |
| node-forge | ^1.4.0 | (BSD-3-Clause OR GPL-2.0) — BSD-3-Clause selected | https://github.com/digitalbazaar/forge |
| node-signpdf | ^3.0.0 | MIT | https://github.com/vbuch/node-signpdf |
| pdf-lib | ^1.17.1 | MIT | https://github.com/Hopding/pdf-lib |
| pdfjs-dist | ^4.4.168 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| pkijs | ^3.4.0 | BSD-3-Clause | https://github.com/PeculiarVentures/PKI.js |
| pptxgenjs | ^4.0.1 | MIT | https://github.com/gitbrent/PptxGenJS |
| react | ^18.3.1 | MIT | https://github.com/facebook/react |
| react-dom | ^18.3.1 | MIT | https://github.com/facebook/react |
| react-i18next | ^17.0.8 | MIT | https://github.com/i18next/react-i18next |
| react-redux | ^9.1.2 | MIT | https://github.com/reduxjs/react-redux |
| tesseract.js | ^7.0.0 | Apache-2.0 | https://github.com/naptha/tesseract.js |
| utif | ^3.1.0 | MIT | https://github.com/photopea/UTIF.js |
| zod | ^3.23.8 | MIT | https://github.com/colinhacks/zod |

## Direct dependencies (build / test only)

These do not ship in the production binary but are required to build, test, and package the app.

| Package | Version | License | Source |
|---|---|---|---|
| @playwright/test | ^1.45.3 | Apache-2.0 | https://github.com/microsoft/playwright |
| @testing-library/jest-dom | ^6.4.8 | MIT | https://github.com/testing-library/jest-dom |
| @testing-library/react | ^15.0.7 | MIT | https://github.com/testing-library/react-testing-library |
| @types/better-sqlite3 | ^7.6.11 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/node | ^20.14.13 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react | ^18.3.3 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react-dom | ^18.3.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @typescript-eslint/eslint-plugin | ^7.18.0 | MIT | https://github.com/typescript-eslint/typescript-eslint |
| @typescript-eslint/parser | ^7.18.0 | BSD-2-Clause | https://github.com/typescript-eslint/typescript-eslint |
| @vitejs/plugin-react | ^4.3.1 | MIT | https://github.com/vitejs/vite-plugin-react |
| @vitest/ui | ^2.1.9 | MIT | https://github.com/vitest-dev/vitest |
| concurrently | ^9.2.1 | MIT | https://github.com/open-cli-tools/concurrently |
| electron | ^30.3.1 | MIT | https://github.com/electron/electron |
| electron-builder | ^24.13.3 | MIT | https://github.com/electron-userland/electron-builder |
| electron-rebuild | ^3.2.9 | MIT | https://github.com/electron/electron-rebuild |
| electron-vite | ^2.3.0 | MIT | https://github.com/alex8088/electron-vite |
| eslint | ^8.57.0 | MIT | https://github.com/eslint/eslint |
| eslint-config-prettier | ^9.1.0 | MIT | https://github.com/prettier/eslint-config-prettier |
| eslint-plugin-import | ^2.29.1 | MIT | https://github.com/import-js/eslint-plugin-import |
| eslint-plugin-jsx-a11y | ^6.9.0 | MIT | https://github.com/jsx-eslint/eslint-plugin-jsx-a11y |
| eslint-plugin-react | ^7.35.0 | MIT | https://github.com/jsx-eslint/eslint-plugin-react |
| eslint-plugin-react-hooks | ^4.6.2 | MIT | https://github.com/facebook/react |
| husky | ^9.1.7 | MIT | https://github.com/typicode/husky |
| jsdom | ^24.1.1 | MIT | https://github.com/jsdom/jsdom |
| lint-staged | ^17.0.5 | MIT | https://github.com/lint-staged/lint-staged |
| playwright | ^1.45.3 | Apache-2.0 | https://github.com/microsoft/playwright |
| prettier | ^3.3.3 | MIT | https://github.com/prettier/prettier |
| typescript | ^5.5.4 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| vite | ^5.3.5 | MIT | https://github.com/vitejs/vite |
| vitest | ^2.1.9 | MIT | https://github.com/vitest-dev/vitest |

---

## Notable transitive dependencies (non-MIT)

Permissive but not under MIT — listed here for visibility. Each is acceptable under the project's "MIT / Apache-2.0 / BSD only" policy in [`ARCHITECTURE.md`](ARCHITECTURE.md) §3.

### Apache-2.0 (32 packages)

Notable: `pdfjs-dist` (the PDF rendering engine), `@playwright/test`, `playwright`, `typescript`, plus `crc-32` and `readdir-glob` (Phase 3 transitives via `exceljs`); Phase 5 additions: `tesseract.js@7.0.0` (direct), `tesseract.js-core@7.0.0` (transitive — the Tesseract C++ engine compiled to WASM), `idb-keyval@6.2.4` (transitive — Tesseract.js caches WASM blobs in IndexedDB on web; unused on Electron main but pulled by the wildcard import), and `wasm-feature-detect@1.8.0` (transitive — chooses between standard / relaxed-simd / threaded WASM builds at runtime). Apache-2.0 is permissive with explicit patent grant.

### BSD-2-Clause (17 packages)

Notable: `@typescript-eslint/parser`, `@electron/osx-sign`, `extract-zip`, `dotenv`. Phase 5 addition: `webidl-conversions@7.0.0` (transitive via `tesseract.js → whatwg-url → tr46 → webidl-conversions`). Permissive with attribution requirement.

### BSD-3-Clause (13 packages)

Notable: `source-map`, `source-map-js`, `sprintf-js`, `tough-cookie`, plus Phase 4 additions `asn1js@3.0.10`, `pkijs@3.4.0` (direct deps for the PAdES manual engine), and `bytestreamjs@2.0.1` (transitive of `pkijs`). Permissive with non-endorsement clause. The Phase 4 cluster comes from the PeculiarVentures PKI tooling family, which is BSD-3-Clause throughout.

### ISC (76 packages)

Functionally equivalent to MIT. Common in the Node ecosystem (e.g. `glob`, `rimraf`, `inherits`, `saxes`, `fstream`).

### MPL-2.0 (1 package — `axe-core`)

`axe-core@4.11.4` (a transitive dep of `eslint-plugin-jsx-a11y`) is under the Mozilla Public License 2.0. MPL is **file-scoped copyleft, not viral**: changes to MPL-licensed files must be released under MPL, but combining MPL files with proprietary code does not impose any license on the proprietary code. Acceptable. We do not modify `axe-core`; we consume it as a published npm package.

### CC-BY-4.0 (1 package — `caniuse-lite`)

`caniuse-lite@1.0.30001793` is a database (not code) under Creative Commons Attribution 4.0. The license requires attribution. This is a tooling-only data file consumed by `browserslist`; it does not ship in our production binary. Attribution requirement is satisfied by this LICENSES.md entry.

### BlueOak-1.0.0 (6 packages)

BlueOak Model License 1.0.0 — modern permissive license, equivalent in effect to MIT/ISC. Packages: `jackspeak`, `minipass-flush`, `package-json-from-dist`, `path-scurry`, `sax`, plus one additional Phase 3 transitive.

### Permissive dual-licensed (8 packages)

Each lets us choose the permissive arm:

- `rc@1.2.8` — BSD-2-Clause OR MIT OR Apache-2.0 → we select MIT
- `type-fest@0.20.2` — MIT OR CC0-1.0 → we select MIT
- `expand-template@2.0.3` — MIT OR WTFPL → we select MIT
- `utf8-byte-length@1.0.5` — WTFPL OR MIT → we select MIT
- `sanitize-filename@1.6.4` — WTFPL OR ISC → we select ISC
- `jszip@3.10.1` — **MIT OR GPL-3.0-or-later → we select MIT** (Phase 3 transitive via `exceljs`). The SPDX expression with the boolean `OR` operator gives the consumer the explicit right to pick either arm; we exercise the MIT arm and never modify or redistribute `jszip` source files. The GPL arm is never selected; no GPL obligation flows into PDF_Viewer_Editor's distribution.
- `node-forge@1.4.0` — **(BSD-3-Clause OR GPL-2.0) → we select BSD-3-Clause** (Phase 4 direct runtime dep — PFX parser in the cert-store + ASN.1/PKCS#7 primitives for the manual PAdES fallback engine). Same SPDX dual-license discipline as `jszip` (Phase 3): the boolean `OR` operator gives the consumer the explicit right to pick either arm. We exercise the BSD-3-Clause arm and never modify or redistribute `node-forge` source files. The GPL-2.0 arm is never selected; no GPL obligation flows into PDF_Viewer_Editor's distribution. The upstream maintainer (Digital Bazaar) ships under this dual license precisely to permit downstream proprietary integration via the BSD arm.

### Other single permissive (7 packages)

- `tslib@2.8.1` — 0BSD (most permissive license available)
- `language-subtag-registry@0.3.23` — CC0-1.0 (public domain dedication)
- `truncate-utf8-bytes@1.0.2` — WTFPL (extremely permissive)
- `argparse@2.0.1` — Python-2.0 (permissive)
- `@csstools/color-helpers@5.1.0` — MIT-0 (MIT without attribution requirement)
- `pako@1.0.11` — MIT AND Zlib (both permissive)
- `big-integer@1.6.52` — **Unlicense** (Phase 3 transitive via `exceljs → unzipper`; the Unlicense is a public-domain dedication, functionally the most permissive possible)
- `traverse@0.3.9` and `chainsaw@0.1.0` — **MIT/X11** (Phase 3 transitives via `exceljs → unzipper → binary`; MIT/X11 is the historical name for the MIT License, semantically identical)

---

## Items flagged for follow-up

### `buffers@0.1.1` — license not declared (Phase 3 transitive)

**Surface:** `exceljs@4.4.0 → unzipper@0.10.14 → binary@0.3.0 → buffers@0.1.1`. Pulled in by the Phase 3 mail-merge XLSX parsing path.

**Issue:** `buffers@0.1.1` ships with no `license` field in `package.json` and no `LICENSE` file in the package root. Same class as the historical Phase 1.1 `spawn-command@0.0.2` flag (also resolved by upgrading the parent package).

**Why low risk:** the package author is James Halliday (`substack`), who publishes the rest of his ecosystem (e.g. `minimist`, `mkdirp`, `optimist`) under MIT. The repository's `README.markdown` does not specify a license either, but the project is an early-2010s small npm utility (~13 LOC of public-domain-style logic for treating a list of `Buffer`s as one). The omission appears to be an oversight from npm's pre-2013 era when the `license` field was optional. The package is 14 years old and has not been re-published.

**Action plan:** track for `exceljs` upgrade to a version that ships a different unzip path. As of `exceljs@4.4.0` the `unzipper@0.10` dep is still pinned. When `exceljs` bumps to a release that swaps to `yauzl` (or any zip lib that doesn't transitively depend on substack's `binary`/`buffers`), `buffers` will fall out of the graph. Diego re-walks the license tree on every Phase boundary; reach for `npm ls buffers` to confirm presence/absence.

**Risk:** **low.** The omitted-license file is an attribution gap, not a copyleft contamination — the upstream author has consistently published as MIT and the package contains no GPL-derived code. We bundle `buffers` inside `app.asar` for the Phase 3 XLSX path; if the author ever asserted a non-permissive licence retroactively, we'd swap to a different ZIP parser (or drop XLSX support and require CSV-only input). The CSV path is built-in (no exceljs needed) and would remain functional.

### Historical (resolved)

The previously-flagged `spawn-command@0.0.2` "license not declared" item was resolved in Phase 1.1 by bumping `concurrently` from `^8.2.2` to `^9.2.1`. `concurrently@9.x` reworked its child-process handling to no longer depend on `spawn-command` (it now relies on `tree-kill` + Node's built-in `child_process` only). After the bump, `npm ls spawn-command` reports the package is no longer present.

Phase 2 added one direct runtime dependency: `utif@^3.1.0` (MIT, [photopea/UTIF.js](https://github.com/photopea/UTIF.js)) for TIFF first-page decoding. The package is permissive, declared in `package.json`, and present in the Direct runtime dependencies table above.

### Phase 3 (Wave 13)

Phase 3 Wave 13 added one direct runtime dependency: `exceljs@^4.4.0` (MIT, [exceljs/exceljs](https://github.com/exceljs/exceljs)) for the mail-merge wizard's XLSX data-source path (`docs/architecture-phase-3.md §6.1`, `src/main/pdf-ops/csv-excel-parser.ts`). The package is permissive, declared in `package.json`, and present in the Direct runtime dependencies table above. It pulls ~100 transitive packages; all are permissive except the `buffers@0.1.1` undeclared-license flag noted above. One transitive (`jszip@3.10.1`) is dual-licensed `(MIT OR GPL-3.0-or-later)` — we exercise the MIT arm explicitly; the dual-license block above documents the choice.

### Phase 4 (Wave 17, this wave)

Phase 4 Wave 17 added four direct runtime dependencies for the cryptographic-signature engine (PAdES B-B + RFC 3161 timestamping + AcroForm signature widget appearance authoring):

- `node-signpdf@^3.0.0` (MIT, [vbuch/node-signpdf](https://github.com/vbuch/node-signpdf)) — **primary** PAdES signing engine. Wraps the byte-range placeholder + replace algorithm with a stable, externally-audited implementation. Per `docs/signature-engine.md §3.2`, this is the engine wired by default; the manual fallback below exists to keep us shippable if node-signpdf regresses or shifts license.
- `node-forge@^1.4.0` (`(BSD-3-Clause OR GPL-2.0)` — **BSD-3-Clause arm selected**, [digitalbazaar/forge](https://github.com/digitalbazaar/forge)) — PFX (PKCS #12) parsing for the cert-store (`src/main/pdf-ops/cert-store.ts`) + ASN.1 + PKCS #7 primitives for the manual PAdES fallback engine (`src/main/pdf-ops/pades-signature-manual.ts`). The dual-license SPDX expression is handled identically to Phase 3's `jszip` precedent: we exercise the BSD-3-Clause arm explicitly and never modify or redistribute upstream source files. See the Permissive dual-licensed block above for the formal selection statement.
- `pkijs@^3.4.0` (BSD-3-Clause, [PeculiarVentures/PKI.js](https://github.com/PeculiarVentures/PKI.js)) — X.509 + CMS (`SignedData`) construction for the manual PAdES engine. Pulls `pvtsutils@1.3.6` (MIT), `pvutils@1.1.5` (MIT), `@noble/hashes@1.4.0` (MIT), and `bytestreamjs@2.0.1` (BSD-3-Clause) as transitives.
- `asn1js@^3.0.10` (BSD-3-Clause, [PeculiarVentures/ASN1.js](https://github.com/PeculiarVentures/ASN1.js)) — pinned ASN.1 BER/DER codec, peer dep of `pkijs` and used directly by the manual engine's byte-precise CMS construction. Pulls `pvtsutils` + `pvutils` + `tslib` (all permissive, all already in the graph).

**Transitive delta:** +8 packages total (4 direct + 4 unique transitives — `pvtsutils`, `pvutils`, `@noble/hashes`, `bytestreamjs`; `tslib` was already in the graph via `@dnd-kit` and others). Every newcomer is MIT or BSD-3-Clause; **no AGPL/GPL/LGPL/EPL/UNKNOWN ingress.** Verified by walking each new `node_modules/<pkg>/package.json` directly on 2026-05-26.

**Why two engines:** `docs/signature-engine.md §3.2` records the Wave 15 decision (locked as `P4-L-3`) to ship a fallback engine alongside the primary. If `node-signpdf` ever regresses (byte-range bugs producing silently-invalid signed PDFs), shifts license, or becomes unmaintained, the manual `node-forge` + `pkijs` + `asn1js` path lets us flip the `PADES_ENGINE` build-time toggle (Phase 4.1 Settings switch incoming) without a rewrite. Both engines satisfy the same `applySignature(input) → result` external contract; tests cover both paths.

### Phase 5 (Wave 21, this wave)

Phase 5 Wave 21 added three direct runtime dependencies for the Scan & OCR engine (Tesseract.js worker pool + bundled English language pack + pdf.js native rasterizer):

- `tesseract.js@^7.0.0` (Apache-2.0, [naptha/tesseract.js](https://github.com/naptha/tesseract.js)) — primary OCR engine. Pure WASM + Worker threads (no native modules). The Apache-2.0 license applies to the package wrapper; the underlying Tesseract C++ engine is also Apache-2.0. Locked decision P5-L-1 (`docs/architecture-phase-5.md §2`).
- `@tesseract.js-data/eng@^1.0.0` (MIT, [naptha/tessdata](https://github.com/naptha/tessdata)) — wrapper npm package that ships the upstream `eng.traineddata.gz` file in two pre-built variants (`4.0.0/` = fast, `4.0.0_best_int/` = integer-quantized best). The **package wrapper** is MIT; the **bundled data file** (`eng.traineddata.gz`) is under Apache-2.0 per upstream `tessdata`'s top-level LICENSE. Electron-builder packages the `4.0.0/eng.traineddata.gz` variant (~10.4 MB) into `resources/tessdata/eng.traineddata.gz` via `extraResources` (see `electron-builder.yml` Phase 5 block); the in-asar copy is surgically excluded as dead weight (same `pdfjs-dist standard_fonts/cmaps` pattern from Phase 4.1.3).
- `@napi-rs/canvas@^1.0.0` (MIT, [Brooooooklyn/canvas](https://github.com/Brooooooklyn/canvas)) — native rasterizer used by pdf.js to render PDF pages to ImageData during OCR. Without it, `ocr-bootstrap.ts:pageDimensionsProd` / `rasterizePageProd` fail at runtime with the typed error `pdf_render_failed` (David's R-1 HIGH risk in build-report Wave 20). Native module distributed as prebuilt `.node` binaries via `optionalDependencies` (one platform-specific subpackage per Windows/macOS/Linux architecture); only `@napi-rs/canvas-win32-x64-msvc@1.0.0` (MIT) ships in our v0.5.0 Windows binary. Listed in `asarUnpack` because native modules cannot live inside `app.asar`.

**Transitive delta:** +12 unique transitive packages (`tesseract.js-core@7.0.0` Apache-2.0, `opencollective-postinstall@2.0.3` MIT, `idb-keyval@6.2.4` Apache-2.0, `is-url@1.2.4` MIT, `regenerator-runtime@0.13.11` MIT, `wasm-feature-detect@1.8.0` Apache-2.0, `zlibjs@0.3.1` MIT, `bmp-js@0.1.0` MIT, `node-fetch@2.7.0` MIT, `whatwg-url@14.2.0` MIT, `tr46@5.1.1` MIT, `webidl-conversions@7.0.0` BSD-2-Clause) plus 11 optional platform-specific `@napi-rs/canvas-<platform>` subpackages (all MIT; only `-win32-x64-msvc` materializes on this host). Every newcomer is permissive (MIT / Apache-2.0 / BSD-2-Clause); **no AGPL/GPL/LGPL/EPL/UNKNOWN ingress.** Verified by walking each new `node_modules/<pkg>/package.json` directly on 2026-05-27 (license-checker@25.0.1 is broken on Node 24 — `slide` module resolution failure — so the walk used a hand-rolled Node script that recursively reads every `package.json` in `node_modules/`).

**Version delta note:** `docs/architecture-phase-5.md §3.3` referenced an Apache-2.0 license on `@tesseract.js-data/eng` and a directory path `4.0.0_fast/eng.traineddata.gz`. The actually-published npm package version is `@tesseract.js-data/eng@1.0.0` (latest tag), the **package** license is MIT (per its `package.json`), and the internal directory layout uses `4.0.0/` (fast variant) and `4.0.0_best_int/` (best variant) — not `4.0.0_fast/`. The `4.0.0_fast` path token is the upstream `tessdata.projectnaptha.com` URL path used by the download-mirror catalog (`src/main/pdf-ops/language-pack-catalog.json: baseUrl`), not the npm-internal directory name. The bundled `4.0.0/eng.traineddata.gz` (SHA-256 `ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468`) and the upstream `4.0.0_fast/eng.traineddata.gz` are the same trained-data file under different parent paths. The license-on-data is Apache-2.0 in both cases (per upstream `tessdata` LICENSE).

**Native module note:** `@napi-rs/canvas` is the first **native** runtime dep added since `better-sqlite3` (Phase 2). It distributes prebuilt `.node` binaries via `optionalDependencies` per platform; the Windows build picks up `@napi-rs/canvas-win32-x64-msvc@1.0.0` automatically. Electron-builder's `npm run postinstall` (which runs `electron-builder install-app-deps`) handles ABI rebuild against Electron 30's Node ABI when needed, same as for better-sqlite3. The `asarUnpack` list adds `node_modules/@napi-rs/canvas/**/*` so dlopen sees the .node file on the real FS at runtime.

### Phase 6 (Wave 25, this wave)

Phase 6 Wave 25 added two direct runtime dependencies for the Export-to-Office engine (docx + pptx writers; xlsx is satisfied by `exceljs` from Phase 3, image formats by `@napi-rs/canvas` + `utif` from Phase 5):

- `docx@^9.7.1` (MIT, [dolanmiu/docx](https://github.com/dolanmiu/docx)) — primary `.docx` writer. Pure-JS, ~250 KB raw / ~80 KB gzipped. Locked decision P6-L-2 (`docs/architecture-phase-6.md §6.2` — Paragraph + TextRun + Heading1-3 + Table + ImageRun scope).
- `pptxgenjs@^4.0.1` (MIT, [gitbrent/PptxGenJS](https://github.com/gitbrent/PptxGenJS)) — primary `.pptx` writer. Pure-JS, ~600 KB raw / ~180 KB gzipped. Locked decision P6-L-4 (`docs/architecture-phase-6.md §6.4` — slide-per-page, 16:9, EMU conversion).

**Transitive delta:** **+1 net package** (`nanoid@5.1.11` MIT, nested under `node_modules/docx/node_modules/nanoid/`; both `docx` and `pptxgenjs` are otherwise self-contained pure-JS bundles with zero other in-tree node_modules). The `pptxgenjs` `dist/pptxgen.bundle.js` is a pre-rolled bundle so all of its build-time deps are inlined and never materialize under `node_modules/`. **No AGPL/GPL/LGPL/EPL/UNKNOWN ingress.** Verified by `scripts/wave25-license-walk.mjs`.

Phase 6 Wave 25 also bumped two devDependencies (build/test only, not in production binary) to resolve the Node 24 + vitest 1.6 test-discovery regression (`.learnings/failures/2026-05-27-vitest-node24-discovery-regression.md`):

- `vitest@^1.6.0 → ^2.1.9` (MIT) — same `describe`/`it`/`expect` API surface; vitest 2.x's Vite-managed worker pool is Node 24 compatible. Outcome: `npm test` discovers and runs 1527 test cases across 138 files (was 0 under v1.6 + Node 24).
- `@vitest/ui@^1.6.0 → ^2.1.9` (MIT) — version-lockstep with vitest core.

**Net package count delta:** **826 (Phase 5) → 817 (Phase 6 Wave 25)** — adding `docx` + `pptxgenjs` + `nanoid` (+3) while the vitest 1.6 → 2.x bump pruned ~12 net transitives from the old vitest dep tree. Total package count is now at its lowest since Phase 3 even with two new direct runtime deps added.

**No new asar-unpacked entries.** Both `docx` and `pptxgenjs` are pure-JS — no `.node` binaries, no dynamic Worker spawns, no FS-real-path requirements. They live inside `app.asar` like every other pure-JS dep. Verified by `npx asar list release/win-unpacked/resources/app.asar | grep -iE "docx|pptxgenjs"` showing both packages bundled into the asar tree.

**Wave 25 packaging-only newcomer note (esbuild emit pattern).** Phase 6's `src/main/index.ts:273` uses a runtime `require('./export/export-bootstrap.js')` for the export-engine bootstrap (David's intent to mirror the OCR lazy-load pattern; the actual OCR pattern is a top-level static import — see `docs/build-report.md` Wave 25 row for the root-cause walk). In production this triggers two cascading failures: (1) vite tree-shakes the bootstrap into the index.js bundle, leaving no file at the require target; (2) even with a separate emit, Electron 30's Node 20 rejects `require()` of ESM with `ERR_REQUIRE_ESM`. Diego's `electron.vite.config.ts:emitExportBootstrapCjs()` plugin is the packaging-domain fix: a closeBundle hook runs esbuild against `src/main/export/export-bootstrap.ts` directly, emitting CJS to `dist/main/export/export-bootstrap.js`, alongside a `dist/main/export/package.json` declaring `{ "type": "commonjs" }` to override the root ESM scope. The proper long-term fix is David converting the runtime require to a static top-level import (would remove this plugin entirely). No license impact — esbuild is already in the toolchain (transitive of vite).

### Phase 7 (Wave 29, this wave)

Phase 7 Wave 29 added four direct dependencies for the polish phase (auto-update client + i18next localization framework):

- `electron-updater@^6.8.3` (MIT, [electron-builder](https://github.com/electron-userland/electron-builder) monorepo, `packages/electron-updater`) — the auto-update client. David's `src/main/auto-update.ts` library-injects it via a runtime `require` inside a statically-imported factory (the Phase-6.1 "prefer static import for the factory" lesson applied — avoids a vite tree-shake of the controller). It reads the `publish` block in `electron-builder.yml` to know the update feed; the publish target is a documented PLACEHOLDER (P7-L-2) so every update call returns the honest `update_not_configured`. Pulls `builder-util-runtime@9.5.1` (MIT, nested), `fs-extra@10.1.0` (MIT), `jsonfile@4.0.0` (MIT), `lazy-val@1.0.5` (MIT), `tiny-typed-emitter@2.1.0` (MIT), `js-yaml@4.1.1` (MIT), `semver@7.7.4` (ISC), `lodash.escaperegexp` + `lodash.isequal` (MIT), `debug@4.4.3`/`ms@2.1.3` (MIT), `graceful-fs@4.2.11` (ISC), `universalify@0.1.2` (MIT), `argparse@2.0.1` (Python-2.0), `sax@1.6.0` (BlueOak-1.0.0).
- `i18next@^26.3.0` (MIT, [i18next/i18next](https://github.com/i18next/i18next)) — the localization engine. Renderer-bundled (no native module). `~22 KB` min+gz.
- `react-i18next@^17.0.8` (MIT, [i18next/react-i18next](https://github.com/i18next/react-i18next)) — React hooks + `<Trans>`. **Peer-requires `i18next >= 26.2.0`** — this constrains i18next to its 26.x major (a downgrade to satisfy an older API would break the react-i18next peer). Pulls `@babel/runtime@7.29.2` (MIT), `html-parse-stringify@3.0.1` (MIT), `void-elements@3.1.0` (MIT), `use-sync-external-store@1.6.0` (MIT).
- `i18next-resources-to-backend@^1.2.1` (MIT, [i18next/i18next-resources-to-backend](https://github.com/i18next/i18next-resources-to-backend)) — lazy `import()` of locale chunks (Vite code-split intent). Pure-JS.

**Transitive delta / license verdict:** a full walk of the reachable subtree from the four new roots = **23 packages, ALL permissive** (MIT / ISC / BlueOak-1.0.0 / Python-2.0). **No AGPL/GPL/LGPL/EPL/undeclared ingress.** Several listed transitives (`argparse`, `sax`, `semver`, `graceful-fs`, `js-yaml`) were already in the tree pre-install (other deps' transitives); the genuinely-new in-tree packages are the electron-updater family + the i18next family.

**No new asar-unpack entry.** All four are pure-JS — no `.node` binaries, no Worker spawns, no FS-real-path requirements. They live inside `app.asar`. Verified via `npx asar list release/win-unpacked/resources/app.asar` showing `node_modules/electron-updater/package.json` (165 entries), `node_modules/i18next/package.json` (40 entries), `react-i18next`, `i18next-resources-to-backend`, and the nested `builder-util-runtime` + `lazy-val`. The locale JSON bundles (Riley's `src/client/i18n/locales/{en-US,es-ES}/*.json`) are **renderer assets inlined into `dist/renderer/assets/index-*.js`** (en-US eager; es-ES did NOT code-split into a separate lazy chunk in this build — see the build-report Wave 29 note — but both en-US and es-ES strings are confirmed present in the asar via string-probe of the renderer bundle).

**Cross-platform native-module note (P7-L-1, UNVERIFIED).** The Wave-29 `electron-builder.yml` adds mac (dmg+zip, universal) + linux (AppImage+deb) targets. These pull NO new license-bearing dependency — they are build-config only. The existing native deps (`better-sqlite3` MIT, `@napi-rs/canvas` MIT) rebuild per-platform; on mac/linux the per-platform `@napi-rs/canvas-{darwin,linux}-*` optional subpackages (all MIT, currently UNMET OPTIONAL on this Windows host — npm skips foreign-platform optionalDependencies) would materialize. No license change.

### Backlog-fix toolchain wave (2026-05-28, Diego)

Added two **devDependencies** (build/test only, NOT in the production binary) to prevent lint-debt re-accumulation (David's Wave 30 recommendation):

- `husky@^9.1.7` (MIT, [typicode/husky](https://github.com/typicode/husky)) — git-hook manager. Wires `.husky/pre-commit` (lint-staged + a `tsc -p tsconfig.main.json --noEmit` safeguard) and `.husky/pre-push` (full three-tsconfig typecheck + full lint). Activated via the `prepare: husky` script on `npm install`. **Zero runtime dependencies.**
- `lint-staged@^17.0.5` (MIT, [lint-staged/lint-staged](https://github.com/lint-staged/lint-staged)) — runs `eslint --fix --max-warnings 0` + `prettier --write` on staged `*.{ts,tsx}` and `prettier --write` on staged `*.{json,css,md}`. Config lives in `package.json` under `"lint-staged"`.

**Transitive delta:** reachable subtree from the two roots = **25 packages, ALL permissive** (24 MIT + 1 ISC `signal-exit@3.0.7`). **No AGPL/GPL/LGPL/EPL/undeclared ingress.** Walked recursively (license-checker remains broken on Node 24). Neither package ships in the asar (verified pure-JS dev tooling). No native module added; no `asarUnpack` change.

No production dependency or runtime license footprint changed in this wave — the only other edits were tooling/config (`package.json` scripts + `engines`, `.npmrc` unchanged, `.husky/**`, `scripts/check-node.mjs`, `scripts/rebuild-native-for-node.mjs`) which add no dependencies.

Future flagged items, if any, would be appended here with the same structure (package + version, the actual license issue, status, action plan, risk).

---

## Acknowledgments

PDF_Viewer_Editor's headline functionality rests on open-source work by:

- **Mozilla** — [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0). Page rendering, text extraction, native outline parsing.
- **Andrew Dillon** and contributors — [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT). Page-tree manipulation, the engine behind Phase 2's edit replay.
- **GitHub / Electron contributors** — [Electron](https://github.com/electron/electron) (MIT). The desktop shell. Bundles Chromium (BSD) and Node.js (MIT).
- **Facebook / Meta** — [React](https://github.com/facebook/react) (MIT) and the surrounding ecosystem.
- **Redux team** — [Redux Toolkit](https://github.com/reduxjs/redux-toolkit) (MIT) and [Reselect](https://github.com/reduxjs/reselect) (MIT).
- **Joshua Wise** and contributors — [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (MIT). Synchronous SQLite for Electron main.
- **Claudéric Demers** and contributors — [dnd-kit](https://github.com/clauderic/dnd-kit) (MIT). Drag-and-drop for thumbnail reorder and bookmark tree drag-nest.
- **Photopea** and contributors — [utif (UTIF.js)](https://github.com/photopea/UTIF.js) (MIT). TIFF first-page decoding for image import (Phase 2).
- **Guyon Roche** and contributors — [exceljs](https://github.com/exceljs/exceljs) (MIT). XLSX read/write for the mail-merge wizard's Excel data-source path (Phase 3).
- **Vasily Buchnev** and contributors — [node-signpdf](https://github.com/vbuch/node-signpdf) (MIT). Primary PAdES signing engine (Phase 4).
- **Digital Bazaar** and contributors — [node-forge](https://github.com/digitalbazaar/forge) (BSD-3-Clause OR GPL-2.0; BSD-3-Clause arm exercised). PFX parsing + ASN.1 + PKCS #7 primitives (Phase 4).
- **PeculiarVentures** and contributors — [pkijs](https://github.com/PeculiarVentures/PKI.js) (BSD-3-Clause) and [asn1js](https://github.com/PeculiarVentures/ASN1.js) (BSD-3-Clause). X.509 + CMS construction for the manual PAdES fallback engine (Phase 4).
- **naptha (Jerome Wu et al.)** and contributors — [tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0) and [tessdata](https://github.com/naptha/tessdata) (MIT wrapper around Apache-2.0 trained data). Pure-WASM OCR engine + bundled English language pack (Phase 5).
- **LongYinan (Brooklyn Zelenka et al.)** and contributors — [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) (MIT). Native rasterizer for pdf.js page renders during OCR (Phase 5).
- **Dolan Miu** and contributors — [docx](https://github.com/dolanmiu/docx) (MIT). Pure-JS `.docx` writer for the Export-to-Word path (Phase 6).
- **Brent Ely** and contributors — [PptxGenJS](https://github.com/gitbrent/PptxGenJS) (MIT). Pure-JS `.pptx` writer for the Export-to-PowerPoint path (Phase 6).
- **electron-builder maintainers** — [electron-updater](https://github.com/electron-userland/electron-builder) (MIT). Auto-update client for the Phase-7 update flow (publish target is a placeholder until the project is published).
- **Jan Mühlemann (jamuhl) et al.** and contributors — [i18next](https://github.com/i18next/i18next) and [react-i18next](https://github.com/i18next/react-i18next) (both MIT), plus [i18next-resources-to-backend](https://github.com/i18next/i18next-resources-to-backend) (MIT). The localization framework + lazy locale loading (Phase 7).
- **Vite team** — [Vite](https://github.com/vitejs/vite) (MIT) and [electron-vite](https://github.com/alex8088/electron-vite) (MIT). Build tooling.
- **electron-builder maintainers** — [electron-builder](https://github.com/electron-userland/electron-builder) (MIT). Packaging and NSIS installer generation.
- **Microsoft** — [TypeScript](https://github.com/microsoft/TypeScript) (Apache-2.0) and [Playwright](https://github.com/microsoft/playwright) (Apache-2.0).
- **Colin McDonnell** — [zod](https://github.com/colinhacks/zod) (MIT). IPC payload validation.

The full transitive dependency list is captured in `package-lock.json` and can be re-scanned any time with `npm ls --all` or a tool like `license-checker`.

---

## Re-scanning

To regenerate this report (e.g. after `npm install` adds new transitive deps):

```bash
npx license-checker --production --csv > /tmp/licenses-prod.csv
npx license-checker --csv > /tmp/licenses-all.csv
```

Then compare against this file and update the counts. Any unfamiliar license should be evaluated against the [`ARCHITECTURE.md`](ARCHITECTURE.md) §3 license whitelist (MIT / Apache-2.0 / BSD / ISC / 0BSD / equivalent permissive). Anything outside that set must be discussed before merge.
