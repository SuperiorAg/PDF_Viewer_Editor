# UI Spec — Phase 7.5

**Author:** Riley (VP of Product Design & Frontend Engineering)
**Date:** 2026-06-17 (Wave 1, Phase 7.5)
**Status:** Wave 1 design, locked at end of wave. Drives Riley's Wave 2..Wave 7 + Wave 5a..5d UI implementation. Reads + complements `docs/ui-spec.md` §1–§16 (Phase 1–7 UI surfaces, frozen).
**Scope:** Per-feature UI specs for every Bucket B (B2–B21) and Bucket C (C1–C6) item brought into scope by the principal "do all" ruling. Bucket A (A1–A7) deltas are included where they affect tooltip/menu structure shared with B/C.

> **Companion documents.** Architectural routing in `docs/architecture-phase-7.5.md`. IPC contracts in `docs/api-contracts.md` §19. SQLite delta in `docs/data-models.md` §13. Tool registry interface + cutover in `docs/tool-registry-spec.md`. Accessibility-authoring deep design in `docs/accessibility-authoring-spec.md`. Preflight rule subset in `docs/preflight-spec.md`.

---

## 0. Conventions reaffirmed for Phase 7.5

Every component spec'd below:

1. Reads visible strings + tooltips + ARIA labels via `t()` from `react-i18next` (Phase 7 P7-L-5; conventions §18.3 rule 8 — the `aria-label="[A-Z]"` grep catches hardcoded English).
2. Has a registry entry per `docs/tool-registry-spec.md` (R1 cutover, Wave 2).
3. Inherits the toolbar's `role="toolbar"` + roving-tabindex (Phase 7 R-3) when it lives in the toolbar; explicit ARIA on stand-alone modals (`role="dialog"` + `aria-modal="true"` + first-focusable focused on open; destructive-confirm modals use `role="alertdialog"`).
4. Uses **Focus Trap** in modals (existing `useFocusTrap` hook) and restores focus to the invoker on close.
5. Keyboard nav: every interactive control reachable via Tab; every action has either a primary shortcut, a menu mirror, or both.
6. i18n: en-US + es-ES bundles updated in lockstep. Per the seven-times-proven trust-floor pattern (P7.5 §8), the four honest-disclosure obligations are surfaced at four locations each.

---

## 1. Bucket A UI deltas (A1–A7, Wave 2)

### 1.1 A1 — Stale tooltip + dishonest-placeholder cleanup

| Surface                           | Change                                                                                                                                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toolbar:shapesTooltip`           | Replace "Shapes (Phase 4)" with "Shape annotation tools (toggle sub-toolbar)". Toolbar Shapes button becomes `aria-pressed` toggle that mounts/unmounts the existing shape sub-toolbar via the `ui.shapesPanelOpen` flag (already wired in Phase 7.4 A5 commit `25d0adb`). |
| `menu:tooltips.findComing`        | DELETE. Replace with no tooltip — the menu item is now wired to the real Find dispatcher (B3, this wave).                                                                                                                                                                  |
| `menu:tooltips.fillSignComing`    | DELETE. The Tools → Fill & Sign menu item now mirrors the Signature Capture flow (existing); label changed to "Fill & Sign…".                                                                                                                                              |
| Insert → Blank Page menu item     | Wire to the existing `dispatch(insertBlankPage())` (the toolbar's `insertBlank` dispatcher). Stop firing `phase3()`.                                                                                                                                                       |
| Insert → Page from File menu item | Wire to the new B11 dispatcher (`pdf:insertPagesFromFile`).                                                                                                                                                                                                                |
| `toolbar:scanDeviceTooltip`       | Replace "Scanner integration arrives in Phase 5.1" with "Use your OS scan utility, then drag the saved PDF here." (per audit §6.9 — Phase 5.1 doesn't exist; honest message).                                                                                              |

`phase3()` toast helper is retired this wave; Wave 2 grep verifies no callers remain.

### 1.2 A2 — Shape sub-toolbar i18n

`src/client/components/shape-tools/shape-toolbar.tsx` currently has 8 hardcoded labels + a hardcoded container ARIA label. Wave 2:

- New i18n namespace `shapes` in `en-US` + `es-ES` with keys:
  - `shapes.rect.label` / `shapes.rect.tooltip` / `shapes.rect.aria`
  - (same triplet for `ellipse`, `polygon`, `line`, `arrow`, `callout`, `lineMeasure`, `polylineMeasure`)
  - `shapes.toolbar.aria` — container label
- All eight button strings routed through `t('shapes.<id>.label')` / `t('shapes.<id>.tooltip')` / `t('shapes.<id>.aria')`.
- Container `aria-label={t('shapes.toolbar.aria')}`.

### 1.3 A3 — Missing shortcut tooltips

| Tool               | New shortcut        | New tooltip                                   |
| ------------------ | ------------------- | --------------------------------------------- |
| Bookmarks edit     | `Alt+B`             | "Toggle bookmarks edit mode (Alt+B)"          |
| Run OCR            | `Alt+O`             | "Run OCR on this document (Alt+O)"            |
| Combine            | `Alt+C`             | "Combine PDFs (Alt+C)"                        |
| Insert blank page  | `Alt+I` `B` (chord) | "Insert blank page (Alt+I, B)"                |
| Confidence overlay | `Alt+Shift+O`       | "Toggle OCR confidence overlay (Alt+Shift+O)" |

Shortcuts register in `shortcuts.ts` and wire in `use-app-shortcuts.ts`. Help modal's shortcut table re-renders from the registry (architecture §2.3).

### 1.4 A4 — Menu mirrors for toolbar-only items

The registry-driven menu-bar renderer (architecture §2.3) automatically surfaces the 9 toolbar-only items per their `surfaces.menu === true` field. New menu structure:

- **Comment** (new top-level menu — per audit §4 A4 recommendation): Highlight, Sticky note, Text box, Underline, Strikethrough, Freehand, Shapes sub-toolbar toggle, Stamps submenu (B7).
- **Pages** (renamed from Insert → "Insert & Pages"): Rotate CW, Rotate CCW, Delete page, Crop (B5), Extract (B10), Split (B10), Replace (B10).

Menu structure derives from `ToolDef.menu` — no per-item hand-wiring.

### 1.5 A5 — Cursor / Hand-tool button

New toolbar button at the start of the annotation group: `cursor:default`, icon `cursor`, label `t('toolbar:cursorDefault')`, tooltip `t('toolbar:cursorDefaultTooltip')` = "Selection cursor (V)". `aria-pressed` when active. Registry entry only — no new dispatcher (the shortcut already exists).

### 1.6 A6 — Fit width / Fit page

Wave 2 replaces the Phase-1 no-op in `use-app-shortcuts.ts:259-263` with real handlers:

- `Ctrl+1` → `dispatch(setZoom({ mode: 'fit-width', viewportPx: <current viewport width> }))`. Computes effective zoom = `viewportPx / largestPageWidthPt * 72`.
- `Ctrl+2` → `dispatch(setZoom({ mode: 'fit-page', viewportPx: <viewport width + height> }))`. Computes effective zoom = `min(viewportWidthPx / largestPageWidthPt, viewportHeightPx / largestPageHeightPt) * 72`.

Both fire on viewport resize so the fit mode is sticky until the user changes zoom manually. Status-bar zoom dropdown shows "Fit width" / "Fit page" when the fit mode is active.

### 1.7 A7 — Find a tool palette

**New component:** `src/client/components/tool-search-palette/index.tsx`.

```
┌──────────────────────────────────────────────────────────┐
│ ⌕ [Find a tool…                                      ] × │
├──────────────────────────────────────────────────────────┤
│ ▸ Compare Files                          File menu       │
│   Crop Pages                             Pages menu      │
│   Find / Search                          Ctrl+F          │
│   Find in document                       Edit menu       │
│   Read Aloud                             View menu       │
│                                                          │
│ Press ↑↓ to navigate · ⏎ to run · Esc to close          │
└──────────────────────────────────────────────────────────┘
```

- Triggered by `Ctrl+/` (registered as `intrinsic` shortcut, not a tool).
- Centered modal, ~600px wide, max 12 results.
- `role="dialog"` + `aria-modal="true"`; `aria-labelledby` points at the search input's hidden label.
- Search input: `role="searchbox"`, `aria-autocomplete="list"`, `aria-controls="tool-search-results"`. `autoFocus` allowed because the element is inside `role="dialog"` (per conventions §13.2 dialog-autofocus carve-out).
- Result list: `role="listbox"`, each result `role="option"` with `aria-selected` on the active item.
- Fuzzy scorer: small inline implementation (Levenshtein with case-insensitive substring boost). Searches `nameKey`-resolved string + `searchKeywords`.
- ↑ / ↓ navigates; ⏎ dispatches the tool's `dispatch(...)`; Esc closes. Focus returns to the originating tool surface (or `body` if `Ctrl+/` was the trigger).
- Renderer reads from the tool registry — every Bucket B and C tool surfaces automatically.

**State machine:**

```
closed → (Ctrl+/) → open(query='') →
  (typing) → open(query=X) →
  (↑/↓) → open(query=X, activeIndex=N) →
  (⏎ on activeIndex) → dispatch + close →
  (Esc | overlay-click | focus-loss) → closed
```

---

## 2. B2 Compare Files (Wave 7)

**Files:** `src/client/components/compare-panel/{index.tsx,compare-page-row.tsx,compare-summary.tsx}`. New slice `compareSlice` (`src/client/state/slices/compare-slice.ts`).

**Trigger:** File → Compare PDFs… (`Ctrl+Shift+M` — new shortcut) OR registry tool `compare:open`.

### 2.1 Visual layout

Two-step modal (`role="dialog"` + `aria-modal="true"`):

**Step 1 — File pickers:**

```
┌─ Compare PDFs ──────────────────────────────────── × ┐
│                                                      │
│   Baseline:  [contract-v1.pdf            ] [Browse]  │
│   Modified:  [contract-v2.pdf            ] [Browse]  │
│                                                      │
│   [ ] Compute visual diff (slower)                   │
│                                                      │
│                            [Cancel] [Compare ▶]      │
└──────────────────────────────────────────────────────┘
```

**Step 2 — Results panel** (full-screen split, replaces document viewer until closed):

```
┌─ Compare: contract-v1.pdf  vs  contract-v2.pdf ─── × ┐
│ Summary: 3 pages with differences · 17 inserts · 4 ↓ │
├──────────────────────┬───────────────────────────────┤
│  Baseline (24 pp)    │   Modified (26 pp)            │
│  ┌────────────────┐  │   ┌────────────────┐          │
│  │  page 1 thumb  │  │   │  page 1 thumb  │          │
│  │  ✓ unchanged   │  │   │  ✓ unchanged   │          │
│  └────────────────┘  │   └────────────────┘          │
│  ┌────────────────┐  │   ┌────────────────┐          │
│  │  page 2 thumb  │  │   │  page 2 thumb  │          │
│  │  ● differs (7)│  │   │  ● differs (7)│          │
│  │  [Show visual] │  │   │  [Show visual] │          │
│  └────────────────┘  │   └────────────────┘          │
│   ...                │    ...                        │
└──────────────────────┴───────────────────────────────┘
```

Page rows scroll independently in each pane; selecting a page on either side scrolls the matching page on the other. Inserted-only pages (in modified but not baseline) get an `+` badge; deleted-only pages get a `−` badge.

### 2.2 Text diff rendering

When a row is expanded ("Show details"), the text diff renders in-place as red-strike + green-add spans (similar to git diff UI). Renderer reuses the existing inline-diff component pattern from the Phase 7.4 redaction preview.

### 2.3 Visual diff rendering

"Show visual diff" button per row dispatches `pdf:getCompareDiff({ sessionId, pageIndex, includeVisualDiff: true })`. The returned base64 PNG renders as an overlay on top of the modified page thumb with the changed pixels tinted (cyan additions, red deletions). Diff pixel count shows next to the button.

### 2.4 State diagram

```
closed → (open) → pickerOpen →
  (Compare ▶) → loading(handles open in main) →
  (success) → results(sessionId, summaryLoaded) →
  (per-row expand) → results + perPageDiff loaded lazily →
  (Show visual diff per row) → perPageVisualDiff loaded →
  (Esc | close button) → closing(pdf:closeCompareSession) →
  closed
```

### 2.5 Accessibility

- Compare panel has `role="region"` + `aria-label={t('compare.regionAria')}`.
- Each page row is `role="article"` with `aria-labelledby` on the page-number heading.
- Visual diff overlay has `aria-label={t('compare.visualDiffAria', { count: pixelCount })}`.
- Focus management: opening the panel focuses the Summary heading; Esc returns focus to the menu item that opened it.

### 2.6 i18n keys (new namespace `compare`)

- `compare.title`, `compare.baseline`, `compare.modified`, `compare.computeVisualDiff`, `compare.compareButton`, `compare.cancelButton`
- `compare.summary` (plural: `compare.summary_one` / `compare.summary_other`), `compare.insertedSpans`, `compare.deletedSpans`
- `compare.pageUnchanged`, `compare.pageDiffersOne`, `compare.pageDiffersOther`, `compare.pageInsertedOnly`, `compare.pageDeletedOnly`
- `compare.showVisualDiff`, `compare.hideVisualDiff`, `compare.showDetails`, `compare.hideDetails`
- `compare.regionAria`, `compare.visualDiffAria`

---

## 3. B3 Find / Search (Wave 2)

**Files:** `src/client/components/find-bar/{index.tsx,find-bar.test.tsx}`. New slice `searchSlice`.

**Trigger:** `Ctrl+F` (already in shortcuts.ts but currently fires a stale toast).

### 3.1 Visual layout

Anchored top-right of the viewer (like Acrobat). Replaces the historical disabled menu item.

```
                                  ┌─ Find ─────────────────────────────┐
                                  │ ⌕ [query                    ] 3/12 │
                                  │ [aA] [Aa] [<] [>] [×]              │
                                  └────────────────────────────────────┘
```

- `[aA]` = case-sensitive toggle (`aria-pressed`).
- `[Aa]` = whole-word toggle.
- `[<]` / `[>]` = previous / next match (F3 / Shift+F3).
- `[×]` = close.

The match counter `3/12` shows "match N of M (on this page)". When the user advances past the current-page matches, the counter becomes `3/12 · searching page 7 of 1064…` while the lazy page walk progresses.

### 3.2 State diagram

```
closed → (Ctrl+F) → open(query='', focused) →
  (typing) → open(query=X, matches on current page computed) →
  (Enter | F3) → open + advance match →
  (Shift+F3) → open + retreat match →
  (advance past last on page) → open + lazy page walk N→N+1 →
  (Esc | ×) → closed (focus returns to viewer)
```

### 3.3 Accessibility

- `role="search"` on the bar container; `aria-label={t('find.bar')}`.
- Match counter is `aria-live="polite"` so screen readers announce progression without focus loss.
- Toggles use `aria-pressed`.
- Esc returns focus to the viewer; the active match remains highlighted until the user moves to a different page.

### 3.4 Performance — preserves perf gate

Lazy per-page walk (P7.5-L-8). NO eager full-text index. Match highlight uses the existing pdf.js TextLayer highlight machinery — already in place from Phase 1.

### 3.5 i18n keys (new namespace `find`)

`find.bar`, `find.placeholder`, `find.caseSensitive`, `find.wholeWord`, `find.previous`, `find.next`, `find.close`, `find.matchCounter` (plural: `find.matchCounter_one` / `find.matchCounter_other`), `find.searchingPage`, `find.noMatches`.

---

## 4. B4 Watermark / Header & Footer / Background (Waves 3 engine + 4 UI)

**Files:** `src/client/components/page-design-modal/{index.tsx,watermark-tab.tsx,header-footer-tab.tsx,background-tab.tsx,preview-pane.tsx}`. New slice `pageDesignSlice`.

**Trigger:** Pages menu → Watermark… / Header & Footer… / Background… (three menu items; each opens the same modal with the matching tab active). Registry tool IDs `page-design:watermark`, `page-design:header-footer`, `page-design:background`.

### 4.1 Visual layout

Three-tab modal (`role="dialog"`):

```
┌─ Page Design ──────────────────────────────────── × ┐
│ ┌Watermark ┬Header & Footer ┬Background┐            │
│ │                                                   │
│ │  Source:    (•) Text   ( ) Image                  │
│ │  Text:      [DRAFT                       ]        │
│ │  Font size: [120]  Color: [■#FF0000]              │
│ │  Rotation:  [45°]  Opacity: [─●─────] 30%         │
│ │  Position:  ( ) Top-left  (•) Center  ( ) ...     │
│ │  Layer:     (•) Overlay   ( ) Underlay            │
│ │                                                   │
│ │  Apply to:  (•) All pages                         │
│ │             ( ) Pages: [1-5,8,10-12]              │
│ │             ( ) Current page                      │
│ ├─ Preview ────────────────────────────────────────┤│
│ │  [thumbnail of page with watermark applied]       │
│ └───────────────────────────────────────────────────┘│
│                          [Cancel] [Apply ▶]          │
└──────────────────────────────────────────────────────┘
```

### 4.2 State diagram

```
closed → (open, kind=watermark|header-footer|background) →
  configuring(kind, form state) →
  (any form change) → configuring + preview recomputed →
  (Apply ▶) → applying(IPC dispatched) →
  (success) → closed + dirty-flag set →
  (Cancel | Esc) → closed (no apply)
```

### 4.3 Accessibility

- Tabs use the `role="tablist"` / `role="tab"` / `role="tabpanel"` pattern that landed in Phase 7 for Settings (architecture §5).
- Each form field has `<label>` + `aria-describedby` for the help text.
- Preview pane has `role="img"` + `aria-label={t('pageDesign.previewAria')}`.

### 4.4 i18n keys (new namespace `pageDesign`)

`pageDesign.title`, `pageDesign.tabs.watermark`, `pageDesign.tabs.headerFooter`, `pageDesign.tabs.background`, `pageDesign.source.text`, `pageDesign.source.image`, `pageDesign.text`, `pageDesign.fontSize`, `pageDesign.color`, `pageDesign.rotation`, `pageDesign.opacity`, `pageDesign.position.<topLeft|topRight|center|bottomLeft|bottomRight>`, `pageDesign.layer.overlay`, `pageDesign.layer.underlay`, `pageDesign.range.all`, `pageDesign.range.pages`, `pageDesign.range.current`, `pageDesign.apply`, `pageDesign.cancel`, `pageDesign.previewAria`.

---

## 5. B5 Crop Pages (Wave 2)

**Files:** `src/client/components/crop-tool/{index.tsx,crop-overlay.tsx,crop-modal.tsx}`. Crop state lives in `ui-slice` under `ui.cropMode`.

**Trigger:** Pages menu → Crop… OR registry tool `pages:crop`.

### 5.1 Visual layout

Two activations:

1. **Drag-handle overlay** on the active page — eight drag handles + crop-rect outline. Pixel measurements show in a small overlay at top-right of the page.
2. **Modal for numeric / range entry:**

```
┌─ Crop Pages ─────────────────────────────────── × ┐
│  Margins (points):                                 │
│    Top:    [12]   Bottom: [12]                     │
│    Left:   [12]   Right:  [12]                     │
│                                                    │
│  Apply to:  (•) Current page  ( ) Range  ( ) All  │
│  Pages:     [1-5,10]                               │
│                                                    │
│  [ ] Respect page rotation                         │
│                                                    │
│                       [Cancel] [Crop ▶]            │
└────────────────────────────────────────────────────┘
```

The drag-handle overlay populates the modal's margin fields live; the user can also type values into the modal and see the overlay snap.

### 5.2 State diagram

```
viewing → (enter crop mode) → cropping(activePageRect, margins) →
  (drag handle) → cropping(updated rect) →
  (modal range change) → cropping(updated range) →
  (Crop ▶) → applying(IPC dispatched) →
  (success) → viewing + dirty-flag set →
  (Cancel | Esc) → viewing (no change)
```

### 5.3 Accessibility

- Drag handles have `role="slider"` with `aria-valuemin` / `max` / `now` set in points. Keyboard nav: arrow keys nudge by 1pt; Shift+arrow by 10pt.
- Range field has `aria-describedby` pointing at a help text node ("e.g. 1-5,10").

### 5.4 i18n keys (new namespace `crop`)

`crop.title`, `crop.margins.top`, `crop.margins.bottom`, `crop.margins.left`, `crop.margins.right`, `crop.range.current`, `crop.range.range`, `crop.range.all`, `crop.respectRotation`, `crop.crop`, `crop.cancel`, `crop.dragHandleAria`.

---

## 6. B6 Compress / Optimize PDF (Wave 4)

**Files:** `src/client/components/compress-modal/index.tsx`.

**Trigger:** File menu → Reduce File Size… OR registry tool `file:compress`.

### 6.1 Visual layout

```
┌─ Reduce File Size ─────────────────────────────── × ┐
│  Current size: 18.4 MB                              │
│                                                     │
│  Image quality:  ( ) Original                       │
│                  ( ) High (150 dpi)                 │
│                  (•) Web (96 dpi)                   │
│                  ( ) Small (72 dpi)                 │
│                                                     │
│  [ ] Recompress JPEGs (quality slider) [─●──] 85%   │
│  [✓] Subset embedded fonts                          │
│  [✓] Remove unused objects                          │
│                                                     │
│  Estimated size: ~6.2 MB (66% reduction)            │
│                                                     │
│                       [Cancel] [Reduce ▶]           │
└─────────────────────────────────────────────────────┘
```

Estimate is computed in the renderer from a one-pass scan of image XObjects + font tables (cheap, no engine call). The actual reduction may differ — the modal shows "≈" and a note "Actual reduction depends on document content".

### 6.2 State diagram

```
closed → (open) → configuring(opts) →
  (Reduce ▶) → applying(IPC dispatched; progress event stream optional) →
  (success) → closed + dirty + toast(reduction%) →
  (Cancel | Esc) → closed
```

### 6.3 i18n keys (new namespace `compress`)

`compress.title`, `compress.currentSize`, `compress.imageQuality.original`, `compress.imageQuality.high`, `compress.imageQuality.web`, `compress.imageQuality.small`, `compress.recompressJpegs`, `compress.subsetFonts`, `compress.removeUnused`, `compress.estimatedSize`, `compress.reductionNote`, `compress.reduce`, `compress.cancel`, `compress.successToast`.

---

## 7. B7 Stamps + Stamp library (Wave 3)

**Files:** `src/client/components/stamps-panel/{index.tsx,stamp-card.tsx,stamp-add-modal.tsx,stamp-placement-overlay.tsx}`. New slice `stampSlice`.

**Trigger:** Comment menu → Stamps (or toolbar Stamps button — Comment group). Registry tool `comment:stamps`.

### 7.1 Visual layout

**Sidebar panel** (sibling of Bookmarks/Annotations panels):

```
┌─ Stamps ────────────────────────── + ─┐
│ Built-in (10)                          │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐    │
│ │APPRVD│ │CONFI │ │DRAFT │ │SAMPLE│    │
│ └──────┘ └──────┘ └──────┘ └──────┘    │
│ ...                                    │
│                                        │
│ My Stamps (3)                          │
│ ┌──────┐ ┌──────┐ ┌──────┐             │
│ │  Joe │ │ logo │ │ ack  │             │
│ └──────┘ └──────┘ └──────┘             │
│                                        │
│ Recently used                          │
│ ┌──────┐ ┌──────┐                      │
│ │APPRVD│ │  Joe │                      │
│ └──────┘ └──────┘                      │
└────────────────────────────────────────┘
```

- Clicking a stamp card enters placement mode — cursor becomes the stamp ghost; next page-click places the stamp via `pdf:applyStamp`.
- `+` button opens the Add Stamp modal (text or image).

### 7.2 State diagram

```
viewing → (open Stamps panel) → panel-open →
  (click stamp card) → placement(stampId) →
  (move mouse over page) → placement + ghost cursor →
  (click on page) → applying →
  (success) → panel-open + annotation added →
  (Esc) → panel-open
```

### 7.3 Add Stamp modal

```
┌─ Add Stamp ─────────────────────────────────── × ┐
│  Kind:   (•) Text  ( ) Image                     │
│  Name:   [Joe Approved                       ]   │
│  Text:   [JOE APPROVED                       ]   │
│  Color:  [■#008800]   Width: [220pt]             │
│                                                  │
│                       [Cancel] [Add]             │
└──────────────────────────────────────────────────┘
```

Image kind swaps Text/Color/Width for "Image: [Browse…]".

### 7.4 Accessibility

- Stamp cards have `role="button"` + `aria-label={t('stamps.cardAria', { name })}`.
- Placement mode is announced via `aria-live` region ("Stamp Approved selected; click on a page to place, Esc to cancel").

### 7.5 i18n keys (new namespace `stamps`)

`stamps.title`, `stamps.builtIn`, `stamps.mine`, `stamps.recent`, `stamps.addButton`, `stamps.addModal.title`, `stamps.kind.text`, `stamps.kind.image`, `stamps.name`, `stamps.text`, `stamps.color`, `stamps.width`, `stamps.image`, `stamps.cardAria`, `stamps.placementAria`, `stamps.builtin.approved`, `stamps.builtin.confidential`, `stamps.builtin.draft`, `stamps.builtin.sample`, `stamps.builtin.reviewed`, `stamps.builtin.urgent`, `stamps.builtin.notForDistribution`, `stamps.builtin.received`, `stamps.builtin.faxed`, `stamps.builtin.copy`.

---

## 8. B8 Password protection (Wave 5 — bundled with B21 Document Properties)

**Files:** integrated into the Document Properties dialog as a Security tab (§9). No stand-alone modal.

### 8.1 Security tab in Document Properties

```
┌─ Document Properties ─ Security ──────────────── × ┐
│ Current security: Open password ✓                  │
│                   Permissions password ✓           │
│                   Encryption AES-256               │
│                                                    │
│  [ ] Require password to open                      │
│      Password:  [●●●●●●●●●●●          ]            │
│      Confirm:   [●●●●●●●●●●●          ]            │
│                                                    │
│  [ ] Require permissions password                  │
│      Password:  [●●●●●●                ]            │
│      Confirm:   [●●●●●●                ]            │
│                                                    │
│  Permissions (when permissions password set):      │
│   [✓] Print       [✓] Modify      [✓] Copy         │
│   [✓] Annotate    [✓] Fill forms  [✓] Extract      │
│   [✓] Assemble    [✓] Print high res               │
│                                                    │
│  Encryption: ( ) AES-128   (•) AES-256             │
│                                                    │
│  ⚠ Saving with new password will rebuild the PDF.  │
│    Existing signatures will be invalidated.        │
│                                                    │
│                     [Cancel] [Apply Security ▶]    │
└────────────────────────────────────────────────────┘
```

### 8.2 State diagram

```
properties-open(Security tab) → editing(form state) →
  (Apply Security ▶) → confirm-dialog (PAdES-style for signed docs) →
  (Confirm) → applying(pdf:setPasswordProtection) →
  (success) → properties-closed + dirty + toast("Encrypted; please re-save document") →
  (Cancel) → properties-open(other tab) or properties-closed
```

### 8.3 PAdES gate

If the doc has signed PAdES signatures, Apply triggers an `alertdialog` confirmation that lists the field names that will be invalidated. Pattern mirrors the Phase 7.4 B1 redaction PAdES gate (`signed_pdf_requires_confirm` short-circuit).

### 8.4 i18n keys (new namespace `security`)

`security.currentSecurity`, `security.requireOpenPassword`, `security.requirePermissionsPassword`, `security.password`, `security.confirmPassword`, `security.passwordMismatch`, `security.passwordTooShort`, `security.permissions.print`, `security.permissions.modify`, ..., `security.encryption.aes128`, `security.encryption.aes256`, `security.rebuildWarning`, `security.invalidatesSignatures`, `security.applyButton`, `security.successToast`.

---

## 9. B9 Action Wizard (Wave 6)

**Files:** `src/client/components/action-wizard/{index.tsx,recorder-bar.tsx,script-list.tsx,batch-runner-modal.tsx}`. New slice `actionWizardSlice`.

**Trigger:** Tools menu → Action Wizard… OR registry tool `tools:action-wizard`.

### 9.1 Visual layout — Recorder bar

When recording, a docked bar appears below the main toolbar:

```
┌─ Recording Action ─────────────────────────────────────── × ┐
│ ● REC · Watermark to all pages → Rotate CW (current page)   │
│ Ops recorded: 2                                             │
│                                          [Pause] [Stop ▶]   │
└─────────────────────────────────────────────────────────────┘
```

Stop opens the Save Script modal asking for a name. Saved scripts list:

### 9.2 Script list panel

```
┌─ Action Wizard ─────────────────────────────── × ┐
│  Saved Actions:                                  │
│   ▸ Apply company watermark    (3 ops, used 12×) │
│   ▸ Add page numbers + header  (4 ops, used 0×)  │
│   ▸ Compress to web quality    (1 op, used 47×)  │
│                                                  │
│   [▶ Run]  [✎ Edit]  [⤓ Export]  [+ Import]      │
│                                                  │
│   [● Record new action]                          │
└──────────────────────────────────────────────────┘
```

### 9.3 Batch runner modal

```
┌─ Run: Apply company watermark ────────────────── × ┐
│  Target files (drag PDFs here, or pick a folder):  │
│   [─────────────────────────────────────────]      │
│   contract-acme.pdf                                │
│   contract-bigco.pdf                               │
│   contract-newhire.pdf       (3 files)             │
│                                                    │
│  Destination folder:                               │
│   [C:\Users\me\Documents\watermarked\] [Browse]   │
│                                                    │
│  Output filename pattern: [{base}-acted.pdf]      │
│                                                    │
│  Progress:                                         │
│   [████████████░░░░░░░░░░░░░░░░] 12/30 files       │
│                                                    │
│                       [Cancel] [Run ▶]             │
└────────────────────────────────────────────────────┘
```

### 9.4 State diagram

```
viewing → (start recording) → recording(ops=[]) →
  (any document op dispatched) → recording(ops=[...,op]) →
  (Pause) → recording-paused →
  (Resume) → recording →
  (Stop) → save-script-modal →
  (Save) → script-list updated →
  (Run) → batch-runner-modal →
  (Run ▶) → running(progress N/M) →
  (success) → results-modal(N succeeded, M failed) →
  (close) → viewing
```

### 9.5 Banned ops

The recorder rejects `kind === 'set-password'` (architecture AR5) silently — the user gets a toast "Password operations are not recordable for security reasons".

### 9.6 i18n keys (new namespace `actionWizard`)

`actionWizard.title`, `actionWizard.recorder.recording`, `actionWizard.recorder.opsRecorded`, `actionWizard.recorder.pause`, `actionWizard.recorder.stop`, `actionWizard.scriptList.savedActions`, `actionWizard.scriptList.usageCount` (plural), `actionWizard.scriptList.run`, `actionWizard.scriptList.edit`, `actionWizard.scriptList.export`, `actionWizard.scriptList.import`, `actionWizard.scriptList.recordNew`, `actionWizard.runner.targetFiles`, `actionWizard.runner.destinationFolder`, `actionWizard.runner.filenamePattern`, `actionWizard.runner.progress`, `actionWizard.runner.run`, `actionWizard.results.succeeded`, `actionWizard.results.failed`, `actionWizard.bannedOpToast`.

---

## 10. B10 Extract / Split / Replace pages (Wave 2)

**Files:** `src/client/components/page-ops-modal/{extract-modal.tsx,split-modal.tsx,replace-modal.tsx}`.

**Triggers:** Pages menu → Extract Pages… / Split Document… / Replace Pages…. Also thumbnail-strip context menu (already in place from Phase 1).

### 10.1 Extract modal

```
┌─ Extract Pages ────────────────────────────── × ┐
│  Pages:   [1-5,10]                              │
│  Save to: [C:\…\contract-cover.pdf] [Browse]   │
│  [✓] Include bookmarks pointing at these pages  │
│                                                 │
│                    [Cancel] [Extract ▶]         │
└─────────────────────────────────────────────────┘
```

### 10.2 Split modal

```
┌─ Split Document ───────────────────────────── × ┐
│  Strategy:                                      │
│   (•) By page count       [10] pages per file   │
│   ( ) By file count       [5] files             │
│   ( ) By top-level bookmarks                    │
│                                                 │
│  Destination: [C:\…\split\] [Browse]            │
│  Pattern:     [{base}-part-{index}.pdf]         │
│                                                 │
│                    [Cancel] [Split ▶]           │
└─────────────────────────────────────────────────┘
```

### 10.3 Replace modal

```
┌─ Replace Pages ────────────────────────────── × ┐
│  In current doc:                                │
│   Replace pages [3-5]                           │
│                                                 │
│  With from another PDF:                         │
│   Source:        [acme-cover.pdf] [Browse]      │
│   Source pages:  [1-3]                          │
│                                                 │
│                    [Cancel] [Replace ▶]         │
└─────────────────────────────────────────────────┘
```

### 10.4 Accessibility

- Range fields have `aria-describedby` pointing at a help text explaining range syntax ("e.g. 1-5,10,15-20").
- The Save to / Destination field has an associated `[Browse]` button labeled `aria-label={t('pageOps.browseAria')}`.

### 10.5 i18n keys (new namespace `pageOps`)

`pageOps.extract.title`, `pageOps.extract.pages`, `pageOps.extract.saveTo`, `pageOps.extract.includeBookmarks`, `pageOps.extract.extract`, ... (mirror per modal).

---

## 11. B11 Insert pages from another PDF (Wave 2)

**Files:** `src/client/components/insert-pages-modal/index.tsx`.

**Trigger:** Pages menu → Insert Pages from File… OR thumbnail-strip context menu "Insert pages here from PDF…".

### 11.1 Visual layout

```
┌─ Insert Pages from File ───────────────────── × ┐
│  Source:        [acme-template.pdf] [Browse]    │
│  Source pages:  (•) All  ( ) [1-3]              │
│                                                 │
│  Insert after page: [4]  (currently active: 4)  │
│                                                 │
│                    [Cancel] [Insert ▶]          │
└─────────────────────────────────────────────────┘
```

### 11.2 Wires the Insert → Page from File menu item (A1 dishonesty fix)

This was previously a `phase3()` toast; A1 + B11 land together so the menu item is honest from the moment of cleanup.

### 11.3 i18n keys (extends `pageOps` namespace)

`pageOps.insertFromFile.title`, `pageOps.insertFromFile.source`, `pageOps.insertFromFile.sourcePages.all`, `pageOps.insertFromFile.sourcePages.range`, `pageOps.insertFromFile.insertAfter`, `pageOps.insertFromFile.insert`.

---

## 12. B12 Page-content Cut/Copy/Paste (Wave 3)

**Files:** renderer-side clipboard handling lives in `src/client/state/clipboard/page-content-clipboard.ts` + new context menu entries.

**Trigger:** Right-click in viewer → Cut/Copy/Paste page-content selection. Edit menu mirrors. Ctrl+X / Ctrl+C / Ctrl+V context-aware (only when a page-content rectangle is selected).

### 12.1 Selection visual

Drag-rectangle on the page produces a marching-ants outline (reuses Phase 7.4 redaction overlay pattern). Right-click on the outline shows the Cut/Copy/Paste menu.

### 12.2 Paste positioning

After Copy → Paste, a ghost rectangle follows the cursor; next click on a page places the content via `pdf:applyPageContentPaste`. Esc cancels.

### 12.3 Cross-app paste

System clipboard receives a PNG raster of the selected rect as a fallback for cross-app paste. Internal paste preserves vector content via the internal MIME type (architecture §6 AR9).

### 12.4 i18n keys (new namespace `pageContent`)

`pageContent.selectAria`, `pageContent.cut`, `pageContent.copy`, `pageContent.paste`, `pageContent.pasteGhostAria`.

---

## 13. B13 Hyperlinks (Wave 4)

**Files:** `src/client/components/link-tool/{index.tsx,link-edit-modal.tsx}`.

**Trigger:** Edit menu → Links → Add / Edit / Remove. Also right-click on existing link annotation → Edit Link.

### 13.1 Add Link flow

User drags a rectangle on the page (in Link tool mode) → modal opens:

```
┌─ Add Link ─────────────────────────────────── × ┐
│  Type:                                          │
│   (•) Web URL                                   │
│   ( ) Page in this document                     │
│   ( ) Bookmark                                  │
│                                                 │
│  URL:  [https://example.com               ]    │
│                                                 │
│                    [Cancel] [Add ▶]             │
└─────────────────────────────────────────────────┘
```

Page-link variant has a page picker (numeric input + "current page" button). Bookmark variant has a tree picker reading from the existing bookmarks slice.

### 13.2 Edit / Remove

Right-click an existing link → context menu "Edit Link" / "Remove Link". Edit reopens the modal with current values; Remove dispatches `pdf:editLinks({ actions: [{ kind: 'remove', linkId }] })`.

### 13.3 i18n keys (new namespace `link`)

`link.add.title`, `link.add.type.uri`, `link.add.type.gotoPage`, `link.add.type.gotoBookmark`, `link.add.url`, `link.add.page`, `link.add.bookmark`, `link.add.add`, `link.edit.title`, `link.contextMenu.edit`, `link.contextMenu.remove`.

---

## 14. B14 Spell check (Wave 6)

**Files:** Spell underline rendering integrates with existing text-edit overlay; `src/client/components/spell-check/{suggestion-popup.tsx}` for the popup.

**Trigger:** Active in text-edit mode automatically (debounced 300ms). Tools menu → Spell Check Settings… for locale picker.

### 14.1 Underline + suggestion popup

Red squiggle under misspelled words; right-click (or click the underline) opens:

```
┌──────────────────────────┐
│ recieve                  │
│ ─────────────────────    │
│ ▸ receive                │
│   receiver               │
│   relieve                │
│ ─────────────────────    │
│   Add to dictionary      │
│   Ignore all in document │
└──────────────────────────┘
```

### 14.2 Settings sub-panel (Tools menu)

```
┌─ Spell Check Settings ─────────────────────── × ┐
│  Active locale: [en-US (US English) ▼]          │
│  Available:                                     │
│   [✓] en-US (US English) — bundled              │
│   [ ] es-ES (Spanish, Spain) — bundled          │
│                                                 │
│  Custom dictionary words:                       │
│   superiorag                                    │
│   Adamhudson777                                 │
│                                                 │
│                    [Cancel] [Save ▶]            │
└─────────────────────────────────────────────────┘
```

### 14.3 Honesty when es-ES dictionary fails the license vet

If es-ES fails the Wave 11 license vet, the settings panel shows the row dimmed with text "Spanish dictionary not available in this build — see Help". No silent failure.

### 14.4 i18n keys (new namespace `spell`)

`spell.suggestions.title`, `spell.addToDictionary`, `spell.ignoreAll`, `spell.settings.title`, `spell.settings.activeLocale`, `spell.settings.available`, `spell.settings.customWords`, `spell.settings.localeNotAvailable`.

---

## 15. B15 Page Display modes (Wave 2)

**Files:** renderer-side change to `src/client/components/main-viewer/index.tsx` + a new View menu group.

**Trigger:** View menu → Page Display → Single Page Continuous (default) / Two-Up Continuous / Single Page / Two-Up. Registry tool IDs `view:displaySinglePageContinuous`, `view:displayTwoUpContinuous`, etc.

### 15.1 Visual variants

| Mode                                     | Layout                                             |
| ---------------------------------------- | -------------------------------------------------- |
| Single Page Continuous (current default) | Vertical strip; smooth scroll across pages         |
| Two-Up Continuous                        | Two-column vertical strip with cover page handling |
| Single Page                              | One page at a time; PgUp/PgDn jumps                |
| Two-Up                                   | Two pages at a time                                |

All modes preserve the virtualized rendering window (P7.5 acceptance #4).

### 15.2 Persistence

The selected mode persists in `settings.view.pageDisplayMode` (new key, defaults to `'single-page-continuous'`).

### 15.3 i18n keys (extends `view` namespace)

`view.pageDisplay.singlePageContinuous`, `view.pageDisplay.twoUpContinuous`, `view.pageDisplay.singlePage`, `view.pageDisplay.twoUp`.

---

## 16. B16 View-only rotation + true Read Mode (Wave 2)

### 16.1 View-only rotation

View menu → Rotate View → 0° / 90° / 180° / 270°. NEW Ctrl+Shift+RightArrow / LeftArrow shortcuts. This is renderer-only CSS rotation — does NOT write to the document.

### 16.2 True Read Mode (F11)

Currently F11 toggles `fullscreen` but keeps all chrome. True Read Mode HIDES:

- Toolbar (still keyboard-accessible via Alt)
- Sidebar
- Inspector
- Status bar (optional — a small floating zoom + page counter pill replaces it)

A small "Exit Read Mode (F11)" pill appears top-right for 3 seconds after activation, then fades. Mouse to top edge re-reveals the toolbar temporarily.

### 16.3 State persistence

Read Mode is NOT persisted across sessions — it's a per-session state.

### 16.4 i18n keys (extends `view` namespace)

`view.rotateView`, `view.readMode.exitPill`, `view.readMode.toolbarRevealAria`.

---

## 17. B17 Area measure tool (Wave 3)

**Files:** new `src/client/components/shape-tools/area-measure.tsx`. Joins the existing shape sub-toolbar.

**Trigger:** Shape sub-toolbar → Area button (new). Shortcut `Shift+A`.

### 17.1 Visual

Cursor + polygon drawing pattern (mirrors existing polyline measure):

- Click points to draw a polygon outline.
- Double-click or Enter closes the polygon.
- Final area renders inside the polygon as a label with units (per the existing calibration).

### 17.2 i18n keys (extends `shapes` namespace)

`shapes.area.label`, `shapes.area.tooltip`, `shapes.area.aria`, `shapes.area.units.sqIn`, `shapes.area.units.sqMm`, etc.

---

## 18. B18 Edit text & images — font swap (Wave 6)

**Files:** `src/client/components/font-swap-modal/index.tsx`. Activated from Inspector → Font tab when a text run is selected in text-edit mode.

### 18.1 Visual layout

```
┌─ Swap Font ─────────────────────────────────── × ┐
│  Replace:  Times-Roman (3 ranges, 247 glyphs)    │
│  With:     [Browse… select .ttf/.otf]            │
│            ◯ Arial.ttf (loaded)                  │
│                                                  │
│  Coverage check:                                 │
│   ✓ 247 / 247 glyphs mapped                      │
│                                                  │
│  Apply to:  (•) Whole document                   │
│             ( ) Current page only                │
│             ( ) Range: [1-5]                     │
│                                                  │
│                    [Cancel] [Swap ▶]             │
└──────────────────────────────────────────────────┘
```

Glyph-coverage check runs in the renderer using a quick fontkit pass before dispatching. When coverage is incomplete, the Swap button is disabled and the panel shows "✗ 5 glyphs missing" with the missing characters listed.

### 18.2 i18n keys (new namespace `fontSwap`)

`fontSwap.title`, `fontSwap.replace`, `fontSwap.with`, `fontSwap.browse`, `fontSwap.coverage`, `fontSwap.coverageMissing`, `fontSwap.applyTo.document`, `fontSwap.applyTo.currentPage`, `fontSwap.applyTo.range`, `fontSwap.swap`.

---

## 19. B19 Auto-bookmarks from headings (Wave 4 engine + 5 UI)

**Files:** new `src/client/components/auto-bookmark-modal/index.tsx`. Activated from Bookmarks panel → "Auto-generate from headings…" link at the bottom of the panel.

### 19.1 Visual

Two-step flow:

**Step 1 — confirm:**

```
┌─ Auto-generate Bookmarks ────────────────────── × ┐
│  Detect headings using:                            │
│   (•) Font-size cluster heuristic                  │
│                                                    │
│  Max depth: [3] (H1, H2, H3)                       │
│                                                    │
│                       [Cancel] [Detect ▶]          │
└────────────────────────────────────────────────────┘
```

**Step 2 — review:**

```
┌─ Review Generated Bookmarks ─────────────────── × ┐
│  ▼ Introduction               (page 1, H1)         │
│    ▶ Why this matters         (page 2, H2)         │
│    ▶ Scope                    (page 3, H2)         │
│  ▼ Findings                   (page 5, H1)         │
│    ▶ ...                                           │
│                                                    │
│   [✓] Replace existing bookmarks                   │
│   ( ) Append to existing                           │
│                                                    │
│                       [Cancel] [Save ▶]            │
└────────────────────────────────────────────────────┘
```

Each row is editable (title rename, delete) before save. Save dispatches the standard `bookmarks:add` channel for each accepted row.

### 19.2 Honesty note in the UI

"Auto-generated bookmarks are a heuristic — please review before saving." appears as a non-dismissible callout in Step 2.

### 19.3 i18n keys (new namespace `autoBookmark`)

`autoBookmark.title`, `autoBookmark.heuristic.fontSizeCluster`, `autoBookmark.maxDepth`, `autoBookmark.detect`, `autoBookmark.review.title`, `autoBookmark.review.replace`, `autoBookmark.review.append`, `autoBookmark.review.heuristicNote`, `autoBookmark.review.save`.

---

## 20. B20 Remove hidden information (Wave 5)

**Files:** `src/client/components/sanitize-modal/index.tsx`. Activated from File → Sanitize Document… (new menu item) OR from Tools menu.

### 20.1 Visual

```
┌─ Remove Hidden Information ──────────────────── × ┐
│  Select categories to remove:                      │
│                                                    │
│   [✓] Document metadata (title, author, ...)       │
│   [✓] Hidden text (non-printing)                   │
│   [✓] Hidden layers (off OCGs)                     │
│   [✓] Embedded JavaScript                          │
│   [✓] Form fields (AcroForm — destroys forms!)     │
│   [✓] Comments / annotations                       │
│   [✓] Attachments                                  │
│   [ ] Bookmarks                                    │
│   [ ] Links                                        │
│   ... (17 total)                                   │
│                                                    │
│  ⚠ Sanitization rebuilds the document. Existing    │
│    signatures will be invalidated.                 │
│                                                    │
│                    [Cancel] [Sanitize ▶]           │
└────────────────────────────────────────────────────┘
```

### 20.2 Destructive-confirm

`role="alertdialog"`. Default focused button is Cancel (per redaction's `cancelButtonRef` pattern from Phase 7.4 B1). Sanitize button has destructive styling.

### 20.3 PAdES gate

Same gate as B8 (§8.3). For signed docs, list the field names that will be invalidated.

### 20.4 i18n keys (new namespace `sanitize`)

`sanitize.title`, `sanitize.categories.metadata`, `sanitize.categories.hiddenText`, ... (per `SanitizeCategory` enum), `sanitize.rebuildWarning`, `sanitize.invalidatesSignatures`, `sanitize.sanitize`, `sanitize.cancel`.

---

## 21. B21 Document Properties dialog (Wave 5)

**Files:** `src/client/components/document-properties-modal/{index.tsx,description-tab.tsx,security-tab.tsx,fonts-tab.tsx,custom-tab.tsx}`.

**Trigger:** File menu → Properties… (`Ctrl+D` — new shortcut, mirrors Acrobat). Registry tool `file:properties`.

### 21.1 Visual layout — Description tab

```
┌─ Document Properties ─────────────────────────── × ┐
│ ┌Description┬Security┬Fonts┬Custom┐               │
│ │                                                  │
│ │  Title:        [Contract for Services        ]   │
│ │  Author:       [Riley Johnson                ]   │
│ │  Subject:      [Q3 2026                      ]   │
│ │  Keywords:     [contract, services, Q3       ]   │
│ │  Creator:      LibreOffice Writer 7.6           │
│ │  Producer:     PDF_Viewer_Editor v0.8.0         │
│ │  Created:      2026-06-01 10:24                 │
│ │  Modified:     2026-06-17 14:51                 │
│ │  Pages:        24                                │
│ │  Page size:    Letter (8.5 × 11 in)             │
│ │                                                  │
│ │                       [Cancel] [Apply ▶]         │
└────────────────────────────────────────────────────┘
```

### 21.2 Security tab — B8 (see §8)

### 21.3 Fonts tab

```
│ Fonts used in document:                            │
│  • Times-Roman (embedded subset)                   │
│  • Helvetica (system; not embedded)                │
│  • Arial-Bold (embedded full)                      │
```

Read-only; data sourced from pdf-lib's font table walk.

### 21.4 Custom tab

Key/value editor for the `/Info` dict's custom entries.

### 21.5 i18n keys (new namespace `documentProperties`)

`documentProperties.title`, `documentProperties.tabs.description`, `documentProperties.tabs.security`, `documentProperties.tabs.fonts`, `documentProperties.tabs.custom`, `documentProperties.fields.title`, `documentProperties.fields.author`, ..., `documentProperties.fonts.embeddedSubset`, `documentProperties.fonts.system`, `documentProperties.fonts.embeddedFull`, `documentProperties.apply`, `documentProperties.cancel`.

---

## 22. C1 Read Aloud / TTS (Wave 5a)

**Files:** `src/client/components/read-aloud-bar/{index.tsx,voice-picker.tsx}`. New slice `ttsSlice`.

**Trigger:** View menu → Read Aloud (`Shift+Ctrl+R` — new shortcut). Registry tool `view:readAloud`. Also auto-suggested when the user selects text + presses `Ctrl+Alt+R`.

### 22.1 Visual layout — floating bar

Anchored bottom-center of the viewer:

```
┌─ Read Aloud ───────────────────────────────────────────┐
│ [▶ Play]  [⏸ Pause]  [⏹ Stop]    Voice: [Zira ▼]       │
│ Rate: [─●──────] 1.0×             Sentence: 7 of 142   │
└────────────────────────────────────────────────────────┘
```

- Play button starts speaking the user's current text selection (or the visible page if no selection).
- Active sentence is highlighted in the TextLayer (cyan tint) as TTS advances.
- Voice picker reads from `tts:listVoices`; selecting one persists to `tts_voice_prefs` for the current locale.

### 22.2 Linux engine-not-available state

When `tts:listVoices` returns `'engine_unavailable'`:

```
┌─ Read Aloud ───────────────────────────────────────────┐
│ ⚠ No TTS engine available.                             │
│   On Linux, install espeak (e.g. `sudo apt install     │
│   espeak`) and reopen. See Help for details.           │
│                                                [Close] │
└────────────────────────────────────────────────────────┘
```

This is the honest fallback per P7.5-L-4. No silent failure, no fake "playing…" state.

### 22.3 Accessibility

- Bar has `role="region"` + `aria-label={t('readAloud.regionAria')}`.
- Sentence-highlight changes are announced as `aria-live="polite"` so a sighted screen-reader user gets dual cues (visual + spoken).
- Play / Pause / Stop have `aria-pressed` on Play/Pause (toggle pair).
- Esc closes the bar; focus returns to the View menu item that opened it.

### 22.4 i18n keys (new namespace `readAloud`)

`readAloud.title`, `readAloud.play`, `readAloud.pause`, `readAloud.stop`, `readAloud.voice`, `readAloud.rate`, `readAloud.sentenceProgress`, `readAloud.engineUnavailable`, `readAloud.engineUnavailableHelp`, `readAloud.regionAria`, `readAloud.selectionRequired`.

---

## 23. C2 Preflight (Wave 5a)

**Files:** `src/client/components/preflight-panel/{index.tsx,rule-row.tsx,profile-picker.tsx}`. New slice `preflightSlice`.

**Trigger:** Tools menu → Preflight… OR registry tool `tools:preflight`.

### 23.1 Visual layout — panel (right rail)

```
┌─ Preflight ─────────────────────────────────── × ┐
│ Profile: [PDF/X-4 ▼] [PDF/A-2b ▼] [Run ▶]        │
│                                                  │
│ Subset of PDF/X-1a, PDF/X-4, PDF/A-1b, PDF/A-2b  │
│ — see Help for the shipped rule set.             │
│                                                  │
│ Last run: 2026-06-17 14:51                       │
│                                                  │
│ ▼ Errors (3)                                     │
│   ✗ X-4: Embedded fonts required                 │
│     Page 7 — Helvetica not embedded              │
│   ✗ X-4: ICC output intent missing               │
│   ✗ A-2b: Document title missing                 │
│                                                  │
│ ▶ Warnings (5)                                   │
│ ▶ Info (12)                                      │
│                                                  │
│  [⤓ Export report]                               │
└──────────────────────────────────────────────────┘
```

Clicking a rule row with `locations` navigates the viewer to the first location.

### 23.2 Honest disclosure (P7.5-L-9)

The "Subset of PDF/X-1a, PDF/X-4, PDF/A-1b, PDF/A-2b — see Help for the shipped rule set." line is a permanent header subtitle. Cannot be dismissed.

### 23.3 i18n keys (new namespace `preflight`)

`preflight.title`, `preflight.profile.pdfX1a`, `preflight.profile.pdfX4`, `preflight.profile.pdfA1b`, `preflight.profile.pdfA2b`, `preflight.run`, `preflight.subsetDisclosure`, `preflight.lastRun`, `preflight.errors`, `preflight.warnings`, `preflight.info`, `preflight.exportReport`, `preflight.rule.<ruleId>.message` (one per shipped rule; see `docs/preflight-spec.md` §3).

---

## 24. C3 Tag PDF (Wave 5b)

**Files:** `src/client/components/tag-tree-editor/{index.tsx,tag-node.tsx,tag-add-modal.tsx}`. Shares `accessibilitySlice`.

**Trigger:** Tools menu → Accessibility → Tag PDF… OR sidebar Accessibility tab.

### 24.1 Visual layout — tree editor (sidebar panel)

```
┌─ Tag PDF ─────────────────────── + [Auto-tag ▼] × ┐
│ ▼ Document                                         │
│   ▼ H1 "Introduction"                              │
│     P "This is the first paragraph..."             │
│     ▼ H2 "Why this matters"                        │
│       P "Many users..."                            │
│       Figure (no alt text) ⚠                       │
│   ▼ H1 "Findings"                                  │
│     ...                                            │
│                                                    │
│ Selected: Figure (page 3)                          │
│   Alt text: [empty                              ]   │
│   Type:     [Figure ▼]                              │
│   [Delete]   [Move up]   [Move down]                │
└────────────────────────────────────────────────────┘
```

- Drag-and-drop reparenting.
- `+` adds a child tag under the selected node.
- "Auto-tag" runs `pdf:autoTagPages` with the heuristic.
- Warning icons (⚠) on figures without alt text + headings nested incorrectly.

### 24.2 Save-as-copy default for tagged docs

When `getStructTree(handle).hasExistingTags === true`, the Save dispatcher in the renderer triggers Save-As by default (P7.5-L-5; R12 mitigation). UI surfaces a one-time toast: "This document has existing accessibility tags. Saving as a copy by default to protect the original."

### 24.3 i18n keys (new namespace `accessibility`)

`accessibility.tagPdf.title`, `accessibility.tagPdf.addChild`, `accessibility.tagPdf.autoTag`, `accessibility.tagPdf.selected`, `accessibility.tagPdf.altText`, `accessibility.tagPdf.type`, `accessibility.tagPdf.delete`, `accessibility.tagPdf.moveUp`, `accessibility.tagPdf.moveDown`, `accessibility.tagPdf.figureNoAlt`, `accessibility.tagPdf.headingNestingWarning`, `accessibility.tagPdf.saveAsCopyToast`.

---

## 25. C4 Reading Order overlay (Wave 5c)

**Files:** `src/client/components/reading-order-overlay/{index.tsx,order-badge.tsx}`.

**Trigger:** Tools menu → Accessibility → Reading Order Overlay OR sidebar Accessibility tab → Reading Order button.

### 25.1 Visual layout

When active, each content block on the page gets a numbered badge:

```
 ┌──────────────────────────┐
 │ [1] Title of section     │
 │                          │
 │ [2] First paragraph...   │
 │                          │
 │ [3] ┌─ Figure ─┐ [4] cap │
 │     │  (image) │ tion    │
 │     └──────────┘         │
 │                          │
 │ [5] Second paragraph...  │
 └──────────────────────────┘
```

- Drag-to-reorder swaps badges.
- "Auto-detect from layout" button runs the layout heuristic and reorders.

### 25.2 Accessibility

- Badges have `role="button"` + `aria-label={t('readingOrder.badgeAria', { current, total })}`.
- Keyboard nav: Tab to a badge; ↑↓ moves it within the order; ⏎ commits.

### 25.3 i18n keys (extends `accessibility` namespace)

`accessibility.readingOrder.title`, `accessibility.readingOrder.autoDetect`, `accessibility.readingOrder.badgeAria`, `accessibility.readingOrder.dragInstruction`.

---

## 26. C5 Alt Text inspector (Wave 5c)

**Files:** `src/client/components/alt-text-inspector/{index.tsx,figure-row.tsx,bulk-modal.tsx}`.

**Trigger:** Tools menu → Accessibility → Alt Text Inspector OR sidebar Accessibility tab → Alt Text button.

### 26.1 Visual layout

```
┌─ Alt Text Inspector ────────────────────────── × ┐
│ Figures without alt text: 4                      │
│                                                  │
│  ▸ Page 3: Figure (logo)                         │
│    Alt: [Acme Corp logo                      ]   │
│  ▸ Page 5: Figure (chart)                        │
│    Alt: [                                    ]   │
│  ▸ Page 7: Figure (signature)                    │
│    Alt: [                                    ]   │
│  ▸ Page 12: Figure (logo)  ← same as page 3?     │
│                                                  │
│  [Bulk set alt text for similar figures]         │
└──────────────────────────────────────────────────┘
```

Clicking a row jumps the viewer to that figure and highlights it. Identifying "similar figures" uses pHash; the bulk modal lets the user set one alt text for all matched figures.

### 26.2 i18n keys (extends `accessibility` namespace)

`accessibility.altText.title`, `accessibility.altText.countNoAlt`, `accessibility.altText.figure`, `accessibility.altText.bulkSet`, `accessibility.altText.bulkModal.title`, `accessibility.altText.bulkModal.matched`, `accessibility.altText.bulkModal.altText`, `accessibility.altText.bulkModal.apply`.

---

## 27. C6 Accessibility Checker (Wave 5d)

**Files:** `src/client/components/accessibility-check-panel/{index.tsx,rule-row.tsx,export-report-modal.tsx}`.

**Trigger:** Tools menu → Accessibility → Run Check OR sidebar Accessibility tab → Run Check button. Registry tool `tools:accessibility-check`.

### 27.1 Visual layout

```
┌─ Accessibility Check ──────────────────────── × ┐
│ Last run: 2026-06-17 14:51                       │
│                                                  │
│ Subset of WCAG 2.1 + PDF/UA-1 — see Help for     │
│ the shipped rule set.                            │
│                                                  │
│ ▼ Errors (3)                                     │
│   ✗ Document missing title                       │
│     [Open Document Properties ▶]                 │
│   ✗ 4 figures missing alt text                   │
│     [Open Alt Text Inspector ▶]                  │
│   ✗ Missing structure tree                       │
│     [Open Tag PDF Editor ▶]                      │
│                                                  │
│ ▶ Warnings (2)                                   │
│ ▶ Info (5)                                       │
│                                                  │
│  [▶ Re-run]  [⤓ Export report]                   │
└──────────────────────────────────────────────────┘
```

Each failure row has a "Quick fix" button that jumps to the relevant tool (Document Properties, Tag PDF, Reading Order, Alt Text Inspector) with the offending element pre-selected.

### 27.2 Honest disclosure (P7.5-L-10)

Permanent subtitle. Cannot be dismissed.

### 27.3 Export report

```
┌─ Export Accessibility Report ────────────────── × ┐
│  Format: (•) HTML  ( ) JSON                       │
│  Save to: [C:\…\report.html] [Browse]             │
│                       [Cancel] [Export ▶]         │
└───────────────────────────────────────────────────┘
```

HTML is the default; JSON for tool integration.

### 27.4 i18n keys (extends `accessibility` namespace)

`accessibility.check.title`, `accessibility.check.subsetDisclosure`, `accessibility.check.lastRun`, `accessibility.check.errors`, `accessibility.check.warnings`, `accessibility.check.info`, `accessibility.check.quickFix.documentProperties`, `accessibility.check.quickFix.altTextInspector`, `accessibility.check.quickFix.tagPdf`, `accessibility.check.quickFix.readingOrder`, `accessibility.check.rerun`, `accessibility.check.exportReport`, `accessibility.check.rule.<ruleId>.message`.

---

## 28. Honest-disclosure ratchet — four locations × four obligations

Reaffirming architecture §8. The four Wave 12 Nathan obligations:

| #   | Obligation                               | Spec doc (Wave 1)                         | UI label (Wave 5a/5b/5d)          | User-guide (Wave 12)                     | README (Wave 12)      |
| --- | ---------------------------------------- | ----------------------------------------- | --------------------------------- | ---------------------------------------- | --------------------- |
| 1   | Preflight subset                         | `docs/preflight-spec.md` §3               | §23.2 header subtitle             | "What we check" subsection               | Feature list footnote |
| 2   | Accessibility Checker subset             | `docs/accessibility-authoring-spec.md` §5 | §27.2 header subtitle             | "What we check" subsection               | Feature list footnote |
| 3   | Auto-tag heuristic approximate           | `docs/accessibility-authoring-spec.md` §6 | §24.1 Auto-tag confirm modal copy | "Auto-tagging is approximate" subsection | Feature list note     |
| 4   | TTS Linux requires user-installed espeak | `docs/architecture-phase-7.5.md` §4.5     | §22.2 engine-not-available state  | "Read Aloud on Linux" subsection         | OS-support table      |

---

## 29. Component dependency / wave map

| Wave | New components                                                                                                                                                                   | Reuses                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 2    | A7 palette, find-bar, page-display switch, read-mode toggle, crop-tool, page-ops-modal extract/split/replace, insert-pages-modal, A5 cursor button, A4 menu mirrors via registry | Tool registry (just landed), pdf-canvas viewport, existing menu-bar shell             |
| 3    | stamps-panel, stamp-add-modal, area-measure (shape sub-toolbar), page-content clipboard handler                                                                                  | shape-toolbar from Phase 7.4 A5, annotation overlay                                   |
| 4    | page-design-modal (watermark/H&F/background), link-tool/link-edit-modal, auto-bookmark-modal step-1                                                                              | inspector tabs                                                                        |
| 5    | document-properties-modal (description/security/fonts/custom), font-swap-modal, sanitize-modal, auto-bookmark-modal step-2                                                       | bookmarks tree picker                                                                 |
| 5a   | read-aloud-bar, preflight-panel                                                                                                                                                  | text-layer for sentence highlight                                                     |
| 5b   | tag-tree-editor, tag-add-modal                                                                                                                                                   | sidebar accessibility tab (new)                                                       |
| 5c   | reading-order-overlay, alt-text-inspector                                                                                                                                        | tag-tree-editor's struct-tree data                                                    |
| 5d   | accessibility-check-panel, export-report-modal                                                                                                                                   | tag-tree-editor + reading-order-overlay + alt-text-inspector for quick-fix navigation |
| 6    | action-wizard (recorder + script list + batch runner), spell-check (suggestion popup + settings sub-panel)                                                                       | existing mail-merge batch shell                                                       |
| 7    | compare-panel (page rows + summary + visual-diff overlay)                                                                                                                        | document store, dual-handle support (new in main)                                     |

---

## 30. Accessibility audit re-affirmed

Every new component lands the Phase 7 a11y floor:

- `jsx-a11y/aria-proptypes: 'error'` (per P7-L-4) — every ARIA attribute is validated at lint.
- `jsx-a11y/no-autofocus: 'error'` — except for the carve-out where the element is inside `role="dialog"` (palette search input, modal first-focusable).
- Every interactive element keyboard-reachable. Every state change announced via `aria-live` where appropriate (e.g., match counter, sentence progress, save toast).
- Focus management on every modal: trap inside, restore to invoker on close.
- Contrast: existing token system honored (foreground/background WCAG AA contrast).

Julian's Wave 11 review re-verifies via the existing a11y audit harness + a per-component manual pass.

End of Phase 7.5 UI spec.
