# User guide — PDF_Viewer_Editor 0.7.6 (Phase 7)

Welcome. This guide walks you through everything PDF_Viewer_Editor 0.7.6 can do, and is explicit about the parts that are still narrowly scoped. **0.7.0 closed the 7-phase roadmap; six point releases (0.7.1 through 0.7.6) followed.** Phase 7 is the polish phase — it adds no new document-editing capability, but it adds an interface-language picker, an opt-in telemetry framework, an auto-update client (now wired to a real GitHub release feed), keyboard + screen-reader accessibility, macOS + Linux build configuration, and (as of 0.7.6) a **comprehensive 13-section in-app Help modal** (F1) plus **cursor-anchored Ctrl+wheel zoom** (the point under the cursor stays put across the gesture). The Phase 6 export surface (Word / Excel / PowerPoint / image — all six formats now produce valid output, including standard-font text in image exports), Phase 5 OCR + searchable PDFs (now with multi-language download), the **Phase 5.1 native WIA scanner on Windows**, Phase 4 signing (visual + PAdES + audit log), Phase 3 forms (designer + mail merge), and Phase 2 page editing all carry through unchanged. **Five visible polish items shipped after 0.7.0:** crisp HiDPI text + fluid centered Ctrl+scroll zoom + a synced zoom dropdown (0.7.4); a new app icon (0.7.5); cursor-anchored zoom + the 13-section in-app Help modal + a functional **Combine PDFs** flow end-to-end (H-30.1 closure, the Phase-1 `not_implemented` stub is gone) (0.7.6). For installation and the honest platform-support matrix, see the [README](../README.md#install). For the resolved-vs-deferred close-out, see [README → Roadmap status](../README.md#roadmap-status). For the upgrade story from 0.6.x, see [`build-report.md`](build-report.md) Phase 7 sections and the 0.7.1–0.7.6 backlog-fix entries.

> **Phase 7 honesty banner — read this before relying on telemetry, auto-update, the Spanish locale, or a non-Windows build.** Four things in 0.7.6 ship in an honest, partial, or unverified state, and the app is built to tell you so at the point of action. The full enumeration is in [Phase 7 trust floor](#phase-7-trust-floor--what-the-app-does-and-doesnt-promise):
>
> 1. **Telemetry is OFF by default.** When enabled, it records anonymous feature-usage counts only — never document content, file paths, or personal information. Nothing leaves your machine at all; the transport is an in-memory buffer you can inspect. See [Telemetry and privacy](#telemetry-and-privacy).
> 2. **The auto-update channel is real (since 0.7.2) but the binary is unsigned.** The update client is wired to the live `SuperiorAg/PDF_Viewer_Editor` GitHub release feed and reports the honest result of a real network call (`up-to-date`, `update-available`, or a real feed/network error — never a fabricated "you're up to date"). However, `electron-updater` correctly refuses to _apply_ an unsigned bundle, so the install path is gated on a code-signing certificate (a deferred follow-up). See [Checking for updates](#checking-for-updates).
> 3. **macOS and Linux builds are UNVERIFIED.** They are produced by the build config but have not been tested on real hardware. See [README → Platform support](../README.md#platform-support).
> 4. **Spanish (es-ES) is a translation sample, not a complete localization.** ~68% of strings are translated to prove the framework works (the denominator grew to 816 keys in 0.7.1, with 140 new keys added in 0.7.6 for the Help modal); the rest fall back to English. See [Changing the interface language](#changing-the-interface-language).

The headline Phase 6 export obligations to know about up front — all five are explained at length in [Export trust floor](#export-trust-floor--what-the-app-does-and-doesnt-promise):

- **PDF → Office conversion is layout-preserving best-effort.** Complex multi-column layouts, embedded vector graphics, intricate tables (especially borderless or merged-cell), and decorative typography may not convert faithfully. The fast `text-only` tier is even more reductive — accurate text in a flat structure with no images, no tables, no headings. Review the output before relying on it for downstream work.
- **Borderless or merged-cell tables may not be detected.** The line-grid table detector requires explicit horizontal AND vertical line segments. Tables that visually exist via whitespace alignment alone produce a flat sequence of paragraphs.
- **Filled form values export as text; XFA-form values do not export.** Phase-3-flattened AcroForms produce inline text. Unflattened AcroForms also produce text via the form-field-object fallback. XFA forms (Phase 3 read-only) produce only the static template; if you need XFA values, flatten the form first (forms designer → flatten) before exporting.
- **Exporting from a signed PDF: the source signature stays valid; the exported file has no signature semantics.** Export is read-only on the source — your PAdES signature is untouched. The exported docx / xlsx / pptx / image has no PAdES surface (those formats either don't support PAdES or are unsigned by definition). Sign the Office file in Office after export if you need a signed Office document.
- **OCR status determines text fidelity.** If the source PDF has been OCR'd (Phase 5), text exports as native selectable text. If the source is image-only and was NOT OCR'd, the Word / PowerPoint output is mostly raster image with no selectable text. The engine does NOT auto-OCR before export — that would silently mutate the source. Run OCR first, save, then export.

Plus a cross-cutting reminder: **Conversion takes ~5-30 seconds per page on the layout-preserving tier, ~0.5 seconds per page on the text-only tier.** A 100-page magazine with full-color images can take 30+ minutes; the cancel button is always available; partial output is cleaned up automatically.

The Phase 5 OCR trust-floor obligations (low-confidence-may-be-wrong / no-cloud-upload / OCR-text-becomes-part-of-PDF / re-OCR-duplicates) continue to apply unchanged in Phase 6 — see [OCR trust floor](#ocr-trust-floor--what-the-app-does-and-doesnt-promise). The Phase 4 PAdES trust-floor obligations continue to apply — see [PAdES trust floor](#pades-trust-floor--what-the-app-does-and-doesnt-promise). Other Phase-3 honesty obligations continue to apply — JavaScript form actions are stripped on save (P3-L-2), XFA forms are read-only, and text editing is replace-only with the original font (Phase 2 boundary). See [Known limitations in Phase 6](#known-limitations-in-phase-6).

---

## What changed in 0.7.2–0.7.6

Five small point releases between the 0.7.1 backlog-fix and today. Each one shipped a concrete user-visible change with packaged-binary evidence.

- **0.7.6 — Cursor-anchored zoom + a 13-section in-app Help modal + functional Combine end-to-end.** Three deltas. **(1)** Ctrl+wheel zoom (made fluid in 0.7.4) now anchors on the cursor: the point under the cursor stays put across the gesture instead of drifting toward the page midline. The mechanic is two-part — per-tick the cursor page's `transformOriginOverride` is rewritten to the cursor anchor (other pages keep `'50% 0'` = no per-frame style churn for non-cursor pages); on commit a `useLayoutEffect` ratios `scrollLeft / scrollTop` by `newZoom / oldZoom`. Verified at the packaged binary from 100% → 133% — the anchor point stayed under the cursor across six wheel ticks. See [Zoom and pan](#zoom-and-pan). **(2)** Press **F1** to open the new Help modal — promoted from a single-screen overview to a 13-section horizontal-tablist reference covering Getting started, Navigation, Editing pages, Annotations, Forms, Signing, OCR, Scanning, Export, Combine, Settings, Troubleshooting, and About. 140 new en-US strings under `modals:help.*`; structured TS data behind a discriminated-union sub-section shape (prose / bullets / steps). The es-ES sample remains at ~58% (the user-guide's existing trust-floor honesty language is echoed in the Help modal text). **(3) Combine PDFs is now functional end-to-end.** H-30.1 closure: the renderer's `pdf:combine` had been returning a Phase-1 `not_implemented` stub even though the milestone-1 walking-skeleton, the help modal, and this user guide all claimed it worked. David shipped a real pdf-lib combine engine + a `dialog:pickPdfFiles` channel; Riley wired the modal end-to-end (multi-file picker, de-dup by absolute path, per-source error mapping). The "Phase 1 stub" string is gone from every renderer surface; running **File → Combine PDFs…** now produces a real merged "Combined Document.pdf". See [Combining PDFs](#combining-pdfs).
- **0.7.5 — New app icon.** The previous binaries shipped with the default Electron atom icon and the build log carried a "default Electron icon is used" warning every release. The 0.7.5 wave committed and wired the new SSI brand icon — a white PDF document with a folded top-right corner and a bold red "PDF" ribbon on a rounded-square cool-neutral plate — into `electron-builder.yml` for Windows (titlebar, taskbar, file-association handler, NSIS installer/uninstaller chrome) and macOS (the icns is wired and the bytes are valid but the embedded-in-a-real-`.app` proof is a future real-Mac step). The ICO is 7-layer multi-res (16/24/32/48/64/128/**256** — 256 is an NSIS hard requirement) and the build warning is gone.
- **0.7.4 — Viewer UX: crisp HiDPI text + fluid centered Ctrl+scroll zoom + synced zoom dropdown.** Three closely-related fixes that make the viewer feel right on a high-DPI laptop screen. The page raster is now DPR-aware with an offscreen double-buffer (so text is sharp at any DPI, not blocky); Ctrl+scroll zoom is driven by a two-tier `displayZoom` CSS transform with rAF-coalesce + a 120ms debounce commit (instant live zoom, pdf.js re-rasters once on commit — no per-tick stutter); the page is horizontally centered during the gesture via `transformOrigin: '50% 0'` (no off-center drift or snap-back); the status-bar zoom dropdown flips to the committed percentage when the gesture ends (e.g. 100% → 177% after six wheel ticks). See [Navigating a document → Zoom and pan](#zoom-and-pan).
- **0.7.3 — Native WIA scanner addon (Phase 5.1).** The disabled "Scan from device" menu item is now live on Windows. A new custom pure-Node-API COM addon (`native/wia-scanner/`) enumerates real WIA devices via `IWiaDevMgr2::EnumDeviceInfo`, acquires pages via `IWiaTransfer::Download`, supports ADF multi-page (feeder) and flatbed single, and composes the scanned pages into a single PDF that chains directly into the [OCR pipeline](#running-ocr) for scan→searchable-PDF. Validated end-to-end against a real Xerox WIA-compliant MFP. On macOS/Linux the loader degrades to `scanner_unavailable` and the menu item stays disabled (the rest of the app is unaffected). See [Scanning from a device](#scanning-from-a-device) for the workflow.
- **0.7.2 — Real auto-update publish target.** The auto-update client was previously wired to a `PLACEHOLDER` channel; "Check for updates" short-circuited to `update_not_configured` without contacting any feed. As of 0.7.2 the publish target is the real `SuperiorAg/PDF_Viewer_Editor` GitHub release feed (`releaseType: draft` for publish safety — each release is created as a draft and a human promotes it to live). The in-app check now actually contacts the live feed and returns an honest result: `up-to-date`, `update-available`, or a real network/feed error. **Auto-update _install_ still needs a code-signing cert** — see [Checking for updates](#checking-for-updates) and the deferred-items table in [README → Roadmap status](../README.md#roadmap-status).

No database schema change in any of 0.7.2–0.7.6 (still schema v7). No new dependency. No regression to any earlier feature.

---

## What changed in 0.7.1

0.7.1 is a backlog-fix point release. It ships **no new feature surface** and **no database-schema change** (still schema v7); it resolves defects and follow-ups documented at the 0.7.0 close. Highlights you can see as a user:

- **Image export now includes text.** Exporting a text PDF to PNG / JPEG / TIFF previously rendered embedded images but left standard-font text (Helvetica / Times / Courier) **blank**. That is fixed — all six export formats now produce complete output. See [Exporting to Office and images](#exporting-to-office-and-images).
- **Multi-language OCR download works.** All nine non-English language packs (Spanish / French / German / Portuguese / Italian / Russian / Simplified + Traditional Chinese / Japanese) now download and install — they previously failed integrity verification. See [Manage language packs](#manage-language-packs).
- **More of the UI is translated.** The deep modal-step prose is now routed through the localization framework; the Spanish sample covers more surface (now measured at ~68% of an 816-key baseline, up from a 482-key baseline). Untranslated strings still fall back to English. See [Changing the interface language](#changing-the-interface-language).
- **The annotation drawing surface has an accessible name.** Screen-reader users now hear a description of the drawing surface that names the keyboard-operable alternative (toolbar + Inspector). See [Accessibility](#accessibility).

The deferred items at the 0.7.1 close (macOS / Linux real-hardware verification + a real auto-update publish target + native scanner integration) were partially resolved in 0.7.2 and 0.7.3 — see "What changed in 0.7.2–0.7.6" above. The remaining genuinely-blocked items (Mac/Linux real-hardware verification + Windows code-signing certificate) are documented in [README → Roadmap status](../README.md#roadmap-status).

---

## What changed in 0.7.0

Phase 7 is the polish phase — it adds **no new document-editing capability** and every Phase 2–6 feature continues to work unchanged. New surfaces, all reached from **Settings → General** (Ctrl+,) or **Help → About**:

- **Interface language picker.** Settings → General → Interface language. English (US) is the default; Spanish (España) is a partial translation sample. The whole UI switches live — no restart — and the choice persists. See [Changing the interface language](#changing-the-interface-language).
- **Opt-in telemetry toggle.** Settings → General → Privacy. OFF by default. When enabled, it records anonymous feature-usage counts only; nothing leaves your machine. A "View collected data" button opens a debug panel showing exactly what is buffered. See [Telemetry and privacy](#telemetry-and-privacy).
- **Update channel + "Check for updates now".** Settings → General → Updates: choose Manual (default) or Automatically on launch, and a check button. The update channel is a placeholder until the project is published — the app says so honestly. See [Checking for updates](#checking-for-updates).
- **About modal.** Help → About: version 0.7.0, acknowledgments (naming the Phase-7 MIT libraries), and an update-status area. See [The About modal](#the-about-modal).
- **Keyboard navigation + screen-reader support.** Proper ARIA tab patterns (sidebar, settings), roving-tabindex toolbar, focus-trapped modals, live-region status announcements — all the critical paths are keyboard-navigable and tested with Windows Narrator. See [Accessibility](#accessibility).
- **macOS + Linux build configuration** (unverified — see [README → Platform support](../README.md#platform-support)).
- **Four new settings** under `telemetry.*`, `i18n.*`, and `update.*` (opt-in flag, locale, update channel, last-checked timestamp). See [Settings](#settings).

See [`docs/build-report.md`](build-report.md) Phase 7 sections (Wave 27 Riley design through Wave 30 Nathan docs) for the full wave-by-wave changelog, and [README → Roadmap status](../README.md#roadmap-status) for the honest close-out + backlog.

### Upgrading from 0.6.x

The 0.6.x → 0.7.0 upgrade is non-destructive. The schema-v7 migration (`migrations/0007_phase7_polish.sql`) runs automatically on first launch — it is the **smallest migration in the project**, seeding four new key-value rows in the existing `settings` table (`telemetry.optIn = false`, `i18n.locale = en-US`, `update.channel = manual`, `update.lastCheckedAt = null`) and adding **no new table and no new column** on any prior table. All your Phase 1–6 state survives unchanged. There is deliberately **no `telemetry_events` table**: the telemetry buffer is in-memory only by privacy design — events must not survive a restart, must not be forensically recoverable from the `.sqlite` file, and must not be a tamper surface (see [Telemetry and privacy](#telemetry-and-privacy)).

If you launch 0.7.0 against a database that already has schema v7, the migration is idempotent and is skipped.

---

## What changed in 0.6.0

Phase 6 is purely additive — every Phase 2 + Phase 3 + Phase 4 + Phase 5 feature continues to work unchanged. New surfaces:

- **Export to Word / Excel / PowerPoint / image** from the open document. A 4-step wizard (Format → Quality + options → Confirm → Background) drives a per-page streaming engine. The result is a new file at the path you choose; the source PDF is never mutated. See [Exporting to Office and images](#exporting-to-office-and-images).
- **Layout-preserving and text-only quality tiers.** Layout-preserving is the recommended default for Word + PowerPoint; text-only is the recommended default for Excel. Image formats do not have a quality tier (you pick DPI instead). See [Choosing a quality tier](#choosing-a-quality-tier).
- **Per-format options panel** — page range, include-annotations, page size (docx), DPI / JPEG quality / multi-page-TIFF (images). Inline `per-format-limitations` honesty bullets above the Start button. See [Per-format options](#per-format-options).
- **Exports sidebar tab.** A 5th sidebar tab (alongside Pages / Bookmarks / Forms / OCR Results) listing in-flight + recent + failed export jobs for the open document with Cancel / Open / Show in folder / Re-run actions. See [Exports sidebar](#exports-sidebar).
- **Status-bar export-progress widget.** A small widget visible in the status bar only while a Phase 6 job is queued or running, with an inline Cancel button. See [Status-bar progress widget](#status-bar-progress-widget).
- **Background queue (modal closes after enqueue).** Unlike the Phase 5 OCR modal that pins while the job runs, the Phase 6 export modal closes after you click Start; the job runs in the background; progress surfaces in the status-bar widget + Exports sidebar tab. (See the [Phase 6 known limitations](#known-limitations-in-phase-6) entry on `ExportQueue` — concurrency is currently inline at 1; the documented FIFO queue ships in Phase 6.1.)
- **File menu — Export to {Word, Excel, PowerPoint, PNG, JPEG, TIFF}** entries open the modal pre-selected to that format. The toolbar Export button opens with your last-chosen format.
- **17 new settings** under `export.*` for per-format defaults (quality tier, page size, DPI, JPEG quality, multi-page TIFF, include-annotations) plus layout-extractor tuning knobs and the export queue max size. See [Settings](#settings).

See [`docs/build-report.md`](build-report.md) Phase 6 sections (Wave 23 Riley architecture through Wave 26 Nathan docs) for the full wave-by-wave changelog.

### Upgrading from 0.5.0

The 0.5.0 → 0.6.0 upgrade is non-destructive. The schema-v6 migration (`migrations/0006_phase6_export.sql`) runs automatically on first launch — it adds one new table (`export_jobs`) plus 17 new key-value rows in the existing `settings` table for per-format defaults. **No existing Phase 1-5 table is touched**; **no new column on any prior table** (Phase 6 is read-only on the source, so no `signature_audit_log` backref is needed). Your recents, settings, bookmarks, saved form templates, Phase 4 signature audit log, Phase 5 OCR jobs + results + language packs, and all Phase 2/3/4/5 state survive the upgrade unchanged.

If you launch 0.6.0 against a database that already has schema v6 (re-install / sidegrade), the migration is idempotent and is skipped. If you ever need to reset the database (rare), delete `%APPDATA%/PDF Viewer & Editor/db.sqlite` — your recents, bookmarks, form templates, signature audit log, OCR job history, AND any export job history will be wiped but no document file on disk is affected. Exported Office / image files on disk live wherever you saved them and are not touched by a DB reset.

The bundled English language pack continues to live at `<install dir>/resources/tessdata/eng.traineddata.gz` (Phase 5, unchanged). Exported Office / image files land at the paths you pick in the Export modal — there is no "default downloads folder" that Phase 6 manages; the modal's path picker uses Electron's native save-as dialog.

---

## Known limitations

This is the full, honest list across all seven phases. Most limitations are intentional scope-fences or documented-backlog items (tracked into Phase 7.1 and the phase-suffixed follow-ups in [README → Roadmap status](../README.md#roadmap-status)), not bugs.

### Phase 7 partial features

| Limitation                                                                                                                                                                                                                                                                                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                             | Ships in                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Telemetry sends nothing — the transport is an in-memory buffer only.** When you opt in, events accumulate in a bounded in-memory ring buffer (default 500 entries) that you can inspect via Settings → "View collected data". Nothing is written to disk, nothing is sent over the network.                                                            | P7-L-3: the Phase 7 deliverable is the framework + opt-in UI + allowlist + a no-op local transport. A real (self-hosted) network transport would go behind the same interface in a future phase. Opt-in default OFF; nothing leaves the machine.                                                                                                                                                                | Future phase (network transport)                                                                               |
| **Auto-update publish target is real (`SuperiorAg/PDF_Viewer_Editor`) as of 0.7.2.** "Check for updates" contacts the live GitHub release feed and reports `up-to-date` / `update-available` / a real feed error. The client never claims a status it didn't observe.                                                                                    | P7-L-2: resolved in 0.7.2. `releaseType: draft` for publish safety; each release is created as a draft and a human promotes it via `gh release edit --draft=false`.                                                                                                                                                                                                                                             | Resolved (0.7.2)                                                                                               |
| **Auto-update cannot apply downloaded bundles without a code-signing certificate.** `electron-updater` verifies an update bundle's signature before applying it; until a cert is acquired, a downloaded bundle on the real channel fails signature verification (correct security behavior). Check + download paths work; install path returns an error. | The cert is a real-world manual step (CA selection, identity verification, key custody policy). Acquiring + configuring it is deferred to a later point release.                                                                                                                                                                                                                                                | Deferred — requires external resource                                                                          |
| **The "Restart and install" unsaved-work gate is fixed end-to-end as of 0.7.2.** Clicking install prompts to save unsaved edits first (Save and install / Discard and install / Cancel). The main-process gate refuses the install path if the renderer reports unsaved work AND the discard flag is not set (defense-in-depth).                         | Julian H-29.1, then H-FIX.1: resolved end-to-end once the real publish target landed (the renderer dialog became reachable; the main-process gate is unchanged).                                                                                                                                                                                                                                                | Resolved (0.7.2)                                                                                               |
| **Spanish (es-ES) is a ~68% translation sample.** First-paint + high-traffic + honesty surfaces are translated, and 0.7.1 extended coverage into the deep modal _steps_; the rest fall back to English (never a raw key).                                                                                                                                | P7-L-6 obligation #4: es-ES exists to prove the framework works, not as a complete professional localization. The 0.7.1 backlog-fix wave completed the deep modal-step extraction (482 → 816 keys); the remaining English fallback is the long tail of low-traffic strings.                                                                                                                                     | Resolved (28c extraction complete in 0.7.1)                                                                    |
| **macOS and Linux builds are configured but UNVERIFIED.** The `electron-builder.yml` config is structurally complete for both, but no binary has been produced and launched on real hardware.                                                                                                                                                            | P7-L-1: configure all, verify Windows only — a green CI package step does not prove a binary runs, and the native-module rebuild (`better-sqlite3`, `@napi-rs/canvas` universal merge) is the riskiest unverified surface.                                                                                                                                                                                      | Phase 7.1 (real-hardware verification)                                                                         |
| **Accessibility has documented pointer-centric gaps.** Freehand annotation drawing and the drawn-signature canvas require a pointer (no keyboard equivalent for an arbitrary stroke). The rendered page raster is not narrated unless the page was OCR'd. Only Windows Narrator is tested.                                                               | These are inherently pointer-centric or image-content surfaces. As of 0.7.1 the freehand drawing surface has an accessible name (`role="application"`) that names the keyboard-operable alternative; the keyboard-accessible workflows (typed/image signatures; highlight/shape/text annotations via toolbar + Inspector; OCR to expose page text) give complete coverage. See [Accessibility](#accessibility). | Drawing surface named in 0.7.1; full keyboard stroke-authoring + NVDA/JAWS/VoiceOver/Orca are later candidates |
| **No light/dark theme toggle yet.** The Theme setting honors system colors; explicit light/dark toggles are a later-phase item.                                                                                                                                                                                                                          | Out of Phase 7 scope.                                                                                                                                                                                                                                                                                                                                                                                           | Later phase                                                                                                    |

### Phase 6 partial features

| Limitation                                                                                                                                                                                                                                                                                                                                                                                            | Why                                                                                                                                                                                                                                                                                                                                                                                     | Ships in                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **All six export formats produce valid output end-to-end (as of 0.7.1).** docx / xlsx / pptx / PNG / JPEG / TIFF all run through the production engine and write valid files. The image-export standard-font glyph defect (standard-font text came out blank) is fixed — verified from the packaged 0.7.1 binary at 25,688 dark pixels on a Helvetica/Times/Courier page (it was 0 / blank in 0.6.1). | The production pdf.js source-loader wire landed, and the font factory now reads standard-14 font + cmap bytes via `fs.readFile` on an absolute path (the earlier blank-text bug was a `file://`-URL-vs-filesystem-path ambiguity that pdf.js could not resolve).                                                                                                                        | Resolved (0.7.1 backlog-fix wave)                               |
| **ExportQueue concurrency is currently inline (runs IPC calls in line) rather than the documented FIFO queue with concurrency=1.** Two concurrent IPC requests against the same output path can race the `.export-temp` file. The handler still enforces a `queue_full` HARD CAP (default 50) — new requests beyond that count return `queue_full` immediately.                                       | Julian Wave 25 H-25.1 flagged that `ExportQueue` from `docs/architecture-phase-6.md §4.6` is documented but not implemented. Phase 6.1 ships the ~50 LOC queue module (single in-flight job + FIFO waiters + `queue_full` returned at the 50th waiter). The current inline path is correct-but-incomplete; collisions surface as `output_path_unwritable` from the atomic-rename probe. | Phase 6.1                                                       |
| **Layout-preserving conversion is best-effort.** Complex multi-column layouts, embedded vector graphics, intricate tables (especially borderless or merged-cell), decorative typography, drop caps, custom kerning, and ligatures may not convert faithfully. The text-only tier is even more reductive (flat text, no images, no tables, no headings).                                               | Algorithmic layout reconstruction from pdf.js text fragments + operator-list is inherently best-effort. Vector graphics, math equations rendered as paths, and chart elements are extracted as embedded images via page rasterization for the layout-preserving tier; the text-only tier drops them entirely.                                                                           | n/a — algorithmic floor (no plan to upgrade beyond best-effort) |
| **Borderless or merged-cell tables won't be detected.** Tables that visually exist via whitespace alignment alone produce a flat sequence of paragraphs in the Word / PowerPoint output.                                                                                                                                                                                                              | The 5-step line-grid table detector requires explicit horizontal AND vertical line segments to identify a table region. Fails-soft on diagonal-only / borderless inputs (returns ZERO `TableRegion`, NOT a wrong table).                                                                                                                                                                | n/a — algorithmic floor                                         |
| **Filled form values export as text; XFA-form values do NOT export.** Phase-3-flattened AcroForms produce inline text in the output. Unflattened AcroForms also produce text via the form-field-object fallback. XFA forms are inaccessible to pdf.js text extraction — the engine sees only the static template, not the dynamic XFA dataset.                                                        | XFA is a PDF-1.7 fork with its own XML schema; pdf.js does not expose XFA dataset values. If you need XFA values exported, save the PDF with the form flattened (`forms:flattenForExport`) first, then export.                                                                                                                                                                          | Wontfix unless explicit XFA demand surfaces                     |
| **Exporting from a signed PDF: the source signature stays valid; the exported file has no signature semantics.** Export does NOT mutate the source PDF — the cryptographic envelope on the source is untouched. The exported docx / xlsx / pptx / image has no PAdES surface (those formats either don't support PAdES or are unsigned by definition).                                                | Read-only-on-source is the Phase 6 P6-L-9 locked decision (conventions §17.1). If you need a signed Office document, sign it in Office after export.                                                                                                                                                                                                                                    | n/a — by design                                                 |
| **OCR status determines text fidelity.** If the source PDF has been OCR'd (Phase 5), text exports as native selectable text. If the source is image-only and was NOT OCR'd, the Word / PowerPoint output is mostly raster image with no selectable text.                                                                                                                                              | The engine does NOT auto-OCR before export — that would be a silent mutation of the source (it would change the source PDF's bytes, which violates the Phase 6 read-only-on-source rule and would invalidate any prior PAdES signature). Run OCR first (Phase 5), save the searchable PDF, then export.                                                                                 | n/a — by design                                                 |
| **Conversion time scales with document complexity.** Plan for ~5-30 seconds per page on the layout-preserving tier, ~0.5 seconds per page on the text-only tier. A 100-page magazine with full-color images at layout-preserving can take 30+ minutes.                                                                                                                                                | Per-page streaming pipeline: text extraction + table detection + image extraction + writer compose. Layout-preserving tier embeds images at original resolution; text-only tier omits them. Cancel button is always available; partial output cleaned up automatically on cancel via atomic `.export-temp` → rename.                                                                    | n/a — algorithmic floor                                         |
| **Hyperlinks in the source PDF do NOT export.** The output Word / Excel / PowerPoint / image carries the link's text but not the underlying URL.                                                                                                                                                                                                                                                      | Phase 6.1 candidate.                                                                                                                                                                                                                                                                                                                                                                    | Phase 6.1                                                       |
| **PDF metadata (author, subject, keywords) does NOT export.** The Word / Excel / PowerPoint output uses generic defaults.                                                                                                                                                                                                                                                                             | Phase 6.1 candidate.                                                                                                                                                                                                                                                                                                                                                                    | Phase 6.1                                                       |
| **Lossless round-trip is NOT promised.** PDF → docx → PDF would not be byte-identical or visually identical.                                                                                                                                                                                                                                                                                          | The engine extracts content into the target format's native primitives (paragraphs / cells / shapes / images); reconstructing a PDF from the exported file is a separate path.                                                                                                                                                                                                          | Wontfix                                                         |
| **No translation.** Output is in the source language(s). The engine recognizes text via pdf.js's text-extraction APIs (Phase 5 OCR's recognized text rides along when the source was OCR'd).                                                                                                                                                                                                          | The engine has no translation step. Use a dedicated tool downstream.                                                                                                                                                                                                                                                                                                                    | Wontfix                                                         |
| **Multi-page TIFF bundles into ONE file. Single-page formats (PNG / JPEG / single-page TIFF) write ONE file per page.**                                                                                                                                                                                                                                                                               | The `multi-page TIFF` checkbox is honored only when format='tiff' (silently ignored otherwise — documented behavior). PNG and JPEG always write one file per page; the filename gets a `-p001`, `-p002`, ... suffix.                                                                                                                                                                    | n/a — by design                                                 |
| **Output-path collisions surface in the modal.** If you pick an existing file path, Electron's native save-as dialog handles the overwrite prompt. If a parallel process (or a parallel export job) has touched the path between dialog and rename, the rename fails with `output_path_unwritable`.                                                                                                   | Belt-and-suspenders atomic write: engine writes to `<output>.export-temp` then renames to `<output>` on success. Phase 6.1 ExportQueue will additionally serialize concurrent export jobs targeting the same path.                                                                                                                                                                      | Phase 6.1 (queue)                                               |

### Phase 5 partial features (carried through)

| Limitation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Why                                                                                                                                                                                                                                                                                                                                              | Ships in                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| **Multi-language OCR download works (as of 0.7.1).** Bundled English plus the other 9 catalog languages (Spanish / French / German / Portuguese / Italian / Russian / Simplified Chinese / Traditional Chinese / Japanese) all download and install. v0.5.0 / v0.6.0 / v0.7.0 shipped English-only because the catalog carried `TBD-FILL-AT-RELEASE` SHA-256 sentinels for the non-bundled rows.                                                                                                           | The 0.7.1 backlog-fix wave fetched the real bytes from `tessdata.projectnaptha.com/4.0.0_fast/` and computed real SHA-256 for all 9 downloadable packs, replacing the sentinels. The integrity check itself is unchanged — the manager still refuses any download whose hash doesn't match the catalog (Wave 21 Julian B-21.1 defense-in-depth). | Resolved (0.7.1)                                                       |
| **Native WIA scanner integration is LIVE on Windows as of 0.7.3** (Phase 5.1). The Tools → Scan from device menu item is enabled on Windows with the new addon loaded; ADF multi-page composes into a single PDF that chains directly into the OCR pipeline. On macOS / Linux the channel returns `scanner_unavailable` and the menu item stays disabled. **TWAIN is NOT supported** — only WIA (the modern Windows scanner API); legacy TWAIN-only scanners may need the manufacturer's software for now. | A custom pure-Node-API COM addon (`native/wia-scanner/`) calls `IWiaDevMgr2::EnumDeviceInfo` + `IWiaTransfer::Download` directly. Pure N-API means a single binary works under Node + Electron with no two-ABI dance. Validated end-to-end against a real Xerox WIA-compliant MFP. See [Scanning from a device](#scanning-from-a-device).        | Resolved on Windows (0.7.3); macOS/Linux scanner support is later work |
| **OCR-recognized text accuracy depends on scan quality.** Low-DPI scans, faded or off-axis pages, complex layouts, decorative fonts, and CJK / Cyrillic / Arabic scripts all reduce confidence. The confidence overlay (View → Toggle OCR confidence overlay) marks words below the threshold (default 60) — review and correct as needed before relying on the output.                                                                                                                                    | Tesseract's LSTM recognizer is excellent but not perfect; we surface confidence honestly rather than hide it.                                                                                                                                                                                                                                    | n/a — physics of OCR                                                   |
| **Re-running OCR on an already-OCR'd page produces duplicate selectable text.** The engine does NOT auto-detect "this page already has a text-behind-image layer".                                                                                                                                                                                                                                                                                                                                         | The detector is a Phase 5.2+ deliverable (see R-W19-F in the Phase 5 risk register). For v0.5.0, undo the prior OCR op (Ctrl+Z) before re-running, OR open the original (pre-OCR) file.                                                                                                                                                          | Phase 5.2+                                                             |
| **CJK / Cyrillic / Arabic glyphs may copy-paste as garbled text.** The Phase 5 text-behind-image authoring uses the built-in `/Helvetica` PDF font (no font embedding). For Latin scripts this is invisible and works perfectly; for non-Latin scripts, the recognized text is searchable but copy-paste may produce wrong glyphs in some PDF readers.                                                                                                                                                     | Phase 5 doesn't embed CJK / Cyrillic / Arabic fonts in the output. Full font embedding for non-Latin scripts is a Phase 5.1+ candidate.                                                                                                                                                                                                          | Phase 5.1+                                                             |
| **OCR cannot mid-page-cancel.** The Cancel button on the running modal aborts between pages (graceful) — once a page is mid-recognition, it finishes before the cancel takes effect.                                                                                                                                                                                                                                                                                                                       | tesseract.js v7 doesn't expose a per-recognition abort signal.                                                                                                                                                                                                                                                                                   | Phase 5.1+                                                             |
| **OCR does not auto-rotate misaligned scans.** The deskew preprocessing helper handles small rotations (< 10°) but a 90° / 180° rotated scan must be rotated manually (Ctrl+R / Ctrl+Shift+R) before OCR runs.                                                                                                                                                                                                                                                                                             | Auto-detecting page orientation is a separate Tesseract feature (OSD) not wired in v1.                                                                                                                                                                                                                                                           | Phase 5.1+                                                             |
| **OCR result panel cannot rehydrate per-word data after document reopen.** The panel shows the per-doc + per-page summary across restarts (stored in `ocr_results` table), but jumping to specific words and the confidence-overlay box rendering requires the word-level JSON which is loaded into memory only during the OCR run. Reopen the doc → run OCR again to repopulate, or wait for Phase 5.1's per-page word hydration IPC channel.                                                             | M-21.5 finding (Julian Wave 21). The hydration channel is on the Phase 5.1 carry list.                                                                                                                                                                                                                                                           | Phase 5.1                                                              |
| **"Don't ask me again" on the OCR-invalidates-signatures prompt is not yet honored.** The checkbox appears in the confirm dialog but doesn't suppress the prompt on subsequent runs in v0.5.0. The confirm is non-skippable per session regardless of the checkbox state.                                                                                                                                                                                                                                  | M-21.4 finding (Julian Wave 21). The toggle is wired in Phase 5.1 once the per-session-flag semantics are finalized (see conventions §16.5 — the persistence is deliberately per-session, never permanent).                                                                                                                                      | Phase 5.1                                                              |
| **macOS / Linux packaging is config-only.** The `electron-builder.yml` profile is structurally complete, but Phase 5 verifies Windows only.                                                                                                                                                                                                                                                                                                                                                                | One platform per phase keeps the verification loop honest.                                                                                                                                                                                                                                                                                       | Phase 7                                                                |

### Phase 4 partial features (carried through)

| Limitation                                                                                                                                                                                                                                                                                 | Why                                                                                                                                                                                          | Ships in                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **You supply the PFX/P12 certificate + password.** The app does not bundle a test cert; it has no built-in "issue me a cert" flow. Self-signed certs work for testing; CA-issued certs work for production.                                                                                | Locked decision P4-L-1: cert + password NEVER persisted by the app. Bundling a test cert would imply persistence + distribution; both are out of scope.                                      | n/a — by design                                                                      |
| **Cert + password live in memory ONLY during the signing operation.** Closing the PAdES sign modal, calling `signatures:certRelease`, or quitting the app zeroes both via `Buffer.fill(0)`. There is no "remember this cert" affordance.                                                   | Locked decision P4-L-1: every PFX byte + password buffer has a deterministic finally-block zeroer. No log statement, no `.env`, no Electron-Store, no SQLite, no temp file.                  | n/a — by design                                                                      |
| **TSA timestamping is OFF by default and ships no default URL.** If you want RFC 3161 timestamps, paste a TSA URL into Settings → Signing and toggle "Enable TSA" on. The app visits the URL only at sign time.                                                                            | Locked decision P4-L-2: the app makes no per-user trust call. HTTPS only; no userinfo (`user:pass@`); no fragment; bounded query. HTTP / LAN TSA appliances are a Phase 4.1 candidate.       | Phase 4.1 (HTTP toggle if demand surfaces)                                           |
| **`signatures:verify` is informational, not third-party trust verification.** It re-hashes the signed byte-range against the local audit-log row and confirms the bytes match. It does NOT validate the cert's CA trust chain, check CRLs/OCSP, or attest to signer identity.              | Phase 4 makes no notarization claim. The local audit log is tamper-vulnerable by design — SQLite write access means any process can edit it. Phase 4.1+ may add full third-party CMS verify. | Phase 4.1+                                                                           |
| **Signing or editing a previously-signed PDF invalidates the prior signatures.** A signed PDF's byte-range hash covers the document bytes at sign time; subsequent edits change those bytes. The Forms sidebar status banner warns when the document carries already-signed `/Sig` fields. | The PDF signature spec ties the cryptographic envelope to specific bytes; any edit invalidates the hash. Out of scope to preserve prior signatures across edits.                             | Phase 5+ may add a "preserve signed bytes, append new edits as a new revision" mode. |
| **The PAdES engine is `node-signpdf` (MIT) by default; a `node-forge` + `pkijs` (MIT / BSD-3-Clause) manual fallback ships behind the same `signatures.padesEngine` setting.**                                                                                                             | Locked decision P4-L-3: both engines satisfy the same external contract; the fallback exists so we can swap if `node-signpdf` regresses upstream.                                            | Phase 4.1 (UI exposure of the engine toggle)                                         |
| **The PAdES `/Contents` placeholder defaults to 16384 hex chars (8192 bytes).** Very long certificate chains may need 32768. Configurable via Settings → Signing → Advanced → `signatures.placeholderSize`.                                                                                | The /Contents field must be large enough to hold the CMS envelope. 16384 is the conservative default per signature-engine.md §3.3.                                                           | n/a — configurable                                                                   |
| **macOS / Linux packaging is config-only.** The `electron-builder.yml` profile is structurally complete for macOS + Linux, but Phase 4 verifies Windows only. Phase 7 actually produces + tests cross-platform binaries.                                                                   | One platform per phase keeps the verification loop honest.                                                                                                                                   | Phase 7                                                                              |
| **JavaScript form actions are stripped on save** (Phase 3 P3-L-2 carries through). A warning toast surfaces on save when JS actions were present.                                                                                                                                          | Locked decision P3-L-2: JS in PDFs is a sandbox-escape attack surface.                                                                                                                       | Phase 3.1 (read-only preservation candidate)                                         |
| **Signature placeholder fields placed in Phase 3 round-trip with `/V` undefined** — Phase 4 fills them. Clicking an empty `/Sig` placeholder now opens the Signature Capture or PAdES Sign modal (your choice).                                                                            | Phase 3 laid the dict + appearance-stream groundwork; Phase 4 wires the fill.                                                                                                                | Already shipped in Phase 4                                                           |
| **Date fields show as text inputs in Acrobat.** In-app date-picker UX is renderer-side only; the underlying PDF stores ISO-8601 text plus a `/TU` hint.                                                                                                                                    | PDF spec uses JavaScript for date formatting; Phase 3 forbids JS (P3-L-2).                                                                                                                   | n/a — accepted fidelity boundary                                                     |
| **XFA forms (LiveCycle Designer) are not editable.** XFA-only documents show a banner "This PDF uses XFA forms which aren't supported"; AcroForm fields in mixed docs remain fillable.                                                                                                     | XFA is a PDF-1.7 fork with its own XML schema.                                                                                                                                               | Wontfix unless explicit demand                                                       |
| **Excel multi-sheet workbooks read sheet 1 only.** Wizard step 2 surfaces a warning when XLSX has >1 sheet.                                                                                                                                                                                | exceljs supports multi-sheet but the wizard UX is sheet-1-only in Phase 3.                                                                                                                   | Phase 3.1 (sheet picker)                                                             |
| **Excel formula evaluation is not supported.** `exceljs` reads the cached value when Excel saved it, otherwise the formula text.                                                                                                                                                           | exceljs does not run formulas; Phase 3 does not embed a formula engine.                                                                                                                      | Wontfix — paste-as-values upstream                                                   |
| **List-box fields (`PDFOptionList`) are not exposed as a distinct type.**                                                                                                                                                                                                                  | Dropdown covers the common case.                                                                                                                                                             | Phase 3.1 if demand surfaces                                                         |
| **Push-button fields are not exposed.**                                                                                                                                                                                                                                                    | Buttons in PDFs are typically JS-action triggers, which Phase 3 forbids (P3-L-2).                                                                                                            | Wontfix                                                                              |
| **Form-template fields whose font/size aren't available in the target doc may render with substitute glyphs.** A toast surfaces on template load: "Some template fields couldn't be applied (N skipped)."                                                                                  | Templates carry coords + properties, not embedded fonts.                                                                                                                                     | Phase 4 (font substitution lands then)                                               |
| **Form-design undo edge cases.** Cross-op-chain undo (e.g. add-field → remove-field → load-template) unwinds one op at a time; the per-op pattern from Phase 2 carries through. Form-fill, by contrast, commits as one batch and Ctrl+Z unwinds the whole batch.                           | History middleware is single-op-inverse for design ops; form-fill is HYBRID commit-boundary (see [developer guide](developer-guide.md#forms-architecture-phase-3)).                          | Phase 3.1 (compaction candidate)                                                     |

### Phase 2/3 limitations that carry through

| Limitation                                                                                                                                                                              | Ships in                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Text editing is replace-only with the original font (no reflow, no font substitution, no multilang shaping); `clipped` / `missing_glyph` errors on too-wide or unsupported replacements | Phase 5+                                       |
| TIFF imports use the first page only                                                                                                                                                    | Phase 5+ candidate                             |
| Bookmarks are scoped to a single file (cross-file navigation not supported)                                                                                                             | Phase 5+                                       |
| No in-app print preview pane                                                                                                                                                            | Phase 5+ (re-prioritized)                      |
| `pdf:identifyTextSpan` real content-stream walker is stubbed (renderer-cached metrics carry the UX)                                                                                     | Phase 5 absorb                                 |
| `MoveBookmarkResult` `invalid_parent` surfaces as `invalid_payload` on the wire                                                                                                         | Phase 5 absorb                                 |
| Chromium engine produces non-deterministic bytes; forms / signatures / embedded JavaScript are flattened in Chromium output                                                             | n/a (force `pdf-lib` for deterministic output) |
| XFA forms (LiveCycle Designer) are not editable; mixed AcroForm + XFA docs surface a banner                                                                                             | Wontfix unless demand surfaces                 |
| Excel multi-sheet workbooks read sheet 1 only                                                                                                                                           | Phase 3.1 candidate                            |
| Excel formula evaluation is not supported (`exceljs` cached-value only)                                                                                                                 | Wontfix — paste-as-values upstream             |

### Coming in Phase 6.1 / 7

| Feature                                                                                                   | Ships in                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Word / PowerPoint / image-format exports wired to the production pdf.js source-loader~~                 | **DONE in 0.7.1** — all six formats produce valid output                                                                                    |
| ~~Non-English language pack download~~                                                                    | **DONE in 0.7.1** — all 9 downloadable languages have real SHA-256                                                                          |
| ExportQueue FIFO module (concurrency=1; `queue_full` at the 50th waiter) replaces the current inline path | later follow-up                                                                                                                             |
| Hyperlinks in source PDF → hyperlinks in exported Word / Excel / PowerPoint                               | later follow-up                                                                                                                             |
| PDF metadata (author, subject, keywords) → exported Office file metadata                                  | later follow-up                                                                                                                             |
| ~~Native WIA scanner integration~~                                                                        | **DONE in 0.7.3 (Windows)** — custom pure-Node-API COM addon (`native/wia-scanner/`); see [Scanning from a device](#scanning-from-a-device) |
| Per-page word-data rehydration on document reopen (full overlay + page-jump after restart)                | Phase 5.1                                                                                                                                   |
| Mid-page OCR cancellation                                                                                 | Phase 5.1+                                                                                                                                  |
| OCR auto-detect-already-OCR'd                                                                             | Phase 5.2+                                                                                                                                  |
| CJK / Cyrillic / Arabic font embedding in text-behind-image output                                        | Phase 5.1+                                                                                                                                  |
| Text editing with reflow + font substitution + multilang shaping                                          | Phase 7+                                                                                                                                    |
| Cross-file bookmark navigation                                                                            | Phase 7+                                                                                                                                    |
| Dark mode + accessibility audit + localization                                                            | Phase 7                                                                                                                                     |
| Full third-party PAdES verification (cert chain + CRL/OCSP)                                               | Phase 4.1+                                                                                                                                  |
| macOS / Linux builds                                                                                      | Phase 7                                                                                                                                     |
| Auto-update                                                                                               | Phase 7                                                                                                                                     |
| Code signing                                                                                              | Phase 7+                                                                                                                                    |

---

## PAdES trust floor — what the app does and doesn't promise

This is the Phase 4 honesty banner. Same shape as the Phase 1 walking-skeleton banner ("Save does not yet preserve your edits"), then the Phase 2 retirement ("Save preserves your edits"), then the Phase 3 forms banner (JS strip / XFA read-only / signed-fields invalidated). The shape is the same; the obligations are new. **Read this before signing anything you care about.**

The Settings → Signing pane surfaces these obligations again, and they appear inline at every PAdES-touching section of this guide. The trust-floor pattern: you read the warning before the operation, you know exactly what will land on disk, and you make an informed choice.

### The four Phase 4 obligations

1. **Signing a previously-signed PDF will invalidate the prior signatures.** The PDF signature spec ties the cryptographic envelope to specific bytes in the file. Any edit — including placing a new signature on top — changes those bytes and invalidates the prior signature's byte-range hash. The Forms sidebar status banner warns when a document carries already-signed `/Sig` fields. If you need to add a signature WITHOUT invalidating existing ones, this is out of scope for Phase 4; the Phase 5+ "append as new revision" mode is the future path.

2. **Cert + password are held in memory only and zeroed on release.** When you load a PFX/P12 certificate in the PAdES sign modal, the bytes + password are read into main-process memory, used to compute the signature, and then both buffers are explicitly zeroed via `Buffer.fill(0)` in a `finally` block — on success AND every failure path. Closing the modal calls `signatures:certRelease` immediately. Quitting the app fires the same release for any retained handle. There is no "remember this cert" affordance, no Settings entry, no SQLite row, no log statement that ever sees the password. Locked decision P4-L-1.

3. **TSA URLs you configure are visited only at sign time; the app ships with no default TSA.** RFC 3161 timestamping is disabled by default. If you paste a TSA URL into Settings → Signing and toggle "Enable TSA" on, the URL is stored in the SQLite settings table (NOT the cert; just the URL string). The TSA is contacted ONLY when you click Sign on the PAdES wizard's step 3 — there is no background traffic, no health-check, no allowlist. URL validation is strict: HTTPS only, no `user:pass@` credentials, no fragment, bounded query string. The app does NOT validate the TSA's trust chain or audit who operates the service; that's your call. Locked decision P4-L-2.

4. **PAdES verification is informational and trusts the local audit log.** The `signatures:verify` channel re-hashes the signed byte-range against the local `signature_audit_log` row written at sign time and confirms the document bytes match what was originally signed. It does NOT validate the cert's CA trust chain, check CRLs/OCSP for revocation, or attest to the signer's identity. The audit log is a local SQLite table; anyone with write access to `%APPDATA%/PDF Viewer & Editor/db.sqlite` can edit it. The app makes **no notarization claim**. A third-party PAdES verifier (Adobe Reader DC, EU DSS, open-source DSS) is the authoritative validator if you need legal-grade verification.

### What the trust floor IS

- A statement that the app's promises are the operations you can verify by reading the source code: it signs what you tell it to sign, with the cert + password you supply, and writes the result to disk.
- A statement that the app's discipline (zero-on-finally, no-persist, no-log) is enforced by tests + Julian's Wave 17 mechanical greps.
- A reference for the [api-contracts.md §14](api-contracts.md) channels' security stance.

### What the trust floor IS NOT

- A notarization service.
- A CA. The app does not issue, distribute, or validate certificates.
- A TSA broker. The app does not run, recommend, or vet TSA services.
- A revocation checker. The app does not consult CRLs or OCSP.

If any of those is required for your use case, use a CA-issued cert + a reputable TSA, sign with this app, and then re-validate the result in a tool that performs the chain validation you need.

---

## OCR trust floor — what the app does and doesn't promise

This is the Phase 5 honesty banner. Same shape as the Phase 4 PAdES trust floor and the Phase 3 forms status banner. **Read this before running OCR on anything important.**

The four Phase 5 obligations appear here in full, again as inline reminders at every OCR-touching section ([Running OCR](#running-ocr), [Manage language packs](#manage-language-packs), [OCR confidence overlay](#ocr-confidence-overlay), [OCR results panel](#ocr-results-panel), [Settings → OCR](#settings)). Reading the warning before the operation, you know exactly what will land on disk, and you make an informed choice.

### The four Phase 5 obligations

1. **OCR text accuracy depends on scan quality; low-confidence words may be incorrect.** Tesseract.js is an excellent open-source OCR engine, but no OCR is perfect on real-world scans. Low-DPI input, faded ink, off-axis pages, complex layouts, handwriting, and non-Latin scripts all reduce confidence. The app surfaces this honestly: every word carries a 0–100 confidence score; the [confidence overlay](#ocr-confidence-overlay) highlights words below the threshold (default 60) in orange so you can spot them. **Review and correct critical text before trusting OCR output for downstream use.** A word at 95 confidence is "very likely correct, but not guaranteed"; a word at 61 confidence is "barely above the threshold — review anyway".

2. **OCR runs locally; no cloud upload; language packs download from `tessdata.projectnaptha.com` on first use only.** Tesseract.js runs entirely in the main Electron process. No document bytes leave the machine at recognition time. The ONLY network traffic the OCR feature produces is when you explicitly click **Download** in the language pack manager (and only for non-bundled packs). English is bundled in the installer and requires no network. Once a pack is downloaded (or bundled), OCR runs offline for that language. The catalog file shipped with the app is `src/main/pdf-ops/language-pack-catalog.json` and lists exactly the URLs the engine will visit; you can inspect it yourself. (In v0.5.0 only the bundled English path is exercised — non-English download is gated; see [Manage language packs](#manage-language-packs).)

3. **OCR-extracted text becomes part of the saved PDF and cannot be silently un-applied.** When you Save after OCR, the invisible text-behind-image layer is written into each affected page's `/Contents` stream. The recognized text is now part of the file bytes. If you Save As to a new path, the OCR text rides along. If you want to revert to the original (non-OCR'd) bytes, the safe path is to undo the OCR op (Ctrl+Z) BEFORE saving, OR open the original file from disk and continue from there. There is no "remove OCR layer" command in v0.5.0; that's a Phase 5.1+ candidate.

4. **Re-running OCR adds another text layer; multiple passes may produce duplicate selectable text.** The engine does not auto-detect "this page already has a text-behind-image layer". If you OCR a page twice, the saved PDF contains TWO overlapping invisible text layers — every word is selectable twice, and Find will return both hits. If you need to retry recognition (e.g. with a different language pack or different preprocessing options), undo the prior OCR op (Ctrl+Z) before re-running, OR start from the original pre-OCR file.

### Two cross-cutting obligations from Phase 4

5. **Running OCR on a PAdES-signed PDF invalidates the prior signatures.** Recognition changes the bytes of every affected page; the byte-range hash any prior PAdES signature covered no longer matches. The OCR modal pre-flight surfaces a non-skippable confirm prompt when prior signatures are present — "This PDF has N cryptographic signature(s). Running OCR will invalidate them. Continue?" If you proceed, the engine writes `invalidated_by_ocr_job_id` into the affected `signature_audit_log` rows so the trail is preserved (visible in the [Signature audit panel](#signature-audit-panel) as "Invalidated by OCR (job #N)"). This is the same Phase 4 invalidate-on-edit discipline carried into Phase 5; see [PAdES trust floor obligation #1](#the-four-phase-4-obligations).

6. **The OCR job log is local and tamper-vulnerable, same as the signature audit log.** Every OCR run inserts rows into the `ocr_jobs` + `ocr_results` tables at `%APPDATA%/PDF Viewer & Editor/db.sqlite`. The data is local-only — it does not phone home, does not export by default — but anyone with write access to the SQLite DB can edit it. The app makes no integrity claim about the audit-log rows themselves.

### What the OCR trust floor IS

- A statement that what you click is what the engine does: it OCRs the pages you ask it to OCR, writes the invisible text layer to disk on Save, and emits per-word confidence so you can audit the output.
- A statement that no network call happens at recognition time. The only outbound traffic is explicit pack downloads.
- A statement that the bundled English pack is the SHA-256 hash listed in `language-pack-catalog.json`; tampering would fail integrity verification before the pack is used.

### What the OCR trust floor IS NOT

- A claim that recognized text is publication-quality. Review confidence before you rely on the output.
- A translation service. Tesseract recognizes characters in the language pack you select; it does NOT translate.
- A layout-reconstruction service. The recognized words sit at their image positions; copy-pasting a column may interleave with the adjacent column. Phase 6 export-to-DOCX is where layout-aware reflow lives.
- A tamper-proof audit log. The `ocr_jobs` + `ocr_results` + `signature_audit_log` tables can be edited by anyone with write access to the SQLite DB.

If any of those is required for your use case, run OCR with this app to get a searchable PDF, then use a dedicated translation or layout-reconstruction tool downstream.

---

## Export trust floor — what the app does and doesn't promise

This is the Phase 6 honesty banner. Same shape as the Phase 5 OCR trust floor, the Phase 4 PAdES trust floor, and the Phase 3 forms status banner — preamble at the top of this guide + this dedicated section + inline reminders at every Phase-6-touching section + the README's known-limitations bullets + the per-format limitations panel inside the Export modal itself. Five locations, the same obligations every time. **Read this before exporting anything you care about.**

The Settings → Export pane surfaces these obligations again, and they appear inline at every Phase-6-touching section of this guide ([Exporting to Office and images](#exporting-to-office-and-images), [Choosing a quality tier](#choosing-a-quality-tier), [Per-format options](#per-format-options), [Exports sidebar](#exports-sidebar), [Status-bar progress widget](#status-bar-progress-widget), [Settings → Export](#settings)). You read the warning before the operation, you know exactly what will land on disk, and you make an informed choice.

### The five Phase 6 obligations

1. **PDF → Office conversion is layout-preserving best-effort.** Complex multi-column layouts, embedded vector graphics, intricate tables (especially borderless or with merged cells), and decorative typography may not convert faithfully. The fast `text-only` tier is even more reductive — it produces accurate text in a flat structure with no images, no tables, no headings. Users should review the output before relying on it for downstream work.

2. **Borderless or merged-cell tables may not be detected.** The line-grid table detector requires explicit horizontal AND vertical line segments to identify a table region. Tables that visually exist via whitespace alignment alone produce a flat sequence of paragraphs in the Word / PowerPoint output. The detector fails-soft (returns ZERO `TableRegion` on diagonal-only / borderless inputs, NOT a wrong table) — the trade is "honest no table" versus "fabricated wrong table".

3. **Filled form values export as text; XFA-form values do NOT export.** Phase-3-flattened AcroForms produce inline text in the output. Unflattened AcroForms also produce text via the form-field-object fallback. **XFA forms (Phase 3 read-only) do NOT export their values** — the engine sees only the static template, not the dynamic XFA dataset. If you need XFA values, flatten the form first (`forms:flattenForExport` from the Phase 3 surface) before exporting.

4. **Exporting from a signed PDF: the source signature stays valid; the exported file has no signature semantics.** Export does NOT mutate the source PDF. The PAdES signature on the source remains valid (verifiable in Acrobat or the app's signature verify panel). The exported docx / xlsx / pptx / image has NO signature — these formats either don't support PAdES (docx, xlsx, pptx) or are unsigned by definition (images). Users who need a signed Office document must sign it in Office after export (out-of-scope for this app).

5. **OCR-status determines text fidelity.** If the source PDF has been OCR'd (Phase 5), text exports as native selectable text. If the source is image-only and was NOT OCR'd, the Word / PowerPoint output is mostly raster image with no selectable text. **The engine does NOT auto-OCR before export** — that would be a silent mutation of the source. The Export modal step 1 surfaces a reminder when the source has no detectable text layer; click Cancel, run [OCR](#running-ocr) first, save, then re-open the Export modal.

### Cross-cutting reminder

> **Export job duration depends on document complexity.** Conversion may take 5-30 seconds per page on the layout-preserving tier and ~0.5 seconds per page on the text-only tier. A 100-page magazine with full-color images can take 30+ minutes. The cancel button is always available; partial output is cleaned up automatically (atomic `.export-temp` → rename; the temp file is unlinked on cancel).

### What the Export trust floor IS

- A statement that the export operation reads from the source PDF without mutating it. The source's bytes on disk are unchanged before and after; the source's PAdES signature stays valid; the source's `signature_audit_log` rows are NOT updated.
- A statement that the output file is written atomically (write-temp → rename) so partial output is cleaned up on cancel.
- A statement that all four output formats are valid per their respective specs (docx = OOXML; xlsx = OOXML; pptx = OOXML; png / jpeg / tiff = standard image formats). The exported files open in Microsoft Word / Excel / PowerPoint without further conversion.
- A statement that per-format defaults follow the locked decisions (P6-L-1 Q-D): layout-preserving for Word + PowerPoint; text-only for Excel; PNG default for image formats.
- A statement that cancel during export deletes the partial output (no orphan `.export-temp` files left behind).

### What the Export trust floor IS NOT

- A faithful-conversion guarantee for decorative typography (drop caps, custom kerning, ligatures, intricate justified layout).
- A faithful-conversion guarantee for vector graphics (charts, diagrams, math equations rendered as paths). Vector graphics are extracted as embedded images via page rasterization for the layout-preserving tier; the text-only tier drops them entirely.
- A hyperlink-preservation guarantee in v0.6.0 (Phase 6.1 candidate).
- A metadata-preservation guarantee — the exported Office file uses generic author / subject / keywords defaults (Phase 6.1 candidate).
- A round-trip guarantee — PDF → docx → PDF would not be byte-identical or visually identical.
- A translation service — output is in the source language(s).
- A signing service — the exported docx / xlsx / pptx / image is unsigned. Sign it in Office after export if needed.

If any of those is required for your use case, run the export to get the Office / image file, then post-process it in a dedicated tool (Word for hyperlink-rewrite + metadata-fill, a CA-issued cert in Office for signing, etc.).

---

## Phase 7 trust floor — what the app does and doesn't promise

This is the Phase 7 honesty banner — the **sixth instance** of the project's trust-floor pattern (after the Phase 1 walking-skeleton "Save doesn't preserve edits" banner, the Phase 3 forms status banner, the Phase 4 PAdES trust floor, the Phase 5 OCR trust floor, and the Phase 6 Export trust floor). Same shape every time: the [top-of-guide preamble](#user-guide--pdf_viewer_editor-070-phase-7), this dedicated section, inline reminders at every Phase-7-touching section, the [README known-limitations](../README.md#roadmap-status), and the load-bearing UI surfaces themselves (the Settings telemetry privacy copy, the locale-picker subtext, the About update-status notice). The obligations are new; the discipline of telling you the truth before you act is unchanged. **Read this before opting into telemetry, checking for updates, switching to Spanish, or running a non-Windows build.**

The Settings → General pane surfaces these obligations at the point of action, and they appear inline at every Phase-7-touching section of this guide ([Changing the interface language](#changing-the-interface-language), [Telemetry and privacy](#telemetry-and-privacy), [Checking for updates](#checking-for-updates), [The About modal](#the-about-modal), [Accessibility](#accessibility), [Settings → General](#settings)). You read the limit before the operation, you know exactly what the app will and won't do, and you make an informed choice.

### The four highest-stakes Phase 7 obligations

1. **Telemetry is OFF by default.** When you enable it, it records **anonymous feature-usage counts only** — never document content, never file paths, never personal information. **Nothing leaves your machine at all**: the transport is an in-memory buffer that you can read in full via the debug panel. There is no analytics endpoint, no third-party SDK (no Google Analytics, no Sentry, no PostHog), and no `telemetry_events` table in the database. The absence of personal data is enforced _structurally_ — the event shape physically cannot carry a name, path, or value beyond an event name and a day bucket (see [Telemetry and privacy](#telemetry-and-privacy)).

2. **The auto-update channel is real (since 0.7.2); the install path needs a code-signing certificate.** The update client is wired to the live `SuperiorAg/PDF_Viewer_Editor` GitHub release feed (`releaseType: draft` for publish safety — each release is created as a draft and a human promotes it to live). When you click "Check for updates", the app contacts that live feed and reports the honest result: **"You're up to date"**, **"Update available: vX.Y.Z"**, or a real network/feed error (e.g. an unpromoted draft returns 404). The app never claims a status it didn't actually observe. **However, `electron-updater` correctly refuses to _apply_ an unsigned bundle** — until a Windows code-signing certificate is acquired, the check + download paths work but the install path returns an error. See [Checking for updates](#checking-for-updates).

3. **macOS and Linux builds are UNVERIFIED.** The build configuration for both platforms ships in 0.7.0, but **no macOS or Linux binary has been produced and launched on real hardware.** They are produced by the build config and have not been tested on real machines. Native modules (the database, the canvas raster pipeline) may fail to load on these platforms until a maintainer verifies on a real host. Real-hardware verification is the headline Phase 7.1 work item — see [README → Platform support](../README.md#platform-support).

4. **Spanish (es-ES) is a translation sample, not a complete localization.** It exists to prove the localization framework works — roughly 68% of strings are translated (the 0.7.1 backlog-fix wave grew the baseline to 816 keys and extended Spanish into the deep modal steps); **the rest remain in English** (they fall back gracefully, so you never see a raw key). It is **not** a complete professional translation. The locale picker labels it honestly: "translation sample, some strings may appear in English" (see [Changing the interface language](#changing-the-interface-language)).

### Two more Phase 7 disclosures

5. **Accessibility is audited to WCAG 2.1 AA for the critical paths, with documented gaps.** Keyboard navigation and screen-reader support (Windows Narrator) cover the critical paths. Freehand annotation drawing and the drawn-signature canvas are inherently pointer-centric and have no keyboard equivalent; the rendered page raster is not narrated unless the page was OCR'd; only Narrator is tested. The keyboard-accessible alternatives provide complete workflows. See [Accessibility](#accessibility).

6. **A code-signing certificate is the user's real-world step.** Auto-update requires a code-signing certificate to apply updates in production; acquiring it is a manual real-world step (Phase 7.1). Until then, even on a real channel, downloaded updates cannot be applied — and the Windows SmartScreen / macOS Gatekeeper warnings on first launch are the cost of an unsigned binary.

### What the Phase 7 trust floor IS

- A statement that telemetry is opt-in (default OFF), anonymous, counts-only, and stays on your machine — verifiable by opening the debug panel and seeing exactly what (if anything) is buffered.
- A statement that the update client reports its real state — "not configured" when the publish target is a placeholder, never a fabricated "up to date".
- A statement that the locale you pick persists and switches the UI live, and that a missing Spanish string falls back to English (never a broken key).
- A statement that the critical-path keyboard + Narrator workflows are audited to WCAG 2.1 AA.
- A statement that Windows is the verified platform; macOS + Linux are configured but unverified.

### What the Phase 7 trust floor IS NOT

- **NOT** an analytics or crash-reporting service. Nothing is sent anywhere in 0.7.0.
- **NOT** a working auto-update. The publish target is a placeholder; no real update will ever download until it is configured, and a cert is needed to apply one.
- **NOT** a verified cross-platform release. A macOS or Linux build from this source has not been launched on real hardware and may not run.
- **NOT** a complete Spanish localization. It is a sample to prove the framework.
- **NOT** a guarantee of full accessibility for pointer-centric surfaces (freehand drawing, drawn signatures) or non-Narrator screen readers.

If any of those is required for your use case, the path is the same honest one as every prior phase: the framework is in place and ready, but the real-world wiring (a published release channel, a signing cert, a verified non-Windows host, a complete translation, a network telemetry endpoint) is a deliberate, disclosed follow-up — never silently faked.

---

## Quick start — open your first PDF in three steps

If this is your first launch, the quickest path to a useful result:

1. **Open a PDF.** Click **Open PDF…** in the empty-state card, OR drag any `.pdf` from File Explorer onto the window, OR press **Ctrl+O**. The first page renders in the main canvas; the thumbnail strip appears on the left.
2. **Navigate.** **Ctrl+wheel** zooms (fluid, horizontally centered, no per-tick stutter); **Page Up / Page Down** moves between pages; **Home / End** jumps to the first / last page. Click any thumbnail in the left sidebar to jump directly to that page.
3. **Edit or annotate.** Press **H** for highlight, **S** for sticky note, **T** for a text box. Drag thumbnails to reorder pages; right-click a thumbnail for the page-operations menu (Insert blank / Delete / Rotate). Press **Ctrl+S** to save when you're done — your edits are written to disk via the atomic edit-replay engine. **Ctrl+Z** undoes the last operation.

That's the walking-skeleton workflow. Everything else — forms, mail merge, signatures, OCR, scanning, export to Office — sits behind toolbar buttons, the Tools menu, and the keyboard shortcuts table in [Keyboard shortcuts (full list)](#keyboard-shortcuts-full-list).

### Where to find things

| What you want to do                         | Where in the app                                                                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open a PDF                                  | **File → Open** (Ctrl+O), drag-drop, or **File → Open Recent**                                                                                                                                                           |
| Read it (zoom / pages / thumbnails)         | The viewer canvas + left thumbnail strip + status-bar zoom dropdown                                                                                                                                                      |
| Add a highlight or sticky note              | Toolbar tools, or **H** / **S** shortcuts; edit in the Inspector on the right                                                                                                                                            |
| Reorder / delete / rotate pages             | Drag thumbnails, or right-click a thumbnail → page-operations menu                                                                                                                                                       |
| Combine multiple PDFs                       | **Toolbar → Combine**, or **File → Combine PDFs…**                                                                                                                                                                       |
| Fill a form                                 | **Forms** tab in the left sidebar (lights up when the doc has fields)                                                                                                                                                    |
| Design a new form                           | **Ctrl+Shift+F** toggles Form Designer mode                                                                                                                                                                              |
| Mail merge                                  | **Ctrl+M** or **Tools → Mail Merge**                                                                                                                                                                                     |
| Sign cryptographically (PAdES)              | **Tools menu → Sign with PAdES**, or **Toolbar → PAdES Sign**                                                                                                                                                            |
| Add a visual signature only                 | **Tools menu → Capture signature**, or **Toolbar → Visual Sign**                                                                                                                                                         |
| Run OCR on a scanned PDF                    | **Tools menu → Run OCR…**, or **Ctrl+Shift+R**                                                                                                                                                                           |
| Scan from a connected scanner (Windows)     | **Tools menu → Scan from device…** (Windows only; disabled elsewhere)                                                                                                                                                    |
| Export to Word / Excel / PowerPoint / image | **Tools menu → Export**, **Toolbar → Export**, or **Ctrl+Shift+E**                                                                                                                                                       |
| Print                                       | **Ctrl+P** or **File → Print**                                                                                                                                                                                           |
| Export current document to a new PDF        | **Ctrl+Shift+P** or **File → Print to PDF**                                                                                                                                                                              |
| Save                                        | **Ctrl+S** (Save) / **Ctrl+Shift+S** (Save As)                                                                                                                                                                           |
| Settings                                    | **Ctrl+,** or **File → Settings**                                                                                                                                                                                        |
| Change UI language to Spanish               | **Settings → General → Interface language**                                                                                                                                                                              |
| Check for updates                           | **Help → About → Check for updates now**                                                                                                                                                                                 |
| In-app help / shortcuts                     | **F1** opens the Help modal — a 13-section reference (Getting started / Navigation / Editing pages / Annotations / Forms / Signing / OCR / Scanning / Export / Combine / Settings / Troubleshooting / About) as of 0.7.6 |

### Tips for first-time users

- **The viewer is read-mostly-then-edit.** Open a PDF, scroll through it, then enter edit mode (toolbar tool, or **Ctrl+E** for text-edit, or **Ctrl+Shift+F** for Form Designer). Edits are queued in memory until you **Ctrl+S** to save. Every edit is undoable with **Ctrl+Z** before save; after save, your edits are part of the file on disk.
- **The Tools menu is the discovery surface.** Everything not on the toolbar lives there: Capture signature, Sign with PAdES, Calibrate measurement, Run OCR, Manage language packs, Scan from device, Export, Mail Merge. If you can't find something in the toolbar, check Tools.
- **The sidebar tabs are stacked deep:** Pages (thumbnails), Bookmarks, Forms, OCR Results, Exports, Annotations. The Forms tab lights up automatically when the doc has fields; the OCR Results tab lights up after a run; the Exports tab lights up while a job is in flight.
- **Read the trust-floor banner** at the top of this guide before relying on signing, OCR, export, telemetry, auto-update, or a non-Windows build. Each feature has documented limits at the point of action — the app is built to tell you the truth, not to surprise you.
- **Settings persist** to `%APPDATA%/PDF Viewer & Editor/db.sqlite`. Recents, bookmarks, form templates, signature audit log, OCR job history, and export job history all live in that file. Delete it only if you want to reset (the user-data PDF files on disk are not touched by a DB reset).

---

## Opening a PDF

When you first launch the app, you see the **empty state** — a centered card with two options:

- **Open PDF…** — opens a native file picker. Selection is one file at a time; use the [Combine](#combining-pdfs) flow to merge.
- **Drag a PDF here** — drop any `.pdf` from File Explorer or your desktop onto the window.

Both routes do the same thing: main reads the file into memory, computes a fingerprint hash, registers a document handle, records the file in the recents list, and tells the renderer to render page 1.

### From the recents menu

After you've opened at least one file, **File → Open Recent** lists the last 20 files you opened. Click any entry to reopen. Recents persist across app restarts (stored in SQLite at `%APPDATA%/PDF Viewer & Editor/db.sqlite`).

Entries are dimmed if the file no longer exists at the recorded path (e.g. you moved or deleted it). Click **Clear recents** at the bottom of the list to wipe history.

### File size and validity

- The default maximum file size is **500 MB** (configurable in [Settings](#settings)).
- The app validates the `%PDF-` magic header before accepting the file. Non-PDF files surface a "Not a PDF" toast.
- Encrypted/password-protected PDFs that pdf.js cannot load surface a "Failed to open" toast. Phase 2 has no password prompt; that's a future ticket.

---

## Navigating a document

Once a document is open, the main viewer takes the center of the window. The **thumbnail strip** is on the left, the **inspector** is on the right (collapsed by default).

### Zoom and pan

| Action        | Shortcut   | Mouse                        |
| ------------- | ---------- | ---------------------------- |
| Zoom in       | **Ctrl++** | **Ctrl+wheel up**            |
| Zoom out      | **Ctrl+-** | **Ctrl+wheel down**          |
| Reset to 100% | **Ctrl+0** | —                            |
| Fit width     | **Ctrl+1** | —                            |
| Fit page      | **Ctrl+2** | —                            |
| Pan           | —          | Click and drag on the canvas |

The current zoom is displayed in the status bar at the bottom of the window. The dropdown is editable: pick from the preset list (50% / 75% / 100% / 125% / 150% / 200% / 400%), type a custom percentage, or use Fit width / Fit page.

#### Viewer polish (new in 0.7.4)

Three closely-related fixes shipped in 0.7.4 to make the viewer feel right on a high-DPI laptop screen:

- **Crisp HiDPI text.** The page raster is now `devicePixelRatio`-aware with an offscreen double-buffer. At DPR 1.5 a CSS-110-px page box uses a 165-px backing store (= `round(110 × 1.5)`), so glyph edges are anti-aliased at the screen's native resolution. Before 0.7.4, the raster was 1× the CSS box regardless of DPR — text looked blocky on Retina-class displays. (Verified at the packaged binary — see the v0.7.4 build-report entry.)
- **Fluid Ctrl+scroll zoom (no per-tick re-raster).** Rolling the wheel with Ctrl held drives a two-tier `displayZoom` CSS transform — the page scales _visually_ on the GPU instantly (`matrix(1.61051, ...)` for six 1.1× ticks, e.g.), and pdf.js re-rasters the page **once** when the gesture ends (a 120ms debounce coalesces the burst). No more per-tick stutter or snap-back; the transform returns to identity (`matrix(1,...)`) on commit and the layout box is re-sized at the new committed zoom.
- **Horizontally centered during zoom.** The `transformOrigin` is fixed at `50% 0` (= 50% of page width, vertical top). The page expands and contracts around its horizontal center; the part of the page you were reading stays where you were reading. Before 0.7.4 the transform-origin defaulted to top-left and the page drifted off-center mid-gesture.
- **Synced zoom dropdown.** The status-bar zoom dropdown updates to the committed percentage when the gesture ends (e.g. 100% → 177% after six ticks). Mid-gesture it shows the previous committed value rather than the in-flight transform — deliberate, so the dropdown is a stable anchor not a flickering counter.

These changes do not require any user action; they are passive. If you experience zoom that feels different from the description above (per-tick re-rasters, blocky text, snap-back to the top-left, dropdown staying at 100%), you may be on a build older than 0.7.4 — check **Help → About** for the version.

#### Cursor-anchored zoom (new in 0.7.6)

0.7.6 layered cursor anchoring on top of the 0.7.4 fluid zoom: the point under the cursor stays put across the gesture. Before 0.7.6, the page expanded around its horizontal midline (good — no off-center drift), but the part of the page you were pointing at could still scroll out of view at high zoom levels. As of 0.7.6, the wheel-tick handler captures a cursor anchor every tick (mouse position + scroller scrollLeft/Top + page-local pixels under the cursor) and the page transform-origin is rewritten per frame to that anchor for the cursor page only (other pages keep their `'50% 0'` origin). On commit (120ms after the last wheel tick), a layout-effect ratio-comp writes `scrollLeft / scrollTop = oldValue * (newZoom / oldZoom)` so the anchor stays put. Practical effect: hover over a specific table cell or figure, ctrl+wheel up six ticks, and that exact cell stays under your cursor at 177% — no need to re-scroll. Verified at the packaged binary at 100% → 133%. If you don't see this behavior, you may be on a build older than 0.7.6.

### Page navigation

| Action         | Shortcut                                                                    |
| -------------- | --------------------------------------------------------------------------- |
| Previous page  | **Page Up**                                                                 |
| Next page      | **Page Down**                                                               |
| First page     | **Home**                                                                    |
| Last page      | **End**                                                                     |
| Jump to page N | Click the page-number field in the status bar, type the number, press Enter |

You can also click any thumbnail in the left sidebar to jump to that page.

### Thumbnails

The left sidebar shows a thumbnail strip with one tile per page. Click to navigate. Drag thumbnails to reorder pages (see [Editing pages](#editing-pages)). Right-click a thumbnail to open the **Page operations** menu (Insert blank before/after, Delete, Rotate).

Switch the sidebar between **Thumbnails** and **Bookmarks** with the tab buttons at the top of the sidebar, or cycle with **Tab** when the sidebar is focused.

---

## Editing pages

Page edits live in memory, run through the undo stack, and are written into the saved bytes on Save. The edit-replay engine handles rotations, deletions, reorders, insert-blanks, image inserts, text replacements, and overlay placements — see [Saving](#saving) for the round-trip story.

### Reorder

Drag a thumbnail in the sidebar to a new position. The viewer updates immediately and the document is marked modified (`*` indicator in the status bar). On Save, the engine re-emits the page tree in the new order.

To reorder multiple pages, hold **Ctrl** while clicking thumbnails to multi-select, then drag the selection. Hold **Shift** to extend a range. **Ctrl+A** selects every page.

### Insert a blank page

Right-click any thumbnail and choose **Insert blank before** or **Insert blank after**. The new page inherits the dimensions of the page you right-clicked.

### Delete

Select one or more thumbnails and press **Delete** (or right-click → **Delete page**). The selection collapses to the next remaining page. Use **Ctrl+Z** to undo — Phase 2 restores deleted original pages byte-for-byte by re-copying from the original document bytes (kept in main per the Phase 2 lynchpin design).

### Rotate

| Action                       | Shortcut         |
| ---------------------------- | ---------------- |
| Rotate 90° clockwise         | **Ctrl+R**       |
| Rotate 90° counter-clockwise | **Ctrl+Shift+R** |

Acts on the currently selected page(s). Each press applies an incremental 90° rotation; four presses returns to the original orientation.

### Undo and redo

| Action | Shortcut                       |
| ------ | ------------------------------ |
| Undo   | **Ctrl+Z**                     |
| Redo   | **Ctrl+Y** or **Ctrl+Shift+Z** |

Undo unwinds the most recent operation: rotate, delete, insert, reorder, annotation add/edit/delete, image import, text replace, or bookmark op. Phase 2 limitation: each undo press unwinds exactly one op. Compaction of multi-step sequences into a single undo step is Phase 3.

---

## Combining PDFs

Use **Toolbar → Combine** or **File → Combine PDFs…** to merge two or more files into a new document. **Functional end-to-end as of 0.7.6** — earlier 0.7.x binaries surfaced a "Combine failed" toast because the renderer was calling a Phase-1 `not_implemented` stub; the real pdf-lib engine + `dialog:pickPdfFiles` channel shipped in 0.7.6 (H-30.1 closure).

The **Combine** modal lets you:

1. Click **Add files…** to open a multi-select file picker. Add as many files as you want (minimum 2). Re-picking a file you already added is silently de-duplicated by absolute path — no duplicate rows.
2. Reorder the source list by dragging entries up and down.
3. Optionally specify a page range per source (e.g. "pages 3–5 only").
4. Click **Combine**.

Main loads each source via pdf-lib, concatenates the requested page ranges into a fresh document, and opens the result in the viewer as a new document called "Combined Document.pdf". You can then Save As to write it to disk; the saved bytes contain the full combine result. Per-source errors map honestly to user-facing toasts: `'fs_read_failed'` (file can't be read from disk), `'pdf_load_failed'` (file isn't a valid PDF), `'invalid_page_range'` (the page range you typed is out of bounds for that source), and `'no_pages'` (every source contributed zero pages — typically a corrupt input).

> **Trust-floor note.** Document-level JavaScript actions, `/OpenAction`, and AcroForm objects from any source are stripped automatically (the merge copies the page tree only — those entries live at the source catalog level and never come along into the freshly authored output document). This is the same JS-strip discipline Phase-3 forms uses on flatten + save. The combined document has no carried-over JS or open-actions, period.

---

## Annotating

Choose a tool from the toolbar or via shortcut. Phase 1/2 ships the basic annotation set; Phase 4 layers seven additional shape + measure tools on top — see [Shape and measure annotations](#shape-and-measure-annotations) below.

| Tool            | Shortcut         | Use                                                                                          |
| --------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| Highlight       | **H**            | Click and drag to highlight a rectangular region of text.                                    |
| Sticky note     | **S**            | Click anywhere on the page to drop a sticky note. Edit text in the inspector.                |
| Text box        | **T**            | Click and drag to create a text box. Type to fill.                                           |
| Underline       | **Ctrl+U**       | Click and drag to underline a text region.                                                   |
| Strikethrough   | **Ctrl+K**       | Click and drag to strike through text.                                                       |
| Freehand (ink)  | **Shift+F**      | Click and drag to draw freehand strokes. (Phase 3 reclaimed Ctrl+Shift+F for Form Designer.) |
| Cursor / select | **V** or **Esc** | Default cursor; click an existing annotation to select.                                      |

Selected annotations show their properties in the **inspector** on the right (color, opacity, contents). Edit there. Delete with the **Delete** key.

All annotations are stored as standard PDF annotation objects (`Highlight`, `Underline`, `StrikeOut`, `Text`, `FreeText`, `Ink` subtypes). They follow the PDF spec, so the saved file opens in any reader with the annotations visible.

### Shape and measure annotations

Phase 4 adds seven new annotation tools as standard PDF annotation subtypes — `Square`, `Circle`, `Polygon`, `PolyLine`, `Line` (used for both arrows and line-measure), and `FreeText` with `/IT FreeTextCallout`. All seven are interoperable with Acrobat Reader, Edge, Foxit, and any other ISO-32000-compliant reader.

| Tool                 | Toolbar icon | What it does                                                                                                                                                                                                                                                     |
| -------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rectangle**        | □            | Click and drag to draw an outlined rectangle. The Inspector exposes border color, border width, border style (solid / dashed / dotted), and optional fill color + opacity. PDF subtype: `Square`.                                                                |
| **Ellipse**          | ○            | Same controls as Rectangle. PDF subtype: `Circle`.                                                                                                                                                                                                               |
| **Polygon**          | ⬠            | Click to drop each vertex; double-click (or press Enter) to close the polygon. The first and last vertices auto-connect. PDF subtype: `Polygon`.                                                                                                                 |
| **Arrow**            | →            | Click and drag to draw a line with an arrowhead at the end. The Inspector lets you change the start and end style (None / Butt / OpenArrow / ClosedArrow) so the same tool draws bare lines, single-headed arrows, or double-headed arrows. PDF subtype: `Line`. |
| **Callout**          | ⌖            | Click to drop the pointer tip (e.g. on the thing you're calling out); drag the text box to its final position. The Inspector exposes the callout text. PDF subtype: `FreeText` with `/IT FreeTextCallout`.                                                       |
| **Line measure**     | ⊢            | Click and drag a single line; the line's real-world length is computed from the per-document measure calibration (see Calibrating measurements below) and shown in the Inspector. PDF subtype: `Line` with `/Measure` dict.                                      |
| **Polyline measure** | ⊢⊢           | Click to drop each vertex; double-click (or press Enter) to finish. The cumulative segment length is computed and shown in the Inspector. PDF subtype: `PolyLine` with `/Measure` dict.                                                                          |

The tool palette is in the right side of the toolbar, between the freehand-ink and the bookmark icons. Default properties (border width, border style, fill enabled, line-end style for the Arrow tool) are configurable in Settings → Annotations.

### Calibrating measurements

The two measure tools (line-measure, polyline-measure) need to know how many real-world units fit in a PDF user-space unit. The default calibration is `1 PDF unit = 1 pt`. To set a custom calibration:

1. Switch to the line-measure or polyline-measure tool.
2. Tools menu → **Calibrate measurement** (or right-click in an empty area of the canvas → **Calibrate**).
3. Click two points on the page that you know the real-world distance between (e.g. a scale bar's endpoints in an architectural drawing).
4. Type the real-world distance and pick a unit (inch / cm / mm / pt / px / custom). For "custom", supply a label like "feet" or "miles".
5. Click **Apply**.

Calibration is stored in main-process memory for the document's lifetime and serialized into the first measure annotation's `/Measure` dict on save. Loading the saved file in any compliant reader (Acrobat, Foxit) reads back the calibration and displays measurements correctly.

There is one calibration per document. Re-calibrating overrides the prior value (and recomputes all measure annotations' displayed lengths immediately). If you need different calibrations on different pages of the same document, you'll need to save each page as a separate file.

### Annotation summary panel

The sidebar gains a new **Annotations** tab (alongside Pages, Bookmarks, Forms). The summary panel lists every annotation in the document, grouped by page, with:

- Annotation type (e.g. "Highlight", "Rectangle", "Polygon", "Signature")
- Page number + jump-to-page click
- Color swatch
- First 50 characters of contents (sticky note text, callout text, etc.)
- Author (if the annotation carries a `/T` Title field)
- Created / modified timestamps

Click any row to jump to the annotation's page and select the annotation (so the Inspector populates). Filter by type via the dropdown at the top of the panel. The summary is read-only — to edit an annotation, jump to it and edit in the Inspector.

---

## Importing images

PDF_Viewer_Editor 0.2.0 imports PNG, JPEG, and TIFF (first page only) images. Two import modes — **new page** or **overlay on an existing page**. Trigger via **Ctrl+I**, **Toolbar → Insert image**, or right-click a page → **Insert image overlay**.

### Mode 1: Insert image as a new page

Pick the file, then pick an insertion position (before/after the current page). The image becomes a full page sized to fit A4 (with the image scaled proportionally inside). Orientation auto-selects portrait or landscape based on the image's aspect ratio.

### Mode 2: Overlay image on existing page

Pick the file, then click-drag a rectangle on the page where the image should land. Resize after drop via the corner handles.

### What formats work

| Format                                    | Status              | Notes                                                                                                                             |
| ----------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| PNG (8-bit, 16-bit)                       | LIVE                | Embedded via pdf-lib `embedPng`.                                                                                                  |
| JPEG (baseline, progressive)              | LIVE                | Embedded via pdf-lib `embedJpg`.                                                                                                  |
| TIFF (single-page)                        | LIVE                | Decoded via [utif](https://github.com/photopea/UTIF.js) (MIT).                                                                    |
| TIFF (multi-page)                         | **First page only** | Only the first frame is decoded. Multi-page TIFF extraction is a Phase 2.5 candidate; you'll see a warning toast when this fires. |
| Other formats (BMP, GIF, WebP, HEIC, RAW) | Not supported       | Convert to PNG or JPEG before import.                                                                                             |

### Limitations

- **TIFF multi-page imports use the first page only.** A 5-page TIFF imports as a single image (the first page).
- **No transparency for JPEG.** JPEG doesn't support alpha; if you need a transparent background, use PNG.
- Image bytes are deduplicated by SHA-256 content hash inside main's per-handle cache, so re-importing the same image multiple times doesn't bloat the saved file.

---

## Editing text

PDF_Viewer_Editor 0.2.0 supports **replace-only text editing with the original font**. This is intentionally narrow — full text editing (reflow, font substitution, multilang shaping) ships in Phase 4.

### How to edit text

1. Switch on the text edit mode (**Ctrl+E**) or select the text-edit tool from the toolbar.
2. Click on a run of text in the document. A text-edit overlay appears around the run with the original font's metrics rendered live.
3. Type your replacement. The overlay shows real-time clip / missing-glyph indicators as you type.
4. Press **Enter** to commit, **Esc** to cancel.

The replacement is queued as an edit op (kind: `text-replace`). On Save, the engine writes the replacement into the saved bytes through pdf-lib at the original run's content-stream position.

### What works

- Replacing a word with another word the same length (no clipping, no glyph misses).
- Replacing a word with a shorter word.
- Replacing a word with a longer word, **as long as the longer word fits within the original glyph run's width** in the original font.

### Failure modes

| Indicator                                    | Meaning                                                                                                         | What to do                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Amber clip indicator** while typing        | Your replacement is wider than the original run; on commit you'll get a `clipped` error toast.                  | Shorten your replacement, or wait for Phase 4 reflow.                              |
| **Red missing-glyph indicator** while typing | Your replacement uses a character the original font doesn't have (e.g. a Cyrillic letter in a Latin-only font). | Pick characters the original font supports, or wait for Phase 4 font substitution. |

### What doesn't work

- **Reflow.** If your replacement doesn't fit the original run's width, you get a `clipped` error toast. Phase 4 will reflow.
- **Font substitution.** If your replacement uses characters the original font doesn't have, you get a `missing_glyph` error toast. Phase 4 will substitute.
- **Multi-line edits.** Phase 2 text-replace is single-run. Multi-line text editing is Phase 4.

If you need to edit text in a way Phase 2 doesn't support, the workaround is to add a text annotation on top (the Phase 1 feature) — not a replacement of the original text, but an overlay that prints with the document.

---

## Working with forms

PDF_Viewer_Editor 0.3.0 detects, fills, and saves AcroForm fields. When you open a PDF that contains form fields, the **Forms** tab in the left sidebar lights up automatically; click it to see the list of detected fields grouped by page.

### Field types supported

| Type                  | What it does in the renderer                                                                        | What lands in the saved PDF                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Text                  | Standard input box with the original font's display metrics.                                        | AcroForm text field with `/V` set to your text.                                                                                                                                      |
| Checkbox              | Toggle on click.                                                                                    | AcroForm checkbox with `/V` set to `/Yes` or `/Off`.                                                                                                                                 |
| Radio (group)         | Mutually-exclusive group; clicking selects one and deselects siblings.                              | AcroForm radio group with `/V` set to the chosen option's export value.                                                                                                              |
| Dropdown (combo)      | Single-select list from the field's options.                                                        | AcroForm dropdown with `/V` set to the chosen value.                                                                                                                                 |
| Date                  | In-app date picker honoring your `forms.dateLocale` setting (`system` / `en-US` / `en-GB` / `ISO`). | Stored as a text field with an ISO-8601 string in `/V` plus a `/TU` hint. **In Acrobat the field shows a text input, not a date picker** — the date-picker UX is renderer-side only. |
| Signature placeholder | Visual "click to sign" affordance; clicking surfaces "Signing arrives in Phase 4."                  | `/FT /Sig` field with `/V` undefined; Phase 4 will populate.                                                                                                                         |

### Filling fields

1. **Read the status banner first** (see [the dedicated section below](#forms-sidebar-status-banner--three-honesty-warnings)) — it surfaces three Phase 3 warnings that affect what lands on disk: JS-action strip, XFA read-only, and signed-fields-will-be-invalidated.
2. Click a field row in the **Forms** sidebar, or click the field directly on the canvas. The corresponding widget on the page receives focus.
3. Type, check, or pick. The value updates immediately in the renderer.
4. **Save (Ctrl+S) commits the batch.** Your fills are written into the AcroForm field dictionaries (`/V` entries) via pdf-lib at save time. The Save section below has the full story.

### The commit boundary

Form-fill values are **transient** until you Save. This is the HYBRID commit boundary (see [developer guide](developer-guide.md#forms-architecture-phase-3) for the architectural rationale). Practical implications:

- **Ctrl+Z while filling unwinds the whole form-fill batch**, not each keystroke. This matches how Word and Acrobat treat form fill.
- An explicit **"Commit form values"** button appears in the Forms sidebar when you have uncommitted fills. Power users can commit a partial fill (creating a snapshot you can undo back to) without saving the file.
- Closing a document with uncommitted fills surfaces the existing unsaved-changes prompt; you can Save (which commits) or Discard.

### Loading a saved template

If you've saved templates (see [Designing forms](#designing-forms)), the **Forms** sidebar shows a "Templates ▾" dropdown. Picking a template adds each field as a new authored field on the current document; you can then nudge, resize, fill, or remove them like any other field. Templates carry their own `lastColumnMappings` for mail-merge, so picking a template that was previously used for a merge pre-populates the column mapping.

### Forms sidebar status banner — three honesty warnings

The top of the Forms sidebar surfaces a status banner that summarizes anything in the document the Phase 3 forms engine will alter or refuse to honor on save. **These three warnings are the trust-floor: nothing is hidden, no claim is implicit.** Each warning maps to a flag returned by the [`forms:detect`](api-reference.md#formsdetect--live-phase-3) IPC channel.

| Warning row                                                                             | When it shows                                                                                                                        | What will happen on save                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Document contains JavaScript actions — they will be stripped on save."**             | Set whenever the document carries `/Names /JavaScript` at the catalog level OR any field carries an `/AA` (additional-actions) dict. | **Every save** writes a file with no JavaScript. Calculations, regex validators, date hooks, and any other JS-driven field behaviors no longer run after a round-trip through the editor. This is the locked Phase 3 decision **P3-L-2**. There is no "preserve JS" toggle in Phase 3 — the strip is unconditional. Phase 3.1 may add a read-only preservation mode; track that phase for updates.                                                                                                                                                                                                               |
| **"This PDF uses XFA forms — XFA isn't editable in Phase 3."**                          | Set when the document's AcroForm dict carries an `/XFA` entry (typically authored in Adobe LiveCycle Designer).                      | XFA fields stay **read-only**. AcroForm fields in the same document (mixed documents are rare but exist) remain fillable. The XFA tree itself is preserved on save (Phase 3 does not strip XFA), but no XFA edits are produced by the editor. XFA support is wontfix unless explicit demand surfaces.                                                                                                                                                                                                                                                                                                            |
| **"This document has signed fields — saving will invalidate any existing signatures."** | Set when any `/Sig` field has a non-empty `/V` entry (i.e. the document has been digitally signed).                                  | Phase 3 does NOT preserve PKCS#7 / PAdES signatures across a save round-trip — the byte-range hash captured at sign time covers the original bytes, and the editor produces fresh bytes. **A sign-then-edit-then-save flow will leave the saved file with signatures that fail validation.** If the file is signed and you only need to read it, do not save it. Cryptographic signing (and signature preservation) ship in Phase 4. The signature placeholder authored by the Phase 3 form designer is distinct — that's a `/Sig` field with `/V` intentionally absent (sign-ready), which round-trips cleanly. |

The banner is informational, not blocking. Save still works. The flags are pure-data outputs of `forms:detect` — no value judgement, no hidden behavior. If you read the warning and proceed, the named outcome is what lands on disk.

### What else the Forms sidebar shows in various states

| Document content                       | Forms sidebar shows                                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No AcroForm fields                     | "No fillable form fields detected. Switch to Form Designer (Ctrl+Shift+F) to add some, or load a saved template."                                               |
| XFA-only (LiveCycle Designer) PDF      | Read-only banner row (see status banner above) plus the empty-form state.                                                                                       |
| Mixed AcroForm + XFA                   | Status banner shows the XFA warning; the AcroForm fields appear in the field list and remain fillable.                                                          |
| AcroForm with JavaScript actions       | Status banner shows the JS-strip warning; fields fill normally. A second toast fires on save: "JavaScript actions stripped from document (Phase 3 limitation)." |
| Signed `/Sig` field with existing `/V` | Status banner shows the signature-invalidation warning; you can still fill / edit / save, but be aware the saved file's signatures will fail validation.        |

---

## Designing forms

PDF_Viewer_Editor 0.3.0 ships a click-to-place form designer.

**Honesty reminder.** Designing fields onto an already-signed document still triggers the signature-invalidation warning on the next save — adding new fields changes the bytes, which invalidates the byte-range hash any prior signature covered. See [the status banner section](#forms-sidebar-status-banner--three-honesty-warnings) for the full set of Phase 3 honesty warnings.

### Toggle Form Designer mode

Press **Ctrl+Shift+F** or click the Form Designer button in the toolbar. The canvas enters designer mode:

- A banner appears at the top of the viewer: "Form Designer — click to place a [text] field. Press Esc to exit."
- The annotation toolbar is replaced with a **Field-Type Selector** (text / checkbox / radio / dropdown / date / signature).
- The right Inspector shows field properties when a field is selected.

Press **Esc** twice to exit: first Esc deselects any selected field, second Esc exits designer mode.

### Place a field

1. Pick a field type from the Field-Type Selector (or press **F** to cycle).
2. Click on the page where you want the field. The field appears at default dimensions; the cursor shows a crosshair while placement is active.
3. Drag the corner handles to resize, or drag the body to move.
4. Edit properties in the Inspector: **Name** (must be unique), **Label** (the visible name; defaults to Name), **Required** (toggles the AcroForm Required flag), **Default value**, and — for radio + dropdown — the **Options** list.

Duplicate field names are rejected inline ("A field named 'first_name' already exists. Choose a different name.").

### Remove a field

Select the field (click), then press **Delete**. Use **Ctrl+Z** to undo. Removing a detected field (one that was in the original document) is fine; the engine writes the field-removal at save time.

### Edit a field's properties

Select the field in the canvas or in the sidebar. The Inspector shows its properties. Change Name, Label, Required, Default, or Options. Each property change is one undoable operation.

### Save a template

Once you've authored fields you want to reuse, open **File → Save form template…** (or right-click in the Forms sidebar → **Save current as template**). Pick a name (must be unique across all templates). The template is saved cross-file in SQLite (schema v3); you can load it onto any other PDF later.

If a name is already in use, the dialog shows "Name in use" inline. Pick a different name; the dialog does NOT auto-overwrite.

### Load a saved template

Open the **Templates ▾** dropdown in the Forms sidebar. Pick a template. Each template field becomes a `form-design-add` operation on the current document — undoable per field. You can then drag, resize, rename, or delete the loaded fields. The template itself is unchanged until you "Save current as template" again with the same name.

### Limitations of the designer

- **No tab-order authoring.** Phase 3 places fields in dispatch order; explicit tab-order is a Phase 3.1 candidate.
- **No z-order reordering between widgets.** Phase 3 places fields in dispatch order.
- **No multi-select.** Phase 3 lets you edit one field at a time.

---

## Capturing a signature

PDF_Viewer_Editor 0.4.2 supports three ways to capture a signature. Each produces a PNG-rendered image in renderer memory, which is then handed to either [Placing visual signatures](#placing-visual-signatures) (appearance-only, no crypto) or [PAdES cryptographic signing](#pades-cryptographic-signing) (appearance + CMS envelope + audit log).

**Honesty reminder.** Capturing a signature is purely a renderer-side operation — no cert, no IPC. The captured PNG bytes stay in renderer memory until you place the signature; placing it sends the PNG (NOT a cert) to main. PAdES cryptographic signing is a separate workflow with its own cert + password handling — see [PAdES cryptographic signing](#pades-cryptographic-signing) and [PAdES trust floor](#pades-trust-floor--what-the-app-does-and-doesnt-promise).

### Open the Signature Capture modal

- **Tools menu → Capture signature**, OR
- Click an empty `/Sig` placeholder field in the canvas (the Phase 3 placeholder fields surfaced in the Forms sidebar), OR
- **Toolbar → Visual Sign button**

The modal opens with three tabs: **Type**, **Draw**, **Image**.

### Mode 1 — Typed signature

1. Switch to the **Type** tab.
2. Type your name in the input field.
3. Pick a font from the dropdown (the default fonts are a small script-style set chosen for signature legibility; Phase 4.1 may add user-supplied fonts).
4. Pick a size with the slider.
5. The preview area shows your typed signature live. The captured PNG is rendered from the typed text at the preview area's resolution.

### Mode 2 — Drawn signature

1. Switch to the **Draw** tab.
2. Use the mouse or a stylus to draw your signature on the canvas.
3. **Clear** wipes the canvas; **Undo last stroke** removes the most recent stroke.
4. The captured PNG is the canvas at its full resolution.

Touch + pen input are supported on touch-enabled Windows tablets.

### Mode 3 — Image signature

1. Switch to the **Image** tab.
2. Click **Choose file…** or drag a PNG / JPEG onto the modal. (TIFF + other formats are not supported in this surface; convert to PNG or JPEG upstream.)
3. The image preview shows the loaded file.
4. The captured bytes are the file's bytes verbatim — no resizing, no recompression at capture time. (The signature placement step does fit-to-rect scaling.)

This mode is useful when you have a scanned image of an existing handwritten signature on a phone or scanner.

### Capture preview options

Below the three tabs, an **Options** section controls what extra information appears alongside the signature when placed:

- **Show name** (default ON) — the typed name appears next to the signature graphic.
- **Show date** (default ON) — today's date in your system locale appears next to the signature.
- **Show reason** — show + edit a reason string (e.g. "I am the author of this document"). Empty by default.

These options also apply to PAdES signatures (next section). For PAdES, two additional options are exposed: **Show Subject CN** (default ON for PAdES) and **Show Issuer CN** + **Show TSA info** (default OFF). See [PAdES cryptographic signing](#pades-cryptographic-signing).

### Cancel a capture

Press **Esc** or click the modal's **X** button. The captured PNG bytes are released from renderer memory (no IPC trip; nothing was sent to main).

---

## Placing visual signatures

A visual signature is the signature graphic from [Capturing a signature](#capturing-a-signature) baked into the PDF as a standard widget annotation with an `/AP /N` appearance stream — appearance only, no cryptographic envelope. **It does NOT cryptographically bind the signer to the document.** Use [PAdES cryptographic signing](#pades-cryptographic-signing) if you need cryptographic identity.

### Two placement modes

**Placeholder mode.** If the document has a Phase 3 `/Sig` placeholder field (authored in the form designer or in a third-party tool), pick the field from the dropdown when you click "Place visual signature" in the capture modal. The signature graphic sizes itself to the placeholder's rect.

**Freeform mode.** Click and drag a rectangle anywhere on any page to set the placement. The signature graphic sizes itself to fit the rect (maintaining aspect ratio). This mode does NOT require a placeholder field.

### What happens behind the scenes

When you place a visual signature, the renderer dispatches a `signatures:applyVisual` IPC channel with the document handle, placement, and appearance spec. Main:

1. If `placement.mode === 'placeholder'`, looks up the named `/Sig` field and rejects if it's already signed (returns `placeholder_field_already_signed`).
2. Composes the appearance stream — typed name, drawn ink, or imported image — at the placement rect's dimensions, with date + reason if requested.
3. Writes an empty `/V <<>>` dict on the signature field to distinguish "visually-signed but not cryptographically signed" from "Phase 3 placeholder" (see signature-engine.md §5.2).
4. Returns an `EditOperation` (kind `signature-visual-place`) for the renderer to append to its op log.

**The visual signature does NOT land on disk until you Save (Ctrl+S).** Until then it's a renderer-side dirty op like any other annotation. Save runs the edit-replay engine and writes the result via atomic temp+rename.

### Honesty reminder — placed visual signature is appearance-only

A visual signature is just a drawing on a page. It does NOT bind your identity to the document via cryptography. A trivially-edited copy of the document with your visual signature could be made without your knowledge. If you need cryptographic identity, use [PAdES cryptographic signing](#pades-cryptographic-signing). If you're signing a contract that requires legal weight, PAdES + a CA-issued cert + an opted-in TSA is the path.

---

## PAdES cryptographic signing

PAdES (ETSI EN 319 142) is the PDF Advanced Electronic Signature standard — a detached PKCS#7 / CMS signature embedded in the PDF's `/Contents` byte-range. It binds the signer's certificate to the exact bytes of the document at sign time. Tampering with the document after sign invalidates the signature; any compliant reader can detect this. **This is the workflow to use if you need cryptographic identity.**

**Read [PAdES trust floor](#pades-trust-floor--what-the-app-does-and-doesnt-promise) before proceeding.** The four obligations are non-negotiable; the app makes no notarization claim.

### The 3-step wizard

Open the wizard from **Tools menu → Sign with PAdES**, or **Toolbar → PAdES Sign button** (different from the visual Sign button — there are two by question E in the Wave 15 ui-spec).

#### Step 1 — Cert

1. Click **Choose certificate…** or drag a PFX/P12 file onto the wizard.
2. Type the cert's password.
3. Click **Load**.

**Cert and password discipline.** The PFX bytes are read into a `Buffer` in main-process memory; the password is wrapped in a `Buffer` within ≤5 lines of the validated payload entering main. The JS string reference to the password is overwritten to `''` immediately. Both buffers live in the cert-store, owned by an opaque handle. They are zeroed via `Buffer.fill(0)` in a `finally` block on EVERY exit — on success (after the sign completes), on every failure path (wrong_password, pfx_decode_failed, pfx_no_private_key, pfx_no_cert), and when you close the wizard. The handle is bounded to one signing operation by default (`autoRelease: true`). Closing the wizard fires `signatures:certRelease`; quitting the app fires `app.before-quit` which releases every retained handle. **No log, no SQLite, no Electron-Store, no `.env`, no temp file ever sees the cert or the password.** Locked decision P4-L-1.

After load, the wizard shows:

- **Subject CN** (from the cert) — for display
- **Issuer CN** (from the cert) — for display
- **Valid from** / **Valid until** — date range; warns if the cert is expired or not yet valid
- **Fingerprint** — SHA-256 hex of the cert

If the cert is expired (`isExpired === true`), the wizard shows an inline warning and disables Next. Phase 4 treats expired-cert as a hard error; Phase 4.1 may add a Setting (`signatures.allowExpiredCert`) to override.

#### Step 2 — Options

Choose placement and appearance:

- **Placement.** Same two modes as visual signatures — **Placeholder field** (pick a `/Sig` field from the dropdown) or **Freeform** (click-drag a rectangle on the canvas behind the wizard).
- **Appearance.** Toggle Show name / Show date / Show Subject CN / Show Issuer CN / Show reason / Show TSA info. PAdES defaults differ from visual: Show Subject CN is ON by default; Show Issuer CN is OFF; Show TSA info is OFF (turns ON automatically if step 3's "Use TSA" is toggled).
- **Reason** — optional free-text. Stored in the CMS signature's `/Reason` field.
- **Location** — optional free-text. Stored in the CMS signature's `/Location` field.
- **Use TSA (RFC 3161 timestamp)** — checkbox; OFF by default. If ON, the URL pulled from Settings → Signing → `signatures.tsaUrl` is used. If Settings has no URL configured, the checkbox is greyed out with a tooltip pointing to Settings.

**TSA honesty reminder.** The TSA URL is visited only when you click Sign on step 3. The app validates the URL strictly (HTTPS only; no userinfo; no fragment; bounded query) and rejects URLs that don't pass. Locked decision P4-L-2 — the app ships with no default TSA service. See [PAdES trust floor](#pades-trust-floor--what-the-app-does-and-doesnt-promise) obligation #3.

#### Step 3 — Sign

Click **Sign**. The wizard streams progress through the modal:

- **Composing appearance** — the visual widget is drawn.
- **Computing byte-range** — main hashes the unsigned PDF bytes (with the `/Contents` field as a 16384-hex-char placeholder).
- **Signing** — `node-signpdf` (default engine) computes the CMS envelope.
- **Requesting timestamp** — if TSA was enabled in step 2, main contacts the TSA URL with a 30-second timeout. If the TSA fails (http error / TLS error / timeout / invalid response / nonce mismatch / genTime skew outside ±5 min), the sign **fails loudly** with a specific error variant (see api-reference §`signatures:applyPades`). This is a fail-loud not fail-quiet posture — silent fallback to "sign without TSA" would defeat the timestamp's purpose.
- **Embedding signature** — the CMS bytes are written into the placeholder slot.
- **Writing audit row** — a row is inserted into `signature_audit_log` capturing the fingerprint, signed-at, doc hash, signature byte-range offset, and TSA response status.
- **Saving** — the signed PDF is written via atomic temp+rename.

On success the wizard closes and you see a toast: "Signed by `<Subject CN>` at `<signed-at>`". The Signature Audit panel (see below) lists the new row.

On failure the wizard surfaces a specific error message — `cert_expired`, `pades_sign_failed`, `tsa_timeout`, `pades_invalidated_by_subsequent_edit`, etc. The document is unchanged on disk (atomic save invariant).

### Honesty reminder — placing PAdES on a previously-signed document

If the document already has signed `/Sig` fields, placing a NEW PAdES signature changes the bytes, which invalidates the byte-range hash any prior signature covered. The wizard surfaces a confirm prompt: "This document has 1 existing signature; signing now will invalidate it. Continue?" Click Continue to proceed; Cancel to back out. Locked decision per the four trust-floor obligations.

### Engine choice — `node-signpdf` vs manual fallback

The default PAdES engine is `node-signpdf` (MIT). A `node-forge` + `pkijs` (MIT / BSD-3-Clause) manual engine ships as a fallback behind the `signatures.padesEngine` Setting (default `'signpdf'`). Both engines satisfy the same external contract; the fallback exists in case `node-signpdf` regresses upstream. Phase 4 ships the toggle structurally; Phase 4.1 exposes the picker in Settings → Signing → Advanced. Locked decision P4-L-3.

---

## Timestamping (RFC 3161)

RFC 3161 timestamping wraps your PAdES signature with a third-party timestamp proving the signature existed at a specific point in time. The TSA (Time-Stamp Authority) is an external service you pick and configure; the app ships with **no default TSA**.

### Configure a TSA URL

1. Open Settings (**Ctrl+,**) → **Signing**.
2. Paste your TSA URL into the **TSA URL** field. Must be `https://...`.
3. Tick the **Enable TSA** checkbox.
4. Click **Test TSA URL** (sends a one-shot `signatures:requestTimestamp` with a dummy SHA-256 hash to verify connectivity; result toasts back).
5. Click **Save**.

The URL is stored in the SQLite `app_settings` table under `signatures.tsaUrl`. **No cert, no signature material, no document bytes are sent during configuration** — only at sign time.

### What gets sent to the TSA

When you tick "Use TSA" on the PAdES wizard step 2 and click Sign on step 3, main constructs an RFC 3161 TimeStampReq containing:

- The SHA-256 hash of the signature bytes (NOT the document; just the signature bytes).
- A random nonce (validated against the TSA response to prevent replay).
- The hash algorithm OID.

The TSA responds with a TimeStampResp containing a TimeStampToken. The app validates:

- HTTP status (200 OK).
- TLS validity (cert chain must verify).
- Response nonce matches request nonce.
- `genTime` is within ±5 minutes of the system clock.

If any check fails, the sign fails loudly with the specific error variant. No fallback to "sign without timestamp" — that would silently weaken the signature.

### Honesty reminder — TSA trust

The app does NOT validate the TSA's trust chain in any deep way beyond TLS verification. It does NOT vet who runs the TSA. **The TSA URL trust is entirely your decision.** Pick a TSA from a CA you trust (DigiCert, GlobalSign, Sectigo, etc. all publish TSA URLs). Some country-specific TSAs are operated by national authorities. Locked decision P4-L-2.

---

## Signature audit panel

PDF_Viewer_Editor 0.4.2 keeps a local "what have I signed, when, and with what cert?" log. It is the SQLite table `signature_audit_log` (schema v4) at `%APPDATA%/PDF Viewer & Editor/db.sqlite`. The audit log is local-only — it does not phone home, does not export by default, and is tamper-vulnerable by design (see [PAdES trust floor](#pades-trust-floor--what-the-app-does-and-doesnt-promise) obligation #4).

### Open the audit panel

The sidebar's **Annotations** tab includes a **Signature Audit** sub-tab. Or open **Tools menu → Signature audit log**. The panel lists every PAdES (and visual) signature this app has applied, newest first.

### What each row shows

| Column           | What it is                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Signed at        | Timestamp from the engine (ms epoch, displayed in your system locale)                           |
| Signed by        | Subject CN from the cert (or "(visual signature)" for visual rows)                              |
| Cert fingerprint | First 16 hex chars of the SHA-256 cert fingerprint; full fingerprint in the row's expanded view |
| TSA              | TSA URL + response status (`ok` / `failed` / null if no TSA was used)                           |
| Doc hash         | First 16 hex chars of the SHA-256 doc hash AT SIGN TIME                                         |
| Filename         | The file's name at sign time (best-effort; the file may have been moved/renamed since)          |

### Filter the panel

- **By file hash** — only rows matching the currently-open document's hash.
- **By signed-by-fingerprint** — only rows signed by a specific cert (paste the full fingerprint).
- **By date range** — `since` / `until` date pickers.

### Verify a signature

Click the **Verify** button on any audit row. Main:

1. Loads the current bytes from the document.
2. Reads the byte-range from the audit row.
3. Re-hashes the byte-range and compares to the messageDigest in the CMS envelope at that offset.
4. Reports `valid: true | false` + `tamperedSinceSign: true | false`.

**Honesty reminder — what verify means and doesn't mean.** `valid: true` means the signature's hash matches the bytes the app saved at sign time. It does NOT mean:

- The cert was issued by a trusted CA (the app does not validate trust chains).
- The cert hasn't been revoked (the app does not consult CRLs/OCSP).
- The signer is who they claim to be (the app trusts what the cert says).
- The audit row itself wasn't tampered with — anyone with write access to the SQLite DB can edit it.

For trust-chain verification, use Adobe Reader DC, EU DSS, or another third-party PAdES verifier. Locked decision P4-L-6 + trust-floor obligation #4.

---

## Running OCR

PDF_Viewer_Editor ships local OCR via [Tesseract.js](https://tesseract.projectnaptha.com/) (Apache-2.0) — shipped in Phase 5 (0.5.0) and unchanged in 0.6.0. Open a scanned PDF (or any image-only PDF), run OCR over a page range, and Save — the saved file now has an invisible text-behind-image layer your selection, Find, and copy-paste features can hit.

**Honesty reminder.** Read the [OCR trust floor](#ocr-trust-floor--what-the-app-does-and-doesnt-promise) before relying on OCR output. The four obligations apply: accuracy depends on scan quality, OCR runs locally with no cloud upload, the saved text-behind-image layer becomes part of the file, and re-running adds duplicate layers. If the doc carries PAdES signatures, OCR invalidates them — same Phase 4 invalidate-on-edit discipline carries through.

### Open the OCR wizard

- **Tools menu → Run OCR…**, OR
- **Toolbar → OCR button**, OR
- **Ctrl+Shift+R** (rebound for OCR in Phase 5; Phase 1's "rotate counter-clockwise" now uses **Ctrl+Shift+Alt+R** on the Pages menu — see [Keyboard shortcuts](#keyboard-shortcuts-full-list))

The modal opens in step 1 (Configure).

### Step 1 — Configure

Pick what to recognize and how:

- **Language** — dropdown listing installed language packs from the [language manager](#manage-language-packs). v0.5.0 ships English only; pick "English (eng)" unless you have downloaded another pack manually. Multi-language recognition (`eng+spa` style) is supported when both packs are installed.
- **Page range** — defaults to all pages. You can pick a specific start / end (inclusive, 1-indexed in the UI; 0-indexed internally), or click **Current page only** for a single-page run.
- **Preprocessing** — three checkboxes, each a pure-function helper that runs on the rasterized page before recognition:
  - **Deskew** (default ON) — detects rotation via Hough transform on text lines; corrects rotations < 10°. Larger rotations (90° / 180°) require manual rotate-page first.
  - **Denoise** (default OFF) — bilateral filter (preserves edges; removes Gaussian noise). Useful for grainy scans.
  - **Contrast boost** (default OFF) — histogram equalization. Useful for faded scans.
- **Raster DPI** — defaults to 300 (configurable in Settings → OCR). Higher DPI improves recognition quality at the cost of memory and time. 200 is acceptable for clean text; 400+ rarely helps and uses significantly more RAM.

Click **Next** to advance.

### Step 2 — Confirm-if-signed

If the document carries any prior PAdES cryptographic signatures, step 2 surfaces a non-skippable confirm prompt:

> **This PDF has 1 cryptographic signature. Running OCR will invalidate it. Continue?**
>
> Affected field(s): `Signature1`
>
> A "Don't ask me again" checkbox appears alongside — in v0.5.0 the checkbox is shown but its persistence is per-session only (the prompt re-appears on app restart even if you tick it). The confirm itself is non-skippable; the only options are **Cancel** or **Continue and invalidate**.

**Honesty reminder.** Clicking **Continue and invalidate** is irreversible at the file level — Save writes the post-OCR bytes, the prior signature's byte-range hash no longer matches, and the [signature audit panel](#signature-audit-panel) records the invalidation with the OCR job ID. Phase 4 trust-floor obligation #1.

If the document has no PAdES signatures, step 2 is skipped and the wizard advances straight to step 3.

### Step 3 — Running

The progress bar shows per-page recognition with sub-phases:

- **Loading language…** (first time only; subsequent pages skip this) — the worker pool initializes the language data; 2–5 seconds on a modern machine
- **Rasterizing page N of M** — pdf.js renders the page at the configured DPI
- **Preprocessing page N of M** — deskew / denoise / contrast helpers run
- **Recognizing page N of M (confidence so far: XX%)** — Tesseract.js runs; this is the longest phase
- **Composing text-behind-image** — the searchable-PDF builder appends BT/ET text blocks to the page
- **Writing output** — final document assembly

The **Cancel** button is always enabled. Cancellation is **graceful, not aggressive**: once you click Cancel, the engine finishes the current page before exiting (mid-page cancellation is Phase 5.1+). The partial output is discarded — no half-OCR'd PDF lands on disk.

If a per-page recognition hangs longer than 60 seconds (configurable via `ocr.workerWatchdogSec`), the per-page watchdog fires, terminates the hung worker, and reports `worker_watchdog_timeout` for the affected page. The job continues with the remaining pages.

### Step 4 — Done

The summary shows:

- **Total words recognized** across the page range
- **Mean confidence** (weighted across all words)
- **Per-page breakdown** — page number / word count / mean confidence (click any row to jump to the page)
- **Low-confidence words count** — number of words below the threshold

Click **Show me the results** to close the modal and open the [OCR results panel](#ocr-results-panel) in the sidebar. Click **Close** to close the modal without opening the panel.

**The OCR text is now in your document but NOT yet on disk.** Like every other edit, it's a renderer-side dirty op until you Save (Ctrl+S). The save flow runs the edit-replay engine with the new `ocr-text-behind-applied` op at step 3.9, writes the invisible text layer into the document, and atomically renames the temp file to the destination. If you close the document without saving, the OCR is lost — but the `ocr_jobs` row in SQLite records the job completion regardless.

### Honesty reminder — running OCR on a signed PDF

If you've already proceeded through step 2's confirm, the prior signatures are invalidated the moment Save writes the post-OCR bytes. Recovery is the same as any post-OCR signature recovery:

1. Undo the OCR op (Ctrl+Z) before saving — the document reverts to its pre-OCR state.
2. Open the original (pre-OCR-and-pre-signed) file from disk.
3. Accept the invalidation: the audit log preserves the "Invalidated by OCR (job #N)" row so you have a trail; re-sign the post-OCR document with a fresh PAdES signature if needed.

---

## Manage language packs

PDF_Viewer_Editor ships English bundled. Nine additional language packs are listed in the language manager modal and download on demand from `tessdata.projectnaptha.com`, each verified by SHA-256 before it is installed. **As of 0.7.1, multi-language download works** — earlier versions (0.5.0–0.7.0) shipped English-only; see the note below.

### Open the language manager

- **Tools menu → Manage language packs…**, OR
- Click **Manage language packs…** from the language picker dropdown in step 1 of the OCR wizard

### What you'll see

The modal lists every language in the shipped catalog (`src/main/pdf-ops/language-pack-catalog.json`):

| Language                        | Status                  | Size    | Action          |
| ------------------------------- | ----------------------- | ------- | --------------- |
| English (eng)                   | **Installed (bundled)** | 10.4 MB | (cannot remove) |
| Spanish (spa)                   | Not installed           | 8.9 MB  | Download        |
| French (fra)                    | Not installed           | 9.5 MB  | Download        |
| German (deu)                    | Not installed           | 11.7 MB | Download        |
| Portuguese (por)                | Not installed           | 9.0 MB  | Download        |
| Italian (ita)                   | Not installed           | 9.6 MB  | Download        |
| Russian (rus)                   | Not installed           | 9.9 MB  | Download        |
| Chinese (Simplified) (chi_sim)  | Not installed           | 12.0 MB | Download        |
| Chinese (Traditional) (chi_tra) | Not installed           | 11.5 MB | Download        |
| Japanese (jpn)                  | Not installed           | 11.2 MB | Download        |

### Download a pack

Click **Download** on a row. The modal shows a progress bar (bytes downloaded / total). The download streams from `https://tessdata.projectnaptha.com/4.0.0_fast/<lang>.traineddata.gz` to a temp location under `%APPDATA%/PDF Viewer & Editor/tessdata/`, then verifies SHA-256 against the catalog before moving the file into place. If verification fails, the temp file is deleted and the action surfaces `pack_integrity_failed`.

Once installed, the language appears in the OCR wizard's language picker on the next modal open.

### Remove a pack

For downloaded (non-bundled) packs, click **Remove**. The pack file is deleted from `%APPDATA%/PDF Viewer & Editor/tessdata/`. The bundled English pack cannot be removed (the **Remove** button is greyed out with tooltip "Bundled pack cannot be removed").

### Multi-language download — resolved in 0.7.1

Earlier versions (0.5.0–0.7.0) shipped the catalog with the bundled `eng` row's real SHA-256 but `TBD-FILL-AT-RELEASE` sentinel values for the other nine language rows, so **every non-English download failed with `pack_integrity_failed`** — the handler correctly refuses to install a pack whose hash doesn't match the catalog (defense-in-depth against a poisoned upstream mirror).

The 0.7.1 backlog-fix wave fetched the real `.traineddata.gz` bytes from the upstream mirror, computed real SHA-256 for all nine downloadable packs, and replaced the sentinels. **Multi-language download now works** for spa / fra / deu / por / ita / rus / chi_sim / chi_tra / jpn. The integrity-check posture is unchanged — only the catalog hashes became real values; the manager still verifies every download against the catalog before installing.

### Honesty reminder — OCR trust floor #2

Language packs are the only thing this app's OCR feature ever touches the network for, and only on explicit download. Recognition is fully offline once a pack is installed. See [OCR trust floor obligation #2](#the-four-phase-5-obligations).

---

## OCR confidence overlay

The confidence overlay paints orange boxes over OCR-recognized words whose confidence is below the configured threshold (default 60). Use it to spot likely-wrong recognition before relying on the output.

### Toggle the overlay

- **View menu → Toggle OCR confidence overlay**, OR
- **Ctrl+Shift+H** (rebindable in Phase 5.1+)
- Settings → OCR → "Show confidence overlay by default" sets the initial state for new documents

The overlay only paints for pages that have OCR results (i.e. the current document has an `ocr-text-behind-applied` op in its history). On a fresh document with no OCR, the toggle is a no-op.

### What you see

For every recognized word below the threshold, an orange semi-transparent rectangle is drawn at the word's PDF user-space position (the same rectangle the invisible text-behind-image layer occupies). Hover over a box to see a tooltip:

> **conf 47** — `recieved` (page 3)

The box is for visual emphasis only; it does NOT modify the underlying document. Toggling the overlay off removes the boxes immediately.

### Adjust the threshold

Open Settings → OCR → **Low-confidence threshold**. The threshold is a 0–100 number; default 60. Lower values (e.g. 40) show fewer orange boxes (only the worst words); higher values (e.g. 80) show more boxes (more cautious review). The change takes effect immediately — no re-OCR needed.

### Honesty reminder — raw confidences are preserved regardless of threshold

The threshold is applied at RENDER time, not at recognition time. The raw per-word confidences are stored in `ocr_results.words_json` and never modified by the threshold. Lowering the threshold from 60 to 40 hides the boxes for words at 41–60 confidence; the recognized text + confidence values are unchanged. Re-raising the threshold immediately brings the boxes back.

A 95-confidence word is "very likely correct, but not guaranteed". A 61-confidence word is "barely above the threshold; review anyway". The threshold is a visual cutoff for emphasis — confidence is a continuous 0–100 scale.

---

## OCR results panel

The sidebar gains a 4th tab — **OCR results** — alongside Pages / Bookmarks / Forms / Annotations. The panel shows the OCR run history for the currently-open document, with per-page summary, search, and page-jump.

### Open the panel

Switch the sidebar to the **OCR** tab. If the current document has no OCR runs, the panel shows an empty state with a "Run OCR…" button that opens the [OCR wizard](#running-ocr).

### What each section shows

**Per-document summary (top)** — for the most recent OCR job on this document:

- Total words recognized
- Mean confidence (weighted across all words)
- Low-confidence words count (below the threshold)
- Page range covered
- Language(s) used
- Job ID + completion timestamp

**Per-page breakdown (middle)** — one row per OCR'd page:

- Page number
- Word count
- Mean confidence (color-coded: green ≥80, amber 60–79, red <60)
- Low-confidence count

Click any row to jump to that page in the viewer.

**Word search (bottom)** — a text input that filters the word list across all pages. Type a query (case-insensitive substring); matching words appear in a scrolling list with their confidence and page number. Click a word to jump to its page and highlight its bounding rectangle in the viewer.

### Limitations

- **The word list is in-memory only.** It reflects the OCR run from the current session. If you close and reopen the document, the per-document and per-page summary rehydrate from SQLite (`ocr_results` table), but the per-word data does not. To repopulate the searchable word list, re-run OCR. Phase 5.1's per-page word hydration IPC channel closes this gap. (See [Phase 5 known limitations](#phase-5-known-limitations) — M-21.5.)
- **OCR history is per-document keyed by file hash.** Moving or renaming a file doesn't lose the history; editing the file's bytes (Save) changes the hash and is treated as a fresh document for OCR purposes.

### Honesty reminder — OCR trust floor #1 / #3

Per [OCR trust floor obligation #1](#the-four-phase-5-obligations): the words shown in this panel may include errors. Use the per-page mean confidence + the per-word confidence (visible on hover in the word search) to focus review. Per obligation #3: once you Save, the recognized text is part of the file bytes; there is no "remove OCR layer" command in v0.6.0 either (Phase 5.1+ candidate). Per [Export trust floor obligation #5](#the-five-phase-6-obligations): if you later export a non-OCR'd document to Word or PowerPoint, the output is mostly raster image with no selectable text — run OCR first if you want selectable text in the exported Office file.

---

## Exporting to Office and images

**NEW in 0.6.0.** PDF_Viewer_Editor 0.6.0 exports the currently-open document to Word (.docx), Excel (.xlsx), PowerPoint (.pptx), or image formats (PNG / JPEG / TIFF). The exported file is a **new file at the path you choose**; the source PDF on disk is unchanged.

**Honesty reminder.** Per [Export trust floor](#export-trust-floor--what-the-app-does-and-doesnt-promise): layout-preserving conversion is best-effort; borderless tables may not be detected; XFA-form values do not export; signed-PDF sources stay valid (the export is a new file with no signature semantics); OCR status determines text fidelity. Conversion takes ~5-30 sec per page (layout-preserving) or ~0.5 sec per page (text-only).

**Channel-status reminder (0.7.1).** All six formats — Word (.docx), Excel (.xlsx), PowerPoint (.pptx), and image (PNG / JPEG / TIFF) — produce valid output end-to-end. The image-export standard-font glyph defect from 0.6.x (standard-font text rendered blank) is fixed in 0.7.1: a text PDF now exports to PNG / JPEG / TIFF with its text visible, verified from the packaged binary (25,688 dark pixels on a Helvetica/Times/Courier page versus 0 / blank before).

### How to start an export

Three routes, all do the same thing:

- **Tools menu** → **Export to Word** / **Export to Excel** / **Export to PowerPoint** / **Export to image** ▸ (PNG / JPEG / TIFF) — opens the modal pre-selected to that format.
- **Toolbar Export button** (the icon between Save and Print) — opens the modal with your last-chosen format pre-selected.
- **Ctrl+Shift+E** — opens the modal with your last-chosen format pre-selected.

The Export modal opens. It has four steps.

### Step 1 — Choose format

Pick the target format from the four large cards: **Word (.docx)**, **Excel (.xlsx)**, **PowerPoint (.pptx)**, **Image ▸**. The Image card reveals a sub-picker for PNG / JPEG / TIFF radios when selected. Image formats do not have a quality tier (see [Choosing a quality tier](#choosing-a-quality-tier)); selecting an image format also reveals the DPI dropdown, the JPEG quality slider (only when JPEG is the picked variant), and the multi-page-TIFF bundling checkbox (only when TIFF is picked).

**Last-chosen format** persists across sessions in `export-slice.lastChosenFormat`. If you exported to Word last week, Ctrl+Shift+E this week will reopen Step 1 with Word pre-selected.

Click **NEXT** to advance to Step 2.

### Step 2 — Quality and options

This step has three columns: **Quality**, **Pages + options**, and the **per-format limitations panel** (the trust-floor honesty surface IN the modal).

#### Choosing a quality tier

| Tier                                                                    | Best for                                                                                                       | What it produces                                                                                                                                                          |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layout-preserving (best-effort)** [recommended for Word + PowerPoint] | Documents where the visual layout matters (reports, brochures, magazines, slide decks).                        | Multi-column layouts (when detected), headings (font-size-MODE-bucketed classification), bordered tables (line-grid detection), embedded images (CTM-tracked extraction). |
| **Text-only (fast)** [recommended for Excel]                            | Documents where you just want the text content, no styling. Also faster (~0.5 sec/page versus ~5-30 sec/page). | A flat sequence of paragraphs, in reading order (multi-column detection still applies for ordering; column structure is discarded). No images, no tables, no headings.    |

Image formats (PNG / JPEG / TIFF) do not have a quality tier — they are pixel rasters at the chosen DPI; the radio group is hidden when an image format is selected.

The `[recommended]` badge tracks the per-format default from the locked decision Q-D: layout-preserving for Word + PowerPoint, text-only for Excel.

#### Per-format options

The options column depends on the chosen format:

| Format     | Options                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Word       | Page range (all / custom range); Include annotations checkbox; Page size dropdown (Letter / A4 / Auto — Auto uses source PDF's page size).                                      |
| Excel      | Page range; Include annotations checkbox (default OFF for Excel — cells are data, not visual).                                                                                  |
| PowerPoint | Page range; Include annotations checkbox. (PowerPoint always uses 16:9 widescreen with letterboxing — no slide-size picker in v0.6.0.)                                          |
| PNG        | Page range; Include annotations checkbox; DPI dropdown (72 / 96 / 150 / 200 / 300 / 600). One PNG file per page (filename gets `-p001`, `-p002`, ... suffix).                   |
| JPEG       | Page range; Include annotations checkbox; DPI dropdown; JPEG quality slider (0.1 to 1.0; default 0.9). One JPEG file per page.                                                  |
| TIFF       | Page range; Include annotations checkbox; DPI dropdown; Multi-page TIFF checkbox (when ON, all pages bundle into ONE multi-page .tiff file; when OFF, one .tiff file per page). |

Page range options: **All pages (1-N)** (default) or **Page range** with `start` and `end` numeric inputs (validated against the source PDF's page count). Inclusive on both ends.

#### Output path

A read-only path field with a **Browse…** button to the right. Browse… opens Electron's native save-as dialog with the format's default extension pre-filled. The dialog handles overwrite-existing-file prompts natively. The path is validated (writable parent directory) before the engine starts; if the path is unwritable, the Start button shows an inline error.

#### Per-format limitations panel

Below the options, the modal renders a panel of 4-6 calibrated bullets sourced from `src/client/components/modals/export-modal/per-format-limitations.ts`. The bullets surface the [Export trust floor](#export-trust-floor--what-the-app-does-and-doesnt-promise) obligations relevant to the chosen format:

| Format            | Bullets visible                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Word              | best-effort layout; borderless tables not detected; XFA doesn't export; signed-source-stays-valid; ~5-30 sec/page; images embedded as raster on layout-preserving tier                                        |
| Excel             | best for table-shaped PDFs; borderless tables won't appear; text-only tier dumps all text to one sheet; numeric coercion best-effort; signed-source-stays-valid; ~5-30 sec/page or ~0.5 sec/page on text-only |
| PowerPoint        | best-effort layout; one slide per page; 16:9 widescreen with letterboxing; borderless tables not detected; ~5-30 sec/page                                                                                     |
| PNG / JPEG / TIFF | rasterized at chosen DPI; annotations rendered inline when ON; multi-page TIFF bundles into ONE file; large DPI = large output files                                                                          |

Plus a link at the bottom of the panel: **Full details → Export trust floor** (anchor jump to this guide's [Export trust floor](#export-trust-floor--what-the-app-does-and-doesnt-promise) section).

Click **BACK** to revise format / image-variant choices, or **NEXT** to go to Step 3.

### Step 3 — Confirm and start

A one-screen summary: format / quality tier / page range / annotations setting / output path. Nothing pre-flight-confirmable (export does not mutate the source, so there is no destructive-action gate — unlike the [OCR](#running-ocr) Step 2 confirm). Click **START EXPORT** to enqueue.

### Step 4 — Background (modal closes after enqueue)

This is the **inversion of the Phase 5 OCR pattern**. The Phase 5 modal pins while OCR runs; the Phase 6 modal closes after enqueue. On Start:

1. The modal flashes a "Queued" toast for ~500 ms.
2. The modal closes.
3. The [status-bar export-progress widget](#status-bar-progress-widget) appears.
4. You can navigate freely — open another document, edit pages, browse forms, run OCR — while the export job runs in the background.
5. If you re-open the Export modal during a running job (Ctrl+Shift+E again, or the toolbar button), the modal opens in a compact "Running job: page 3 of 10 — extracting text… [Cancel]" view rather than restarting the format picker.

When the job completes, the status-bar widget changes to "Export complete — Open" for ~5 sec, then auto-dismisses. The Exports sidebar tab's "Recent" section shows the finished job with Open / Show in folder / Re-run actions.

If the job fails, the status-bar widget changes to "Export failed — Retry" and stays visible until clicked or dismissed; the Exports sidebar tab's row shows the error. The most common failure today is `'extraction_failed'` for docx / pptx / image jobs — see the v0.6.0 channel-status reminder at the top of this section.

### Cancelling an in-flight export

- **Status-bar widget Cancel button** — fast-path cancel; no confirm prompt (partial output cleanup is automatic via atomic `.export-temp` → unlink).
- **Exports sidebar tab → Cancel button on the running row** — same effect.
- **Re-opening the modal during a job → Cancel button in the running view** — same effect.

Cancel is graceful between per-page steps — once the engine has started writing a given page's content, that page finishes before the cancel takes effect. The job moves to `cancelled` status in the Exports sidebar. Partial output on disk (the `.export-temp` file) is deleted.

### Output-path collisions

If you pick an output path that already exists, Electron's native save-as dialog (which the path picker uses) shows the OS overwrite prompt. If you click Yes, the prior file is overwritten when the engine renames the temp file at the end of the run.

If a parallel export job (or a parallel external process) has touched the path between dialog and engine rename, the rename fails with `output_path_unwritable`. The sidebar row shows the error; nothing partial lands on disk.

**Note on the ExportQueue gap (Phase 6.1 follow-up):** in v0.6.0 the engine runs IPC calls inline rather than serializing through the documented FIFO `ExportQueue`. Two concurrent IPC requests against the same output path can race the `.export-temp` file. The modal warns "An export to this path is already running" if you try to start a second export targeting the same path while one is in flight, but the warning is best-effort (the renderer cannot see all concurrent processes). Phase 6.1 ships the ~50 LOC queue module that enforces concurrency=1 deterministically.

### Honesty reminder — Export trust floor

Per [Export trust floor](#export-trust-floor--what-the-app-does-and-doesnt-promise): all five Phase 6 obligations apply to every export flow. The most common surprises:

- A complex multi-column magazine layout exports as a flat reading-order paragraph stream when the column detector fails on that particular layout (obligation #1).
- A bordered table in the source renders as a Word / PowerPoint table; a borderless table renders as a flat paragraph stream (obligation #2).
- An XFA form's filled values don't export; flatten the form first via the Phase 3 surface, then export (obligation #3).
- A signed PDF source stays valid; the exported docx has no signature (obligation #4). If your downstream workflow needs a signed Office document, sign it in Office after export.
- An image-only PDF that was never OCR'd produces a docx / pptx with no selectable text (obligation #5). Run OCR first (Tools → Run OCR), save the searchable PDF, then export.

---

## Exports sidebar

**NEW in 0.6.0.** A 5th sidebar tab (alongside Pages / Bookmarks / Forms / OCR Results) listing in-flight + recent + failed export jobs for the currently-open document (filtered by file hash). Switch the left sidebar to the **Exports** tab to view.

### What the tab shows

```
┌── Exports ──────────────────────────────┐
│ Running                                  │
│ ┌────────────────────────────────────┐  │
│ │ Word  • my-doc.docx                 │  │
│ │ Page 3 of 10 — extracting text…    │  │
│ │ [Cancel]                            │  │
│ └────────────────────────────────────┘  │
│                                          │
│ Recent (3)                               │
│ ┌────────────────────────────────────┐  │
│ │ Word  • my-doc.docx                 │  │
│ │ Completed 2 min ago • 47p, 2t, 5img│  │
│ │ [Open] [Show in folder] [Re-run]   │  │
│ └────────────────────────────────────┘  │
│ ┌────────────────────────────────────┐  │
│ │ PNG   • my-doc-pages.png            │  │
│ │ Completed 1 hr ago • 10 pages, PNG │  │
│ │ [Show in folder] [Re-run]           │  │
│ └────────────────────────────────────┘  │
│ ┌────────────────────────────────────┐  │
│ │ Excel • my-doc.xlsx                 │  │
│ │ Failed 3 hr ago • output_path_unw…  │  │
│ │ [Retry] [Show error]                │  │
│ └────────────────────────────────────┘  │
│                                          │
│ [View all exports →]                     │
└──────────────────────────────────────────┘
```

**Honesty banner.** A short banner at the top of the panel links back to the [Export trust floor](#export-trust-floor--what-the-app-does-and-doesnt-promise) section — placement #2 in the four-doc-locations-plus-modal trust-floor ratchet.

### Sections

- **Running** — currently-executing job (one at a time in v0.6.0; the inline-execution path means only one job runs even when others are "queued"). Shows the format, output basename, current page-progress phase, and a Cancel button.
- **Recent** — completed / cancelled / failed jobs from the past sessions. Each row shows the format, output basename, completion timestamp, content stats (e.g. `47p, 2t, 5img` = 47 paragraphs extracted, 2 tables detected, 5 images embedded; image formats show "10 pages, PNG" instead). Action buttons: **Open** (opens the file in the OS default app), **Show in folder** (uses Electron's `dialog.showItemInFolder`), **Re-run** (re-opens the Export modal pre-populated with this row's settings — format + quality + page range + annotations).
- **Failed jobs** — shown inline in the Recent list with the error code (`output_path_unwritable`, `extraction_failed`, `queue_full`, etc.). **Retry** opens the modal pre-populated with the same settings; **Show error** opens an inline expansion of the full `error_message` field for diagnostics.

### "From older version" badge

If a row's `doc_hash` differs from the currently-open document's `doc_hash` (because you resaved the source PDF between exports — which changes the bytes and the hash), the row shows an inline badge **from older version**. The job's outputs on disk are still valid; the badge surfaces honestly that the source PDF has changed.

### Path stripping (privacy + boundary discipline)

The sidebar row shows only the output **basename** + a one-level **directory hint** (the parent-folder name, like `Downloads`). The full absolute path stays in the main process per the Phase 6 conventions §17.2 export-bytes-stay-in-main discipline. Show-in-folder works because the renderer dispatches via the `jobId`, not the raw path — the main process resolves the path from `export_jobs.output_path` and calls `dialog.showItemInFolder`.

### Re-run an export

Click **Re-run** on a Recent row. The Export modal opens at Step 2 with the row's settings pre-populated. The source document is the currently-open doc (NOT the doc the original export ran against, if those differ); adjust settings as needed and click Start Export to enqueue a fresh job.

---

## Status-bar progress widget

**NEW in 0.6.0.** The status bar (existing — page-count widget + zoom widget) gains a new section right of the page-count widget, visible only while a Phase 6 export job is `queued`, `running`, or recently-terminal:

```
| Page 3 / 10 | Zoom 100% |  EXPORT: my-doc.docx — page 3 of 10  [Cancel] |
```

### What the widget does

- **Visible only when a Phase 6 job is in flight or recently terminal.** Hidden when no jobs are running and no recent job is pending dismissal.
- **Click the widget** → switches the sidebar to the Exports tab + scrolls to the running job's row.
- **Cancel button** → fast-path cancel (no confirm prompt; partial output cleanup is automatic).
- **Auto-dismiss** — when a job completes successfully, the widget flips to "Export complete — Open" for ~5 sec, then auto-hides. Failed jobs stay visible until clicked or dismissed.

### Honesty reminder — Export trust floor

Per [Export trust floor obligation #4](#the-five-phase-6-obligations): an export running in the background does NOT touch the source PDF — your edits, annotations, signatures, and OCR data are unaffected. You can save the source while an export runs; the export will continue against the document bytes captured at the start of the job.

---

## Scanning from a device

**Phase 5.1 — LIVE on Windows as of 0.7.3.** The Tools → Scan from device menu item is enabled on Windows when the native WIA addon is loaded. On macOS / Linux the menu item stays disabled with a tooltip ("Scanning is supported on Windows only; the underlying WIA API is a Windows-only Microsoft component"). The 0.7.3 release shipped a custom pure-Node-API COM addon (`native/wia-scanner/`) that talks directly to the Windows Image Acquisition (WIA) subsystem via `IWiaDevMgr2`; there is no third-party native dependency.

**Honesty reminder.** Scanning is a hardware-driven operation — the addon enumerates devices the OS reports and forwards your selections to the device through Microsoft's WIA driver. **The app does NOT communicate over the network at scan time** (the WIA driver may, e.g. for network MFPs you've already paired through Windows). The scanned bytes live in main-process memory until you save the composed PDF (see [Save](#saving)). The IPC bridge never sends raw scan bytes across to the renderer — only the document handle and a summary.

### Open the scan modal

- **Tools menu → Scan from device…**, OR
- **File menu → Scan from device…**

The scan modal opens.

### Step 1 — Pick a device

The modal lists every device Windows surfaces through WIA — flatbed scanners, sheet-fed scanners, all-in-one MFPs, document feeders. Each row shows:

- **Device name** (as reported by the WIA driver, e.g. `Xerox WIA - Office_MFP_C415`)
- **Type** (`scanner` / `multi-function-peripheral` / `camera`)
- **Description** (free-text from the driver)

If no devices are listed: confirm the scanner is powered on, connected (USB or network-paired through Windows Settings → Devices → Scanners), and that Windows itself sees it (Windows Settings → Printers & scanners). The modal's **Refresh** button re-runs `scan:listDevices` against the live driver list.

If the modal opens disabled with the tooltip "**Scanner unavailable**", the addon failed to load — see [Troubleshooting → "Scanner unavailable" or "Scan from device" disabled](#scanner-unavailable-or-scan-from-device-disabled-phase-51) below.

### Step 2 — Acquire options

Pick how the scanner should produce pages:

- **Resolution (DPI)** — common choices: 150 (fast, OCR-acceptable), 300 (the recommended default for text + OCR), 600 (archival / fine detail). Higher DPI = larger pages + slower scans.
- **Color mode** — `Color`, `Grayscale`, or `Black & White` (1-bit). For text-only scans destined for OCR, Grayscale is the recommended default (sharper edges than B&W, smaller files than Color).
- **Source** — `Flatbed` (single page) or `Document feeder (ADF)` (multi-page). ADF is only available on scanners that report a feeder item.
- **Page count** (ADF only) — `All available pages` (the default; the feeder runs until it's empty) or a numeric limit.

Click **Start scan**. The scanner begins acquiring; a progress indicator shows per-page status.

### Step 3 — Review and save

When acquisition completes, the modal shows a thumbnail strip of every scanned page. You can:

- **Reorder** pages by drag.
- **Delete** an obviously-bad page (jam, misfeed) before composition.
- **Rescan** a single page (re-runs `scan:acquire` for one page).

Click **Compose to PDF**. The addon's output (uncompressed BMP by default; PNG / JPEG / TIFF if the driver reports those native formats) is normalized and composed into a single multi-page PDF via pdf-lib. The composed PDF opens as a new document in the viewer ("Scanned Document.pdf").

### Step 4 — Optional: Scan → searchable PDF (one-click OCR chain)

If you tick the **Run OCR on scanned pages** checkbox in step 2, the scan modal hands the composed document handle directly to the [OCR pipeline](#running-ocr) when you click Compose to PDF. The OCR wizard opens pre-pointed at the scanned document; pick a language and click Next. This is the canonical scan→searchable-PDF flow that the Phase 5.1 brief always targeted.

You can also save the scanned document first and run OCR later (`Tools → Run OCR`) — same outcome.

### Limitations

- **Windows only.** WIA is a Microsoft API. On macOS / Linux the menu item is disabled and the IPC channel returns `scanner_unavailable`. macOS scanner integration (Image Capture / ICA) and Linux SANE bindings are future work outside Phase 5.1 scope.
- **The app does not support TWAIN.** TWAIN is a legacy parallel scanner API; modern Windows scanner drivers expose WIA. If your scanner has only a TWAIN driver and no WIA component, the device may not appear in the modal. Use the scanner manufacturer's bundled software to scan to a PDF / image and then open the file here.
- **Mid-scan cancel is best-effort.** Some drivers ignore cancel until the current page finishes; the modal's Cancel button surfaces the request immediately but completion is driver-dependent. (Same constraint as Phase 5 OCR mid-page cancel.)
- **Scan progress reporting is per-page, not per-line.** A long flatbed scan shows "Scanning page 1…" until the driver reports completion; you cannot see a sub-page progress bar from the WIA API.
- **No paper-orientation auto-detection.** A misfed page (90° rotated, upside-down) is scanned as-is. Rotate the page in the viewer (Ctrl+R) before OCR or save.

### Workaround if scanning isn't available

If you're on macOS / Linux, or your Windows scanner doesn't appear in the device list:

1. Use the **Windows built-in Scan app** (Start → Search → "Scan") or your **scanner manufacturer's bundled software** (HP Smart, Epson Scan, Brother iPrint&Scan, Canon IJ Scan Utility, etc.) to scan a page to PDF or image.
2. Open the produced file in PDF_Viewer_Editor (File → Open, or drag-drop).
3. Run [OCR](#running-ocr) over the imported pages.

This workflow produces exactly the same searchable-PDF output as the native scanner integration, just with an extra OS-level step.

---

## Mail merge

PDF_Viewer_Editor 0.3.0 ships a 4-step mail-merge wizard. Press **Ctrl+M** or pick **Tools → Mail Merge** to open it.

**Honesty reminder.** If the template document carries JavaScript form actions, every per-row output is JS-stripped (locked decision P3-L-2). If the template document is signed, every per-row output has its signature invalidated (Phase 3 does not preserve signatures across save). The [status banner](#forms-sidebar-status-banner--three-honesty-warnings) on the source document tells you up front; the wizard surfaces a confirmation prompt if either flag is set.

### How mail merge works

The wizard reads a CSV or Excel file row-by-row, maps each row's columns to your form's fields, fills the form per row, and writes either a folder of N PDFs (one per row) or one concatenated PDF with all rows.

The runner lives in the main process (not in a worker or new BrowserWindow). It parses the data source once, loads the template document bytes once, and clones a fresh `PDFDocument` per row so per-row fills don't bleed across iterations. Each per-row save uses an atomic temp+rename (so a power loss mid-run never corrupts a target file).

### Step 1 — Template

Pick what to fill:

- **Use currently open document** — fills the open PDF's fields.
- **Saved template** — pick from your saved form templates (the same templates the Forms sidebar shows).

The wizard previews the template's field count and the first few field names.

### Step 2 — Data source

Click **Choose file…** or drop a CSV/XLSX file onto the wizard. The wizard parses the first 5 rows + the header to give you a preview; the full file stays in main.

Drag-drop supports `.csv`, `.xlsx`, and `.xls` extensions. The same window-level drag-drop pathway that handles PDF + image drops carries these files (Electron's `File.path` Phase 1 wiring).

A warning surfaces if an XLSX file has more than one sheet — **only sheet 1 is read in Phase 3.** Excel sheet picker is a Phase 3.1 candidate.

A note on Excel formulas: **`exceljs` does not evaluate formulas.** If your XLSX has formulas, the wizard reads the cached value (if Excel saved it on close) or the formula string. The robust workaround is paste-as-values upstream in Excel before exporting.

### Step 3 — Column mapping

Map data-source columns to form fields. Auto-detect runs first (case-insensitive `columnName === fieldName`); the wizard pre-populates matches.

For each unmatched column, pick a target field from the dropdown, or pick **(skip)** to ignore it. Required form fields that don't have a column mapping block the Next button with an inline error: "Required field 'agreement_date' has no column mapping."

If your template was previously used for a merge, `lastColumnMappings` pre-populates this step so the second run is one-click ready.

### Step 4 — Output

Pick how the merged PDFs should be written:

- **Folder of N PDFs** — pick an output folder + filename template (e.g. `contract-{LastName}-{rowIndex:04}.pdf`). Available substitutions: any column name from the data source, plus `{rowIndex}` and zero-padded variants like `{rowIndex:04}`.
- **Single concatenated PDF** — pick a save location and filename; all N rows are written into one document.

**Flatten forms in output** checkbox: when checked, each per-row output runs `form.flatten()` before writing — the resulting PDFs have no interactive form fields (just the rendered text/checkbox/etc baked into the page content streams). Useful for distributing forms you don't want recipients to edit further.

### While the merge runs

A progress modal shows the current row, total rows, and percent complete. The progress bar updates via `mail-merge:progress` events streamed from main to renderer. The **Cancel** button is always enabled.

If you cancel:

- **Folder mode:** rows already written stay on disk; the partial result is reported.
- **Concat mode:** no output file is written (atomic save discards partial work).

If a per-row fill fails (e.g. a date value the parser couldn't accept), the modal switches to an error state showing the failing row index, the error, and how many files were written before the failure. Folder-mode partial output stays on disk; concat-mode discards.

### Mail merge performance

Empirically (Wave 12 measurements on a 100-row CSV with a 12-field template, 100 KB template PDF, modern Windows laptop):

- 100 rows ≈ 250–370 ms
- 500 rows ≈ 1.5–2 seconds
- 5000 rows ≈ 15–25 seconds

Folder mode has near-constant memory footprint (write per row, GC the PDFDocument). Concat mode keeps each row's bytes until the final concatenation — peak memory ≈ N × per-row-bytes. For very large jobs (10k+ rows), folder mode is preferred.

### Limitations of mail merge

- **One sheet per XLSX** (Phase 3.1 candidate for picker).
- **No formula evaluation** (use paste-as-values upstream).
- **No per-row signature** (Phase 4 lands signing).
- **No template substitution inside the document's static text** (mail merge fills form fields only, not static page content).

---

## Working with bookmarks

PDF_Viewer_Editor 0.2.0 ships full bookmarks authoring — create, rename, nest, reorder, delete — with cycle detection on drag-and-drop.

### Open the bookmarks panel

Switch the left sidebar to the **Bookmarks** tab.

The panel shows two sources:

1. **Native PDF outline** — the bookmark tree authored into the file itself. Click any entry to jump to its page.
2. **Your bookmarks** — pages you've marked in this session for this file. Stored in SQLite, keyed by the file's content fingerprint, so they persist across app restarts and survive if you move the file.

### Create a bookmark

- Right-click in the panel → **New bookmark** (creates a bookmark at the current page), OR
- Right-click any thumbnail in the sidebar → **Bookmark this page**, OR
- Click the **+** button at the top of the bookmarks panel

The new bookmark appears at the bottom of the tree with a default name. Double-click the label or press **F2** (with the bookmark focused) to rename.

### Rename a bookmark

- Double-click on the label, OR
- Right-click → **Rename**, OR
- Select the bookmark and press **F2**

Press **Enter** to commit, **Esc** to cancel.

### Nest a bookmark

Drag a bookmark onto another bookmark in the panel to make it a child. The dragged bookmark becomes the last child of the target. The cycle-detection algorithm rejects drops that would create a loop (e.g. dragging a parent onto its own descendant) with a "Would create a cycle" toast.

### Reorder a bookmark

Drag a bookmark up or down within the same parent to change its position. Reorder operations preserve the bookmark's children.

### Delete a bookmark

- Right-click → **Delete**, OR
- Select the bookmark and press **Delete**

Deleting a parent also deletes its descendants (delete-cascade). Use **Ctrl+Z** to undo.

### Limitations

- **Bookmarks are scoped to a single file** (keyed by file hash). Cross-file navigation is Phase 5+.
- A failed cross-file move surfaces as "Invalid request" rather than a more specific message — see the [`MoveBookmarkResult` discriminated union](#known-limitations-in-phase-2) note above; a precise wire variant is a Phase 2.5 follow-up.

---

## Printing

PDF_Viewer_Editor 0.2.0 dispatches print jobs through Electron's `webContents.print()`. Press **Ctrl+P** or use **File → Print** to open the system print dialog.

### What happens when you press Ctrl+P

1. The renderer asks main to dispatch a print job for the current document.
2. Main runs the edit-replay engine to produce the up-to-date document bytes (so all your edits are part of the printed output), constructs a hidden BrowserWindow (security floor preserved — see [developer-guide → security-floor](developer-guide.md#l-001--enabledragdropfiles-must-stay-default) for L-001 enforcement), loads the bytes, and invokes the OS print dialog through the embedded webContents.
3. You pick a printer in the OS dialog, click Print, and the job is dispatched.

### What you'll see

- A toast "Sending to printer…" while the job is queued.
- A toast "Sent to printer" once the OS accepts the job. (We do NOT track per-printer success; that's the OS's responsibility.)
- If something goes wrong before dispatch — usually a bytes-build failure for a document with a corrupt edit chain — you'll see "Print failed: ..." with the specific reason.

### Limitations

- **No in-app print preview.** The OS print dialog has its own preview; we don't render one in the app. Phase 3 will add a preview pane + print settings UI.
- **No print-settings persistence.** Each Print press opens the OS dialog with OS defaults; settings don't survive between prints.

---

## Print to PDF

PDF_Viewer_Editor 0.2.0 exports the current document to a new PDF file via **Ctrl+Shift+P** or **File → Print to PDF**. The export uses one of two engines depending on a heuristic.

### The two engines

| Engine                  | When it's picked                                                                                                            | What it does                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pdf-lib (default)**   | Documents without unauthorable annotations, fewer than ~10 overlay objects per page, no text-replace ops in the edit chain. | Replays the edit chain via the same engine that powers Save, then writes the result through pdf-lib. Byte-stable, fast, deterministic.                                                                                                                        |
| **Chromium (fallback)** | Documents with unauthorable annotations, ≥10 overlay objects per page, or text-replace ops in the edit chain.               | Renders the document through an offscreen BrowserWindow (security floor preserved, L-001 enforced) and uses `webContents.printToPDF()` to write the output. Slower; bytes are not deterministic across runs (Chromium's own bytes-build is non-reproducible). |

You can force a specific engine via **Settings → Export → Default engine** (`pdf-lib` / `chromium` / `auto`). The default is `auto` (heuristic picks).

### Engine selection feedback

When you press Ctrl+Shift+P, a brief "Engine: pdf-lib" or "Engine: Chromium (reason: …)" indicator appears in the toast that confirms which engine ran. The reason string is one of: `default`, `forced-by-setting`, `forced-by-overlay-threshold`, `forced-by-unauthorable-annotation`, `forced-by-text-replace`. See [api-reference.md](api-reference.md#pdfexport) for the full reason enum.

### Flatten forms in output (Phase 3)

The Export to PDF dialog has an Advanced section with a **Flatten forms in output** checkbox (Phase 3 addition). When checked, the engine calls `form.flatten()` over the output PDF before writing — interactive form fields are baked into the page content streams as static text/checkboxes/etc, with no `/AcroForm` left in the file.

- The checkbox is **greyed out** when the chosen engine is Chromium (Chromium output is always flattened) or when the document has no AcroForm.
- The default state is controlled by the `forms.flattenOnExportDefault` setting (default `false`).
- Flatten is **irreversible in the output file**. The interactive version stays in your in-memory document, so a subsequent Save (which doesn't flatten) preserves interactivity in the source.

Save As does NOT get a flatten checkbox — Save is interactivity-preserving by design. Use Print to PDF when you want flattened output.

### Limitations

- **Chromium engine produces non-deterministic bytes.** Same input, same edit chain → different output bytes across runs. This is Chromium's behavior, not ours. For deterministic exports, force `pdf-lib`.
- **Forms, signatures, and embedded JavaScript are not preserved in Chromium output.** The Chromium engine renders the document, then writes the rendered pages — interactive structures are flattened. If your document has those structures and you need them preserved, force `pdf-lib`.

---

## Saving

Two save commands:

| Action       | Shortcut         | Behavior                                                                                       |
| ------------ | ---------------- | ---------------------------------------------------------------------------------------------- |
| **Save**     | **Ctrl+S**       | If the file was opened from disk, writes to the same path. Otherwise opens the Save As dialog. |
| **Save As…** | **Ctrl+Shift+S** | Always opens the native save dialog; you choose the destination.                               |

On success the status bar shows "Saved to `<filename>.pdf`" and the document's modified indicator clears.

**Save preserves your edits.** Rotations, deletions, reorders, insert-blanks, annotations, image overlays, image-page inserts, text replacements, and bookmark changes all persist to disk via the edit-replay engine. The Phase 1 fidelity caveat is retired.

### What happens behind the scenes

When you press Ctrl+S:

1. The renderer collects the document's edit-op log and annotation list and dispatches them to main via the `fs:applyEditOps` IPC channel.
2. Main loads the original bytes from its per-handle store, runs the [edit-replay engine](edit-replay-engine.md) — a pure function that applies each op in order through pdf-lib to produce the new bytes — and emits the requested annotations.
3. Main writes the resulting bytes via an **atomic temp-rename**: write to `<destination>.tmp`, then rename to `<destination>`. Partial saves can never leave a corrupt file at the destination path.
4. On success, the document's modified indicator clears and the renderer flushes the dirty-op log (next save starts from a clean baseline).

The Save engine is always **pdf-lib**. The dual-engine choice (pdf-lib vs Chromium) only applies to [Print to PDF](#print-to-pdf), where Chromium's renderer fallback exists to cover documents with structures pdf-lib doesn't author.

### What you can rely on

- The output file is a syntactically valid PDF that opens in any reader.
- The output file contains every edit you made in this session: rotations, deletions, reorders, blanks, annotations (including Phase 4 shapes + visual signatures), image imports, text replacements, form values, bookmarks, AND embedded PAdES cryptographic signatures (cryptographically bound to the saved bytes).
- Saving does not corrupt or overwrite the source file unexpectedly (atomic temp-rename plus the renderer-doesn't-see-paths rule).
- Recents and bookmarks for the saved file are correctly recorded.

### What Phase 4 adds to Save semantics

- **Visual signatures** persist through Save like any other annotation. The widget annotation + appearance stream + empty `/V <<>>` marker are written by the edit-replay engine at save time.
- **PAdES cryptographic signatures** are written by the signing flow itself (not by Save) — the wizard's step 3 produces the signed bytes and writes them via atomic temp+rename in the same path Save would. The signed PDF is on disk before the wizard closes.
- **Saving AFTER a PAdES signature was applied earlier in the same session** is rejected with `pades_invalidated_by_subsequent_edit`. Any post-sign edit would invalidate the byte-range hash; the engine fails loudly rather than producing a structurally-invalid signed file. To make further edits, undo the post-sign ops OR re-sign the document after the edits (computing a new byte-range hash).
- **Loading a doc with EXISTING PAdES signatures from a prior session** displays the Forms sidebar status banner warning that those signatures will be invalidated by subsequent edits. The save engine does NOT re-validate the existing signatures (Phase 4 makes no claim about prior signatures' integrity) — it just preserves their bytes unless you edit them. See [PAdES trust floor](#pades-trust-floor--what-the-app-does-and-doesnt-promise) obligation #1.

### What Phase 5 adds to Save semantics

- **OCR text-behind-image layers persist through Save.** The new `ocr-text-behind-applied` EditOperation is handled at replay step 3.9 — after page-structure ops, forms, and shape annotations, but before the global emit-annots step. The text-behind-image layer is appended to each affected page's `/Contents` stream as BT/ET blocks with rendering mode 3 (invisible).
- **Save on an OCR'd-then-PAdES-signed document** follows the same step-3.7 PAdES invalidation discipline carried over from Phase 4. If the OCR op was applied before the PAdES signature, replay produces a structurally-valid signed PDF whose signature covers the post-OCR bytes — which is the correct behavior. If a PAdES signature was applied and then OCR was run after, Save aborts with `pades_invalidated_by_subsequent_edit` (the OCR step itself surfaces a confirm prompt earlier in the flow — see [Running OCR step 2](#step-2--confirm-if-signed)).
- **Re-running OCR adds another text layer.** The save engine does NOT auto-detect "this page already has a text-behind-image layer". Multiple OCR passes produce multiple overlapping invisible text layers in the saved PDF. See [OCR trust floor obligation #4](#the-four-phase-5-obligations).
- **OCR is undoable per Save boundary.** Ctrl+Z while the OCR op is in the dirty-ops queue (pre-Save) removes the text-behind-image layer from the in-memory document. After Save, the layer is on disk; undoing post-Save reverts the renderer state but a subsequent Save would rewrite the file without the layer. The atomic-save invariant guarantees no half-applied OCR ever lands on disk.

### What still isn't supported

- **Text replacements that don't fit the original glyph run width** — Save fails with `clipped` (see [Editing text](#editing-text)). Fix the replacement and retry.
- **Text replacements with characters the original font doesn't have** — Save fails with `missing_glyph`. Fix the replacement and retry.
- **Cross-document edit chains** (e.g. ops that reference pages from a different open handle) — return a warning.
- **JavaScript form actions on AcroForm fields** — stripped silently on save (Phase 3 locked decision P3-L-2). A warning toast surfaces when JS actions are stripped: "JavaScript actions stripped from document (Phase 3 limitation)."

### Forms on Save

If you've filled form fields in this session, Save auto-commits them BEFORE writing the file. The HYBRID commit boundary (see [Working with forms](#the-commit-boundary)) means form fills are batched into one undoable operation on Save. Authored fields (added in the form designer) are written into the document's `/AcroForm /Fields` array as standard ISO-32000 AcroForms — your file remains portable to any compliant reader (Acrobat, Edge, Foxit, Preview).

If you want a non-interactive (flattened) version, use **Print to PDF** with the "Flatten forms in output" checkbox instead of Save. Save preserves interactivity by design.

### Save As behavior

Save As always opens the native save dialog and writes to the chosen destination. Picking a path inside the source file's directory does not overwrite the source — the destination must be the exact path you choose. The renderer never sees absolute paths; main holds the destination token (60-second TTL) and resolves it on write.

---

## Changing the interface language

**New in 0.7.0.** Open Settings (**Ctrl+,**) → **General** → **Interface language**.

1. Pick a language from the dropdown. Two are available:
   - **English (US)** — `en-US`, the complete baseline.
   - **Español (España)** — `es-ES`, a **translation sample**.
2. The entire UI switches **immediately** — no restart. Menus, toolbar tooltips, modals, settings, and the empty-state text all re-render in the chosen language.
3. Your choice persists across launches (stored under the `i18n.locale` setting).

> **Honesty reminder — Spanish is a sample, not a complete translation** (Phase 7 trust-floor obligation #4; see [Phase 7 trust floor](#phase-7-trust-floor--what-the-app-does-and-doesnt-promise)). The locale picker labels it directly: _"translation sample, some strings may appear in English."_ Roughly 70% of strings are translated — the high-traffic surfaces (menus, toolbar, sidebar, common modals, Settings, About, and **all the honesty/privacy copy**) are in Spanish, but some deep modal _step_ prose (e.g. the multi-step OCR-invalidate confirm, signature-capture sub-steps) remains English. Any untranslated string falls back to English automatically — **you will never see a raw key like `toolbar:open` on screen.** Completing the deep modal-step translation is a Phase 7.1 item.

Adding more languages later (French, German, etc.) is purely additive — a new locale folder and a picker entry, no code change. The app does **not** auto-detect your OS language in 0.7.0 (the default is English; you opt into Spanish), because the proof locale is incomplete and a surprise mid-flow switch would be worse than a deliberate one.

Dates, numbers, and relative times ("5 min ago") in the UI follow the active locale via the platform `Intl` API — there is no extra date/number-formatting dependency.

---

## Telemetry and privacy

**New in 0.7.0.** Open Settings (**Ctrl+,**) → **General** → **Privacy**.

PDF_Viewer_Editor can record **anonymous feature-usage counts** to help understand which features get used. It is **OFF by default** and **opt-in** — you turn it on with a single checkbox, and you can read everything it has recorded at any time.

### What it is

- A small set of allowlisted **event names** (e.g. "a document was opened", "an export ran", "the locale changed") plus a **day bucket** (`YYYY-MM-DD`, never a precise timestamp). That is the _entire_ payload — there is no field for a file name, a document title, a user identity, a field value, or any free text.
- A bounded **in-memory ring buffer** (default 500 entries). When it fills, the oldest entry is dropped.

### What it is NOT (Phase 7 trust-floor obligation #1 — see [Phase 7 trust floor](#phase-7-trust-floor--what-the-app-does-and-doesnt-promise))

- **It does not send anything anywhere.** There is no network transport — nothing leaves your machine. No analytics endpoint, no third-party SDK (no Google Analytics, no Sentry, no PostHog/Mixpanel/Amplitude).
- **It does not store personal data, document content, or file paths.** This is enforced _structurally_, not by discipline: the event shape physically cannot carry anything beyond an event name and a day bucket, so even a careless future change cannot leak personal data (see [developer guide → Telemetry framework](developer-guide.md#telemetry-framework-phase-7) for the `.strict()` schema guard).
- **It does not persist across restarts.** There is no `telemetry_events` table in the database — the buffer is in-memory by design, so it cannot be forensically recovered from the `.sqlite` file. Only the opt-in _flag_ persists.
- **It does not log the events.** Nothing about a recorded event is written to the app's log files.

### Turning it on, off, and inspecting the buffer

1. Tick **"Help improve the app with anonymous usage data"** in Settings → General → Privacy. The default state is **unchecked (OFF)**.
2. The always-visible privacy copy beneath the toggle restates the obligations: _off by default, anonymous counts only, never document content or file paths, nothing leaves your computer._
3. Click **"View collected data"** to open the debug panel — a plain table of event name + day bucket. This is what makes the opt-in **auditable**: you can see precisely what the framework has buffered.
4. **Turning the toggle OFF clears the buffer immediately** — no orphaned events survive an opt-out.

While the toggle is OFF, the app records nothing at all — events are dropped before they would even be buffered.

---

## Checking for updates

**New in 0.7.0.** Two paths: **Help → About → "Check for updates now"**, or Settings → **General** → **Updates**.

### The update channel

- **Manual** (default) — the app checks for updates only when you click the button.
- **Automatically on launch** — the app checks once at startup. OFF by default (the default is Manual) because there is no real release channel to check yet.

### The real channel — and the honest status it reports (Phase 7 trust-floor obligation #2 — see [Phase 7 trust floor](#phase-7-trust-floor--what-the-app-does-and-doesnt-promise))

**As of 0.7.2, the publish target is real.** The bundled `app-update.yml` points at `SuperiorAg/PDF_Viewer_Editor` on GitHub (`releaseType: draft` for publish safety — each release is created as a draft and a human promotes it to live). When you click "Check for updates", the app contacts that live feed and reports what actually happened:

- **"You're up to date"** — the live feed advertises a version equal to yours.
- **"Update available: v0.7.6"** (or whatever the new version is) — the feed advertises a newer version. The Download button is enabled; the Install button is gated on a code-signing certificate (see below).
- **"The update feed could not be read"** (or a similar network/feed error) — the app contacted the channel and got an error response. The most common cause: a draft release has not been promoted yet, so the unauthenticated feed read returns 404.

The app does **not** show a fake "you're up to date" — every status reported is the result of a real network call against the real feed. (The 0.7.0–0.7.1 binaries showed "update channel not configured" because the bundled `app-update.yml` carried a `PLACEHOLDER` owner/repo; that short-circuit is gone in 0.7.2+.)

> **Auto-update install is still gated on a code-signing certificate.** Even with a real feed, `electron-updater` correctly refuses to apply an unsigned update bundle (correct security behavior). The check + download paths work today; the install path needs the cert, which is a manual real-world acquisition step. See [README → Roadmap status → Deferred](../README.md#deferred--requires-external-resources).

> **Safety note — the unsaved-work install gate.** Clicking "Restart and install" prompts to save any unsaved edits first (Julian H-29.1, resolved end-to-end in 0.7.2). Three options: Save and install (runs Save then re-tries the install), Discard and install (proceeds without saving), Cancel (closes the dialog). The main-process gate refuses to install if the renderer reports unsaved work AND the discard flag is not set — defense-in-depth.

---

## The About modal

**New in 0.7.0.** Open with **Help → About**.

The About modal shows:

- The app version (**0.7.0**) and name.
- **Acknowledgments** — the permissive open-source libraries the app stands on, including the Phase-7 additions: **i18next**, **react-i18next**, and **electron-updater** (all MIT), alongside pdf.js, pdf-lib, tesseract.js, docx, exceljs, pptxgenjs, node-signpdf, and better-sqlite3.
- A **"Check for updates now"** button and the update-status area (which renders the honest "update channel not configured" notice described in [Checking for updates](#checking-for-updates)).

The About content is also reachable as the **About tab** inside the Settings modal.

---

## Accessibility

**New in 0.7.0.** Phase 7 audited the app to **WCAG 2.1 Level AA** for the critical paths and remediated the deferred Phase-1 accessibility debt. Tested screen reader: **Windows Narrator**.

### What works by keyboard

- **Every critical path is keyboard-navigable**: open a PDF (`Ctrl+O` or the focusable "Open file…" button / recents list), navigate (`PageDown`/`PageUp`, `Ctrl++`/`Ctrl+-`, `Home`/`End`), annotate (tool selection + text/sticky/shape via keyboard), fill forms (native controls, Tab through fields), and save (`Ctrl+S`).
- **Tab patterns.** The sidebar tabs (Pages / Bookmarks / Forms / OCR / Exports) and the Settings tabs (General / Files / Export / Editing / About) use the proper WAI-ARIA tab pattern: a single Tab stop, **arrow keys** move between tabs, **Home/End** jump to first/last. The toolbar is a single Tab stop with arrow-key traversal across its buttons (disabled buttons are skipped).
- **Thumbnail strip.** Arrow keys move between pages; Enter/Space navigates; Home/End jump; Delete removes a page; Ctrl/Cmd+A selects all.
- **Modals trap focus and return it.** Opening a modal moves focus into it and keeps Tab/Shift+Tab cycling within it; **Esc always closes** (no keyboard trap); closing returns focus to the control that opened it. Destructive confirm dialogs (unsaved-changes, OCR-invalidates-signatures) default focus to the **safe** (non-destructive) button.
- **Visible focus.** Every focusable element shows a focus ring on keyboard navigation; it is never suppressed.
- **Status announcements.** Page changes, save status, and export progress are announced via polite live regions; errors are announced assertively.

### Honest gaps (Phase 7 trust-floor obligation #5 — see [Phase 7 trust floor](#phase-7-trust-floor--what-the-app-does-and-doesnt-promise))

- **Freehand annotation drawing has no keyboard equivalent** — drawing an arbitrary stroke is pointer-only. The highlight, strikethrough, text box, sticky note, and shape tools _are_ keyboard-accessible, so you have a complete keyboard annotation workflow without freehand.
- **Drawn signatures require a pointer** — the typed and image-based signature methods are fully keyboard-accessible.
- **The rendered page raster is not narrated** — a screen reader cannot read the visual content of a page image. If you run [OCR](#running-ocr) on an image-only page, the recognized text _is_ exposed to the accessibility tree; un-OCR'd image pages are opaque to the reader.
- **Only Windows Narrator is tested.** NVDA, JAWS, macOS VoiceOver, and Linux Orca are unverified in 0.7.0.

---

## Settings

Open with **Ctrl+,** or **File → Settings**.

| Setting                                                            | Default                | Notes                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default zoom                                                       | Fit width              | Applied when a new document opens.                                                                                                                                                                                                                                                                          |
| Theme                                                              | System                 | Honors system colors. Light / dark theme toggles ship in a later phase.                                                                                                                                                                                                                                     |
| Recents — maximum items                                            | 20                     | How many entries the recents menu remembers.                                                                                                                                                                                                                                                                |
| Open — maximum file size (MB)                                      | 500                    | Files larger than this surface a "Too large" toast.                                                                                                                                                                                                                                                         |
| Make PDF_Viewer_Editor the default PDF handler                     | Off                    | The installer's checkbox during install is the working path. The in-app runtime toggle reads the current OS state.                                                                                                                                                                                          |
| Export — default engine                                            | Auto                   | Print-to-PDF engine choice: `auto` (heuristic), `pdf-lib`, or `chromium`. See [Print to PDF](#print-to-pdf).                                                                                                                                                                                                |
| Export — show warnings toast                                       | On                     | Toggles the Chromium-engine warning ("forms/signatures flattened") and the multi-page-TIFF first-page-only warning.                                                                                                                                                                                         |
| Annotation — author default                                        | (empty)                | Shows in the `T` (`/Title`) field of new annotations.                                                                                                                                                                                                                                                       |
| Undo — maximum history depth                                       | 100                    | Maximum number of undo entries kept per document.                                                                                                                                                                                                                                                           |
| Forms — date locale                                                | System                 | Controls the date picker's input parsing: `System`, `en-US`, `en-GB`, or `ISO`. Storage in the PDF is always ISO-8601.                                                                                                                                                                                      |
| Forms — flatten on export by default                               | Off                    | Sets the default state of the "Flatten forms in output" checkbox in the Export-to-PDF dialog and the Mail Merge wizard.                                                                                                                                                                                     |
| Mail merge — last output folder                                    | (auto)                 | Auto-populates the folder picker in wizard step 4.                                                                                                                                                                                                                                                          |
| Mail merge — default output mode                                   | Folder                 | Pre-selects "Folder of N PDFs" or "Single concatenated PDF" in step 4.                                                                                                                                                                                                                                      |
| **Signing — TSA URL** (Phase 4)                                    | (empty)                | RFC 3161 Time-Stamp Authority URL. HTTPS only. See [PAdES trust floor](#pades-trust-floor--what-the-app-does-and-doesnt-promise) obligation #3 — the app ships no default TSA.                                                                                                                              |
| **Signing — Enable TSA** (Phase 4)                                 | Off                    | When ON, the PAdES wizard's step 2 "Use TSA" checkbox is available. Off-by-default per locked decision P4-L-2.                                                                                                                                                                                              |
| **Signing — TSA timeout (ms)** (Phase 4)                           | 30000                  | Max round-trip time for the TSA HTTP request. After timeout, the sign fails loudly.                                                                                                                                                                                                                         |
| **Signing — Placeholder size (hex chars)** (Phase 4)               | 16384                  | Size of the `/Contents` placeholder slot the engine reserves for the CMS envelope. Long cert chains may need 32768. Advanced.                                                                                                                                                                               |
| **Signing — Default Show Date** (Phase 4)                          | On                     | Default state of the "Show date" checkbox in the Signature Capture + PAdES Sign modals.                                                                                                                                                                                                                     |
| **Signing — Default Show Subject CN** (Phase 4)                    | On                     | Default state of the "Show Subject CN" checkbox in PAdES Sign (visual signatures never show Subject CN).                                                                                                                                                                                                    |
| **Signing — PAdES engine** (Phase 4.1 toggle)                      | `signpdf`              | `'signpdf'` uses `node-signpdf` (default); `'manual'` uses the `node-forge` + `pkijs` fallback engine. Advanced — see [user-guide → PAdES](#pades-cryptographic-signing).                                                                                                                                   |
| **Annotations — Default border width (pt)** (Phase 4)              | 1                      | Default border width for new rectangle / ellipse / polygon shape annotations.                                                                                                                                                                                                                               |
| **Annotations — Default border style** (Phase 4)                   | Solid                  | `'solid'`, `'dashed'`, `'dotted'`.                                                                                                                                                                                                                                                                          |
| **Annotations — Default fill enabled** (Phase 4)                   | Off                    | Whether new shape annotations have a fill by default.                                                                                                                                                                                                                                                       |
| **Annotations — Default line-end style** (Phase 4)                 | OpenArrow              | Default arrowhead style for the Arrow tool. `'None'`, `'OpenArrow'`, `'ClosedArrow'`.                                                                                                                                                                                                                       |
| **OCR — Default language** (Phase 5)                               | `eng`                  | The Tesseract language code pre-selected in the OCR wizard's language picker. Must be one of the installed packs in the [language manager](#manage-language-packs).                                                                                                                                         |
| **OCR — Low-confidence threshold** (Phase 5)                       | 60                     | Per-word confidence cutoff for the [confidence overlay](#ocr-confidence-overlay). Words below this value get the orange box. Range 0–100; applied at render time, not at recognition (raw values preserved).                                                                                                |
| **OCR — Raster DPI** (Phase 5)                                     | 300                    | Resolution for the per-page raster the OCR engine consumes. Higher = better recognition + more memory + slower. Range 72–600; 300 is the recommended default.                                                                                                                                               |
| **OCR — Max concurrent languages** (Phase 5)                       | 4                      | Maximum number of language workers alive simultaneously in the worker pool. LRU-evicts when exceeded. Range 1–8.                                                                                                                                                                                            |
| **OCR — Worker watchdog (sec)** (Phase 5)                          | 60                     | Per-page recognition timeout. If a single page takes longer, the worker is terminated and the page records `worker_watchdog_timeout`. Range 10–600.                                                                                                                                                         |
| **OCR — Preprocess: deskew** (Phase 5)                             | On                     | Default state of the Deskew checkbox in the OCR wizard step 1. Corrects rotations under ~10°.                                                                                                                                                                                                               |
| **OCR — Preprocess: denoise** (Phase 5)                            | Off                    | Default state of the Denoise checkbox. Bilateral filter; useful for grainy scans.                                                                                                                                                                                                                           |
| **OCR — Preprocess: contrast boost** (Phase 5)                     | Off                    | Default state of the Contrast boost checkbox. Histogram equalization; useful for faded scans.                                                                                                                                                                                                               |
| **OCR — Denoise kernel** (Phase 5)                                 | 3                      | Bilateral filter kernel size. Odd integers 3..9.                                                                                                                                                                                                                                                            |
| **OCR — Show confidence overlay by default** (Phase 5)             | Off                    | Whether the [confidence overlay](#ocr-confidence-overlay) starts ON when a document with OCR data is opened.                                                                                                                                                                                                |
| **OCR — Confirm-invalidate-signatures once** (Phase 5)             | Off                    | The "Don't ask me again" toggle on the OCR-invalidates-PAdES-signatures confirm prompt. In v0.5.0 / 0.6.0 this toggle is shown but is per-session only — the confirm re-appears on app restart regardless. (M-21.4 carry-over; permanent persistence is intentionally NOT supported per conventions §16.5.) |
| **Export — Word: default quality tier** (Phase 6)                  | Layout-preserving      | Default tier pre-selected in the Export modal Step 2 for Word. Per locked decision Q-D.                                                                                                                                                                                                                     |
| **Export — Word: default page size** (Phase 6)                     | Auto (source)          | Default page size dropdown for docx output. `Letter` / `A4` / `Auto` (Auto uses the source PDF's page size).                                                                                                                                                                                                |
| **Export — Word: include annotations by default** (Phase 6)        | On                     | Default state of the include-annotations checkbox in the Export modal for Word.                                                                                                                                                                                                                             |
| **Export — Excel: default quality tier** (Phase 6)                 | Text-only              | Default tier pre-selected in the Export modal Step 2 for Excel. Per locked decision Q-D (Excel is inherently tabular).                                                                                                                                                                                      |
| **Export — Excel: include annotations by default** (Phase 6)       | Off                    | Default state of the include-annotations checkbox for Excel (cells are data, not visual).                                                                                                                                                                                                                   |
| **Export — PowerPoint: default quality tier** (Phase 6)            | Layout-preserving      | Default tier pre-selected for PowerPoint. Per locked decision Q-D.                                                                                                                                                                                                                                          |
| **Export — PowerPoint: include annotations by default** (Phase 6)  | On                     | Default state of the include-annotations checkbox for PowerPoint.                                                                                                                                                                                                                                           |
| **Export — Default image format** (Phase 6)                        | PNG                    | Pre-selected variant in the image-format sub-picker. `PNG` / `JPEG` / `TIFF`.                                                                                                                                                                                                                               |
| **Export — Default DPI** (Phase 6)                                 | 150                    | Default DPI for image export. Range 72-600. Higher = better quality, larger files.                                                                                                                                                                                                                          |
| **Export — Default JPEG quality** (Phase 6)                        | 0.9                    | Default JPEG quality (only honored when format='jpeg'). Range 0.1-1.0.                                                                                                                                                                                                                                      |
| **Export — Default multi-page TIFF bundling** (Phase 6)            | Off                    | Default state of the multi-page-TIFF checkbox (only visible when format='tiff').                                                                                                                                                                                                                            |
| **Export — Default include annotations in image export** (Phase 6) | On                     | Default state for the image-format include-annotations checkbox.                                                                                                                                                                                                                                            |
| **Export — Layout: line clustering ε (pt)** (Phase 6, advanced)    | 2                      | Y-coordinate clustering epsilon for paragraph detection. Tune only if your PDFs have unusually tight or loose line spacing. Range 0.5-10.                                                                                                                                                                   |
| **Export — Layout: paragraph break ratio** (Phase 6, advanced)     | 1.5                    | Line-gap / median-line-height threshold for paragraph break. Range 1.0-5.0.                                                                                                                                                                                                                                 |
| **Export — Layout: heading ratio** (Phase 6, advanced)             | 1.3                    | Font-size / median-body-font ratio for heading classification. Range 1.1-3.0.                                                                                                                                                                                                                               |
| **Export — Layout: column gap (pt)** (Phase 6, advanced)           | 40                     | Minimum X-gap for column boundary detection. Increase for tight multi-column layouts. Range 10-200.                                                                                                                                                                                                         |
| **Export — Max queue size** (Phase 6, advanced)                    | 50                     | Maximum queued + 1 running. New requests beyond the cap return `queue_full`. Phase 6.1 ExportQueue uses the same cap.                                                                                                                                                                                       |
| **Telemetry — opt-in** (Phase 7)                                   | **Off**                | Anonymous feature-usage counts only; in-memory only, nothing leaves your machine. See [Telemetry and privacy](#telemetry-and-privacy). Stored as `telemetry.optIn`.                                                                                                                                         |
| **Interface language** (Phase 7)                                   | `en-US` (English (US)) | `en-US` or `es-ES` (Spanish — a translation sample). Switches the UI live. See [Changing the interface language](#changing-the-interface-language). Stored as `i18n.locale`.                                                                                                                                |
| **Update — channel** (Phase 7)                                     | **Manual**             | `Manual` (check only on button click) or `Automatically on launch`. Default Manual because the publish target is a placeholder. See [Checking for updates](#checking-for-updates). Stored as `update.channel`.                                                                                              |
| **Update — last checked at** (Phase 7)                             | (never)                | Read-only; the timestamp of the last update check. Stored as `update.lastCheckedAt` (JSON `null` until the first real check — never a sentinel `0`/epoch date).                                                                                                                                             |

Settings persist in SQLite (`%APPDATA%/PDF Viewer & Editor/db.sqlite`). The four Phase 7 keys are the _only_ new persistent state — there is no `telemetry_events` table (the buffer is in-memory by design).

**Honesty reminder for the Signing settings.** The TSA URL is stored as a plain string; it is visited only at sign time (see [Timestamping](#timestamping-rfc-3161)). No cert / password is stored — those are loaded fresh per signing operation via the PAdES wizard and zeroed on release (see [PAdES trust floor](#pades-trust-floor--what-the-app-does-and-doesnt-promise) obligation #2).

**Honesty reminder for the OCR settings.** Per [OCR trust floor obligation #2](#the-four-phase-5-obligations), changing OCR settings does NOT trigger any network call. The language-pack download path is the ONLY OCR feature that touches the network, and only when you click **Download** in the [language manager](#manage-language-packs). The threshold + DPI + preprocess settings are pure presentation / engine knobs.

**Honesty reminder for the Export settings.** Per [Export trust floor](#export-trust-floor--what-the-app-does-and-doesnt-promise): the Export settings tune defaults for the Export modal; they do NOT change what the engine extracts. The layout tuning knobs (line ε, paragraph break ratio, heading ratio, column gap) only adjust the recognizer thresholds — they cannot make the engine detect a borderless table or extract an XFA form value. Defaults match common PDFs.

**Honesty reminder for the Phase 7 settings.** Per [Phase 7 trust floor](#phase-7-trust-floor--what-the-app-does-and-doesnt-promise): turning **Telemetry — opt-in** ON records anonymous counts to an in-memory buffer only — it triggers **no network call** and writes nothing to disk; turning it OFF clears the buffer. Switching the **Interface language** to Spanish renders the high-traffic UI in Spanish with English fallback for untranslated strings (a translation sample, not complete). Setting **Update — channel** to "Automatically on launch" does nothing useful in 0.7.0 because the publish target is a placeholder — the check reports "update channel not configured" honestly. None of the four Phase 7 settings sends data anywhere.

---

## Keyboard shortcuts (full list)

Verified against `src/client/hooks/use-app-shortcuts.ts` and `src/client/shortcuts.ts`.

| Category         | Action                            | Shortcut                                | Enabled in Phase 3                                               |
| ---------------- | --------------------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| File             | Open PDF                          | **Ctrl+O**                              | yes                                                              |
| File             | Save                              | **Ctrl+S**                              | yes                                                              |
| File             | Save As                           | **Ctrl+Shift+S**                        | yes                                                              |
| File             | Close document                    | **Ctrl+W**                              | yes                                                              |
| File             | Quit                              | **Ctrl+Q**                              | yes                                                              |
| File             | Print                             | **Ctrl+P**                              | yes                                                              |
| File             | Print to PDF (Export)             | **Ctrl+Shift+P**                        | yes                                                              |
| File             | Settings                          | **Ctrl+,**                              | yes                                                              |
| Edit             | Undo                              | **Ctrl+Z**                              | yes                                                              |
| Edit             | Redo                              | **Ctrl+Y** or **Ctrl+Shift+Z**          | yes                                                              |
| Edit             | Find                              | **Ctrl+F**                              | Phase 4+ (shows "coming soon" toast)                             |
| Edit             | Select all pages                  | **Ctrl+A**                              | yes                                                              |
| Edit             | Delete selection                  | **Delete** or **Backspace**             | yes                                                              |
| View             | Zoom in                           | **Ctrl++**                              | yes                                                              |
| View             | Zoom out                          | **Ctrl+-**                              | yes                                                              |
| View             | Zoom 100%                         | **Ctrl+0**                              | yes                                                              |
| View             | Fit width                         | **Ctrl+1**                              | (no-op in current build; viewport fit modes wire in a follow-up) |
| View             | Fit page                          | **Ctrl+2**                              | (no-op in current build)                                         |
| View             | Toggle sidebar                    | **Ctrl+B**                              | yes                                                              |
| View             | Toggle inspector                  | **Ctrl+Alt+I**                          | yes                                                              |
| View             | Toggle fullscreen                 | **F11**                                 | yes                                                              |
| Pages            | Rotate clockwise                  | **Ctrl+R**                              | yes                                                              |
| Pages            | Rotate counter-clockwise          | **Ctrl+Shift+Alt+R**                    | yes (Phase 5 rebind — Ctrl+Shift+R is now Run OCR per L-21.3)    |
| Pages            | Insert image                      | **Ctrl+I**                              | yes                                                              |
| Pages            | Previous page                     | **Page Up**                             | yes                                                              |
| Pages            | Next page                         | **Page Down**                           | yes                                                              |
| Pages            | First page                        | **Home**                                | yes                                                              |
| Pages            | Last page                         | **End**                                 | yes                                                              |
| Tools            | Highlight                         | **H**                                   | yes                                                              |
| Tools            | Sticky note                       | **S**                                   | yes                                                              |
| Tools            | Text box                          | **T**                                   | yes                                                              |
| Tools            | Underline                         | **Ctrl+U**                              | yes                                                              |
| Tools            | Strikethrough                     | **Ctrl+K**                              | yes                                                              |
| Tools            | Freehand (ink)                    | **Shift+F**                             | yes                                                              |
| Tools            | Text edit mode                    | **Ctrl+E**                              | yes                                                              |
| Tools            | Cursor / select                   | **V** or **Esc**                        | yes                                                              |
| **Tools**        | **Capture signature**             | **Ctrl+Shift+G**                        | **yes (Phase 4 NEW)**                                            |
| **Tools**        | **Sign with PAdES**               | **Ctrl+Alt+G**                          | **yes (Phase 4 NEW)**                                            |
| **Tools**        | **Calibrate measurement**         | **Ctrl+Alt+M**                          | **yes (Phase 4 NEW)**                                            |
| **Tools**        | **Run OCR…**                      | **Ctrl+Shift+R**                        | **yes (Phase 5 NEW)**                                            |
| **Tools**        | **Manage language packs…**        | (no shortcut; menu only)                | **yes (Phase 5 NEW)**                                            |
| **Tools / File** | **Export…**                       | **Ctrl+Shift+E**                        | **yes (Phase 6 NEW)**                                            |
| **Tools**        | **Scan from device…**             | (no shortcut; menu only)                | **LIVE on Windows (Phase 5.1, 0.7.3+); disabled on macOS/Linux** |
| **View**         | **Toggle OCR confidence overlay** | **Ctrl+Shift+H**                        | **yes (Phase 5 NEW)**                                            |
| Forms            | Toggle Form Designer mode         | **Ctrl+Shift+F**                        | yes (Phase 3)                                                    |
| Forms            | Open Mail Merge wizard            | **Ctrl+M**                              | yes (Phase 3)                                                    |
| Designer         | Cycle field-type in toolbar       | **F** (designer-mode only)              | yes (mode-scoped)                                                |
| Designer         | Deselect / exit designer          | **Esc** (first deselects, second exits) | yes                                                              |
| Designer         | Remove selected field             | **Delete** (designer-mode only)         | yes                                                              |
| Help             | Help                              | **F1**                                  | yes                                                              |
| Sidebar          | Cycle sidebar tab                 | **Tab** (when sidebar focused)          | yes                                                              |
| Sidebar          | Rename focused bookmark           | **F2** (when bookmark focused)          | yes                                                              |

Phase 4 shortcuts are hard-coded. User-configurable shortcuts ship in a later phase.

**Note on Ctrl+Shift+F:** Phase 2's Freehand tool was reached with **Shift+F** (no Ctrl). Phase 3 took Ctrl+Shift+F for Form Designer; Shift+F still toggles Freehand. Existing muscle memory is unaffected. Phase 4 introduced three new Ctrl+chord shortcuts (Capture signature, Sign with PAdES, Calibrate measurement) that don't conflict with prior bindings.

**Note on Ctrl+Shift+R (Phase 5 rebind, L-21.3):** Phase 1–4 used **Ctrl+Shift+R** for "rotate counter-clockwise". Phase 5 reclaims that chord for **Run OCR…** (the most common new action in this phase). The counter-clockwise rotate is now **Ctrl+Shift+Alt+R**; the toolbar / Pages menu still exposes a one-click button. Phase 5 also introduces **Ctrl+Shift+H** for the OCR confidence overlay toggle.

**Note on Ctrl+Shift+E (Phase 6):** Phase 6 adds **Ctrl+Shift+E** for the Export modal. The chord opens the modal with your last-chosen format pre-selected (`export-slice.lastChosenFormat`). The File menu Export to {Word / Excel / PowerPoint / image…} entries open the modal pre-selected to that specific format instead. No conflict with prior phases' bindings.

---

## Troubleshooting

### "Failed to open: not a PDF"

The file's magic header is not `%PDF-`. The file may be a renamed `.txt`, a corrupted download, or an encrypted container that pdf.js cannot load directly. Confirm in another reader (e.g. Edge, Adobe Reader). If it opens elsewhere but not here, please file an issue with the file's first 16 bytes.

### "Too large"

The file exceeds your configured **Open — maximum file size**. Raise the limit in [Settings](#settings), or split the file before opening.

### "Save failed: clipped" or "Save failed: missing_glyph"

You have a text-replace op in your edit chain that the engine can't realize. Edit the replacement in question (see [Editing text → Failure modes](#failure-modes)) and retry save. The atomic-save invariant guarantees the destination file isn't corrupted — the prior version (if any) is still on disk untouched.

### "Save failed: op_apply_failed"

A general edit-op apply failure. Common causes: an `insert` op referencing an out-of-range original page index, a `reorder` op with invalid from/to indices, an `image-overlay` op with a rectangle outside the page. The toast `details` payload identifies the failing op kind. File an issue if the cause isn't obvious.

### "Save failed" (generic)

If you see a generic save failure toast:

- Check that the destination disk has free space.
- Check that the destination folder is writable (not a read-only network share).
- Check the renderer DevTools console (in a development build) for the full error.

### The app won't launch

- Windows SmartScreen blocked it on first run: click **More info → Run anyway** in the SmartScreen dialog.
- If the app crashes immediately on launch, check `%APPDATA%/PDF Viewer & Editor/logs/main.log`. The launch-time DB initialization is wrapped in a try/catch — if SQLite fails to open the user-data DB, the app falls back to in-memory persistence (you'll see a toast saying "Settings will not persist this session") rather than crashing.

### Recents or settings don't persist across restarts

If you see "Settings will not persist this session" on launch, the SQLite database failed to open. Check that `%APPDATA%/PDF Viewer & Editor/` exists and is writable. If you've upgraded across an incompatible schema (rare), delete `%APPDATA%/PDF Viewer & Editor/db.sqlite` to reset — note this wipes recents and your bookmarks.

### Drag-and-drop a PDF doesn't open it

The drop must be a `.pdf` extension that the OS surfaces as a real path. Browser-tab drags (where the file lives in the browser's cache) are rejected — open them from disk instead.

### Image import toast says "TIFF first page only"

That's expected — Phase 2 imports first-page only for multi-page TIFFs. To import all pages, split the TIFF beforehand (e.g. with ImageMagick) into individual files.

### Bookmark drag rejected with "Would create a cycle"

You tried to drag a bookmark onto one of its own descendants, which would create a loop in the tree. Move the descendant out from under the dragged bookmark first, then retry.

### "JavaScript actions stripped from document" toast on save

Your PDF contained JavaScript form actions (calculators, regex validators, date hooks). Phase 3 strips these on save for security and scope reasons (locked decision P3-L-2). The visible behavior in the open document is unaffected during this session, but the saved file has no JS. If you need JS-action preservation, Phase 3.1 may add a read-only preservation mode; track for updates.

### "Some forms in this document use the XFA format which isn't supported"

The PDF was authored in Adobe LiveCycle Designer using XFA (XML Forms Architecture), a different forms model from AcroForm. Phase 3 supports AcroForm only. XFA fields show as read-only; AcroForm fields in mixed documents remain fillable. XFA support is wontfix unless explicit demand surfaces.

### Mail merge stopped with "Output path invalid"

The wizard's chosen output folder (folder mode) or output file (concat mode) failed path validation. Common causes: traversal characters (`..`), UNC paths the sanitizer rejects, reserved DOS device names (`CON`, `PRN`, etc.). Pick a different path; absolute paths to user-writable folders work.

### Mail merge stopped with "Row N: fill failed"

A row's column value couldn't be coerced to its mapped field's type (e.g. a non-date string mapped to a date field; a non-numeric string mapped to a numeric-format text field with strict validation). The error toast names the field and the offending value; the row index in the source data lets you find and fix the row. Folder-mode mail-merge keeps the rows already written before the failure; concat-mode discards.

### Mail merge with XLSX shows "using sheet 1 only"

Phase 3 reads sheet 1 only. If you need a different sheet, copy it to sheet 1 in Excel or save it as a separate workbook. Sheet picker is a Phase 3.1 candidate.

### Form template can't be loaded ("Some template fields couldn't be applied")

The template references field configurations (e.g. fonts, sizes) that the target document doesn't fully match. The skipped fields are listed in the toast. Phase 3 reports honestly rather than silently substituting; Phase 4 will add font substitution for templates.

### Form designer rejects a field name ("A field named X already exists")

AcroForm field names must be unique within a document. Pick a different name. The inspector blocks Save (of the field) until the name is unique. Detected fields' names follow the same rule; renaming an authored field to collide with a detected one fails the same way.

### "Sign failed: wrong_password" (Phase 4 PAdES)

The password you typed didn't decrypt the PFX. Re-type and retry. Note that the password is case-sensitive and PFX files sometimes use unusual characters; double-check by loading the PFX in a different tool (e.g. `openssl pkcs12 -info -in cert.pfx`) if you suspect the password.

### "Sign failed: cert_expired" or "cert_not_yet_valid"

Your cert's validity window doesn't include the current system clock. Either use a cert whose validity window covers now, or fix your system clock if it's wrong. Phase 4 has no override for expired certs; the `signatures.allowExpiredCert` Setting candidate would land in Phase 4.1 if demand surfaces.

### "Sign failed: pades_invalidated_by_subsequent_edit"

You edited the document after computing the PAdES signature but before saving. The byte-range hash captured at sign time no longer matches the document. Either re-sign (the wizard's PAdES path computes a fresh hash from the current bytes) or undo the post-sign edits before saving.

### "Sign failed: tsa_timeout" / "tsa_http_error" / "tsa_tls_error"

The TSA URL you configured is not reachable, doesn't respond in time, or has TLS issues. Try the **Test TSA URL** button in Settings → Signing to verify connectivity. Phase 4 has a hard 30-second timeout (configurable via `signatures.tsaTimeoutMs`). If the TSA is reachable but takes longer, raise the timeout. If TSA is unreachable, sign WITHOUT TSA — uncheck "Use TSA" in step 2 of the PAdES wizard.

### "Sign failed: tsa_genTime_skew"

The TSA's reported time is more than ±5 minutes off your system clock. Fix your system clock if it's wrong; if the TSA itself is misconfigured, pick a different TSA.

### "Sign failed: pades_placeholder_too_small"

The CMS envelope didn't fit in the default 16384-hex-char `/Contents` placeholder. This usually happens with very long certificate chains. Raise `signatures.placeholderSize` to 32768 in Settings → Signing → Advanced and retry.

### "Sign failed: engine_not_available"

The PAdES engine (`node-signpdf` or the manual `node-forge` + `pkijs` fallback) failed to load. Reinstall the app; this should not occur in a properly-packaged binary.

### Signature appears placed but a third-party viewer says "invalid"

The visual signature graphic is just a drawing; only the PAdES path produces a cryptographic envelope. If a third-party PAdES verifier (Adobe Reader DC, EU DSS, etc.) reports "invalid" on a PAdES signature this app produced, the most common causes are:

- The document was edited or re-saved after sign (any byte change invalidates the signature).
- The cert is self-signed and the verifier doesn't trust your local CA store.
- The cert's CA chain isn't reachable by the verifier (intermediate certs missing).

The app's own `signatures:verify` channel re-hashes the byte-range against the local audit log — see [Signature audit panel](#signature-audit-panel). That's informational; it does NOT validate the trust chain.

### Audit panel shows no rows after signing

Check the SQLite DB is writable. The PAdES sign flow returns `audit_log_failed` if it cannot insert the audit row. Common cause: `%APPDATA%/PDF Viewer & Editor/db.sqlite` is read-only or corrupted.

### "Measure annotation shows wrong distance"

The per-document calibration is wrong. Re-calibrate via Tools menu → Calibrate measurement (or Ctrl+Alt+M), clicking two points whose real-world distance you know.

### "OCR failed: language_pack_not_installed" (Phase 5)

The OCR wizard's language picker shows a language pack as installed, but the engine couldn't resolve the `.traineddata.gz` file at run time. Common cause: the pack was removed from `%APPDATA%/PDF Viewer & Editor/tessdata/` between modal open and the OCR run. Reopen the [language manager](#manage-language-packs) → re-download. If the language is the bundled English (`eng`) and you're seeing this error, the installer's `resources/tessdata/eng.traineddata.gz` is missing — reinstall the app.

### "OCR failed: pack_integrity_failed" (Phase 5)

The SHA-256 of the downloaded pack didn't match the catalog. The download is discarded automatically. Common causes:

- **The upstream mirror returned a different file.** Rare. Retry the download — if it persistently fails, the upstream mirror or your network is interposing. (Note: as of 0.7.1, all nine non-English packs have real catalog hashes and download successfully — this error no longer means "non-English is unsupported". See [Manage language packs](#manage-language-packs).)
- **You are on an older build (0.5.0–0.7.0).** Those versions shipped sentinel hashes for the non-English rows, so non-English downloads always failed by design. Upgrade to 0.7.1 or later for multi-language download.

### "OCR failed: signed_pdf_requires_confirm" (Phase 5)

The document has prior PAdES cryptographic signatures and the OCR run was issued without the user's confirm. The OCR modal should always surface the confirm prompt at step 2 before reaching this error; if you see it as a toast, the wizard skipped step 2 (likely a bug — file an issue). Open the wizard again and step through Configure → Confirm-if-signed → Running.

### "OCR failed: worker_watchdog_timeout_page_N" (Phase 5)

A single page took longer than the watchdog timeout (default 60s) and the worker was terminated. Common causes:

- Very high DPI (lower the Raster DPI in Settings → OCR or in the wizard).
- A pathological scan that confuses Tesseract (try a different preprocessing combination — e.g. enable Denoise + Contrast boost).
- A very low-RAM host that's swapping. Close other apps and retry.

The remaining pages in the OCR job continue automatically; you can re-run OCR on just the affected page after fixing the input.

### OCR text is selectable in the viewer but missing in Adobe Reader (Phase 5)

If your saved file's OCR text is selectable in PDF_Viewer_Editor but Adobe Reader shows no selection or copy-paste produces nothing:

- Re-open the file in PDF_Viewer_Editor and confirm OCR results are present (sidebar → OCR tab).
- Try Foxit Reader or Microsoft Edge's built-in PDF viewer — they may handle the text-behind-image layer differently.
- For CJK / Cyrillic / Arabic scripts, copy-paste may yield wrong glyphs because Phase 5 doesn't embed those fonts in the text-behind-image layer (the recognized text is searchable but copy-paste fidelity is reader-dependent — see [Phase 5 known limitations](#phase-5-known-limitations)).

### OCR confidence overlay doesn't appear (Phase 5)

- Check **View → Toggle OCR confidence overlay** is enabled (or press **Ctrl+Shift+H**).
- Confirm the document has OCR results — switch the sidebar to the [OCR results panel](#ocr-results-panel) and verify per-page word counts are populated. If the panel is empty, run OCR first.
- Lower the threshold in Settings → OCR → Low-confidence threshold. If all your words are above 80 confidence, the default threshold of 60 surfaces nothing.
- **As of 0.7.18:** reopening a previously-OCR'd document now rehydrates the per-word data automatically via the new `ocr:listResultsByJob` channel. No need to re-run OCR. If the overlay is still empty after reopen, the `ocr_results` table may have been cleared (e.g. by an explicit "Clear OCR data" action) — re-run OCR.
- **As of 0.7.18:** boxes now position correctly on rotated pages (90 / 180 / 270 degrees). If you're on an older build (0.7.17 or earlier) and the boxes look offset on a rotated page, that's the pre-fix behavior — update to 0.7.18.
- **As of 0.7.18:** PDFs with non-embedded standard fonts (Helvetica / Times / Symbol — the PDF 1.7 base-14 set) now OCR correctly. If you've been seeing very low confidence (e.g. 22 words at 28.5 mean confidence with 81.8% low-confidence) on a text-heavy PDF that displays fine on screen, that's the pre-fix symptom — the rasterizer was leaving the standard-font glyphs blank, so Tesseract saw an empty image. Update to 0.7.18 and re-run OCR.

### "Scanner unavailable" or "Scan from device" disabled (Phase 5.1)

If you're on **macOS or Linux**, this is expected — Windows Image Acquisition (WIA) is a Windows-only Microsoft API. On non-Windows platforms the native scanner channel returns `scanner_unavailable` and the menu item stays disabled. Use the workaround in [Scanning from a device → Workaround](#workaround-if-scanning-isnt-available).

If you're on **Windows** and the menu item is still disabled or the modal shows "Scanner unavailable":

- The native addon failed to load at startup. Common reasons:
  - The `native/wia-scanner/build/Release/*.node` file is missing from the install (rare; reinstall fixes it).
  - You're running a build older than 0.7.3 — check **Help → About** (the native WIA addon ships starting at 0.7.3; earlier builds shipped a stub).
  - A 3rd-party app has loaded an incompatible version of the WIA COM library; restart Windows.
- If the menu is enabled but no devices appear: confirm Windows itself sees your scanner (**Settings → Bluetooth & devices → Printers & scanners**). The modal's **Refresh** button re-runs the WIA device enumeration. If Windows lists the scanner but our modal doesn't, the device driver may not expose a WIA component (some legacy scanners are TWAIN-only) — use the workaround.
- If a network MFP isn't enumerated: confirm it's been paired through Windows Settings (the OS itself must own the connection; we read whatever WIA reports).

See [Scanning from a device](#scanning-from-a-device) for the full flow.

### Language pack download stuck at "verifying" (Phase 5)

SHA-256 verification of a large pack (10–15 MB) takes a few seconds on modern hardware; "verifying" should clear within ~5 seconds. If it persists, cancel the download (Esc) and retry. If the failure is reproducible, file an issue with the pack name and your OS / RAM details.

### Check for updates returns "up-to-date" / "update-available" / a feed error (Phase 7)

**Expected as of 0.7.2** — the auto-update client now contacts the real `SuperiorAg/PDF_Viewer_Editor` GitHub release feed. The status the app reports is what actually happened on the network:

- **"Up-to-date"** — the live feed advertises a version equal to the one you're running.
- **"Update available: vX.Y.Z"** — the feed advertises a newer version. The Download button works; the Install button is gated on a code-signing certificate (see below).
- **"The update feed could not be read"** or similar network/feed error — the app contacted the channel and got an error response (e.g. a draft release that hasn't been promoted to live yet; an unauthenticated read against a draft returns 404). This is the **honest** result; the app does **not** invent a status.

**Auto-update install is still gated on a code-signing certificate.** `electron-updater` refuses to apply an unsigned bundle (correct security behavior). Until the cert is in place (see [README → Roadmap status → Deferred](../README.md#deferred--requires-external-resources)), the check + download paths work but the install path returns an error.

If you see **"Update channel not configured"** on a 0.7.2+ build (the honest placeholder state from 0.7.0–0.7.1): the build's bundled `app-update.yml` carries `PLACEHOLDER`. This should not happen in any 0.7.2+ binary published from the official CI workflow — if it does, you have a build older than 0.7.2. Check **Help → About** for the version.

See [Checking for updates](#checking-for-updates).

### Some of the UI is still in English after switching to Spanish (Phase 7)

Expected. Spanish (es-ES) is a **translation sample** covering roughly 70% of strings — the high-traffic surfaces are translated, but some deep modal _step_ prose stays English. Any untranslated string falls back to English automatically; you should never see a raw key (e.g. `toolbar:open`). Completing the deep modal-step translation is a Phase 7.1 item. See [Changing the interface language](#changing-the-interface-language).

### The telemetry debug panel is empty (Phase 7)

Expected if telemetry is OFF (the default) — the app records nothing while the opt-in toggle is unchecked. Even with opt-in ON, the buffer only fills as you use features, and it is cleared whenever you turn the toggle OFF. Nothing is ever sent anywhere. See [Telemetry and privacy](#telemetry-and-privacy).

---

## Filing an issue or feedback

Please include:

- Your build version (in **Help → About**, or in the file name: `PDF Viewer & Editor-0.7.0-x64.exe`)
- The exact toast message if you saw one
- Steps to reproduce — even an outline
- Whether the file involved is shareable

**Do NOT include** your PFX file, your cert password, or any private key material in an issue. Phase 4's discipline (cert + password never persisted) extends to the user-feedback workflow — we cannot debug a signing failure that requires your cert, and you should not share it. If a signing failure correlates with a specific cert, supply only the cert's Subject CN + Issuer CN + a description of which step of the PAdES wizard failed.

Logs live at `%APPDATA%/PDF Viewer & Editor/logs/main.log` (main process) and the renderer DevTools console (open with **Ctrl+Shift+I** in a development build; production builds disable DevTools).
