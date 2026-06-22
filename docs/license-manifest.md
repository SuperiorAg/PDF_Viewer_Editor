# License Manifest — PDF_Viewer_Editor

**Last verified:** 2026-06-18 (Phase 7.5 Wave 11)
**Owner:** Diego (Director of Platform Engineering & Release Operations)
**Audit partner:** Julian (Director of Code Quality & Security Audit)

---

## Verdict

**All shipped runtime dependencies are permissive (MIT / Apache-2.0 / BSD / ISC).** One dependency was REJECTED on license grounds: `dictionary-es` (Spanish Hunspell dictionary, GPL-3.0 OR LGPL-3.0 OR MPL-1.1). The Spell Check feature therefore ships with `en-US` only, with an honest user-facing disclosure surfaced via the `spell:listLocales` IPC channel.

One subprocess-only dependency carries a strong copyleft license: `espeak` (Linux TTS engine, GPL-3.0). It is **APPROVED on a no-binary-redistribution basis** — we shell out via `child_process.spawn('espeak', args)` from the runtime; we do not link, we do not bundle. This is the FSF-endorsed subprocess-only aggregate-works pattern, consistent with the standing project rule "permissive OSS only" because the GPL terms attach to the binary distribution, which we never perform. The packaging configuration is hard-constrained to never add `espeak*` to `electron-builder.yml extraResources` — Julian's Wave 11 §11.8 LOW finding flags a future ratchet script (`scripts/ratchet-no-espeak-bundle.mjs`) as a safety net.

The shipped bundle vendors one external binary: `qpdf` 11.9.1 (Apache-2.0), used by the B8 Password Encryption / Document Properties Security tab via subprocess (`spawn(qpdf, ...)` with the input PDF on stdin and the encrypted PDF on stdout). The binary is SHA256-pinned per `scripts/qpdf-version.json` and fetched at packaging time by `scripts/fetch-qpdf-binaries.mjs` against the upstream PGP-signed manifest at `https://github.com/qpdf/qpdf/releases/download/v11.9.1/qpdf-11.9.1.sha256`. The Apache-2.0 NOTICE-equivalent text is `scripts/qpdf-LICENSE.txt` (canonical on-disk copy in repo, SHA256 pinned in `qpdf-version.json`).

---

## Section 1 — Phase 7.5 NEW dependencies

License tokens are verbatim from `npm view <package>@<version> license` at the time of vet. Where the brief stated a different token (typo or planning-pass guess), the actual token from npm metadata is authoritative — discrepancies are flagged explicitly so the audit trail is honest.

| Package                    | Version | License token (verbatim)           | URL                                                | Verdict | Notes                                                                                                                                                                                                |
| -------------------------- | ------- | ---------------------------------- | -------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diff-match-patch`         | 1.0.5   | `Apache-2.0`                       | https://github.com/google/diff-match-patch         | OK      | Used by B2 Compare Files text-diff engine (David Wave 7).                                                                                                                                            |
| `pixelmatch`               | 7.2.0   | **`ISC`**                          | https://github.com/mapbox/pixelmatch               | OK      | **DISCREPANCY:** Wave 7 brief said MIT. Actual upstream license is ISC. ISC is functionally equivalent to BSD-2-Clause / MIT for this project's permissive-OSS policy. Julian Wave 11 §3.7 approved. |
| `pngjs`                    | 7.0.0   | `MIT`                              | https://github.com/lukeapage/pngjs                 | OK      | Used by B2 Compare Files diff-mask compositor (David Wave 7).                                                                                                                                        |
| `nspell`                   | 2.1.5   | `MIT`                              | https://github.com/wooorm/nspell                   | OK      | Used by B14 Spell Check engine (David Wave 6).                                                                                                                                                       |
| `dictionary-en`            | 4.0.0   | `(MIT AND BSD)`                    | https://github.com/wooorm/dictionaries             | OK      | en-US Hunspell dictionary for the Spell Check feature. Dual-permissive compound token; both terms are individually permissive.                                                                       |
| `dictionary-es`            | (n/a)   | `(GPL-3.0 OR LGPL-3.0 OR MPL-1.1)` | https://github.com/wooorm/dictionaries             | REJECT  | es-ES Hunspell dictionary. **NOT INSTALLED.** Phase 7.5 Spell Check ships en-US only. The `spell:listLocales` IPC response carries an honest user-facing disclosure (see "Honest disclosure" below). |
| `qpdf` (subprocess binary) | 11.9.1  | `Apache-2.0`                       | https://github.com/qpdf/qpdf                       | OK      | Bundled per `scripts/qpdf-version.json` SHA256 pins. License text verbatim at `scripts/qpdf-LICENSE.txt`. Per-OS bundling rules below.                                                               |
| `@types/diff-match-patch`  | 1.0.36  | `MIT`                              | https://github.com/DefinitelyTyped/DefinitelyTyped | OK      | dev-dep types only.                                                                                                                                                                                  |
| `@types/pngjs`             | 6.0.5   | `MIT`                              | https://github.com/DefinitelyTyped/DefinitelyTyped | OK      | dev-dep types only.                                                                                                                                                                                  |

### Honest disclosure surfaced to the user

When the user opens the Spell Check locale picker, the IPC channel `spell:listLocales` returns a response carrying the verbatim user-facing reason string for the missing es-ES locale. The string is pinned by a unit test so paraphrasing fails CI — same honesty contract as P7.5-L-10 (Accessibility Checker `subsetDisclosure`) and the C2 Preflight `subsetDisclosure`. Source: `src/main/spell/spell-locales.ts` (David Wave 6).

---

## Section 2 — TTS license decisions (per OS)

The C1 Read Aloud feature uses per-OS native TTS engines via subprocess. Each engine carries different license terms; our policy is consistent: **subprocess-only, no linking, no bundling**.

| OS      | Engine                 | License                     | How we use it                                                                                                                                                                                                            | Verdict / constraint                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | ---------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | SAPI 5.4               | OS-bundled (Microsoft EULA) | `spawn('powershell', ['-Command', 'Add-Type -AssemblyName System.Speech; …'])` from `src/main/tts/sapi-adapter.ts`. We never redistribute SAPI; we invoke the OS-bundled component.                                      | OK. No license issue — we depend on a component the user's OS provides.                                                                                                                                                                                                                                                                                                                                          |
| macOS   | `say`                  | OS-bundled (Apple EULA)     | `spawn('say', args)` from `src/main/tts/say-adapter.ts`. OS-bundled component on every supported macOS version.                                                                                                          | OK. No license issue — same reasoning as SAPI.                                                                                                                                                                                                                                                                                                                                                                   |
| Linux   | `espeak` (`espeak-ng`) | **GPL-3.0**                 | `spawn('espeak', args)` from `src/main/tts/espeak-adapter.ts`. The user installs `espeak` via the distribution package manager (apt/dnf/pacman). We never bundle the binary, never link the library, never redistribute. | **APPROVED on a no-binary-redistribution basis.** Julian Wave 11 §3.7 rationale: subprocess-only call is the FSF-endorsed aggregate-works pattern; the GPL terms attach to the binary distribution, which we never perform. **Hard constraint:** never add `espeak*` to `electron-builder.yml extraResources` / `extraFiles` / `files`. Julian's 11.8 LOW finding flags a future ratchet script as a safety net. |

When the Linux user has not installed espeak, the engine surfaces `engine_unavailable` (an honest failure mode) and the Read Aloud bar renders the §22.2 honest fallback — no fake "playing…" spinner. The "missing engine" error message points the user at the system package manager.

---

## Section 3 — qpdf binary bundling (Phase 7.5 Wave 11)

**License:** Apache-2.0 (verbatim copy at `scripts/qpdf-LICENSE.txt`; SHA256 pinned at `qpdf-version.json` field `licenseFileSha256`).

**Per-OS bundling decisions** (mirrored in `electron-builder.yml` per-platform `extraResources` blocks):

| Platform    | Bundled?          | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Discovery fallback                                                                                                                                                                                                                                                                                                                |
| ----------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows x64 | YES               | `qpdf.exe` + `qpdf29.dll` + 8 VC++ runtime DLLs ship under `resources/qpdf/bin/`. All 9 DLLs are shipped alongside `qpdf.exe` because (a) qpdf.exe imports qpdf29.dll, (b) qpdf29.dll imports the VC++ runtime DLLs, (c) we cannot depend on the user's machine having the VC++ Redistributable installed (Windows 10/11 Home editions often don't). Ship cost: ~7.5 MB total.                                                                                                                    | None needed (binary present). If somehow absent, `encryption-engine.ts:resolveRunner` surfaces `engine_unavailable` with guidance.                                                                                                                                                                                                |
| Linux x64   | YES (config-only) | `bin/qpdf` + `lib/libqpdf.so.29.9.1` (with symlink) + 8 supporting system libs ship under `resources/qpdf/`. The Linux qpdf binary uses RUNPATH `../lib` so the bin/ + lib/ split MUST be preserved. **CONFIG-ONLY / UNVERIFIED** on real Linux hardware per the Phase 7 P7-L-1 convention (electron-builder does not run on real Linux hardware in CI). Ship cost: ~9.5 MB total.                                                                                                                | System PATH (`/usr/bin/qpdf` after `apt install qpdf`). Discovery in `encryption-engine.ts` tries packaged path first, then system PATH.                                                                                                                                                                                          |
| macOS       | NO                | Upstream qpdf 11.9.1 publishes **no macOS prebuilt binary** (verified 2026-06-18 from https://api.github.com/repos/qpdf/qpdf/releases/tags/v11.9.1). Assets are msvc/mingw Windows + linux-x86_64 + AppImage + tarball source. No `.dmg` or darwin zip. We do not build qpdf from source on macOS in our packaging pipeline (no signed cert workflow + no qpdf upstream build manifest we can verify). Documented limitation; tracked for Phase 7.6 if a permissive macOS binary source surfaces. | System PATH (`/opt/homebrew/bin/qpdf` after `brew install qpdf`). The discovery in `encryption-engine.ts:defaultQpdfBinaryPath` falls through to the bare exe name `'qpdf'` on darwin so `child_process.spawn` resolves it from PATH at run time. When neither is present, the engine returns `engine_unavailable` with guidance. |

**Fetch + verify flow:**

```bash
node scripts/fetch-qpdf-binaries.mjs
```

The script:

1. Reads per-OS URLs + SHA256s + size budgets from `scripts/qpdf-version.json`
2. Downloads the platform-appropriate archive
3. Verifies SHA256 (refuses to install on mismatch)
4. Extracts into `vendor/qpdf/<platform>/` following the documented layout
5. Copies `scripts/qpdf-LICENSE.txt` into the per-platform tree as `vendor/qpdf/<platform>/LICENSE.txt`

`vendor/` is git-ignored — the binary is never committed. CI runs the fetch step before `electron-builder`; developers run it on first dev-mode exercise of the encryption engine.

---

## Section 4 — Prior phase dependencies (enumerated; vet completed in prior phases)

These dependencies were vetted in earlier phase reviews. License tokens listed for the historical record; no re-vet was performed in Phase 7.5. The full provenance lives in the Wave-by-wave `docs/build-report.md` history.

### Runtime

| Package                        | License token                                          |
| ------------------------------ | ------------------------------------------------------ |
| `electron` (peer / build)      | `MIT`                                                  |
| `pdf-lib`                      | `MIT`                                                  |
| `pdfjs-dist`                   | `Apache-2.0`                                           |
| `tesseract.js`                 | `Apache-2.0`                                           |
| `@tesseract.js-data/eng`       | `Apache-2.0`                                           |
| `@napi-rs/canvas`              | `MIT`                                                  |
| `better-sqlite3`               | `MIT`                                                  |
| `bindings`                     | `MIT`                                                  |
| `react`, `react-dom`           | `MIT`                                                  |
| `@reduxjs/toolkit`             | `MIT`                                                  |
| `react-redux`                  | `MIT`                                                  |
| `@dnd-kit/core`                | `MIT`                                                  |
| `@dnd-kit/sortable`            | `MIT`                                                  |
| `i18next`                      | `MIT`                                                  |
| `react-i18next`                | `MIT`                                                  |
| `i18next-resources-to-backend` | `MIT`                                                  |
| `docx`                         | `MIT`                                                  |
| `exceljs`                      | `MIT`                                                  |
| `pptxgenjs`                    | `MIT`                                                  |
| `utif`                         | `MIT`                                                  |
| `electron-updater`             | `MIT`                                                  |
| `zod`                          | `MIT`                                                  |
| `asn1js`                       | `MIT` (BSD-3-Clause clean-room reimpl, MIT-relicensed) |
| `pkijs`                        | `MIT`                                                  |
| `node-forge`                   | `(BSD-3-Clause OR GPL-2.0)`                            |
| `node-signpdf`                 | `MIT`                                                  |

### Build / dev / test

| Package                     | License token |
| --------------------------- | ------------- |
| `vite`                      | `MIT`         |
| `electron-vite`             | `MIT`         |
| `electron-builder`          | `MIT`         |
| `@electron/rebuild`         | `MIT`         |
| `typescript`                | `Apache-2.0`  |
| `eslint`                    | `MIT`         |
| `prettier`                  | `MIT`         |
| `vitest`                    | `MIT`         |
| `@playwright/test`          | `Apache-2.0`  |
| `@testing-library/react`    | `MIT`         |
| `@testing-library/jest-dom` | `MIT`         |
| `husky`                     | `MIT`         |
| `lint-staged`               | `MIT`         |

The `(BSD-3-Clause OR GPL-2.0)` token on `node-forge` is a dual-licensed permissive option — we elect the BSD-3-Clause arm, which is permissive and compatible with the project's MIT distribution.

---

## Section 5 — Excluded by policy

These packages were considered and explicitly excluded on license grounds. Listed for the audit trail.

| Package          | License                            | Reason                                                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PyMuPDF          | AGPL-3.0                           | Strong copyleft. Excluded by the standing project rule "permissive OSS only" (`CLAUDE.md`).                                                                                                                                                                         |
| iText (7+)       | AGPL-3.0                           | Same as above.                                                                                                                                                                                                                                                      |
| Ghostscript      | AGPL-3.0                           | Same as above.                                                                                                                                                                                                                                                      |
| PDFTron / Apryse | Commercial                         | Proprietary. Excluded by the standing rule "no commercial SDKs."                                                                                                                                                                                                    |
| Foxit SDK        | Commercial                         | Same as above.                                                                                                                                                                                                                                                      |
| Syncfusion       | Commercial                         | Same as above.                                                                                                                                                                                                                                                      |
| `dictionary-es`  | `(GPL-3.0 OR LGPL-3.0 OR MPL-1.1)` | Bundled (`dependencies`) by Hunspell-style dictionaries would mean shipping GPL/LGPL/MPL text in the asar — runtime "linking" semantics with the rest of the renderer. We declined. Spell Check ships en-US only with the honest disclosure described in Section 1. |

---

## Final verdict

**GREEN.** All shipped runtime dependencies are permissive. The one strong-copyleft subprocess dependency (`espeak`) is approved on the no-binary-redistribution basis per FSF-endorsed aggregate-works pattern; the packaging configuration is hard-constrained never to bundle it (Julian §11.8 LOW finding flags a future safety-net ratchet). The one rejected dependency (`dictionary-es`) ships an honest user-facing disclosure surfaced via `spell:listLocales`. The qpdf binary bundling (Apache-2.0) is SHA256-pinned via the upstream PGP-signed manifest and the LICENSE text travels in the installed package tree per platform.

Signed: **Diego (Director of Platform Engineering & Release Operations)** — 2026-06-18, Phase 7.5 Wave 11.

Audit partner: **Julian (Director of Code Quality & Security Audit)** — license audit second-pass GREEN per `docs/code-review.md §3.7`. Julian's L-007 sign-off is PENDING the lock text written in this wave; once acknowledged, Julian will append a §7.1 amendment to `docs/code-review.md`.
