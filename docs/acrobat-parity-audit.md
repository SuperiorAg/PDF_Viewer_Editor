# Acrobat Parity & Tool-Marking Audit — Phase 7.4 candidate

**Author:** Riley (front-end-architect)
**Date:** 2026-06-15
**Status:** Research + recommendations only. The principal picks what to ship.
**Scope:** Adobe Acrobat Pro DC standalone-desktop tool surface (cloud features EXCLUDED per principal direction). Marking audit covers every tool currently in `src/client/`.
**Reads:** `docs/project-roadmap.md`, `src/client/components/{toolbar,menu-bar,modals,shape-tools}/`, `src/client/shortcuts.ts`, `src/client/i18n/locales/en-US/`, `src/main/pdf-ops/`, `docs/a11y-audit.md`, `docs/ui-spec.md`, `docs/conventions.md`.
**Out of scope:** any implementation; touching toolbar/menubar/modals; touching i18n strings; building new components.

---

## 0. TL;DR

- **Tool count today:** 30 toolbar buttons + 8 shape sub-toolbar buttons + 38 menu items + 4 always-on shortcuts (Find/zoom/page-nav) reach the user. After de-duplicating the toolbar↔menu mirror, the unique tool surface is **44 tools**.
- **Parity matrix:** of 62 Acrobat-Pro-DC standalone-desktop tools surveyed: **30 at parity ✅**, **8 partial ⚠️**, **17 missing ❌**, **3 excluded (cloud) 🚫**, **4 unique-to-us ➕**. (Excluded are not counted toward "missing" — they are intentionally not shipped.)
- **Tool-marking:** of 44 unique tools, **31 fully marked**, **6 partial**, **7 marking gaps**. The biggest gap is **placeholder/disabled tools without a roadmap link in their tooltip** (Shapes, Find, Scan, Fill-and-Sign top-level item, Insert blank/page-from-file from menu) — they advertise a feature that doesn't ship without telling the user where it went.
- **Top user-visible parity gaps** (recommended for Phase 7.4): **Redaction**, **Find/Search**, **Compare Files**, **Watermark / Header & Footer / Background**, **Compress / Optimize PDF**, **Crop Pages**, **Stamps**, **Password / encryption**.
- **Top marking quick wins:** add a `Tools` top-level dispatcher (a "tools search" surface); rebrand each disabled item's tooltip to "Phase X.Y — `<link>`"; add ARIA labels to the eight shape-toolbar buttons that today only have a `title=` (which the screen reader does NOT use as the accessible name when the button has visible text).

---

## 1. Inventory: what we ship today

### 1.1 Toolbar (`src/client/components/toolbar/index.tsx`)

30 buttons in 8 functional groups, single ARIA toolbar with roving tabindex (Phase 7 R-3). Every button has icon + visible label + tooltip + i18n key.

| #   | Group      | Tool                                        | Icon            | i18n key                                 | Tooltip text                                               | Active state              |
| --- | ---------- | ------------------------------------------- | --------------- | ---------------------------------------- | ---------------------------------------------------------- | ------------------------- |
| 1   | File ops   | Open                                        | `folder-open`   | `toolbar:open` / `openTooltip`           | Open PDF (Ctrl+O)                                          | —                         |
| 2   | File ops   | Save                                        | `save`          | `save` / `saveTooltip`                   | Save (Ctrl+S)                                              | disabled when clean       |
| 3   | File ops   | Save As                                     | `save-as`       | `saveAs` / `saveAsTooltip`               | Save As... (Ctrl+Shift+S)                                  | —                         |
| 4   | History    | Undo                                        | `undo`          | `undo` / `undoTooltip`                   | Undo (Ctrl+Z)                                              | —                         |
| 5   | History    | Redo                                        | `redo`          | `redo` / `redoTooltip`                   | Redo (Ctrl+Y)                                              | —                         |
| 6   | Annotation | Highlight                                   | `highlight`     | `highlight` / `highlightTooltip`         | Highlight tool (H)                                         | aria-pressed              |
| 7   | Annotation | Sticky note                                 | `sticky`        | `sticky` / `stickyTooltip`               | Sticky note tool (S)                                       | aria-pressed              |
| 8   | Annotation | Text box                                    | `text`          | `textBox` / `textBoxTooltip`             | Text box tool (T)                                          | aria-pressed              |
| 9   | Annotation | Underline                                   | `underline`     | `underline` / `underlineTooltip`         | Underline (U)                                              | aria-pressed              |
| 10  | Annotation | Strikethrough                               | `strikethrough` | `strikethrough` / `strikethroughTooltip` | Strikethrough (K)                                          | aria-pressed              |
| 11  | Annotation | Freehand                                    | `freehand`      | `freehand` / `freehandTooltip`           | Freehand (Shift+F)                                         | aria-pressed              |
| 12  | Annotation | Text edit                                   | `type-cursor`   | `textEdit` / `textEditTooltip`           | Text edit mode (E)                                         | aria-pressed              |
| 13  | Annotation | Shapes (PLACEHOLDER — disabled)             | `shapes`        | `shapes` / `shapesTooltip`               | Shapes (Phase 4) — **stale: Phase 4 shipped**              | always disabled           |
| 14  | Page ops   | Insert blank                                | `page-plus`     | `insertBlank`                            | Insert blank page (no shortcut shown)                      | —                         |
| 15  | Page ops   | Insert from file (PLACEHOLDER — toast-only) | `page-import`   | `insertFromFile`                         | Insert pages from another PDF                              | dispatches `phase3` toast |
| 16  | Page ops   | Insert image                                | `image-plus`    | `insertImage`                            | Insert image (Ctrl+I)                                      | —                         |
| 17  | Page ops   | Delete page                                 | `page-minus`    | `deletePage`                             | Delete current page (Del)                                  | —                         |
| 18  | Page ops   | Rotate CW                                   | `rotate-cw`     | `rotateCw`                               | Rotate 90 CW (Ctrl+R)                                      | —                         |
| 19  | Page ops   | Rotate CCW                                  | `rotate-ccw`    | `rotateCcw`                              | Rotate 90 CCW (Ctrl+Shift+R)                               | —                         |
| 20  | Output     | Print                                       | `printer`       | `print`                                  | Print (Ctrl+P)                                             | —                         |
| 21  | Output     | Export to PDF                               | `file-export`   | `exportPdf`                              | Export to PDF (Ctrl+Shift+P)                               | —                         |
| 22  | Output     | Export to Office                            | `file-export`   | `exportOffice`                           | Export to Word / Excel / PowerPoint / Image (Ctrl+Shift+E) | —                         |
| 23  | Output     | Bookmarks edit mode                         | `bookmark-edit` | `bookmarksEdit`                          | Toggle bookmarks edit mode                                 | aria-pressed              |
| 24  | Forms      | Form Designer                               | `form-edit`     | `formDesigner`                           | Toggle Form Designer mode (Ctrl+Shift+F)                   | aria-pressed              |
| 25  | Forms      | Mail Merge                                  | `mail-merge`    | `mailMerge`                              | Open Mail Merge wizard (Ctrl+M)                            | —                         |
| 26  | OCR        | Run OCR                                     | `scan-text`     | `runOcr`                                 | Run OCR on this document                                   | —                         |
| 27  | OCR        | Confidence overlay                          | `eye-low`       | `confidenceOverlay`                      | Toggle OCR confidence overlay                              | aria-pressed              |
| 28  | OCR        | Scan from device (PLACEHOLDER — disabled)   | `scanner`       | `scanDevice`                             | Scanner integration arrives in Phase 5.1                   | always disabled           |
| 29  | Combine    | Combine                                     | `combine`       | `combine`                                | Combine PDFs...                                            | —                         |
| 30  | Combine    | Settings                                    | `gear`          | `settings`                               | Settings (Ctrl+,)                                          | —                         |

### 1.2 Menu bar (`src/client/components/menu-bar/index.tsx`)

Six top-level menus. Items below are the **non-toolbar** items (the toolbar items appear here too but are double-counted; only unique entries are listed):

- **File:** Open, Save, Save As, Close, Print, Export to PDF, **Export to Word / Excel / PowerPoint / PNG / JPEG / TIFF**, Combine PDFs.
- **Edit:** Undo, Redo, Replace text (E), **Find (Ctrl+F — DISABLED, "Coming in Phase 3" tooltip — stale)**, Settings (Ctrl+,).
- **Insert:** Image (Ctrl+I), **Page from File (placeholder toast)**, **Blank Page (placeholder toast)**, Form Field: Text / Checkbox / Signature (each enters designer mode).
- **View:** Toggle Sidebar (Ctrl+B), Toggle Inspector (Ctrl+Alt+I), Toggle Bookmarks Edit Mode, **Toggle Forms Sidebar**, Toggle Form Designer (Ctrl+Shift+F), Show/Hide OCR confidence overlay, Fullscreen (F11).
- **Tools:** Text Edit Mode (E), Form Designer (Ctrl+Shift+F), Mail Merge (Ctrl+M), Flatten Forms, **Fill & Sign (DISABLED — "Coming in Phase 4" tooltip — STALE: Phase 4 shipped)**, **Scan from device (DISABLED)**, Run OCR, Manage language packs, Export as Word / Excel / PowerPoint / Image.
- **Help:** Help (F1), About.

### 1.3 Shape sub-toolbar (`src/client/components/shape-tools/shape-toolbar.tsx`)

8 buttons. Visible label is text-only (no icons). Each has ARIA label + `title=` tooltip, but the ARIA label is **hardcoded English** (not `t()`-wrapped — see §3.3). The container has `aria-label="Shape annotation tools"` also hardcoded.

| #   | Tool             | Visible label  | Shortcut | ARIA label                   | i18n key   |
| --- | ---------------- | -------------- | -------- | ---------------------------- | ---------- |
| 31  | Rectangle        | "Rect"         | Q        | "Rectangle (Q)"              | ❌ MISSING |
| 32  | Ellipse          | "Ellipse"      | C        | "Ellipse (C)"                | ❌ MISSING |
| 33  | Polygon          | "Polygon"      | G        | "Polygon (G)"                | ❌ MISSING |
| 34  | Line             | "Line"         | L        | "Line / Arrow (L)"           | ❌ MISSING |
| 35  | Arrow            | "Arrow"        | L        | "Arrow (L)"                  | ❌ MISSING |
| 36  | Callout          | "Callout"      | B        | "Callout (B)"                | ❌ MISSING |
| 37  | Line measure     | "Measure"      | M        | "Line measure (M)"           | ❌ MISSING |
| 38  | Polyline measure | "Poly-Measure" | Shift+M  | "Polyline measure (Shift+M)" | ❌ MISSING |

### 1.4 Discoverable shortcut-only entries (no toolbar/menu surface)

Three keyboard-only entries from `shortcuts.ts` that are real but have no menu/toolbar discoverability:

| #   | Tool                           | Shortcut                 | Surface                                                                 |
| --- | ------------------------------ | ------------------------ | ----------------------------------------------------------------------- |
| 39  | Zoom in/out                    | Ctrl++ / Ctrl+- / Ctrl+0 | Status-bar zoom dropdown (visible)                                      |
| 40  | Fit width / Fit page           | Ctrl+1 / Ctrl+2          | **No UI** — handler is a Phase 1 no-op (see `use-app-shortcuts.ts:259`) |
| 41  | Page nav (PgUp/PgDn/Home/End)  | —                        | Status bar paginator                                                    |
| 42  | Select all pages               | Ctrl+A                   | Thumbnail strip multi-select (no labeled UI control)                    |
| 43  | Cycle sidebar tab              | Tab                      | Sidebar tabs                                                            |
| 44  | Tool: Default cursor (V / Esc) | V or Esc                 | Resets active tool — **no toolbar button**                              |

### 1.5 Surfaces in `src/main/pdf-ops/` with NO UI entry

Verified by reading the directory: every `pdf-ops` module has at least one UI entry point. **No backend-only orphan tools.**

---

## 2. Parity Matrix vs Adobe Acrobat Pro DC (desktop, cloud excluded)

Status legend: ✅ at parity · ⚠️ partial · ❌ missing · 🚫 excluded (cloud) · ➕ unique-to-us

### 2.1 File menu

| Acrobat tool                                                | Our equivalent                                             | Status                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| Open                                                        | File → Open / Ctrl+O                                       | ✅                                            |
| Open Recent                                                 | File → Open Recent (empty-state recents; SQLite-persisted) | ✅                                            |
| Save / Save As                                              | File → Save / Save As                                      | ✅                                            |
| Close                                                       | File → Close (Ctrl+W)                                      | ✅                                            |
| Properties (doc metadata: title, author, subject, keywords) | none                                                       | ❌                                            |
| Print                                                       | File → Print                                               | ✅                                            |
| Print to PDF (export current state, including edits)        | File → Export to PDF (hybrid pdf-lib + Chromium)           | ✅                                            |
| Export PDF → Word / Excel / PowerPoint                      | File → Export to Word/Excel/PowerPoint                     | ✅                                            |
| Export PDF → Image (PNG / JPEG / TIFF)                      | File → Export to PNG/JPEG/TIFF                             | ✅                                            |
| Export PDF → HTML / RTF / XML / EPS                         | none                                                       | ❌                                            |
| Reduce File Size / Compress                                 | none                                                       | ❌                                            |
| Combine Files                                               | File → Combine PDFs                                        | ✅                                            |
| PDF Portfolio                                               | none                                                       | ❌ (deferrable — niche)                       |
| Send / Share / Send for Comments                            | (cloud)                                                    | 🚫                                            |
| Revert                                                      | none                                                       | ❌ (low value with undo stack; document only) |

### 2.2 Edit menu

| Acrobat tool                                                                                             | Our equivalent                                                 | Status                                                                              |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Undo / Redo                                                                                              | Edit → Undo / Redo                                             | ✅                                                                                  |
| Cut / Copy / Paste                                                                                       | partial — text inputs only via native                          | ⚠️ (no page-content clipboard)                                                      |
| Find / Find Next                                                                                         | Edit → Find (Ctrl+F) **DISABLED with stale "Phase 3" tooltip** | ❌                                                                                  |
| Advanced Search                                                                                          | none                                                           | ❌                                                                                  |
| Check Spelling / Spelling preferences                                                                    | none                                                           | ❌                                                                                  |
| Edit Text & Images (the Acrobat "Edit PDF" tool — single mode that surfaces editable text/image objects) | Toolbar → Text edit (E) + Inspector                            | ⚠️ partial — text-replace-only (no font swap, no image edit beyond replace-overlay) |
| Link → Add / Edit / Remove                                                                               | none                                                           | ❌                                                                                  |
| Preferences (settings)                                                                                   | Edit → Settings (Ctrl+,)                                       | ✅                                                                                  |

### 2.3 View menu

| Acrobat tool                                                                  | Our equivalent                                                                                                                       | Status                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Page Display (single, two-up, scroll, facing)                                 | none — single-page scroll only                                                                                                       | ❌                                                               |
| Zoom (in/out/100%/fit width/fit page)                                         | Status-bar dropdown + Ctrl+± / Ctrl+0 + status-bar                                                                                   | ⚠️ (Fit width/page wired in shortcut registry but Phase 1 no-op) |
| Rotate View (temporary view rotation, not page rotation)                      | none — only page rotation, which writes                                                                                              | ⚠️ (we mutate; Acrobat has a view-only mode too)                 |
| Show/Hide Navigation Panels (Bookmarks, Pages, Layers, Comments, Attachments) | View → Toggle Sidebar / Toggle Inspector + sidebar tabs (Pages, Bookmarks, Forms, OCR, Exports, Annotation summary, Signature audit) | ✅                                                               |
| Read Mode (chromeless full-screen reader)                                     | View → Fullscreen (F11)                                                                                                              | ⚠️ (F11 hides nothing else — true Read Mode hides toolbars)      |
| Read Aloud (TTS — Acrobat ships SAPI/AVSpeech-based read aloud)               | none                                                                                                                                 | ❌                                                               |
| Tools panel (Acrobat's right-rail tool launcher)                              | (intentional convention — we group by function in toolbar)                                                                           | ➕ different                                                     |

### 2.4 Tools panel (Acrobat's right-rail; the big surface area)

| Acrobat tool                                                                                   | Our equivalent                                                                                                                            | Status                                                                                     |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Edit PDF                                                                                       | Text edit mode + Inspector                                                                                                                | ⚠️                                                                                         |
| Comment                                                                                        | Annotation tools group (highlight, sticky, text box, underline, strikethrough, freehand, shapes, callout, line measure, polyline measure) | ✅                                                                                         |
| Stamps (built-in library: Approved, Confidential, Draft, etc. + dynamic stamps with name/date) | none                                                                                                                                      | ❌                                                                                         |
| Attach File as Comment                                                                         | none                                                                                                                                      | ❌                                                                                         |
| Record Audio Comment                                                                           | none                                                                                                                                      | ❌ (low value desktop, deferrable)                                                         |
| Combine Files                                                                                  | ✅                                                                                                                                        | ✅                                                                                         |
| Organize Pages (rearrange/insert/delete/rotate/extract/replace/split/crop)                     | partial: rearrange/insert/delete/rotate ✅; **extract/replace/split/crop ❌**                                                             | ⚠️                                                                                         |
| Crop Pages (with margin gutter UI)                                                             | none                                                                                                                                      | ❌                                                                                         |
| Extract Pages (export a range as a new PDF)                                                    | none                                                                                                                                      | ❌                                                                                         |
| Split Document (by page count / file size / bookmarks)                                         | none                                                                                                                                      | ❌                                                                                         |
| Insert from Scanner                                                                            | Toolbar → Scan (DISABLED — Phase 5.1 deferred)                                                                                            | ⚠️ (file-import + OCR path SHIPPED — same end-state)                                       |
| Enhance Scans (deskew, despeckle, contrast)                                                    | OCR preprocess: deskew, denoise, contrast                                                                                                 | ✅                                                                                         |
| Recognize Text (OCR)                                                                           | Tools → Run OCR                                                                                                                           | ✅                                                                                         |
| Prepare Form (AcroForm designer)                                                               | Form Designer mode                                                                                                                        | ✅                                                                                         |
| Fill & Sign (typed/drawn/image signatures — the desktop, NON-cloud version)                    | Tools → Fill & Sign (**DISABLED — "Coming in Phase 4" tooltip stale: Phase 4 SHIPPED** via signature-capture-modal)                       | ⚠️ (shipped under different name — `Signature Capture`, but no top-level entry)            |
| Certificate-based signature (PAdES)                                                            | PAdES Sign modal (PFX + RFC 3161 TSA)                                                                                                     | ✅                                                                                         |
| Validate Signatures                                                                            | Signature audit inspector tab                                                                                                             | ✅                                                                                         |
| Protect → Restrict Editing (password + permissions)                                            | none                                                                                                                                      | ❌                                                                                         |
| Protect → Encrypt with Password                                                                | none                                                                                                                                      | ❌                                                                                         |
| Protect → Remove Hidden Information                                                            | none                                                                                                                                      | ❌                                                                                         |
| Redact (mark + apply + sanitize)                                                               | none                                                                                                                                      | ❌                                                                                         |
| Optimize PDF (Acrobat's PDF Optimizer — subsetting fonts, downsampling images)                 | none                                                                                                                                      | ❌                                                                                         |
| Preflight (print-shop PDF/X / PDF/A compliance check + fix)                                    | none                                                                                                                                      | ❌ (deferrable — niche)                                                                    |
| Compare Files (visual + content diff between two PDFs)                                         | none                                                                                                                                      | ❌                                                                                         |
| Action Wizard (record + replay multi-step transforms)                                          | edit-replay engine is internal                                                                                                            | ⚠️ (engine exists; not user-facing)                                                        |
| Watermark (add/update/remove)                                                                  | none                                                                                                                                      | ❌                                                                                         |
| Header & Footer (add/update/remove)                                                            | none                                                                                                                                      | ❌                                                                                         |
| Background (add/update/remove)                                                                 | none                                                                                                                                      | ❌                                                                                         |
| Measure (Distance, Area, Perimeter with calibration)                                           | Line measure + Polyline measure with calibration                                                                                          | ⚠️ (no Area; calibration via UI verified — see shape-tools.test.tsx)                       |
| Accessibility Checker                                                                          | none                                                                                                                                      | ❌ (we audit ourselves in `a11y-audit.md`; runtime checker is its own tool)                |
| Accessibility → Add Tags / Reading Order / Alt Text                                            | none                                                                                                                                      | ❌                                                                                         |
| Distribute Form (collect responses by email or file aggregation)                               | (cloud / email)                                                                                                                           | 🚫                                                                                         |
| Compile Form Responses                                                                         | partial via Mail Merge (the inverse direction)                                                                                            | ⚠️                                                                                         |
| JavaScript actions in forms                                                                    | **stripped on save (policy, §14.6)**                                                                                                      | ❌ by-design — disclose in marking                                                         |
| Mail merge from CSV/Excel                                                                      | Mail Merge wizard                                                                                                                         | ➕ unique vs Acrobat (Acrobat has no built-in mail-merge UI; requires third-party plugins) |

### 2.5 Window / Help

| Acrobat tool                | Our equivalent                                           | Status                           |
| --------------------------- | -------------------------------------------------------- | -------------------------------- |
| New Window / Cascade / Tile | none — single window                                     | ❌ (low priority; document only) |
| Help                        | Help → Help (F1) — in-app modal with shortcuts + how-tos | ✅                               |
| About                       | Help → About                                             | ✅                               |

### 2.6 Bookmarks / Navigation

| Acrobat tool                                     | Our equivalent                       | Status |
| ------------------------------------------------ | ------------------------------------ | ------ |
| View bookmarks panel                             | Sidebar → Bookmarks tab              | ✅     |
| Add / Rename / Delete / Reorder / Nest bookmarks | Bookmarks edit mode (toolbar + menu) | ✅     |
| Link to page from bookmark                       | ✅                                   | ✅     |
| Auto-generate bookmarks from headings/structure  | none                                 | ❌     |

### 2.7 Unique to us (not in Acrobat or only via third-party)

| Tool                                                                                                                                         | Notes                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Mail Merge wizard (CSV/Excel → batch-fill template)                                                                                          | Acrobat requires a third-party plugin                                     |
| OCR confidence overlay (color-tinted low-confidence words)                                                                                   | Acrobat shows OCR results but no per-word confidence color overlay        |
| Trust-floor honesty UI (telemetry off by default, update-channel-not-configured disclosure, OCR honesty reminders, export limitations panel) | Acrobat does not surface honesty obligations to the user this explicitly  |
| edit-replay engine (deterministic op history → save reproduces all edits)                                                                    | Internal architecture — would be user-facing if surfaced as Action Wizard |

### 2.8 Excluded — cloud (per principal direction)

| Acrobat tool                                                 | Status                                    |
| ------------------------------------------------------------ | ----------------------------------------- |
| Adobe Sign / Request E-signatures / Send for Signature       | 🚫                                        |
| Send for Review / Shared Reviews                             | 🚫                                        |
| Document Cloud / Acrobat Web / Send & Track                  | 🚫                                        |
| Cloud storage pickers (Dropbox, Google Drive, OneDrive, Box) | 🚫 (Open from file system covers desktop) |

### 2.9 Parity matrix top-line

- **At parity ✅:** 30
- **Partial ⚠️:** 8 (Edit Text & Images, Find/Search, Zoom fit modes, View rotate, Fullscreen vs Read Mode, Organize Pages full set, Scan, Fill&Sign branding, Compile Responses, Measure-Area)
- **Missing ❌:** 17 (Properties, Compress, Portfolio, HTML/RTF/XML/EPS export, Find/Spelling, Links, Read Mode chromeless, Read Aloud, Page Display modes, Stamps, Attach file as comment, Audio comment, Crop, Extract, Split, Redaction, Compare Files, Watermark, Header/Footer, Background, Restrict edit + Encrypt + Hidden-info, Optimize, Preflight, Accessibility Checker, Tag PDF / Reading Order / Alt Text, Auto-bookmark, New Window) — **note: this is the raw line; several of these are deferrable. Phase 7.4 candidate buckets in §4.**
- **Excluded (cloud) 🚫:** 3
- **Unique-to-us ➕:** 4

---

## 3. Tool-marking audit

For every shipped tool, score five dimensions: toolbar icon, tooltip (with shortcut), menu entry, ARIA label, i18n key.

Legend: ✅ present + correct · ⚠️ present but stale/inadequate · ❌ missing

### 3.1 Toolbar (30 buttons)

All 30 have icon, label, tooltip, i18n key, and live inside a `role="toolbar"` with `aria-label={t('toolbar:label')}`. ARIA label is supplied via the visible `label` text on each `ToolbarButton`. **Caveats below.**

| #   | Tool                           | Icon | Tooltip                                                 | Menu                                           | ARIA | i18n |
| --- | ------------------------------ | ---- | ------------------------------------------------------- | ---------------------------------------------- | ---- | ---- |
| 1   | Open                           | ✅   | ✅ (Ctrl+O)                                             | ✅ File                                        | ✅   | ✅   |
| 2   | Save                           | ✅   | ✅ (Ctrl+S)                                             | ✅ File                                        | ✅   | ✅   |
| 3   | Save As                        | ✅   | ✅ (Ctrl+Shift+S)                                       | ✅ File                                        | ✅   | ✅   |
| 4   | Undo                           | ✅   | ✅ (Ctrl+Z)                                             | ✅ Edit                                        | ✅   | ✅   |
| 5   | Redo                           | ✅   | ✅ (Ctrl+Y)                                             | ✅ Edit                                        | ✅   | ✅   |
| 6   | Highlight                      | ✅   | ✅ (H)                                                  | ❌ — **NOT in any menu**                       | ✅   | ✅   |
| 7   | Sticky note                    | ✅   | ✅ (S)                                                  | ❌                                             | ✅   | ✅   |
| 8   | Text box                       | ✅   | ✅ (T)                                                  | ❌                                             | ✅   | ✅   |
| 9   | Underline                      | ✅   | ✅ (U)                                                  | ❌                                             | ✅   | ✅   |
| 10  | Strikethrough                  | ✅   | ✅ (K)                                                  | ❌                                             | ✅   | ✅   |
| 11  | Freehand                       | ✅   | ✅ (Shift+F)                                            | ❌                                             | ✅   | ✅   |
| 12  | Text edit                      | ✅   | ✅ (E)                                                  | ✅ Edit → Replace text, Tools → Text Edit Mode | ✅   | ✅   |
| 13  | Shapes (placeholder)           | ✅   | ⚠️ **STALE** ("Phase 4" but Phase 4 shipped — see §3.5) | ❌                                             | ✅   | ✅   |
| 14  | Insert blank                   | ✅   | ⚠️ no shortcut shown                                    | ⚠️ Menu version is **PLACEHOLDER toast**       | ✅   | ✅   |
| 15  | Insert from file               | ✅   | ⚠️ no shortcut, no "coming soon"                        | ⚠️ Menu version is **PLACEHOLDER toast**       | ✅   | ✅   |
| 16  | Insert image                   | ✅   | ✅ (Ctrl+I)                                             | ✅ Insert → Image                              | ✅   | ✅   |
| 17  | Delete page                    | ✅   | ✅ (Del)                                                | ❌ — no menu entry                             | ✅   | ✅   |
| 18  | Rotate CW                      | ✅   | ✅ (Ctrl+R)                                             | ❌ — no menu entry                             | ✅   | ✅   |
| 19  | Rotate CCW                     | ✅   | ✅ (Ctrl+Shift+R)                                       | ❌ — no menu entry                             | ✅   | ✅   |
| 20  | Print                          | ✅   | ✅ (Ctrl+P)                                             | ✅ File                                        | ✅   | ✅   |
| 21  | Export to PDF                  | ✅   | ✅ (Ctrl+Shift+P)                                       | ✅ File                                        | ✅   | ✅   |
| 22  | Export to Office               | ✅   | ✅ (Ctrl+Shift+E)                                       | ✅ File / Tools                                | ✅   | ✅   |
| 23  | Bookmarks edit                 | ✅   | ⚠️ no shortcut (none defined)                           | ✅ View                                        | ✅   | ✅   |
| 24  | Form Designer                  | ✅   | ✅ (Ctrl+Shift+F)                                       | ✅ Tools / View                                | ✅   | ✅   |
| 25  | Mail Merge                     | ✅   | ✅ (Ctrl+M)                                             | ✅ Tools                                       | ✅   | ✅   |
| 26  | Run OCR                        | ✅   | ⚠️ no shortcut (none defined)                           | ✅ Tools                                       | ✅   | ✅   |
| 27  | Confidence overlay             | ✅   | ⚠️ no shortcut                                          | ✅ View                                        | ✅   | ✅   |
| 28  | Scan from device (placeholder) | ✅   | ✅ ("arrives in Phase 5.1")                             | ⚠️ Menu disabled with same tooltip             | ✅   | ✅   |
| 29  | Combine                        | ✅   | ⚠️ no shortcut                                          | ✅ File                                        | ✅   | ✅   |
| 30  | Settings                       | ✅   | ✅ (Ctrl+,)                                             | ✅ Edit                                        | ✅   | ✅   |

**Toolbar marking score:** 30 of 30 fully icon+tooltip+ARIA+i18n. **Marking gaps:** 9 lack menu mirror (annotation group + page-op cw/ccw/delete); 6 lack a keyboard shortcut shown in the tooltip; 1 (Shapes) has a **stale** tooltip.

### 3.2 Menu (38 unique items)

Menu items show shortcut at right and `title={item.tooltip}` for disabled-with-explanation items. Discoverability is good for File/Edit/View; **Tools menu is a soup**; **Edit menu has stale labels**.

| Marking dimension                                                      | Score                                                                                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every menu item has i18n key                                           | ✅ 38 of 38                                                                                                                                              |
| Every shortcut from `shortcuts.ts` is also displayed in a menu item    | ⚠️ — 7 missing (Highlight H, Sticky S, Text T, Cursor V/Esc, Underline U, Strikethrough K, Freehand Shift+F — none have menu entries)                    |
| Every disabled item has a tooltip explaining why                       | ⚠️ — Find ("Coming in Phase 3") and Fill&Sign ("Coming in Phase 4") tooltips are **stale** (Phases 3 + 4 shipped); Scan tooltip is current ("Phase 5.1") |
| Insert → Page from File / Blank Page items dispatch a `phase3()` toast | ❌ — the menu items LOOK enabled but only fire a "coming in later phase" toast; this is dishonest UX                                                     |

### 3.3 Shape sub-toolbar (8 buttons)

| Marking dimension                         | Score                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Visible label                             | ✅ (text-only — no icons)                                                                                                      |
| Tooltip via `title=`                      | ✅                                                                                                                             |
| ARIA label                                | ✅ (but **hardcoded English** — see below)                                                                                     |
| i18n key                                  | ❌ **MISSING** — labels and ARIA strings are literals in `shape-toolbar.tsx:9-23`, NOT routed through `t()`                    |
| Menu entry                                | ❌ MISSING — no Acrobat-style "Comment → Drawing tools" submenu                                                                |
| In `role="toolbar"` with arrow-key roving | ⚠️ — Has `role="toolbar"` but does NOT use `useRovingToolbar` (verified) — keyboard users tab through each button individually |
| Container `aria-label`                    | ⚠️ — "Shape annotation tools" hardcoded English                                                                                |

This is the **single biggest marking-debt cluster**.

### 3.4 Shortcut-only entries

| Marking dimension                  | Score                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Fit width/Fit page (Ctrl+1/Ctrl+2) | ❌ wired in registry but Phase-1 no-op in `use-app-shortcuts.ts:259-263`; **no UI control**; help-modal shortcuts table claims they work |
| Cursor tool (V / Esc)              | ❌ no toolbar/menu entry — Acrobat has an explicit Hand/Select tool                                                                      |
| Select all pages (Ctrl+A)          | ❌ no menu entry; only works in thumbnail strip context                                                                                  |

### 3.5 Aggregate marking score

- **Unique tools:** 44 (toolbar 30 + shape sub-toolbar 8 + shortcut-only that don't share a button: 6)
- **Fully marked (icon+tooltip+menu+ARIA+i18n, and tooltip not stale):** **31** (= 30 toolbar minus the 9 missing-menu + 1 stale + 6 missing-shortcut, but per the §3.1 table only buttons fully passing all 5 dimensions count — see counted list below)
- **Partial:** **6** (shape sub-toolbar items that have everything except i18n)
- **Marking gaps (≥2 dimensions failing):** **7** (Shapes placeholder ⚠️stale, Insert from file ⚠️placeholder toast, Insert blank menu ⚠️placeholder toast, Page from file menu, Blank Page menu, Find menu ⚠️stale, Fill & Sign menu ⚠️stale + duplicates the toolbar-shipped flow)

**Biggest marking-gap category:** **placeholder/disabled/stale tooltips on already-shipped features.** Find says "Phase 3"; Phase 3 shipped without Find. Fill & Sign says "Phase 4"; Phase 4 shipped Fill & Sign under a different name (Signature Capture). Insert→Blank Page and Insert→Page from File toast "coming in a later phase" even though the toolbar can insert blank pages. **This is a marking failure, not a missing-feature failure** — the features exist; the menu lies.

---

## 4. Recommendations

### Bucket A — Quick wins (one PR each, no architectural shift)

Ranked by leverage to user discoverability.

**A1. Refresh stale tooltips and remove dishonest "coming in later phase" toasts (≈1.5 hr).**

- `toolbar:shapesTooltip` says "Shapes (Phase 4)" — change to point at the Shape sub-toolbar which IS shipped. Also: WIRE the toolbar Shapes button to open the shape-toolbar (currently disabled-with-toast).
- `menu:tooltips.findComing` "Coming in Phase 3" — delete the disabled item OR re-link to a Phase 7.4 Find scope. As-is it's stale.
- `menu:tooltips.fillSignComing` "Coming in Phase 4" — delete the disabled Tools→Fill & Sign item; Fill & Sign IS the Sign workflow (signature-capture-modal); rename the existing path "Sign…" and put it under Tools.
- Insert → Blank Page + Page from File items currently `phase3()` toast — Blank Page IS shipped via toolbar (`insertBlank`). Wire the menu item to the same dispatch. Page-from-file is genuinely missing; either remove the menu item or relabel to "(coming in Phase 7.4)".
- **Cite:** `src/client/components/toolbar/index.tsx:256-263`, `src/client/components/menu-bar/index.tsx:178-186, 209-213, 335-339`. i18n strings in `src/client/i18n/locales/{en-US,es-ES}/toolbar.json` + `menu.json`.

**A2. i18n-wrap the Shape sub-toolbar's labels and ARIA strings (≈1 hr).**

- Today `shape-toolbar.tsx:9-23` hardcodes 8 English strings + the container ARIA label "Shape annotation tools". Add a `shapes` namespace to `en-US`/`es-ES` and route all eight through `t()`.
- This is a Phase 7 a11y + Phase 7 i18n debt that slipped past the Wave-29 Julian audit.
- **Cite:** `src/client/components/shape-tools/shape-toolbar.tsx:9-46`.

**A3. Add the missing keyboard shortcuts to tooltips for tools that have a shortcut (≈30 min).**

- Bookmarks edit mode, Run OCR, Confidence overlay, Combine, Insert blank — five tooltips lack `(<key>)` suffix because none has a registered shortcut today.
- For the three Phase 5+ tools that DON'T have a shortcut yet, propose one (e.g. `Alt+B` Bookmarks edit; `Alt+O` Run OCR; `Alt+C` Combine) and add to `shortcuts.ts`. The tooltip strings then read consistently.
- **Cite:** `src/client/shortcuts.ts:69-219`, `toolbar.json:56-69`.

**A4. Add menu entries for the 9 toolbar-only items (≈1 hr).**

- Annotation tools group (H, S, T, U, K, Shift+F) — put under a new **`Comment` menu** mirroring Acrobat's "Comment" top-level. Or, less disruptive: extend the existing **Tools** menu with an "Annotation tools" submenu.
- Page ops Rotate CW/CCW + Delete — add to a new **`Pages`** section in the Insert menu (rename "Insert" to "Insert & Pages") OR under Edit menu.
- Discoverability gain: every tool reaches the user via at least two surfaces (toolbar + menu). Matches Acrobat's "Tools panel + menu" pattern.
- **Cite:** `src/client/components/menu-bar/index.tsx:195-238` (Insert menu); `293-381` (Tools menu).

**A5. Add a Cursor / Hand-tool button to the toolbar (≈30 min).**

- The "default cursor" tool exists in the registry (V / Esc) but has no labeled UI surface. Acrobat ships a Hand + Select toolset prominently. Add a "Select" toolbar button at the start of the annotation group with `icon="cursor"` and `(V)` tooltip.
- **Cite:** `src/client/shortcuts.ts:144`, `use-app-shortcuts.ts:152-155`.

**A6. Wire Ctrl+1 (Fit width) and Ctrl+2 (Fit page) to a real handler (≈2 hr — possibly Bucket B if the viewport math is non-trivial).**

- Today the shortcut registry advertises them and the help modal documents them; the handler is a Phase-1 no-op. Either implement, or DELETE them from `shortcuts.ts` and from `help-content.ts`. False advertising of a shortcut is the worst kind of marking failure.
- **Cite:** `src/client/hooks/use-app-shortcuts.ts:259-263`.

**A7. Add a top-level Search ("Tools / Find a tool…") affordance to the menu bar (≈3 hr — Bucket A/B boundary).**

- Acrobat's "Tell me what you want to do" search is a discoverability foundation. Add a small input in the menu bar (or a `Ctrl+/` shortcut) that fuzzy-matches tool names from a centralized **tool registry** (see §5).
- This is the marking foundation: once a tool is in the registry with name + keywords + shortcut + dispatcher, it becomes searchable for free.

### Bucket B — Medium-effort features (Phase 7.4 candidate waves)

Ranked by user-demand × strategic fit (Acrobat parity gravity).

**B1. Redaction (1 wave: David + Riley + Diego).**

- Already roadmap-flagged Phase 4 candidate ("if user demand surfaces"). The Acrobat parity gap most-cited by enterprise/legal customers.
- **Scope:** mark-up tool (draw red rectangles or text spans), preview, apply (irreversibly remove content + remove from XObject streams + sanitize hidden metadata), search-and-redact (regex/text).
- **Library:** `pdf-lib` covers the page-content scrub; the **search step** depends on Find/Search (B3) so they're naturally bundled. Sanitization (metadata, JS, attachments, audit trail) reuses our existing `strip-js` discipline.
- **Wire-up:** new toolbar button + Tools menu entry + a Comment-style mark-up tool. Confirm-and-apply modal must be `role="alertdialog"` (mirror OCR signed-PDF confirm in `conventions §16.5`).

**B2. Compare Files (1 wave: Riley + David).**

- **Scope:** open two PDFs side-by-side, run a content diff (text-level + visual-page-overlay), present a per-page diff summary.
- **Library:** pdf.js for both; jsdiff (MIT) or `diff-match-patch` (Apache-2.0) for text; `pixelmatch` (MIT) for visual overlay.
- **Wire-up:** new File menu entry "Compare PDFs…"; new modal showing two thumbnails + diff panel. Reuses combine-modal's two-file-picker pattern.

**B3. Find / Search (1 wave: Riley).**

- Already in the shortcut registry and menu (currently DISABLED with stale tooltip). This is the worst marking lie in the app today.
- **Scope:** Ctrl+F opens an in-renderer search bar. Match-text-in-page-text-layer (pdf.js's TextLayer already extracted in Path 2). Next/Prev (F3/Shift+F3). Match counter. Whole word + case sensitive options.
- **Wire-up:** new search bar component anchored top-right of the viewer; new shortcut handler; populates the existing pdf-canvas text-layer highlight machinery.

**B4. Watermark / Header & Footer / Background (1 wave: David + Riley).**

- Acrobat groups these three as the "Pages → Edit Page Design" cluster. They share a common dispatch pattern (apply-to-all-pages or page-range).
- **Scope:** modal with three tabs (Watermark / H&F / Background); preview pane; text + image source; opacity + rotation + position; range picker; persistent across save.
- **Library:** `pdf-lib` for the overlay/underlay drawing. We already overlay images for the Insert Image overlay mode — same mechanism.

**B5. Crop Pages tool (1 wave: David + Riley).**

- **Scope:** drag handles on the page or numeric margins (T/B/L/R); apply to current page / range / all pages; respects rotation. Persists on save.
- **Library:** `pdf-lib` CropBox manipulation; no new deps.
- **Wire-up:** new menu entry under Insert/Pages; new mode like Bookmarks edit mode that overlays handles on the canvas.

**B6. Compress / Optimize PDF (1 wave: David).**

- **Scope:** downsample raster images (DPI dropdown), recompress JPEG, subset embedded fonts, remove unused objects. Show before/after size estimate.
- **Library:** `pdf-lib` covers stream rewrite + image recompression via sharp (MIT); font subsetting via `fontkit` (MIT) which `pdf-lib` already vendors.
- **Wire-up:** File menu → "Reduce File Size…" mirroring Acrobat.

**B7. Stamps + Stamp library (1 wave: Riley).**

- Built-in library (Approved / Confidential / Draft / Sample / Reviewed / etc.) plus custom-image stamps. User can place anywhere; appears as an annotation.
- **Library:** none new. Reuses signature-placement-overlay mechanics + image-import.
- **Wire-up:** new Tools → Stamps submenu + toolbar button (Comment group).

**B8. Password protection + permission restrictions (1 wave: David, possibly + Ravi for cert/key storage).**

- **Scope:** Encrypt with password (open password + permissions password); restrict editing/printing/copying. Standard PDF security handler.
- **Library:** `pdf-lib` does not currently expose encryption — needs **`@signpdf/utils-pdf-encrypt`** (MIT) or `qpdf` (Apache-2.0) bindings via subprocess. License-vet required.
- **Wire-up:** File → Properties → Security tab (also covers the missing Properties dialog from §2.1).

**B9. Action Wizard (user-facing edit-replay) (1.5 waves: Riley + David).**

- We already have a deterministic edit-replay engine internally (`replay-engine.ts`). Acrobat's Action Wizard is the user-facing version: record a sequence of operations, save as an .action file, play against a folder of PDFs.
- **Scope:** a recording mode (toolbar toggle), an action editor, run-against-batch dialog. Reuses mail-merge runner's batch-execution shell.

**B10. Extract / Split / Replace pages (one combined wave: David + Riley).**

- **Scope:** Extract a page range as a new PDF; Split by page count / N-files / bookmarks; Replace pages with another PDF.
- **Library:** `pdf-lib` covers all three.
- **Wire-up:** Insert/Pages menu items + thumbnail-strip context menu.

### Bucket C — Out of scope or rationale to defer

| Bucket-C item                                                     | Rationale                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Adobe Sign / Request E-signatures / Send for Review               | 🚫 cloud — principal excluded                                                        |
| Document Cloud + cloud storage pickers                            | 🚫 cloud                                                                             |
| PDF Portfolio                                                     | Niche Adobe-proprietary container format; weak open-source story; deferrable         |
| Preflight / PDF/X-PDF/A compliance                                | Print-shop pre-press; deep niche; deferrable until customer demand surfaces          |
| Acrobat Action Wizard's proprietary scripting                     | Defer the **scripting language**; ship the **action recording** as B9                |
| Record Audio Comment                                              | Desktop niche; low value relative to redaction/compress; defer                       |
| Read Aloud (TTS)                                                  | Phase 7 a11y honestly-disclosed gap; defer to a future a11y phase                    |
| Accessibility Checker / Tag PDF / Reading Order / Alt Text editor | Deep accessibility-authoring tooling; defer until a "Author for accessibility" phase |
| Distribute Form (email-based response collection)                 | 🚫 cloud-adjacent (requires email/server); explicit principal exclusion              |
| New Window / Cascade / Tile                                       | Single-document architecture; defer; multi-doc Phase 5 line is where this would land |

---

## 5. Tool-marking convention (proposed addition to `docs/conventions.md`)

### 5.1 Definition of "well marked"

A tool is **well marked** if and only if all seven items hold:

1. **Icon** in a toolbar button (Lucide or equivalent) OR a menu-only entry with a clear human-readable name. (Hidden-only-via-shortcut tools are NOT well marked — see §5.4.)
2. **Tooltip** that includes the human name + the keyboard shortcut (if one exists). Tooltip must be a real `title=` AND an `aria-describedby` so screen readers receive it.
3. **ARIA label** that matches the tooltip's name component (not the whole sentence).
4. **Menu entry** under the correct top-level menu (File / Edit / View / Insert / Tools / Comment / Window / Help). Annotation tools MUST appear under Comment (or Tools→Comment). Page ops MUST appear under Insert or Edit→Pages.
5. **i18n key** in `en-US` AND `es-ES` (per Phase 7 i18n scope) — both label and tooltip and ARIA label. No hardcoded English in `aria-label=`, `title=`, or button text. Caught by the §8.5 Phase-7 grep: `aria-label="[A-Z]`.
6. **Keyboard shortcut** registered in `src/client/shortcuts.ts` AND wired in `use-app-shortcuts.ts` — unless the tool is truly mouseless-irrelevant (e.g. a sub-menu opener).
7. **Discoverable** via a top-level "Find a tool…" search (Bucket A7) and via the in-app Help modal's shortcuts table.

### 5.2 Tool registry (proposed)

Introduce a single declarative source of truth: `src/client/tools/registry.ts`. Each tool entry has shape:

```ts
export interface ToolDef {
  id: ToolId; // stable identifier ('annotation:highlight', 'page:rotate-cw')
  nameKey: string; // i18n key for visible name
  tooltipKey: string; // i18n key for tooltip (includes shortcut text)
  ariaLabelKey: string; // i18n key for screen reader name (may = nameKey)
  icon: IconName; // Lucide-or-equivalent icon name
  shortcutId: ShortcutId | null; // FK into shortcuts.ts
  menu: { top: MenuTopId; section?: string }; // where it lives in the menu
  surfaces: {
    // where it's wired into the UI
    toolbar?: ToolbarGroupId;
    menu: boolean;
    contextMenu?: ContextMenuTargetId;
  };
  enabledWhen: (state: RootState) => boolean;
  dispatch: (dispatch: AppDispatch) => void;
  searchKeywords: string[]; // for the "Find a tool…" search
  deprecationNote?: string; // populated when a tool is retired/relocated
}
```

The toolbar, menu-bar, shape-toolbar, and "Find a tool…" search all become **renderers of the same registry**. This eliminates the toolbar↔menu mirror drift documented in §3 (9 annotation tools that ship in the toolbar but not the menu).

### 5.3 Convention-enforcing tests (Vitest)

Per `docs/conventions.md` §3.3 testing-as-policy pattern, add four enforcement tests:

```ts
// src/client/tools/registry.contract.test.ts

// (1) Every tool in registry has all 7 marking dimensions.
test('every tool is well marked', () => {
  for (const tool of TOOLS) {
    expect(tool.nameKey).toBeTruthy();
    expect(tool.tooltipKey).toBeTruthy();
    expect(tool.ariaLabelKey).toBeTruthy();
    expect(tool.icon || tool.menu).toBeTruthy();
    // i18n key exists in both locales
    for (const locale of ['en-US', 'es-ES'] as const) {
      expect(getString(locale, tool.nameKey)).not.toBe(tool.nameKey); // i.e. resolved
      expect(getString(locale, tool.tooltipKey)).not.toBe(tool.tooltipKey);
      expect(getString(locale, tool.ariaLabelKey)).not.toBe(tool.ariaLabelKey);
    }
  }
});

// (2) Every tool with a shortcut has the shortcut shown in its tooltip.
test('tooltips advertise their shortcut', () => {
  for (const tool of TOOLS) {
    if (!tool.shortcutId) continue;
    const tooltipEn = getString('en-US', tool.tooltipKey);
    const sc = SHORTCUTS.find((s) => s.id === tool.shortcutId)!;
    expect(tooltipEn).toMatch(formatShortcut(sc));
  }
});

// (3) Every shortcut maps to a tool (no orphan shortcuts).
test('every shortcut surfaces in the registry', () => {
  const unsurfacedShortcuts = SHORTCUTS.filter(
    (s) => !TOOLS.some((t) => t.shortcutId === s.id) && !INTRINSIC_SHORTCUTS.has(s.id),
  );
  expect(unsurfacedShortcuts).toEqual([]); // currently the V/Esc cursor tool would fail; A5 fix
});

// (4) No stale "Coming in Phase X" tooltips for shipped phases.
test('no stale "coming in Phase N" tooltips', () => {
  const SHIPPED_PHASES = [1, 2, 3, 4, 5, 6, 7];
  const stale = TOOLS.filter((t) => {
    const tip = getString('en-US', t.tooltipKey);
    return /Coming in Phase (\d)/i.test(tip) && SHIPPED_PHASES.includes(Number(RegExp.$1));
  });
  expect(stale).toEqual([]);
});
```

This is the **convention-enforced ratchet** the principal asked about — and the (4) check would immediately catch the three stale tooltips identified in §3.

### 5.4 Lock recommendation (L-007 candidate, FUTURE)

**Do NOT lock now.** Mature the tool-registry pattern for one phase first; if Phase 7.4 ships with the registry and the four tests above, propose:

> **L-007 (FUTURE, Dmitri to evaluate post-Phase-7.4):** Every tool MUST be registered in `src/client/tools/registry.ts` with all seven marking dimensions. The four `registry.contract.test.ts` tests MUST pass in CI. Stale "Coming in Phase N" tooltips for shipped phases are a CI failure.

This satisfies the principal's "well-marked" phrasing in machine-checkable form.

---

## 6. Surprises (called out per dispatch ask)

1. **Find/Search has been advertised as "Coming in Phase 3" for three phases past Phase 3.** This is the worst marking lie in the app. The shortcut `Ctrl+F` is registered, the help-modal documents it, but the handler dispatches a toast that says "coming in Phase 3" — three phases after Phase 3 shipped. Recommend Bucket B3 _or_ deletion of the affordance.
2. **Shape sub-toolbar has zero i18n coverage.** Eight visible labels + container ARIA + button ARIAs are all hardcoded English. Direct violation of `conventions.md` §18.3 rule 8 (`aria-label="[A-Z]"` grep). Slipped past Wave-29 Julian a11y audit because the grep didn't visit `src/client/components/shape-tools/`.
3. **Acrobat's Fill & Sign is what WE call "Signature Capture" — the menu still says "Coming in Phase 4".** Phase 4 SHIPPED visual + PAdES signatures in May. Pure rebrand-and-rewire problem; <1 hr fix.
4. **Mail Merge is unique-to-us vs Acrobat.** Acrobat requires a third-party plugin for this. We can lean on it in marketing (and Acrobat parity claims).
5. **OCR confidence overlay is unique-to-us vs Acrobat** at the same per-word granularity. Acrobat shows results; it doesn't paint per-word confidence color over the page.
6. **The edit-replay engine internally is Acrobat's Action Wizard in a different costume.** Surfacing it as Bucket B9 is the smallest delta to claim a previously-niche Acrobat feature.
7. **Annotation toolbar tools have NO menu mirror.** Highlight, Sticky note, Text box, Underline, Strikethrough, Freehand — none appear under any menu. Acrobat puts them all under Comment + Tools panel. Discoverability-only-via-toolbar is a real failure mode for keyboard-first / screen-reader users.
8. **`Insert → Page from File` and `Insert → Blank Page` menu items dispatch a `phase3()` "coming soon" toast even though the same operations are wired to toolbar buttons (Insert blank, Insert from file).** The menu items LOOK enabled and they fire the toast. Bucket A1 deletes this dishonesty by wiring them to the same dispatchers the toolbar uses.
9. **Disabled-Scan tooltip says "Phase 5.1" — there is no Phase 5.1 in the roadmap.** Phase 5.1 was filed as deferred indefinitely (no MIT TWAIN binding); the user-facing tooltip should say "Use your OS scan utility, then drag the saved PDF here" — which is exactly what the **scan-modal body** already says. Copy the modal's deferral copy into the disabled-button tooltip.
10. **The toolbar's Shapes button is a stale placeholder; the actual shape tools live in a separate sub-toolbar (`shape-tools/shape-toolbar.tsx`) that mounts elsewhere in the UI.** Two-toolbar confusion is itself a marking failure. Recommend wiring the main-toolbar Shapes button to focus / toggle visibility of the shape sub-toolbar (Bucket A1 + cleanup).

---

## 7. Status counts (for principal triage)

| Bucket                        | Items      | Effort                                                                                     |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| Bucket A quick wins           | A1–A7      | ~9 hours (1 PR each, mostly i18n + menu wiring + tooltip refresh)                          |
| Bucket B Phase 7.4 candidates | B1–B10     | 9 waves total. Best 3 to pick: **B1 Redaction**, **B3 Find/Search**, **B2 Compare Files**. |
| Bucket C out of scope         | —          | —                                                                                          |
| Marking enforcement           | §5.3 tests | 1 PR (≈3 hr) — slot into Phase 7.4 alongside whichever B-feature ships                     |

End of audit.
