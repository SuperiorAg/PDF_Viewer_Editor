# UI Specification — PDF_Viewer_Editor

**Author:** Riley (front-end-architect)
**Date:** 2026-05-21
**Status:** Wave 1, locked. Drives the React component tree Riley will implement in Wave 2.
**Scope:** Phase 1 screens, states, shortcuts, and drag-drop behavior. Phase 2+ UI affordances are stubbed (disabled buttons with tooltips) but not designed in detail.

---

## 1. Information architecture

Single-window desktop app. One window = one document at a time in Phase 1. Architecture leaves room for tabbed multi-doc in Phase 2 but does not implement it.

```
+-----------------------------------------------------------------------------+
| [Top menu bar: File / Edit / View / Tools / Help]                           |
+-----------------------------------------------------------------------------+
| [Toolbar: Open | Save | Save As | Undo | Redo |  H S T I [shapes] |  Pages▼ | Combine ] |
+-----------+-----------------------------------------------+-----------------+
|           |                                               |                 |
| Sidebar   |              Main viewer                      | Inspector       |
|  [Thumbs] |   (canvas with pan/zoom; pdf.js render)       |  (annotation    |
|  [Marks]  |                                               |   properties /  |
|           |                                               |   selected page |
|           |                                               |   metadata)     |
|           |                                               |                 |
|           |                                               |                 |
+-----------+-----------------------------------------------+-----------------+
| Status bar: page X of Y | zoom: 100% | * Modified | Engine: pdf-lib (auto) |
+-----------------------------------------------------------------------------+
```

Sidebar and inspector are **collapsible**. Default state: sidebar expanded, inspector collapsed.

Sidebar has two tabs:
- **Thumbnails** (default) — vertical strip of page thumbnails. Drag to reorder. Right-click for page-ops menu (Insert before/after, Delete, Rotate).
- **Bookmarks** — tree showing native PDF outline (read-only Phase 1) + user-authored bookmarks (CRUD Phase 1).

---

## 2. Component tree (Phase 1)

```
<App>
  <ErrorBoundary>
    <MenuBar />
    <Toolbar />
    <MainLayout>
      <Sidebar collapsible>
        <SidebarTabs>
          <ThumbnailStrip />
          <BookmarksPanel />
        </SidebarTabs>
      </Sidebar>
      <PdfViewer>
        <PdfCanvas />          {/* pdf.js render layer */}
        <AnnotationLayer />    {/* DOM overlay for in-progress + persisted annotations */}
        <SelectionOverlay />   {/* marquee for batch selection */}
      </PdfViewer>
      <Inspector collapsible>
        <AnnotationProperties /> {/* when annotation selected */}
        <PageMetadata />         {/* when no annotation selected */}
      </Inspector>
    </MainLayout>
    <StatusBar />
    <ModalLayer>
      <CombineModal />
      <SettingsModal />
      <ConfirmCloseUnsavedModal />
      <ExportEngineDialog />
      <ErrorToast />
      <ProgressToast />
    </ModalLayer>
  </ErrorBoundary>
</App>
```

Component files: `src/client/components/<KebabName>/index.tsx` + co-located styles + tests.

---

## 3. Toolbar specification

| Button | Icon | Shortcut | Enabled when | Action |
|---|---|---|---|---|
| Open | folder-open | Ctrl+O | always | `dialog:openPdf` |
| Save | floppy | Ctrl+S | document open AND dirtyOps.length > 0 | `fs:writePdf` (existing path) or prompt Save As if never saved |
| Save As | floppy-arrow | Ctrl+Shift+S | document open | `dialog:saveAs` → `fs:writePdf` |
| Undo | rotate-left | Ctrl+Z | history.past.length > 0 (Phase 2 wires; Phase 1 disabled) | dispatch `historySlice/undo` |
| Redo | rotate-right | Ctrl+Y / Ctrl+Shift+Z | history.future.length > 0 (Phase 2 wires; Phase 1 disabled) | dispatch `historySlice/redo` |
| **Annotation tools group:** | | | | |
| Highlight (H) | marker | H | document open | set `annotationsSlice/setActiveTool('highlight')` |
| Sticky note (S) | sticky-note | S | document open | set active tool 'sticky' |
| Text box (T) | type | T | document open | set active tool 'text' |
| Underline | underline | — | DISABLED Phase 1 (tooltip: "Phase 2") |
| Strikethrough | strikethrough | — | DISABLED Phase 1 |
| Freehand | scribble | — | DISABLED Phase 1 |
| Rectangle / Circle / Line | shapes | — | DISABLED Phase 1 (tooltip: "Phase 4") |
| **Page operations menu (▼):** | | | | |
| Insert blank page | page-plus | — | document open | inserts at current page index +1 |
| Insert from file… | page-import | — | document open | opens picker; inserts pages from another PDF |
| Delete page | page-minus | Del (when page selected in thumbnails) | thumbnail selected | dispatches `delete` op |
| Rotate 90° CW | rotate-cw | Ctrl+R | document open | rotates current page |
| Rotate 90° CCW | rotate-ccw | Ctrl+Shift+R | document open | rotates current page |
| **Combine** | layers-merge | — | always | opens CombineModal |
| **Settings** | gear | Ctrl+, | always | opens SettingsModal |

Icon set: any permissive-licensed icon library (e.g. **Lucide React**, ISC license, MIT-compatible). Choice locked in `package.json` by Diego in Wave 3.

---

## 4. Sidebar — Thumbnails tab

### 4.1 Layout
Vertical scrollable strip. Each thumbnail shows:
- Page number label (centered below)
- Active border (2px accent color) on current viewport page
- Selection check (top-left) on multi-select
- Modified marker (small dot) on pages with unsaved annotation edits

### 4.2 Interactions

| Gesture | Result |
|---|---|
| Click | Scroll viewer to this page; set as current page |
| Ctrl+Click | Toggle this page in selection |
| Shift+Click | Select range from last-clicked to this |
| Drag thumbnail (vertical) | Reorder page; preview indicator shows insertion line; release dispatches `reorder` op |
| Right-click | Context menu: Insert before, Insert after, Insert blank, Delete, Rotate CW, Rotate CCW, Copy page (Phase 2), Extract to file (Phase 2) |
| Del (when selected) | Delete selected pages (confirm if >1) |

### 4.3 Drag-drop from OS
- Dropping a PDF file onto the thumbnail strip prompts: "Insert pages from <filename> at position N?" → confirm → `pdf:combine` with current doc + dropped file with `pageRange` undefined (all pages)
- Dropping a PDF onto the empty viewer canvas (no document open) opens that file
- Dropping a PDF onto the canvas of an open document prompts: "Open new document, or insert pages?"
- Dropping a non-PDF file → toast: "PDF_Viewer_Editor only accepts .pdf files."

### 4.4 Performance
- Thumbnails rendered lazily as they scroll into view (IntersectionObserver)
- Thumbnail bitmap cached per page (LRU, max 100 entries by default; configurable via `recents.thumbnailCache` setting in Phase 2)
- When a page is reordered, the thumbnail bitmap is reused (no re-render needed; the page content didn't change)

---

## 5. Sidebar — Bookmarks tab

### 5.1 Sources merged
1. **Native PDF outline** (from `pdf:getOutline`) — shown as italic, with a small lock icon (read-only Phase 1)
2. **User-authored bookmarks** (from `bookmarks:list`) — shown as normal, editable

### 5.2 Interactions

| Gesture | Result |
|---|---|
| Click bookmark | Scroll viewer to its page |
| Right-click user bookmark | Context menu: Rename, Delete |
| Right-click any page in viewer | "Add bookmark here" → modal: title (default = "Page N") → `bookmarks:upsert` |
| Drag user bookmark | Reorder among user bookmarks (Phase 2; Phase 1 inserts append-only) |

### 5.3 Empty state
"No bookmarks yet. Right-click any page in the viewer and choose 'Add bookmark' to create one."

---

## 6. Main viewer

### 6.1 Render
- pdf.js viewer fitted to the available space, scroll mode = vertical continuous
- Zoom levels: `fit-width`, `fit-page`, 50%, 75%, 100%, 125%, 150%, 200%, 400%; Ctrl+Plus / Ctrl+Minus cycles; Ctrl+0 resets to 100%; Ctrl+1 = fit width; Ctrl+2 = fit page
- Pan: drag with middle mouse button OR with hand tool selected
- Selection mode: when an annotation tool is active, click-drag creates the annotation; with the default tool (cursor), click-drag selects text (Phase 2; Phase 1 disabled) OR draws a marquee for batch annotation (Phase 4)

### 6.2 Annotation interactions (Phase 1)

| Tool | Gesture | Result |
|---|---|---|
| Highlight (H) | Click-drag over text | Creates `/Highlight` annotation with QuadPoints derived from text layer hit-testing |
| Sticky note (S) | Single click | Places a `/Text` annotation at click point; opens contents popover for typing |
| Text box (T) | Click-drag rectangle | Creates a `/FreeText` annotation; opens contents popover; default font from settings |

After placing, the annotation is selected; the Inspector shows its properties (color, opacity, author, contents).

### 6.3 Annotation rendering
- Persisted annotations drawn in an HTML overlay on top of the pdf.js canvas (NOT into the canvas itself — keeps them selectable / hit-testable)
- In-progress annotation (draft) drawn in a separate layer with reduced opacity until released
- Coordinates converted via `pdf-coords.ts` (data-models.md §3.5)

---

## 7. Inspector panel

Right side, collapsible. Two modes:

### 7.1 Annotation selected
Shows:
- Subtype label ("Highlight" / "Sticky note" / "Text box")
- Color picker (10 preset swatches + custom hex)
- Opacity slider (0–100%)
- Author field (read-only by default; editable via Settings)
- Contents textarea (Sticky note + Text box only)
- Font size / family (Text box only)
- "Delete annotation" button (with confirm if Phase 2 setting "confirm delete" is on)

Live updates as the user adjusts — dispatches `annot-edit` op on commit (e.g. slider mouse-up) to avoid filling the undo stack with intermediate values.

### 7.2 No annotation selected
Shows:
- Current page metadata: page index, dimensions (width × height in inches and points), rotation
- Document metadata: title (from PDF info dict), author, page count, file hash (first 8 chars), file size
- Permissions: print, modify, copy (read from PDF security, if any)

---

## 8. Status bar

Left-aligned:
- `Page X of Y` (current page in viewport)

Center:
- `Zoom: 100%`

Right-aligned:
- `* Modified` (only when dirtyOps.length > 0)
- `Engine: <chosen>` when an export is in progress or just completed (clickable → reopens ExportEngineDialog)
- Tiny progress spinner during export

---

## 9. Modals

### 9.1 CombineModal

```
+--------------------------------------------+
|  Combine PDF files                  [X]    |
+--------------------------------------------+
|                                            |
|  [+ Add file…]   [+ Use currently open]    |
|                                            |
|  1. document.pdf       all pages       [×] |
|  2. contract.pdf       pages 1–3       [×] |
|  3. addendum.pdf       all pages       [×] |
|     [drag rows to reorder]                 |
|                                            |
|  Page range: [1–3] [edit]                  |
|                                            |
|             [Cancel]    [Combine]          |
+--------------------------------------------+
```

- Drag rows to reorder
- Per-row page range editor (input "1-3, 5, 7-9")
- "Combine" calls `pdf:combine`; on success, the result document becomes the new active doc (or opens in a new window — Phase 2)

### 9.2 SettingsModal

Sections:

**General**
- Theme: System / Light / Dark (Phase 2 wires UI; Phase 1 disabled "Coming in Phase 2")
- Recents max items: input (number, 1–200)
- Confirm before closing unsaved: checkbox

**Files**
- Max file size to open: input (MB, 1–10000)
- **PDF file association:** read-only label "PDF_Viewer_Editor IS / IS NOT the default PDF viewer" + button "Make default" / "Relinquish default" (calls `app:setDefaultPdfHandler`). Subtext: "Windows may ask you to confirm." See Decision 4.

**Export**
- Default engine: dropdown `Auto (recommended) / pdf-lib / Chromium`
- Show warnings toast after export: checkbox

**Editing** (Phase 2 wires; Phase 1 mostly disabled)
- Default author for annotations: text input (defaults to OS username)
- Undo history depth: slider 10–500 (Phase 2)

**About**
- App version, Electron / Chromium / Node versions
- License notice
- Link to docs / repo

### 9.3 ConfirmCloseUnsavedModal

```
+--------------------------------------------+
|  Unsaved changes                     [X]   |
+--------------------------------------------+
|                                            |
|  document.pdf has unsaved changes.         |
|                                            |
|  [Don't save]  [Cancel]  [Save and close]  |
+--------------------------------------------+
```

Three buttons; Esc = Cancel; Enter = Save and close.

### 9.4 ExportEngineDialog

Shown when user picks **File → Export to PDF** (Phase 2 wires; Phase 1 has the dialog but the menu item is disabled with "Phase 2" tooltip).

```
+--------------------------------------------+
|  Export to PDF                       [X]   |
+--------------------------------------------+
|                                            |
|  Engine: [Auto (recommended)        ▼]     |
|          [Auto (recommended)]              |
|          [pdf-lib (smaller, vector)]       |
|          [Chromium (broader compat)]       |
|                                            |
|  Auto will choose:                         |
|    Chromium — source PDF is encrypted      |
|                                            |
|  Save to: [Choose location...]             |
|                                            |
|             [Cancel]      [Export]         |
+--------------------------------------------+
```

The "Auto will choose" preview runs the heuristic synchronously and shows the projected engine + reason. If the user picks `pdf-lib` or `Chromium` manually, the preview switches to "Manual override: X."

---

## 10. Keyboard shortcuts (complete table)

| Shortcut | Action |
|---|---|
| Ctrl+O | Open PDF |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save As |
| Ctrl+W | Close document |
| Ctrl+Q | Quit app (prompts if unsaved) |
| Ctrl+Z | Undo (Phase 2) |
| Ctrl+Y / Ctrl+Shift+Z | Redo (Phase 2) |
| Ctrl+A | Select all pages in thumbnail strip |
| Ctrl+Plus / Ctrl+= | Zoom in |
| Ctrl+Minus | Zoom out |
| Ctrl+0 | Zoom 100% |
| Ctrl+1 | Fit width |
| Ctrl+2 | Fit page |
| Ctrl+R | Rotate current page 90° CW |
| Ctrl+Shift+R | Rotate current page 90° CCW |
| Ctrl+, | Open Settings |
| Ctrl+F | Find text (Phase 2) — disabled Phase 1 |
| Ctrl+P | Print to physical printer (Phase 2) — disabled Phase 1 |
| Ctrl+Shift+P | Export to PDF (Phase 2) — disabled Phase 1 |
| H | Activate Highlight tool |
| S | Activate Sticky Note tool |
| T | Activate Text Box tool |
| V / Esc | Default cursor tool (deactivate annotation tool) |
| Del | Delete selected annotation OR selected pages (if focus is in thumbnail strip) |
| Tab | Cycle Sidebar tabs (Thumbnails ↔ Bookmarks) |
| F1 | Open in-app help (links to docs/) — Phase 4 stub |
| F11 | Toggle fullscreen |
| Ctrl+B | Toggle sidebar |
| Ctrl+I | Toggle inspector |
| Page Up / Down | Previous / next page |
| Home / End | First / last page |

Shortcuts are configurable in Phase 2; in Phase 1 they are hard-coded but the constants live in `src/client/shortcuts.ts` so Phase 2 swap is mechanical.

---

## 11. Drag-drop behavior (complete)

| Source | Target | Result |
|---|---|---|
| OS file (.pdf) | Window (no document open) | Open file |
| OS file (.pdf) | Window (document open) | Prompt: "Open in new window" OR "Insert pages here" (Phase 2 may add tabs) — Phase 1 only offers Open replacing current (with unsaved confirm) |
| OS file (.pdf) | Thumbnail strip | Insert pages at drop position (calls `pdf:combine` with current + dropped) |
| OS file (non-PDF) | anywhere | Toast: "Only .pdf files supported" |
| OS file (image) | viewer canvas | Phase 2 stub — Phase 1 shows "Image import: Phase 2" toast |
| Internal: thumbnail | thumbnail strip | Reorder (dispatches `reorder` op) |
| Internal: bookmark | bookmark list | Reorder user bookmarks (Phase 2; Phase 1 ignores) |
| Internal: annotation | another page in thumbnail strip | Move annotation across pages (Phase 2; Phase 1 ignores) |

External drag visual feedback: dashed border on the drop target zone.

---

## 12. Screen states

Every screen has FOUR mandatory states. UI for each:

### 12.1 Empty

**Viewer (no doc open):**
```
+-----------------------------------------------------------+
|                                                           |
|             [large PDF icon]                              |
|                                                           |
|         Open a PDF to get started                         |
|                                                           |
|         [Open file...]   or drag and drop                 |
|                                                           |
|         Recents:                                          |
|           contract.pdf                  2 hours ago       |
|           handbook.pdf                  yesterday         |
|           invoice-2025-04.pdf           last week         |
|         [clear recents]                                   |
|                                                           |
+-----------------------------------------------------------+
```

**Sidebar (Thumbnails tab, no doc):** hidden (the sidebar itself is hidden when no doc open).
**Bookmarks tab (no doc):** "No document open."
**Bookmarks tab (doc with no marks):** see §5.3.

### 12.2 Loading

**Document opening:**
- Skeleton placeholders in thumbnail strip (gray rectangles, 5 visible)
- Spinner over viewer canvas with "Loading document…"
- Status bar: "Loading X.pdf… 47%"
- Cancel button (Esc)

**Combine in progress:**
- Modal stays open with progress bar
- Cannot dismiss

**Export in progress (Phase 2):**
- ProgressToast (lower-right): "Exporting via Chromium… (preparing)" with phase from `pdf:export:progress` events

### 12.3 Error

**Open failed:**
- Toast (red, dismissible): "Couldn't open document.pdf — file is not a valid PDF."
- Specific messages per `DialogOpenPdfError` variant
- Recents stays visible

**Save failed:**
- Modal: "Save failed: <message>". Buttons: "Try Save As", "Cancel".
- Document stays dirty (not cleared)

**Combine failed:**
- Inline error in CombineModal: "Couldn't combine: <reason>". Files stay listed.

**Export failed (Phase 2):**
- Toast (red): "Export failed: <reason>". If `engine_failed_pdflib`, offer "Retry with Chromium" button.

**Annotation render failed:**
- Annotation shown as a red placeholder rect with tooltip "Annotation failed to render". Document not blocked.

### 12.4 Populated (normal)

The reference state. Toolbar enabled per §3; sidebar populated; viewer rendering pages; inspector showing context.

---

## 13. Accessibility (Phase 7 audit; floor for Phase 1)

Phase 1 floor:
- All interactive elements reachable by keyboard (Tab order is logical: Toolbar → Sidebar → Viewer → Inspector → Status bar)
- Focus ring visible on focused element
- All icon-only buttons have `aria-label`
- Color contrast ≥ 4.5:1 on text vs background (default theme)
- No info conveyed by color alone (e.g. modified state shows both `*` and color)

Phase 7 will add: screen reader testing (NVDA / JAWS), full keyboard nav of the canvas (annotations, page navigation announcements), localization framework.

---

## 14. Styling decision

**Decision: CSS Modules** (no Tailwind, no styled-components).

Rationale:
- CSS Modules give scoped class names + plain CSS files — no runtime cost, no build-time CSS-in-JS overhead
- Tailwind's utility classes balloon Phase 2's annotation canvas markup with no functional benefit
- Vite has first-class CSS Modules support (`*.module.css` files)
- styled-components ships a runtime; we don't need it
- Each component owns `index.tsx` + `<component>.module.css` co-located

ESLint enforces: CSS files match component names; no global styles outside `src/client/styles/global.css`.

---

## 15. Open UI questions (not blocking Wave 2)

1. **Inspector default state** — collapsed (current spec) vs expanded? Decision: collapsed; user expands when they need it. Setting `inspector.defaultCollapsed` added in Phase 2.
2. **Multi-page selection visualization** — currently a checkmark in the thumbnail corner. Consider switching to a full thumbnail border accent in user testing.
3. **Annotation popovers vs inline edit** — current spec uses popovers. Inline edit could be cleaner; revisit during Wave 2 implementation by Riley if a clearly better path emerges.

---

## 11. Phase 2 additions (2026-05-21, Riley)

> ### Phase 2 amendment (2026-05-21)
>
> §1-§10 above remain authoritative for Phase 1 surfaces. Additions below extend the toolbar, menus, modals, shortcut table, and drag-drop matrix. The Phase-1 IA (single-window, sidebar + viewer + inspector + status bar) is preserved.

### 11.1 Toolbar additions

Add to the toolbar table (§3) as additional rows:

| Button | Icon | Shortcut | Enabled when | Action |
|---|---|---|---|---|
| **Undo** | rotate-left | Ctrl+Z | history.past.length > 0 | dispatch `historySlice/undo` — **enabled Phase 2** (was disabled stub Phase 1) |
| **Redo** | rotate-right | Ctrl+Y / Ctrl+Shift+Z | history.future.length > 0 | dispatch `historySlice/redo` — **enabled Phase 2** |
| **Underline (U)** | underline | U | document open + text under cursor | set active tool 'underline' — **enabled Phase 2** |
| **Strikethrough (K)** | strikethrough | K | document open + text under cursor | set active tool 'strikeout' — **enabled Phase 2** |
| **Freehand (F)** | scribble | F | document open | set active tool 'ink' — **enabled Phase 2** |
| **Insert Image** | image-plus | Ctrl+I | document open | open `ImageImportModal` |
| **Text Edit** | type-cursor | E | document open | toggle `text-edit-overlay` mode |
| **Bookmarks Edit** | bookmark-edit | — | document open | toggle bookmarks-panel editing mode (enables drag-to-reorder + context menus) |
| **Print** | printer | Ctrl+P | document open | open Electron's OS print dialog via `pdf:print` |
| **Export to PDF** | file-export | Ctrl+Shift+P | document open | open `ExportEngineDialog` (already exists Phase 1; now wired to real engine) |

Phase-1 disabled buttons that were tooltipped "Phase 2": Underline, Strikethrough, Freehand. Phase 2 enables. The shape-tool buttons (Square / Circle / Line) REMAIN disabled with tooltip "Phase 4."

Note `Ctrl+I` is reassigned from "Toggle inspector" (§10) to "Insert Image" in Phase 2. Toggle-inspector moves to `Ctrl+Alt+I`. This is a deliberate trade-off — Ctrl+I matches the muscle memory from Office apps for image insertion. Document in shortcut table.

### 11.2 Menu additions

**File menu:**
- Print… (Ctrl+P) — opens system print dialog
- Export to PDF… (Ctrl+Shift+P) — opens ExportEngineDialog
- (Existing File menu items unchanged)

**Edit menu:**
- Undo (Ctrl+Z) — **enabled Phase 2**
- Redo (Ctrl+Y) — **enabled Phase 2**
- (Add at top of the menu, before any existing items)

**Insert menu (NEW):**
- Image… (Ctrl+I) — opens ImageImportModal
- Page from File… — opens existing combine-modal-style picker, inserts pages at current cursor
- Blank Page — inserts blank page at current cursor

**View menu:**
- Toggle Bookmarks-Edit Mode — toggles the bookmarks panel between read-only display and editing affordances

**Tools menu:**
- Text Edit Mode (E) — toggles `text-edit-overlay`

### 11.3 ImageImportModal (NEW)

```
+--------------------------------------------+
|  Insert Image                        [X]   |
+--------------------------------------------+
|                                            |
|  Choose an image (PNG, JPEG, TIFF):        |
|  [Choose file...]   signature.png  [×]    |
|                                            |
|  Insert as:                                |
|    (•) New page at: [End of document  ▼]   |
|    ( ) Overlay on current page             |
|        Position: [x: 100] [y: 100]         |
|        Size:     [w: 200] [h: 100]         |
|                                            |
|  [Multi-page TIFF: first page will be used]|  ← warning if applicable
|                                            |
|             [Cancel]     [Insert]          |
+--------------------------------------------+
```

- Mode radio: "New page" (default) or "Overlay on current page."
- "New page" position dropdown: Beginning / End / Before current / After current / Custom (numeric input).
- "Overlay" mode shows rect inputs in PDF user-space (origin bottom-left as per §3.5). The user can also click-drag on the canvas after the modal closes to refine the overlay; Phase 2 ships the modal-form path AND the canvas-handle drag refinement.
- Drag-drop of an image file onto the canvas opens the modal with the file pre-loaded and "Overlay on current page" pre-selected, with rect derived from drop point.
- Multi-page TIFF warning surfaces inline before commit.
- Commit fires `pdf:embedImage` which returns the `EditOperation` (kind `image-insert` or `image-overlay`); renderer dispatches `applyEdit(op)`.

### 11.4 PrintExportDialog (separate from ExportEngineDialog)

Phase-1 §9.4 designed `ExportEngineDialog`. Phase 2 keeps that dialog for **Export to PDF** (file output). A separate code path for **Print to printer** uses Electron's native OS print dialog directly (no custom dialog component). Rationale:

- OS print dialog handles printer selection, paper size, duplex, etc. — re-implementing these in HTML is poor UX.
- The Phase-2 `pdf:print` channel calls `webContents.print(undefined, ...)` which triggers the OS dialog.
- If the user wants to silent-print to a known printer (Phase 5+ feature), the channel supports `printerName` + `options.silent: true`. UI for this is not in Phase 2.

`ExportEngineDialog` (Phase 1 designed) is now WIRED to the real `pdf:export` channel. The "Auto will choose" preview runs the heuristic synchronously and surfaces the projected engine + reason. Phase-2 extensions to the heuristic (architecture-phase-2.md §3.8) are reflected in the preview.

### 11.5 Text-edit overlay UX

A new component `src/client/components/text-edit-overlay/` renders over the canvas in text-edit mode.

**Entering text-edit mode:**
- Click toolbar Text Edit button OR press `E`.
- Cursor changes to text-cursor over text regions.
- The annotation toolbar (Highlight, Sticky, etc.) is hidden in this mode (mutually exclusive).

**Editing a text run:**
- Click into a text region on the canvas.
- Renderer fires `pdf:identifyTextSpan({ handle, pageIndex, x, y })`.
- On success: an inline editor (`<input type="text">` styled to match the original font as best as DOM allows) opens over the run's bounding rect, populated with the current text.
- As user types, the renderer measures the new string against cached font metrics:
  - If new-width > original-width: tooltip "Text will be clipped on save. Phase 4 will support reflow." appears above the editor. User can continue typing.
  - If a codepoint is not in the font's glyph map: a red underline appears under the offending character, and a tooltip "Original font does not contain this character. Use FreeText annotation to add new text in a different font." appears. The commit button (Enter / Save icon) is DISABLED until the offending characters are removed.
- Pressing Esc cancels the edit, restores the original text.
- Pressing Enter (or clicking outside, if `editing.commitTextOnBlur` setting is true) commits — fires `pdf:replaceText({ handle, pageIndex, objectId, newText })`. On success, dispatches `applyEdit(op)` with the returned EditOperation.
- The overlay shows the new text immediately on commit (renderer-side overlay; underlying canvas still shows old text until the next save → refresh cycle).

**Exiting text-edit mode:**
- Press Esc again with no active editor open, OR click the Text Edit toolbar button again, OR pick another tool.
- The overlay is dismissed; the canvas reverts to standard view (with the overlay-text replacements still showing until next save).

**Visual style:**
- Inline editor has a 1-pt dashed border (color: accent) matching the run's bounding rect.
- The render of the underlying text is dimmed (50% opacity) within the editor's rect so the user knows they're replacing it.
- Tooltips position above the editor; if off-screen, below.

### 11.6 Bookmarks-authoring panel (rewrite)

Phase 1's `bookmarks-panel` is read-only. Phase 2 rewrites it to a tree component with the following capabilities:

```
Bookmarks (Edit Mode ◊ off / on toggle)
├─ Cover page                  → Page 1
├─ Indemnification             → Page 14
│  ├─ Subsection 14.1          → Page 15
│  └─ Subsection 14.2          → Page 17
└─ Signature block             → Page 27

Right-click on any user bookmark:
  • Rename               (or double-click to inline-rename)
  • Delete (confirm if has children)
  • New child bookmark
  • Move up / Move down (within siblings)

Drag a bookmark:
  • Vertical drag within siblings → reorder (calls bookmarks:move with same parentId, new sortOrder)
  • Horizontal drag (right) → indent under prior sibling (calls bookmarks:move with new parentId)
  • Horizontal drag (left) → outdent (calls bookmarks:move with parent's parentId)
  • Drop on another bookmark → move under it

Native PDF outline (italic, lock-icon, read-only):
  • Still displayed at top of panel
  • Cannot be edited
  • Click to navigate (Phase 1 behavior)
```

Implementation uses `@dnd-kit/sortable` + `@dnd-kit/core` (already deps Phase 1). The tree component handles indent/outdent through dnd-kit's `KeyboardSensor` (Shift+Tab / Tab) and `PointerSensor` (horizontal drag).

Cycle detection (preventing a parent being moved under its descendant) lives in the renderer slice before dispatching the IPC call; the main-process repo also re-checks via SQL CTE (api-contracts.md §12.6).

**Empty state (no user bookmarks):**
> No bookmarks yet. Right-click any page in the viewer and choose "Add bookmark" to create one. Switch to Edit Mode to drag, reorder, and nest.

**Confirm-before-delete:** if `editing.confirmDelete` setting is true (default), deleting a bookmark with children prompts:
> "Delete 'Indemnification' and its 2 sub-bookmarks?  [Cancel] [Delete all]"

Single-bookmark deletes (no children) commit without prompt.

### 11.7 Print Export Dialog reuse

Phase 1's `ExportEngineDialog` (§9.4) is reused for the **Export to PDF** flow (Ctrl+Shift+P / File menu → Export). No new dialog component for export. Print-to-printer uses Electron's native OS dialog.

The dialog's "Auto will choose: …" preview text now reflects Phase-2 heuristic signals (architecture-phase-2.md §3.8):

| Signal | Preview text |
|---|---|
| AcroForm fields detected | "Chromium — document contains form fields" |
| Embedded JavaScript | "Chromium — document contains scripted actions" |
| Encrypted source | (Phase 1) "Chromium — source PDF is encrypted" |
| Text-replace op queued | "pdf-lib — text edits require original-font fidelity" |
| Default | "pdf-lib — default engine" |

The dialog gains a "Deterministic output" checkbox in the Phase 2 Advanced section (collapsed by default). Bound to the `export.deterministic` setting.

### 11.8 Updated keyboard-shortcut table

Reflects Phase 2 changes to §10:

| Shortcut | Action | Phase |
|---|---|---|
| Ctrl+Z | Undo | **enabled Phase 2** |
| Ctrl+Y / Ctrl+Shift+Z | Redo | **enabled Phase 2** |
| Ctrl+I | Insert Image | **Phase 2 (was Toggle Inspector Phase 1)** |
| Ctrl+Alt+I | Toggle Inspector | Phase 2 (replaces Ctrl+I) |
| Ctrl+P | Print to printer | **enabled Phase 2** |
| Ctrl+Shift+P | Export to PDF | **enabled Phase 2** |
| E | Text Edit Mode toggle | **Phase 2 (NEW)** |
| U | Underline tool | **enabled Phase 2** |
| K | Strikethrough tool | **enabled Phase 2** |
| F | Freehand tool | **enabled Phase 2** |
| Ctrl+B | Toggle sidebar | Unchanged |
| (other Phase 1 shortcuts) | | Unchanged |

The `shortcuts.ts` file's `enabledInPhase1: boolean` field becomes `enabledInPhases: number[]` — a list of phases where the shortcut is active. Phase 2 shortcuts have `[2, 3, 4, 5, 6, 7]` etc. (active from Phase 2 onward). The matcher `findShortcutForEvent` now consults the field — closes the Wave 5 Riley observation that the flag was documentation-only.

### 11.9 Updated drag-drop matrix

Extends §11 of the Phase-1 doc:

| Source | Target | Phase 2 result |
|---|---|---|
| OS file (image: PNG/JPEG/TIFF) | viewer canvas | **Phase 2:** opens ImageImportModal with file pre-loaded, "Overlay on current page" mode pre-selected with rect derived from drop point |
| OS file (image) | thumbnail strip | **Phase 2:** opens ImageImportModal with "New page" mode pre-selected, at position derived from drop target (between two thumbnails) |
| OS file (image) | empty state (no doc open) | **Phase 2:** toast "Open a PDF first, then insert images" — image-only documents are NOT Phase 2 (use Insert Image → New Page in an open doc instead) |
| OS file (non-PDF, non-image) | anywhere | Toast: "Only .pdf, .png, .jpg/.jpeg, .tif/.tiff files supported" |
| Internal: bookmark | bookmarks panel (drop within siblings) | **Phase 2:** reorder via `bookmarks:move` |
| Internal: bookmark | bookmarks panel (drop on another bookmark) | **Phase 2:** re-parent + cycle-check |
| Internal: annotation | another page in thumbnail strip | **Phase 2 deferred** (Phase 3 maybe) — current Phase 2 keeps annotations bound to their page |

L-001 cross-check: image drag-drop EXTENDS the existing PDF drag-drop path (same `File.path` Electron property). The L-001 setting (`enableDragDropFiles: true`) is the dependency for both. **The Phase-2 implementer (Riley Wave 7) MUST NOT touch `window-manager.ts`.**

### 11.10 Empty / Loading / Error / Populated screen states (additions)

Extending §12:

**Loading — Image embed in progress:**
- Modal overlay on the ImageImportModal with spinner: "Embedding image…"
- For TIFF: phase shown ("Decoding TIFF…", "Embedding into document…")
- Cancel button (Esc)

**Loading — Export in progress (Phase 2 Live):**
- ProgressToast at lower-right with the new phase values from api-contracts.md §12.8:
  - "Preparing…"
  - "Applying edits…"
  - "Embedding images…"
  - "Emitting annotations…"
  - "Loading in Chromium…" (Chromium path)
  - "Printing…" (Chromium path)
  - "Finalizing…"
- Cancel button — fires `pdf:export:cancel` (new event; David Wave 7 implements)

**Loading — Print job dispatching:**
- Brief spinner overlay on Print button until OS dialog appears
- After dialog: app returns to normal state immediately (OS handles spooling)

**Error — text-replace missing glyph (inline):**
- Inline tooltip on the text-edit overlay, NOT a toast
- Red underline under the offending character(s)
- Commit button disabled

**Error — text-replace will clip (inline):**
- Warning tooltip, NOT an error
- Commit button stays enabled

**Error — save failed (Phase 2 variants):**
- Toast for `op_apply_failed`, `image_decode_failed`, `text_span_not_found`
- Modal for `fs_write_failed` with "Try Save As" button
- Toast for `encrypted_unsupported` with "Try Export to PDF (Chromium)" action

**Populated — text-edit mode active:**
- A persistent banner at the top of the canvas: "Text Edit mode — click any text run to edit. Esc to exit."
- Cursor changes to text-cursor over text regions
- Annotation toolbar hidden (replaced by Text Edit toolbar with Cancel button)

### 11.11 Accessibility additions (Phase 7 floor extends)

Phase 2's new components ship with the Phase-1 accessibility floor (§13):

- ImageImportModal: focus trap, Esc dismisses, all inputs labeled.
- Bookmarks tree: keyboard nav with Arrow keys (Up/Down between visible, Right to expand/dive into children, Left to collapse/escape to parent), Enter to navigate to the page, Space to toggle expand.
- Text-edit overlay: editor receives focus on open; Tab cycles between editor and Save/Cancel buttons; Esc cancels.
- New buttons (toolbar Undo/Redo, Insert Image, Print, Export, Text Edit, Bookmarks Edit) all have `aria-label` and visible focus ring.

Phase 7's full a11y audit is unchanged (still scoped to Phase 7 per project-roadmap).

### 11.12 Phase-2 absorbed Julian Wave-2 MEDIUMs (UI)

Per phase-2-plan.md §2.2 (Riley Wave 7 task list mentions MEDIUMs E-1, E-2, G-5, I-2, I-3, I-4). Brief recap, mapped to UI changes here:

- **I-2** (`combine-modal` `addFromPicker` inserts empty path) — combine-modal in Phase 2 wires the real `app:pickPdfPath` channel; the "+ Add file..." button calls it and only appends a row on user file pick. No more empty-path placeholder entries.
- **I-3** (`empty-state` recents not clickable) — recents items become clickable links that fire `openDroppedPathThunk(item.path)`. UI text and layout unchanged; just adds the click handler.
- **I-4** (`thumbnail-item` no keyboard activator) — adds `tabIndex={0}`, `role="option"`, `onKeyDown` mapping Enter+Space to onClick. Arrow keys focus prev/next thumbnail. Delete fires the delete-page flow.
- **I-2 also** (bookmarks-panel Space key) — bookmarks-panel rewrite (§11.6) handles both Enter and Space via the new tree component.
- **E-1, E-2, G-5** — non-UI; they're slice/test/coverage items absorbed in Riley's Wave 7 task list, NOT in this UI spec amendment.

### 11.13 Cross-reference checklist (Wave 6 self-verification)

- [x] Toolbar additions (§11.1)
- [x] Menu additions (§11.2)
- [x] ImageImportModal (§11.3)
- [x] Text-edit overlay (§11.5)
- [x] Bookmarks-authoring panel (§11.6)
- [x] Print + Export wiring (§11.4, §11.7)
- [x] Updated shortcut table (§11.8)
- [x] Updated drag-drop matrix (§11.9)
- [x] Screen states (§11.10)
- [x] Accessibility floor extends (§11.11)
- [x] L-001 unchanged (§11.9 + this row)
- [x] Phase-2 MEDIUM-absorption UI items (§11.12)

End of Phase-2 UI amendment.

---

## 12. Phase 3 additions (2026-05-22, Riley)

> ### Phase 3 amendment (2026-05-22)
>
> §1-§11 above remain authoritative for Phase 1 + Phase 2 surfaces. Additions below extend the toolbar, menus, sidebar tabs, modals, shortcut table, and drag-drop matrix. The IA (single-window, sidebar + viewer + inspector + status bar) is preserved.

### 12.1 Toolbar additions (Phase 3)

Add to the toolbar table (§3, extended in §11.1) as additional rows:

| Button | Icon | Shortcut | Enabled when | Action |
|---|---|---|---|---|
| **Form Designer** | form-edit | Ctrl+Shift+F | document open | toggles form-designer mode (cursor changes; right Inspector shows field-properties; click-to-place activates) |
| **Mail Merge** | mail-merge | Ctrl+M | document open AND `formsSlice.fields.length > 0` (template has fields) | opens MailMergeModal wizard |

The shape-tool buttons (Square / Circle / Line) REMAIN disabled with tooltip "Phase 4." Phase 3 does NOT enable them.

### 12.2 Menu additions (Phase 3)

**File menu:**
- (No new items in Phase 3; Save / Save As / Print / Export to PDF remain Phase 2 surfaces with the Phase 3 flatten extension — see §12.7)

**Edit menu:**
- (Unchanged from Phase 2)

**Insert menu:**
- Form Field… → submenu listing Text / Checkbox / Radio / Dropdown / Signature / Date (each opens the designer in "place next field of this type" mode)

**View menu:**
- Toggle Forms Sidebar — focuses the new Forms tab in the sidebar (auto-opens if collapsed)
- Toggle Form Designer Mode (Ctrl+Shift+F) — same as toolbar Form Designer button

**Tools menu:**
- Mail Merge… (Ctrl+M) — opens MailMergeModal
- Flatten Forms — runs `forms:flatten` for the open doc (with confirm dialog warning "this is irreversible after save")

### 12.3 Forms sidebar tab (NEW)

Add a third tab to the sidebar (existing tabs: Thumbnails, Bookmarks; new: **Forms**).

```
Forms tab content:
┌────────────────────────────────────────┐
│ ✓ AcroForm detected: 12 fields         │   ← status banner per detectionStatus
│   ⚠ JavaScript actions stripped on save│   ← when hasJavaScriptActions=true
│   ⚠ XFA payload (read-only)            │   ← when hasXfaForm=true
├────────────────────────────────────────┤
│ ▾ Page 1                               │
│   • First Name              [text]   ✏ │
│   • Last Name               [text]   ✏ │
│   • Subscribe to newsletter [checkbox]✏│
│ ▾ Page 2                               │
│   • Salary range          [dropdown] ✏ │
│   • Date of hire             [date]  ✏ │
│   • Signature             [signature]✏ │
│                                        │
│ [Templates ▾]   [Save as template…]    │   ← bottom bar
└────────────────────────────────────────┘
```

**Detection-status banner** at the top of the tab (driven by `forms:detect` response):
- `unknown` (initial) → "Detecting forms…"
- `none` → "This PDF has no fillable form fields. Switch to Form Designer to add some."
- `present` → "AcroForm detected: N fields"
- Plus optional warning rows for `hasJavaScriptActions`, `hasXfaForm`, signed-fields-present

**Field tree** organized by page (collapsible groups). Each field row shows:
- field name + label (label dimmed if same as name)
- type pill (`[text]`, `[checkbox]`, `[date]`, etc.)
- edit icon (✏) — opens field properties in the Inspector
- modified marker (small dot) if `formsSlice.values[name] !== formsSlice.committedValues[name]`

**Interactions:**
| Gesture | Result |
|---|---|
| Click field row | Scroll viewer to the field's page; highlight the field's widget rect briefly; focus the corresponding input in form-fill overlay |
| Double-click field row | Same + open Inspector with the field selected |
| Right-click field row | Context menu: Edit properties, Remove field, Cycle through similar fields |
| ✏ icon | Open Inspector field-properties pane |
| Tab in the tree | Cycle to next field; the viewer scrolls in lockstep — "cycle through fields" affordance |

**Templates dropdown** (bottom-left of tab):
- Lists saved templates from `forms:listTemplates` (newest first; max 10 shown with "Show all…" link if more)
- Clicking a template opens a confirmation: "Apply 'X' template? This will add N fields to the current page set."
- After confirmation, dispatches `loadFormTemplateThunk` which fires N `form-design-add` ops

**Save as template button** (bottom-right):
- Enabled when `formsSlice.fields.some(f => f.origin === 'authored')`
- Opens a small modal: text input "Template name" + Save / Cancel; fires `forms:saveTemplate`

**Commit form values button** (appears at the top of the tab when uncommitted values exist):
```
You have 3 unsaved field values.  [Commit] [Discard]
```
- Commit: fires `commitFormThunk` → dispatches `form-commit` EditOperation
- Discard: clears `formsSlice.values` for fields where they differ from `committedValues` (no history entry)

### 12.4 Form Designer mode (NEW)

Activated via Ctrl+Shift+F or toolbar button. Mutually exclusive with text-edit mode and annotation-tool mode (entering designer mode deactivates all annotation tools).

**Visual cues:**
- Toolbar Form Designer button shows depressed state
- Cursor changes to crosshair over the canvas
- A persistent banner at the top of the canvas: "Form Designer — click to place a field. Press Esc to exit."
- The annotation toolbar (Highlight, Sticky, etc.) is hidden; replaced by a Field-Type Selector toolbar:
  ```
  [ Text ▼ ] [ Checkbox ] [ Radio ] [ Dropdown ] [ Signature ] [ Date ] | [Select]
  ```
  - Active field-type pill shows accent border
  - "Select" mode (cursor with arrow) — for clicking existing fields to edit their properties

**Placing a field:**
1. User picks a field type from the Field-Type Selector
2. Cursor becomes crosshair
3. Click-drag on a page draws a rectangle (PDF user-space rect via `pdf-coords.ts` conversion at IPC boundary, per question E)
4. On release, the renderer fires `forms:designAdd` with a default-named `FormFieldDefinition` (e.g. `text_field_3`, `checkbox_1` — auto-numbered to avoid collisions)
5. On success: the field appears in the Forms sidebar AND a widget outline shows on the canvas. Inspector switches to the new field's properties pane.

**Resize / move existing fields (in designer mode):**
- Click a field's widget rect → selected (shows resize handles at corners + edges)
- Drag handle → resize; fires `forms:designAdd` with `form-design-edit` semantics on the renderer side OR a per-field `editField` IPC if needed (Wave 12 picks)
- Drag inside the rect → move; same edit-op
- Del key → remove the selected field (fires `forms:designRemove`)

**Inspector — Form-field properties pane:**
```
┌──── First Name (text) ────────────┐
│ Name:        [first_name      ]   │   ← read-only after creation (Phase 3)
│ Label:       [First Name      ]   │
│ Required:    [ ] required         │
│ Default:     [               ]    │
│ Page:        1 (read-only)        │
│ Rect:        x=100 y=400 w=200 h=24│
│                                   │
│ [Remove field]                    │
└───────────────────────────────────┘
```

For radio / dropdown:
```
Options:
  [Yes      ] [Yes        ] [×]
  [No       ] [No         ] [×]
  [Maybe    ] [Maybe       ] [×]
  [+ Add option]
```
(value + label per row; reorder via drag handles in Phase 3.1)

For date:
```
┌──── Date of Hire (date) ──────────┐
│ Name:        [date_of_hire    ]   │
│ Label:       [Date of Hire    ]   │
│ Date format: [MM/DD/YYYY      ▼]  │  ← renderer-side hint only; stored value is ISO-8601
│ Required:    [ ] required         │
│ Default:     [today         ▼]    │
│ Page:        2 (read-only)        │
│ Rect:        x=100 y=300 w=180 h=24│
│                                   │
│ [Remove field]                    │
└───────────────────────────────────┘
```

For signature:
```
┌──── Signature (signature) ────────┐
│ Name:        [signature_1     ]   │
│ Label:       [Sign here       ]   │
│ Required:    [ ] required         │
│ Page:        2 (read-only)        │
│ Rect:        x=100 y=200 w=200 h=48│
│                                   │
│ ⓘ Signing arrives in Phase 4.     │
│   This field is a placeholder.    │
│                                   │
│ [Remove field]                    │
└───────────────────────────────────┘
```

**Exit designer mode:**
- Press Esc twice (first Esc deselects current field; second exits mode), OR
- Click toolbar Form Designer button again, OR
- Switch to annotation tool / text-edit mode (mutually exclusive)

**Auto-commit on exit:** `dirtyOps` already accumulates the design-add/edit/remove ops as they happen (per Phase-3 hybrid model §5 — design ops are per-gesture); no special commit on exit.

### 12.5 Form-fill overlay (NEW)

When `formsSlice.detectionStatus === 'present'` AND `formsSlice.designerMode === false`, the renderer overlays editable form widgets on the canvas. Each widget renders as a React component matching its type:

| Type | Component | Notes |
|---|---|---|
| `text` | `<input type="text">` styled to match the run's bounding rect + font | Multi-line text — Phase 3.1 |
| `checkbox` | `<input type="checkbox">` sized to fit the rect | |
| `radio` | `<input type="radio" name={groupName}>` per option | Mutually exclusive within a group |
| `dropdown` | `<select>` with options | |
| `signature` | "(Click to sign — Phase 4)" placeholder button (disabled) | Tooltip explains Phase 4 arrival |
| `date` | `<input type="date">` (HTML5 picker, respects `forms.dateLocale` setting) | Stored value normalized to ISO-8601 at IPC boundary |

**Position:** each widget is positioned in screen-space via the existing `pdf-coords.ts` (Phase 1 module). The conversion is screen-on-render, PDF-user-space-on-store — consistent with Phase 2 patterns. Question E answer: renderer keeps screen-space, converts at IPC boundary.

**Interaction:**
- Click into a field → focus the input, show edit cursor
- Type / select / check → updates `formsSlice.values` (transient)
- Tab → cycle to next field (in field order from `forms:detect`)
- Esc → blur the current field
- Saving (Ctrl+S) auto-commits all uncommitted values before the save fires

**Visual cues:**
- Required fields with missing values show a red asterisk in the field label tooltip
- Fields with uncommitted changes show a yellow dot in the top-left corner
- Read-only / signed fields (existing /V on a Sig field) show a lock icon + "Read-only" tooltip

### 12.6 Mail Merge Wizard modal (NEW)

```
+---------------------------------------------+
|  Mail Merge                          [X]    |
+---------------------------------------------+
|  [1. Template] [2. Data] [3. Map] [4. Output]|   ← step indicator
+---------------------------------------------+
|                                             |
|  Step content here                          |
|                                             |
+---------------------------------------------+
|        [< Back]   [Cancel]   [Next >]       |   ← Back disabled on step 1, Next becomes "Run" on step 4
+---------------------------------------------+
```

#### 12.6.1 Step 1 — Template

```
Choose a template:
  (•) Use currently open document
  ( ) Saved template:
      [ Contract template (15 fields)        ▼]   ← from forms:listTemplates
      [ Invoice template (8 fields)             ]
      [ Show all templates…                     ]

  Preview: 12 fields on 2 pages
   • First Name (text)
   • Last Name (text)
   • Subscribe (checkbox)
   • ... (9 more)
```

#### 12.6.2 Step 2 — Data source

```
Choose a data file:
  [Choose file...]   contacts.csv   [×]

  Preview (first 5 rows):
  ┌────────────┬───────────┬──────────────────┐
  │ FirstName  │ LastName  │ Email            │
  ├────────────┼───────────┼──────────────────┤
  │ John       │ Smith     │ john@example.com │
  │ Jane       │ Doe       │ jane@example.com │
  │ ...        │ ...       │ ...              │
  └────────────┴───────────┴──────────────────┘
  Total rows: 247

  ⚠ Workbook has 3 sheets — using sheet 1 only (Phase 3 limitation)   ← if XLSX with >1 sheet
```

Drag-drop a CSV/XLSX file onto the modal → auto-fills the file picker (see §12.10 drag-drop matrix addition). File is parsed in main via `forms:loadDataSourcePreview` sub-channel which returns first 5 rows + headers; the full file stays in main.

#### 12.6.3 Step 3 — Column mapping

```
Map columns to fields:
  Column          Field
  ┌──────────┐    ┌────────────────────┐
  │FirstName │ →  │first_name         ▼│   ← auto-detected (case-insensitive name match)
  │LastName  │ →  │last_name          ▼│
  │Email     │ →  │email              ▼│
  │Phone     │ →  │(skip)             ▼│   ← column has no matching field
  │           │    │last_name           │
  │           │    │email               │
  │           │    │subscribe           │
  │           │    │(skip)              │
  └──────────┘    └────────────────────┘

  ⚠ Required field 'agreement_date' has no column mapping  ← error inline
```

Auto-detected matches are pre-populated (case-insensitive `columnName === fieldName`). User overrides via dropdowns. Unmapped fields with `required: true` block the Next button.

If a saved template was selected in step 1, its `lastColumnMappings` pre-populates the mappings (architecture-phase-3.md §6.4).

#### 12.6.4 Step 4 — Output

```
Output mode:
  (•) Folder of N PDFs
      Folder: [Choose folder...]   ./output/   [×]
      Filename: [contract-{LastName}-{rowIndex:04}.pdf            ]
                Available: {FirstName} {LastName} {Email} {rowIndex} {rowIndex:04}

  ( ) Single concatenated PDF
      Save to: [Choose location...]   merged-247.pdf

  ☐ Flatten forms in output (irreversible interactivity loss)

  [Cancel]   [< Back]   [Run merge >]
```

User picks output mode (radio); `mailMerge.defaultOutputMode` setting controls preselection. Filename template uses `{column}` substitutions; preview shown on hover. "Flatten forms" checkbox bound to `forms.flattenOnExportDefault` setting.

#### 12.6.5 Running

After clicking "Run merge":

```
+--------------------------------------------+
|  Mail Merge — Running                [X]   |
+--------------------------------------------+
|                                            |
|  Processing row 47 of 247…                 |
|  ████████░░░░░░░░░░░░░░░░░░░░░░  19%       |
|                                            |
|  Phase: rendering-row                       |
|                                            |
|  Recent warnings:                           |
|    Row 23: 'Phone' column empty, skipping  |
|                                            |
|                            [Cancel]        |
+--------------------------------------------+
```

Progress bar updates from `mail-merge:progress` events. Modal is dismissable via the X (which prompts: "Cancel the merge?"). Cancel button fires `forms:runMailMerge:cancel` sub-channel.

#### 12.6.6 Completion

On success:
```
+--------------------------------------------+
|  Mail Merge — Complete               [X]   |
+--------------------------------------------+
|                                            |
|  ✓ 247 PDFs written to ./output/           |
|                                            |
|  ⚠ 3 rows had warnings (see details)       |
|                                            |
|  [Show in folder]    [Close]    [Details ▾]|
+--------------------------------------------+
```

On cancel:
```
✓ 47 PDFs written before cancellation (folder mode)
OR
✗ Output file not written (concat mode — atomic, partial output discarded)
```

### 12.7 Flatten-on-export checkbox (Save As + Print-to-PDF)

The existing Phase-1 `ExportEngineDialog` (§9.4 / §11.4) gains a new Advanced row:

```
+--------------------------------------------+
|  Export to PDF                       [X]   |
+--------------------------------------------+
|                                            |
|  Engine: [Auto (recommended)        ▼]     |
|                                            |
|  Auto will choose:                         |
|    pdf-lib — default engine                |
|                                            |
|  Save to: [Choose location...]             |
|                                            |
|  ▾ Advanced                                |
|     ☐ Deterministic output (Phase 2)       |
|     ☐ Flatten forms in output (Phase 3)    |   ← NEW
|                                            |
|             [Cancel]      [Export]         |
+--------------------------------------------+
```

When the chosen engine is `chromium`, the Flatten checkbox is GREYED OUT with tooltip "Chromium printing always produces flattened output." When the open document has no AcroForm, the checkbox is GREYED OUT with tooltip "This document has no form fields."

Save As (`dialog:saveAs`) dialog does NOT get the flatten checkbox — Save preserves interactivity per Phase 2 semantic split. Users wanting to save+flatten use Export to PDF instead.

The setting `forms.flattenOnExportDefault` controls the initial state of the checkbox.

### 12.8 Updated keyboard-shortcut table (Phase 3)

Reflects Phase 3 additions to §10 / §11.8:

| Shortcut | Action | Phase |
|---|---|---|
| Ctrl+Shift+F | Toggle Form Designer mode | **Phase 3 (NEW)** |
| Ctrl+M | Open Mail Merge wizard | **Phase 3 (NEW)** |
| F (in designer mode) | Cycle to next field-type in toolbar | **Phase 3 (NEW)** |
| Esc (in designer mode) | First Esc: deselect field; second Esc: exit designer mode | **Phase 3 (NEW)** |
| Tab (in forms tab) | Cycle to next field; viewer scrolls in lockstep | **Phase 3 (NEW)** |
| Del (in designer mode, field selected) | Remove the selected field | **Phase 3 (NEW)** |
| (other Phase 1 + Phase 2 shortcuts) | | Unchanged |

**Conflict check:**
- Ctrl+Shift+F was not used in Phase 1 or Phase 2 (Phase 2 used U/K/F for annotation tools, never Ctrl+Shift+F). Clear.
- Ctrl+M was not used in Phase 1 or Phase 2. Clear.
- F-key conflict: Phase 2 assigned F to Freehand tool. Phase 3 designer-mode F (cycle field-type) is mode-scoped — only active while designer mode is on, where annotation tools are hidden. Resolved by mode-exclusivity (the same pattern as Phase 2's text-edit mode hiding the annotation toolbar).

The `shortcuts.ts` module's `enabledInPhases: number[]` field (Phase 2 addition §11.8) extends with `[3, 4, 5, 6, 7]` for the new Phase 3 entries (active from Phase 3 onward).

### 12.9 Form-field placement coords — question E answer

Decision: **the renderer keeps everything in screen-space; conversion to PDF user-space happens at the IPC boundary via `pdf-coords.ts`** (existing Phase 1 module).

Specifically:
- The form-designer overlay draws widget rects in screen-space (pixel coords at current zoom).
- On commit (release of click-drag), the renderer converts the screen rect → PDF user-space via `screenRectToPdf(rect, page, viewport)`.
- The `forms:designAdd` payload carries the PDF user-space rect.
- On detection, the IPC response's `rect` is PDF user-space; the renderer converts to screen via `pdfRectToScreen(rect, page, viewport)` for display.

This matches Phase 2's annotation pattern (`ARCHITECTURE.md §7.3`) — every coord transition goes through `pdf-coords.ts`. Single source of truth for off-by-one and y-flip bugs.

### 12.10 Updated drag-drop matrix (Phase 3)

Extends §11 / §11.9 of the Phase-2 doc:

| Source | Target | Phase 3 result |
|---|---|---|
| OS file (CSV: .csv) | MailMergeModal step 2 | Auto-fills the file picker; advances to step 2 preview |
| OS file (Excel: .xlsx / .xls) | MailMergeModal step 2 | Same |
| OS file (CSV / Excel) | empty modal / anywhere outside MailMergeModal | Toast: "Drop CSV/Excel into the Mail Merge wizard. Open Tools → Mail Merge first." |
| OS file (non-supported in any context) | anywhere | Toast: "Only .pdf, .png, .jpg/.jpeg, .tif/.tiff, .csv, .xlsx files supported" |
| Internal: form field widget | another field (within designer) | **Phase 3 deferred** (z-order reordering) — current Phase 3 places fields in dispatch order |
| Internal: form template item | open document | Loads the template (alternative to clicking in templates dropdown) |

L-001 cross-check: CSV / Excel drag-drop uses the SAME `File.path` Electron property as PDF drops + image drops (`enableDragDropFiles: true`). Phase 3 EXTENDS the L-001 pathway; does not weaken it. Wave 12 implementer (Riley) MUST NOT touch `src/main/window-manager.ts`.

### 12.11 Screen states (Phase 3 additions)

Extending §12 / §11.10:

**Empty — Forms sidebar (no AcroForm + no authored fields):**
> No fillable form fields detected. Switch to Form Designer (Ctrl+Shift+F) to add some, or load a saved template.
> [Templates ▾]

**Empty — Forms sidebar (XFA-only document):**
> This PDF uses XFA (LiveCycle Designer) forms which aren't editable in Phase 3.
> Some fields may be visible; they're read-only.

**Loading — Form detection in progress:**
- Forms sidebar shows "Detecting forms…" with spinner for the first ~500ms after document open
- Most detects are sub-100ms; the spinner is debounced to avoid flicker

**Loading — Mail merge in progress:**
- Modal stays open with progress bar (§12.6.5)
- Cancel button always enabled

**Loading — Form designer save in progress:**
- ProgressToast at lower-right when `pdf:export` is running with `flattenForms: true`
- Phase: "Flattening forms…" (sub-phase of finalizing)

**Error — Mail merge row failure:**
- Modal switches to error state:
  ```
  ✗ Mail merge stopped at row 23
  Error: field 'amount' (text) couldn't accept the value '12,500.00' — date field expected
  Files written before failure: 22
  [Show in folder]   [Close]
  ```

**Error — Form designer duplicate name:**
- Inspector inline: "A field named 'first_name' already exists. Choose a different name."
- Save button disabled until name is unique

**Error — Forms detection failed:**
- Forms sidebar status banner: "Couldn't detect forms in this document. The PDF may be malformed."
- Falls back to manual Form Designer mode

**Populated — Form designer mode:**
- Top-of-canvas banner: "Form Designer — click to place a [text] field. Press Esc to exit."
- Field-Type Selector toolbar visible (replaces annotation toolbar)
- Right Inspector shows selected field's properties pane

**Populated — Mail merge wizard step indicators:**
- Step indicator at top shows progress: completed steps in accent color, current in bold, future in dim

### 12.12 Accessibility additions (Phase 7 floor extends)

Phase 3's new components ship with the Phase-1 + Phase-2 accessibility floor (§13 / §11.11):

- **Forms sidebar tab:** Tab between field rows; Arrow keys cycle within page groups; Enter expands/activates; Space toggles expand of page group; Esc closes any open Inspector pane
- **Form Designer:** Tab between Field-Type Selector buttons; Enter activates; cursor coordinates announced for screen readers when click-to-place is active
- **Mail Merge Wizard:** Tab between fields; Enter advances step (when Next is enabled); Esc cancels; step indicator is keyboard-focusable for screen-reader announcement
- **Form-fill overlay:** Each widget receives focus in tab order; standard form-control accessibility (`<input>`, `<select>`, native focus indicators)
- **All new buttons** (Form Designer, Mail Merge, field-type pills, flatten checkbox) have `aria-label` and visible focus ring

Phase 7's full a11y audit is unchanged (still scoped to Phase 7).

### 12.13 Cross-reference checklist (Wave 11 self-verification)

- [x] Toolbar additions (§12.1)
- [x] Menu additions (§12.2)
- [x] Forms sidebar tab (§12.3)
- [x] Form Designer mode (§12.4)
- [x] Form-fill overlay (§12.5)
- [x] Mail Merge Wizard (4 steps + running + completion) (§12.6)
- [x] Flatten-on-export checkbox (§12.7)
- [x] Updated shortcut table (§12.8)
- [x] Placement coords answer (§12.9 — question E)
- [x] Updated drag-drop matrix (§12.10)
- [x] Screen states (§12.11)
- [x] Accessibility floor extends (§12.12)
- [x] L-001 unchanged (§12.10 + this row)

End of Phase-3 UI amendment.

---

## 13. Phase 4 additions (2026-05-26, Riley)

> ### Phase 4 amendment (2026-05-26)
>
> §1-§12 above remain authoritative for Phase 1 + Phase 2 + Phase 3 surfaces. Additions below extend the toolbar, menus, sidebar tabs, modals, shortcut table, and drag-drop matrix. The IA (single-window, sidebar + viewer + inspector + status bar) is preserved. No new BrowserWindow (L-001 unchanged).

### 13.1 Toolbar additions (Phase 4)

Add to the toolbar table (§3, extended in §11.1, §12.1) as additional rows. The shape-tool buttons (Square / Circle / Line) that were DISABLED with "Phase 4" tooltip Phases 1-3 are now **ENABLED**.

| Button | Icon | Shortcut | Enabled when | Action |
|---|---|---|---|---|
| **Rectangle (Q)** | square | Q | document open | activate Square shape tool |
| **Ellipse (C)** | circle | C | document open | activate Circle shape tool |
| **Polygon (G)** | polygon | G | document open | activate Polygon shape tool |
| **Arrow / Line (L)** | arrow-right | L | document open | activate Line tool with current `annotations.defaultLineEndStyle` |
| **Callout (B)** | message-square-arrow-down | B | document open | activate FreeTextCallout tool |
| **Line measure (M)** | ruler | M | document open | activate Line tool with measure dict using current `MeasureCalibration` |
| **Polyline measure (Shift+M)** | ruler-multi | Shift+M | document open | activate PolyLine tool with measure dict |
| **Sign** | signature | Ctrl+Shift+G | document open | opens `SignatureCaptureModal` (typed/drawn/image tabs) |
| **PAdES Sign** | shield-check | Ctrl+Alt+G | document open AND PFX picker available | opens `PadesSignModal` |
| **Audit log** | clipboard-check | — | always | opens `SignatureAuditPanel` modal |

**Visual vs cryptographic distinction (question E answer):** The toolbar has TWO clearly-labeled buttons — **Sign** (visual; the small typed/drawn/image-based stamp) and **PAdES Sign** (cryptographic; opens the cert + password modal). Both fall under a "Sign" toolbar group with a divider. Rationale: a single button with a sub-menu would hide the cryptographic affordance behind an extra click and risk users who want a real signature accidentally applying a visual one. Two buttons cost a small amount of toolbar real estate; the clarity is worth it.

**Cycling fields with Tab:** when a `/Sig` placeholder field is present in the doc and the Form Fill overlay is active, Tab cycles to the placeholder; pressing Enter on a focused placeholder activates the **Sign** button (visual signature flow by default; Shift+Enter activates PAdES Sign).

### 13.2 Menu additions (Phase 4)

**File menu:**
- (Unchanged from Phase 3)

**Edit menu:**
- (Unchanged from Phase 3)

**Insert menu:**
- Shape… → submenu listing Rectangle / Ellipse / Polygon / Line / Arrow / Callout / Line Measure / Polyline Measure
- Signature… → submenu listing **Visual signature…** (opens Capture modal) and **Cryptographic (PAdES)…** (opens PAdES Sign modal)

**View menu:**
- Toggle Annotations Sidebar → focuses the new Annotations summary tab
- Toggle Signature Audit Panel — opens SignatureAuditPanel

**Tools menu:**
- Calibrate measure… → opens `MeasureCalibrationModal`
- Sign with PFX… (Ctrl+Alt+G) → opens PadesSignModal
- Verify my signatures… → opens SignatureAuditPanel with verify column visible
- Flatten signature widgets only — runs an extension to `forms:flatten` that flattens ONLY signature widgets (visual stamps); preserves other form fields. Phase 4 addition to the existing Flatten flow.

### 13.3 SignatureCaptureModal (NEW)

```
+--------------------------------------------+
|  Add visual signature                [X]   |
+--------------------------------------------+
|  [ Typed ] [ Drawn ] [ Image ]             |   ← tabs
+--------------------------------------------+
|                                            |
| (Typed tab)                                |
|  Your name: [ John Smith                  ]|
|  Font:      [ Caveat (script)         ▼  ]|
|  Size:      [ 24 pt ▼ ]                    |
|                                            |
|  Preview:                                  |
|  ┌──────────────────────────────────────┐ |
|  │ John Smith                            │ |
|  └──────────────────────────────────────┘ |
|                                            |
|  Options:                                  |
|   [x] Show typed name                      |
|   [x] Show date                            |
|   [ ] Show reason                          |
|   Reason: [                              ] |
|                                            |
|              [Cancel]   [Place signature]  |
+--------------------------------------------+
```

**Typed tab:** the renderer renders the name in a hidden `<canvas>` at high DPI using the chosen script font; on Place, exports PNG bytes + dimensions and ships in `VisualAppearanceSource { kind: 'typed', pngBytes, ... }`.

**Drawn tab:**
```
| (Drawn tab)                                |
|  Draw your signature below:                |
|  ┌──────────────────────────────────────┐ |
|  │                                       │ |
|  │     (canvas)                          │ |
|  │                                       │ |
|  └──────────────────────────────────────┘ |
|  [ Clear ]   Smoothing: [ Medium ▼ ]      |
```

Pointer events with Catmull-Rom smoothing via `use-signature-canvas.ts` hook. Exports PNG on Place.

**Image tab:**
```
| (Image tab)                                |
|  Choose image: [Browse...]                 |
|  signature.png  256×128       [×]          |
|                                            |
|  Preview:                                  |
|  ┌──────────────────────────────────────┐ |
|  │ (image)                               │ |
|  └──────────────────────────────────────┘ |
|                                            |
|  Drag-drop image into this area to import. |
```

Drag-drop of a PNG/JPEG into the modal pre-loads the file (per drag-drop matrix §13.7 below).

**On Place:** the modal closes. The renderer enters **placement mode** with the SignaturePlacementOverlay attached to the cursor.

### 13.4 SignaturePlacementOverlay (NEW — SHARED with image-overlay per question H)

After capture, the user places the signature onto the canvas. The placement overlay is **the SAME COMPONENT** as the Phase 2 image-overlay component (`src/client/components/image-overlay`), parameterized with a payload type. Per question H decision: both flows need drag-to-position + resize handles + rotation handles + snap-to-field; sharing prevents drift between them.

```
+----------------------------------------------------------+
|  (Page canvas)                                            |
|                                                           |
|        ┌─────────────────────┐                            |
|        │ [signature image]   │                            |
|        │                     │   ← drag corner to resize  |
|        │ Signed by J. Smith  │                            |
|        │ Date: 2026-05-26    │                            |
|        └───────────────●─────┘                            |
|                       (resize handle)                     |
|                                                           |
|  Floating toolbar (above the overlay):                    |
|  [ ⤺ Cancel ] [ ✓ Apply ]                                 |
+----------------------------------------------------------+
```

**Snap-to-field:** while dragging, if the overlay center is over a `/Sig` placeholder field's widget rect, the overlay snaps to the field rect (with a visual highlight). Release dispatches `signatures:applyVisual` (or `applyPades` if it's a PAdES flow) with `placement.mode='placeholder'`.

**Freeform placement:** if not over a placeholder, the user can drop anywhere. Release dispatches with `placement.mode='freeform'`.

**Resize:** corner handles maintain aspect ratio (signatures look weird stretched). Edge handles resize one axis freely (for callout-style placements).

**Rotate:** a rotation handle above the overlay sets the rotation 0/90/180/270 (snap to 90). Phase 4 does NOT support arbitrary rotation — too much PDF-spec edge case complexity. Documented as a Phase 4.1+ candidate.

### 13.5 PadesSignModal (NEW)

```
+--------------------------------------------+
|  Sign with PFX certificate           [X]   |
+--------------------------------------------+
|  [ 1. Certificate ] [ 2. Options ] [ 3. Sign ]
+--------------------------------------------+
|                                            |
| (Step 1 — Certificate)                     |
|  PFX file: [Browse...]                     |
|  cert.pfx  4.2 KB    [×]                   |
|  Password: [••••••••                    ]  |
|                            [Load cert →]   |
|                                            |
|  Once loaded, cert info displays:          |
|  Subject:  CN=John Smith                   |
|  Issuer:   CN=Example CA                   |
|  Valid:    2024-01-01 → 2027-01-01         |
|  ✓ Valid now                                |
|                                            |
|  ⚠ Your password is never logged or saved. |
|     It's discarded immediately after the   |
|     cert is loaded.                        |
+--------------------------------------------+
|                                            |
| (Step 2 — Options)                         |
|  Reason:    [                            ] |
|  Location:  [                            ] |
|                                            |
|  Appearance:                               |
|   [x] Show subject CN                      |
|   [x] Show date                            |
|   [ ] Show issuer CN                       |
|   [ ] Show reason                          |
|   [ ] Show TSA info (when timestamped)     |
|                                            |
|  Timestamp (TSA):                          |
|   ( ) None                                 |
|   (•) Use configured TSA (Settings)        |
|       URL: https://freetsa.org/tsr         |
|       Status: ✓ Tested OK (2 days ago)     |
|                                            |
+--------------------------------------------+
|                                            |
| (Step 3 — Sign)                            |
|  Place the signature:                      |
|   (•) Onto signature field (1 placeholder) |
|       Field: signature_1  (Page 7)         |
|   ( ) Freeform position (drag after sign)  |
|                                            |
|  Click Sign to apply the signature.        |
|  This may take up to 30 seconds (TSA).     |
|                                            |
|         [Cancel]     [< Back]   [Sign]     |
+--------------------------------------------+
```

**Step 1 — Load cert:**
- User picks PFX, types password, clicks Load cert
- Renderer dispatches `loadCertThunk({ pfxBytes, password })` → IPC → main parses PFX, returns handle
- On success, displays cert info + advances to step 2
- The renderer's React state holding the password is set to `''` BEFORE awaiting the IPC promise (conventions §15 discipline)
- On failure (wrong_password, expired, etc.), inline error displayed; user can retry

**Step 2 — Options:**
- Reason / Location text inputs (optional)
- Appearance checkboxes (defaults from Settings `signatures.defaultShow*`)
- TSA radio (None / Use configured)
- The "Use configured TSA" radio is disabled if Settings `signatures.tsaEnabled` is false; tooltip explains "Configure TSA in Settings"

**Step 3 — Sign:**
- Placement radio: onto a placeholder (auto-detected; preselected if exactly one exists) OR freeform
- Sign button: dispatches `applyPadesThunk` with the cert handle, appearance, TSA URL, placement
- During the sign, the modal shows a spinner overlay with "Signing… (this may take up to 30 seconds if TSA is enabled)"
- On success: modal closes; toast "Signed by <subjectCN> at <time>"; if placement is freeform, the placement overlay activates so user can drag the visible signature to the right spot
- On failure: error inline ("TSA timed out — try without timestamping"); buttons re-enable so user can retry

**Modal cleanup (cert release):** `useEffect` cleanup fires `releaseCertThunk` if a cert handle exists. The handle is also auto-released by `applyPades` on success (default `autoRelease=true`).

**Sign-with-uncommitted-form-values disclosure:** if the user has uncommitted form-fill values when they click Sign, a tooltip on the Sign button reads "Your unsaved form values will be auto-committed before signing." On Sign, the renderer fires `commitFormThunk()` BEFORE `applyPadesThunk` so the bytes-at-sign-time include the latest values.

### 13.6 Annotation tools — properties pane additions

Inspector (§7.1) gains a new section for shape annotations:

```
┌──── Rectangle annotation ─────────────┐
│ Color:       [ ■ ] swatches + hex      │
│ Opacity:     [——●——————] 80%           │
│ Border width:[ 2 pt ▼ ]                │
│ Border style:[ Solid ▼ ]               │
│ Fill:        [x] enabled               │
│   Fill color:[ ■ ]                     │
│   Fill opacity:[—●—————————] 30%       │
│                                        │
│ [Delete annotation]                    │
└────────────────────────────────────────┘
```

For Line / Arrow:
```
│ Line start: [ None      ▼ ]            │
│ Line end:   [ OpenArrow ▼ ]            │
```

For Callout:
```
│ Text:       [ multi-line textarea ]    │
│ Font size:  [ 11 ▼ ]                   │
│ Font family:[ Helvetica ▼ ]            │
```

For Line-measure / Polyline-measure:
```
│ Unit:       [ inch ▼ ]                 │
│ Scale:      [ 1.00 ] per unit          │
│             [Calibrate from canvas]    │
```

The "Calibrate from canvas" button opens the MeasureCalibrationModal (§13.8).

### 13.7 Annotation summary panel (NEW sidebar tab)

Adds a FOURTH tab to the sidebar (existing: Thumbnails, Bookmarks, Forms; new: **Annotations**).

```
Annotations tab content:
┌────────────────────────────────────────┐
│ Filter: [x]All [ ]Highlight [ ]Sticky  │
│         [ ]Text [ ]Shape [ ]Sig        │
│ Sort:   [ Page (asc) ▼ ]               │
├────────────────────────────────────────┤
│ Page 1                                  │
│  ⬛ Square — "Important section"   →    │
│  💬 FreeText — "Approved"           →   │
│ Page 4                                  │
│  ✏ Ink — drawn glyph                →   │
│  📐 Line-measure — 24.5 in          →   │
│ Page 7                                  │
│  📍 Signature (PAdES)                →  │
│     Signed by John Smith                │
│     2026-05-26 14:32:08 UTC             │
│                                         │
│ [ Export annotations to CSV ]           │
└────────────────────────────────────────┘
```

Click row → scroll viewer to that annotation + select it.

Export annotations to CSV: pops a file dialog; writes a CSV with `[page, subtype, contents, author, createdAt, x, y, width, height, color, opacity]`.

### 13.8 MeasureCalibrationModal (NEW)

```
+--------------------------------------------+
|  Calibrate measure tool              [X]   |
+--------------------------------------------+
|                                            |
|  Click two points on the canvas that you   |
|  know the real-world distance between.     |
|                                            |
|  Distance picked: 240 pt                   |
|                                            |
|  Real-world length:                        |
|   [ 12  ] [ inch ▼ ]                        |
|                                            |
|  Resulting scale:                          |
|   1 PDF unit = 0.0500 inch                 |
|   (or: 20 PDF units = 1 inch)              |
|                                            |
|              [Cancel]      [Apply]         |
+--------------------------------------------+
```

After Apply: dispatches `setMeasureCalibrationThunk`. Subsequent line/polyline-measure annotations use this calibration. The calibration is per-document and persisted into the PDF on save.

### 13.9 SignatureAuditPanel modal (NEW)

```
+------------------------------------------------------+
|  Signatures applied by this app             [X]      |
+------------------------------------------------------+
|  Filter: [ All ▼ ] [ This document ▼ ]               |
|                                                       |
|  Date          Kind    Subject CN     Doc           ⟳ |
|  ─────────────────────────────────────────────────── |
|  2026-05-26    PAdES   John Smith     contract.pdf ✓  |
|  2026-05-25    Visual  —              draft.pdf       |
|  2026-05-24    PAdES   John Smith     invoice.pdf  ⚠  |
|                                                       |
|  Selected row details:                               |
|   Fingerprint:  3a4b5c... (SHA-256)                   |
|   Cert valid:   2024-01-01 → 2027-01-01               |
|   TSA:          https://freetsa.org/tsr (ok)          |
|   Byte-range:   [0, 12345, 28729, 8765]               |
|   Reason:       Approval for Q2 budget                |
|                                                       |
|  [Show in folder]  [Verify hash]   [Delete row]      |
+------------------------------------------------------+
```

Sorted by date desc. Filter by "This document" (matches `doc_hash` of the open file).

**Verify hash** runs `signatures:verify` and shows green/yellow/red:
- ✓ Green: hash matches; signature intact
- ⚠ Yellow: doc hash drifted (file was modified after signing); pre-sign hash matches
- ✗ Red: byte-range hash doesn't match; signature is invalid

**Delete row** is a manual override (e.g. for cleaning up test signatures). Confirms first. Does NOT affect the signed bytes in any file.

**Tamper-vulnerability disclaimer** at the bottom of the panel:
> ℹ This is a local log of signatures you've applied with this app. It is NOT a tamper-evident record. For legal-effect signatures, rely on the PAdES signature inside the PDF itself, not on this log.

### 13.10 Flatten signature widgets (extension to Phase 3 Flatten)

The Phase 3 `forms:flatten` channel flattens ALL form fields. Phase 4 adds a UI option to flatten ONLY signature widgets (visual + PAdES placeholders that have been signed) — leaves the other form fields interactive.

In the Export dialog (§12.7 from Phase 3):

```
  ▾ Advanced
     ☐ Deterministic output (Phase 2)
     ☐ Flatten forms in output (Phase 3)
     ☐ Lock signatures (flatten signature widgets only) ← NEW
```

The "Lock signatures" checkbox flattens the appearance of signed signatures into the page content stream, removing the widget — so a downstream viewer can't accidentally invalidate the signature by editing the widget rect. The cert + CMS still live in the `/V` entry; the widget is just visually-locked.

Distinct from "Flatten forms" (which removes ALL widgets including unsigned form fields). The two checkboxes can both be checked.

### 13.11 Updated keyboard-shortcut table (Phase 4)

Reflects Phase 4 additions to §10 / §11.8 / §12.8:

| Shortcut | Action | Phase |
|---|---|---|
| Q | Activate Square (Rectangle) tool | **Phase 4 (NEW)** |
| C | Activate Circle (Ellipse) tool | **Phase 4 (NEW)** |
| G | Activate Polygon tool | **Phase 4 (NEW)** |
| L | Activate Line / Arrow tool | **Phase 4 (NEW)** |
| B | Activate Callout tool | **Phase 4 (NEW)** |
| M | Activate Line-measure tool | **Phase 4 (NEW)** |
| Shift+M | Activate Polyline-measure tool | **Phase 4 (NEW)** |
| Ctrl+Shift+G | Sign (visual signature; opens capture modal) | **Phase 4 (NEW)** |
| Ctrl+Alt+G | PAdES Sign (cryptographic; opens PFX modal) | **Phase 4 (NEW)** |
| Tab (in form-fill overlay on a `/Sig` placeholder) | Focus the placeholder; Enter signs visually; Shift+Enter signs PAdES | **Phase 4 (NEW)** |
| (other Phase 1+2+3 shortcuts) | | Unchanged |

**Conflict check:**
- Q, C, G, L, B, M were not used in Phase 1/2/3. Clear.
- Ctrl+Shift+G — F11 fullscreen conflict? No, Ctrl+Shift+G is fresh. Clear.
- Ctrl+Alt+G — fresh; clear.

The `shortcuts.ts` module's `enabledInPhases: number[]` field extends with `[4, 5, 6, 7]` for the new Phase 4 entries.

### 13.12 Updated drag-drop matrix (Phase 4)

Extends §11 / §11.9 / §12.10 from prior phases:

| Source | Target | Phase 4 result |
|---|---|---|
| OS file (image: PNG/JPEG) | SignatureCaptureModal (Image tab) | Auto-loads image; previews; ready to Place |
| OS file (PFX/P12: .pfx, .p12) | PadesSignModal step 1 | Auto-loads PFX into the file input; user types password |
| OS file (PFX/P12) | anywhere outside PadesSignModal | Toast: "Drop PFX into the PAdES Sign modal. Open Sign → Cryptographic first." |
| OS file (non-supported in any context) | anywhere | Toast: "Only .pdf, .png, .jpg/.jpeg, .tif/.tiff, .csv, .xlsx, .pfx, .p12 files supported" |
| Internal: signature placement overlay | another field | Re-snap to the new field |

L-001 cross-check: PNG / JPEG / PFX drag-drop uses the SAME `File.path` Electron property as Phase 1+2+3 drops. Phase 4 EXTENDS the L-001 pathway; does not weaken it. Wave 16 implementer (Riley) MUST NOT touch `src/main/window-manager.ts`.

### 13.13 Settings additions (Phase 4)

Settings dialog (§9.2) gains a new section **Signing** + extends **Annotations**:

**Signing** (NEW section)
- Timestamping (TSA):
  - ☐ Enable RFC 3161 timestamping when signing
  - URL: [https://...                                ]
  - Timeout: [30 s]
  - [Test connection]   (fires signatures:requestTimestamp; reports green/red)
- Default appearance:
  - ☑ Show signer name on signed signatures
  - ☑ Show date on signed signatures
- Advanced (collapsed by default):
  - Placeholder size: [16384] hex chars (raise for very long cert chains)
  - PAdES engine: [signpdf ▼] (signpdf / manual) — Phase 4.1; visible Phase 4 read-only

**Annotations** (extends existing section)
- Default border width: [1 pt ▼]
- Default border style: [Solid ▼]
- Default fill enabled: ☐
- Default line end style for arrow tool: [OpenArrow ▼]

### 13.14 Screen states (Phase 4 additions)

Extending §12 / §11.10 / §12.11:

**Empty — Annotations sidebar (no annotations):**
> No annotations yet. Use the toolbar to create highlights, shapes, signatures, or callouts.

**Loading — PAdES sign in progress:**
- Modal overlay on PadesSignModal step 3 with spinner: "Signing…"
- If TSA enabled: "Signing… (contacting TSA)"
- ESC does NOT cancel mid-TSA (the TSA HTTP request is in-flight; cancel is on best-effort basis Phase 4.1)
- After completion: modal closes; toast appears

**Error — wrong PFX password:**
- Inline in PadesSignModal step 1: "Wrong password. Try again."
- Password input cleared; focus returned

**Error — TSA timeout:**
- Inline in PadesSignModal step 3: "Timestamping service didn't respond within 30 seconds. Try without timestamping or check the TSA URL in Settings."

**Error — cert expired:**
- Inline in PadesSignModal step 1: "This certificate is expired (notAfter: 2021-12-31). Choose a different cert."
- Step 2 button disabled

**Populated — signature audit panel:**
- Listed with date / kind / subject; row click shows details
- Filter by current doc by default

**Populated — signature placement overlay active:**
- Top-of-canvas banner: "Drag your signature onto a Sign here field, or to any position. Click Apply when done."

### 13.15 Accessibility additions (Phase 7 floor extends)

Phase 4's new components ship with the Phase-1+2+3 accessibility floor:

- **SignatureCaptureModal:** focus trap; Esc dismisses; Tab cycles tabs (Typed/Drawn/Image); all inputs labeled; the canvas has a textual alternative ("Drawing signature with mouse/touch — use Image tab to upload instead")
- **PadesSignModal:** focus trap; Esc dismisses with confirm (avoids accidentally losing the cert handle); Tab cycles steps; password input has appropriate `<input type="password" autocomplete="off">`
- **SignaturePlacementOverlay:** keyboard nav with arrow keys (move 1 pt; Shift = 10 pt); +/- to resize; Enter to Apply; Esc to Cancel
- **Annotation summary panel:** Tab between rows; Enter scrolls to annotation; Space toggles filter checkboxes
- **MeasureCalibrationModal:** focus trap; numerical inputs with units; calibration preview live-updates
- **SignatureAuditPanel:** Table is a `<table>` with row/column headers; clickable rows have `role="button"`

Phase 7's full a11y audit unchanged (still scoped to Phase 7).

### 13.16 Cross-reference checklist (Wave 15 self-verification)

- [x] Toolbar additions — visual + PAdES + shape tools (§13.1) — question E answered
- [x] Menu additions (§13.2)
- [x] SignatureCaptureModal (§13.3)
- [x] SignaturePlacementOverlay shared with image-overlay (§13.4) — question H answered
- [x] PadesSignModal 3-step (§13.5)
- [x] Annotation property pane for shapes (§13.6)
- [x] Annotation summary panel (§13.7)
- [x] MeasureCalibrationModal (§13.8)
- [x] SignatureAuditPanel (§13.9)
- [x] Flatten signature widgets extension (§13.10)
- [x] Updated shortcut table (§13.11)
- [x] Updated drag-drop matrix (§13.12)
- [x] Settings additions (§13.13)
- [x] Screen states (§13.14)
- [x] Accessibility floor extends (§13.15)
- [x] L-001 unchanged (§13.12 + this row)

End of Phase-4 UI amendment.

---

> ### Phase 4.1.1 amendment (2026-05-26, Riley)
>
> Small adoption wave following the Phase 4.1 live-test hot-patches Marcus
> applied to my domain. Three structural decisions are codified here so
> downstream consumers (annotation overlay, signature placement, shape tools,
> mail-merge field placement) can read one section instead of grepping the
> code. None of this changes user-visible behavior beyond "PDF text renders
> correctly and thumbnails show real page bitmaps."

#### 4.1.1.1 Page-dimension measurement flow (Option Y — root-cause centralized)

The `PDFDocumentModel.pages[].width / .height` fields are now authoritative
*after* `measurePageDimensionsThunk` fires. Previously (Wave 2 .. Phase 4.1)
these were hardcoded to US Letter (612×792 pt) by `state/thunks.ts:82-92` at
document open. Every downstream consumer of `PageModel.width/height` —
`pdf-coords.ts` (annotation screen↔PDF rect transforms),
`page-metadata/index.tsx` (the sidebar's "612 × 792 pts" readout),
`viewportForPage` (zoom math helper), `annotation-layer/index.tsx` (its
`page` prop), and the future shape / form / signature placement overlays —
reads these fields and silently produced wrong coords on non-Letter PDFs.

**Lifecycle:**

1. `openDocumentThunk` / `openDroppedPathThunk` / `combinePdfsThunk` dispatch
   `setDocument` with the Letter default (unchanged — `dialog:openPdf` and
   `pdf:combine` do not return per-page dims).
2. Immediately after, the same thunk dispatches `measurePageDimensionsThunk`.
3. That thunk calls `loadDocumentByHandle(handle)` (cache hit if PdfCanvas /
   ThumbnailItem already kicked off the load), iterates pages 0..N-1 via
   `pageProxy.getPage` + `.width / .height`, `.cleanup()`s each page proxy,
   then dispatches ONE batched `setPageDimensions([…])` action.
4. The slice (`document-slice.ts:setPageDimensions`) updates each page's
   width + height, ignoring out-of-range indices and non-positive /
   non-finite values (defensive against corrupt `/MediaBox` entries).

**Component contract:** `PdfCanvas` and `ThumbnailItem` no longer maintain
component-local `measuredDims` state — Redux is authoritative. They read
`props.page.width / props.page.height` directly. Brief pre-measure paint
uses Letter defaults; the first dispatch from the thunk corrects the layout.

**Memory hygiene:** the thunk awaits one `getPage` at a time (sequential,
not parallel) and `.cleanup()`s each proxy immediately. Total transient
memory is bounded by ONE page proxy regardless of document size.

**Concurrency:** an in-flight set (keyed by handle) dedupes overlapping
invocations. Closing + reopening the document re-fires the measure on the
new handle.

**Failure mode:** if `pdf-loader` returns `{ok:false}`, the thunk silently
no-ops and the Letter default persists. PdfCanvas surfaces the underlying
error via its existing `loadError` overlay.

#### 4.1.1.2 Thumbnail strip render lifecycle (was placeholder, now real)

`ThumbnailItem` renders a real pdf.js page bitmap into a `<canvas>` at
fixed scale `THUMB_WIDTH_PX (110) / pageProxy.width`. The Wave-1 mockup
(`<span>{index + 1}</span>` text placeholder) is gone. CSS sizing flows
through `--thumb-w` / `--thumb-h` custom properties on the `.thumbnail`
container so the page's aspect ratio determines the visual box height
(see `thumbnail-strip.module.css:.thumbCanvas`).

Blank pages keep the "Blank" badge — no canvas, no pdf.js work for them.

Cancellation: the render job is held in a ref; component unmount or
re-render cancels it before starting a new one. Identical pattern to
PdfCanvas. Memory hygiene: each thumbnail's pageProxy is `.cleanup()`-ed
as soon as its render resolves (these pages are not held for scroll-back —
PdfCanvas's `pageProxyRef` is the long-lived consumer).

#### 4.1.1.3 pdf.js asset hosting (Option Q — build-time copy)

`pdf.js` requires runtime access to standard Type-1 font substitutes
(Helvetica/Times/Courier AFM/PFB) and CMaps (CJK + non-Latin encodings).
The renderer fetches them from `./pdfjs/standard_fonts/` and `./pdfjs/cmaps/`
respectively (configured at `pdf-render.ts:189-198` via
`standardFontDataUrl`, `cMapUrl`, `cMapPacked: true`).

These assets are NOT committed to the repo. `electron.vite.config.ts`
declares a `vite-plugin-static-copy` (MIT) entry that copies the 16
`standard_fonts/*` files and 169 `cmaps/*` files from
`node_modules/pdfjs-dist/` into `dist/renderer/pdfjs/` at every renderer
build. `rename: { stripBase: true }` flattens them so they land at the
correct paths.

**Bump procedure:** when pdfjs-dist version is bumped, no manual asset
sync is needed — the next `npm run build` picks up the new files.

**Why not Option P (commit the assets):** 185 binary files (~2.2 MB) in
git noise + a guaranteed staleness vector vs the worker version.

#### 4.1.1.4 Cross-reference checklist (Phase 4.1.1 self-verification)

- [x] PageModel dim measure flow centralized at the Redux layer
- [x] Component-local `measuredDims` removed from PdfCanvas + ThumbnailItem
- [x] Thumbnail render lifecycle documented (real canvas, not placeholder)
- [x] pdfjs asset hosting documented (Option Q: build-time copy)

End of Phase-4.1.1 UI amendment.

---

## 14. Phase 5 additions (2026-05-27, Riley)

> ### Phase 5 amendment (2026-05-27)
>
> §1-§13 + §4.1.1.* above remain authoritative for Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 4.1 surfaces. Additions below extend the toolbar, menus, modals, sidebar tabs (confidence overlay layer), shortcut table, and drag-drop matrix. The IA (single-window, sidebar + viewer + inspector + status bar) is preserved. No new BrowserWindow (L-001 unchanged).

### 14.1 Toolbar additions (Phase 5)

Add to the toolbar table (§3, extended §11.1, §12.1, §13.1) as additional rows. The OCR + scan tooltips spelled out per the trust-floor obligations (§14.10 below).

| Button | Icon | Shortcut | Enabled when | Action |
|---|---|---|---|---|
| **Run OCR** | scan-text | Ctrl+Shift+R | document open | opens `OcrRunModal` (Phase 5 file-import + OCR path) |
| **Toggle confidence overlay** | eye-low | Ctrl+Shift+H | OCR result loaded for current doc | toggles `OcrConfidenceOverlay` visibility |
| **Scan…** | scanner | — | NEVER in Phase 5 (disabled with tooltip "Scanner integration arrives in Phase 5.1") | Phase 5.1 placeholder |

**Toolbar grouping:** the existing groups (Phase 1: file/edit/zoom; Phase 2: insert/text/print; Phase 3: forms/mail-merge; Phase 4: sign/annotation) get a new **OCR group** with a divider. The OCR group contains Run OCR + Confidence overlay + Scan (disabled). Three items; minimal real-estate cost.

### 14.2 Menu additions (Phase 5)

**File menu:**
- (Unchanged from Phase 4)

**Edit menu:**
- (Unchanged from Phase 4)

**Insert menu:**
- Import image for OCR… (extends the Phase 2 Insert image pattern; this variant opens the OCR modal pre-loaded with the image, not the image-import modal)

**View menu:**
- Toggle Confidence overlay (Ctrl+Shift+H) — toggles the new overlay layer
- Toggle OCR audit panel — opens `OcrAuditPanel` (Phase 5.2 surface; placeholder modal in Phase 5)

**Tools menu:**
- Run OCR… (Ctrl+Shift+R) — opens `OcrRunModal`
- Manage language packs… — opens `LanguagePackManagerModal`
- **Scan from device…** — **DISABLED** in Phase 5; tooltip: "Scanner integration arrives in Phase 5.1. For now, use the OS Scan app then drag the saved PDF into this app to run OCR."
- (Phase 4 items unchanged)

### 14.3 OcrRunModal (NEW)

Four-step modal: language → preprocess → confirm → progress. Closes on completion.

```
+-----------------------------------------------------------+
|  Run OCR                                          [X]     |
+-----------------------------------------------------------+
|  Step 1 — Choose language and pages                       |
+-----------------------------------------------------------+
|                                                            |
|  Language(s):  [ English (eng)                       ▼ ]  |
|                [ + Add another language ]                 |
|                ─────────────────────────                  |
|                ☐ Spanish (spa)     ☐ French (fra)         |
|                ☐ German (deu)      [ Download more… ]     |
|                                                            |
|  Pages:  ◉ All pages (1-N)                                |
|          ○ Page range: [ 1 ] to [ N ]                     |
|                                                            |
|  Preprocessing:                                            |
|   ☑ Deskew (auto-correct rotation)                        |
|   ☐ Denoise                                                |
|   ☐ Boost contrast                                         |
|                                                            |
|  Honesty reminder: OCR accuracy depends on scan quality.   |
|  Low-confidence words will be highlighted in orange.       |
|  See OCR trust floor for what we promise and don't.        |
|                                                            |
|              [Cancel]    [Next: Confirm ▶]                |
+-----------------------------------------------------------+
```

**Step 2 — Confirm + sign-invalidate prompt:**

When the doc has prior PAdES signatures, an inline non-skippable confirm appears:

```
┌─────────────────────────────────────────────────────────┐
│ ⚠ This PDF has 1 cryptographic signature                │
│   (signed by John Smith, 2026-05-26).                   │
│                                                          │
│   Running OCR will INVALIDATE the signature.            │
│   The signature audit log will record this.             │
│                                                          │
│   ☐ Don't ask me again for this session                 │
│                                                          │
│        [Cancel]   [Continue and invalidate]             │
└─────────────────────────────────────────────────────────┘
```

The "Don't ask me again" toggles `ocr.confirmInvalidateSignaturesOnce: true`. Per `architecture-phase-5.md §6`.

**Step 3 — Running (modal-locked):**

```
+-----------------------------------------------------------+
|  Run OCR                                  [Cancel]        |
+-----------------------------------------------------------+
|  Recognizing page 7 of 24…                                |
|                                                            |
|  [████████████░░░░░░░░░░░░░░░░░░] 29%                     |
|                                                            |
|  Language: English (eng) · DPI: 300                       |
|  Mean confidence so far: 87%                               |
|  Low-confidence words so far: 23                           |
|                                                            |
|  Estimated time remaining: ~4 min                          |
|                                                            |
|  Phase: Recognizing (page 7)                              |
+-----------------------------------------------------------+
```

The progress bar advances on `ocr:progress` events. Cancel button always visible; Esc maps to Cancel; X button shows a confirm: "Cancel OCR? Partial output will be discarded."

**Step 4 — Done:**

```
+-----------------------------------------------------------+
|  OCR complete                                              |
+-----------------------------------------------------------+
|  Recognized 4,213 words across 24 pages                   |
|  Mean confidence: 88%                                      |
|  Low-confidence words: 142 (3.4%)                         |
|  Total time: 5m 32s                                        |
|                                                            |
|  ☑ Show confidence overlay now                            |
|                                                            |
|              [Done]   [Show audit row]                    |
+-----------------------------------------------------------+
```

### 14.4 OcrConfidenceOverlay (NEW)

Renderer-side overlay drawn on top of each rendered page. For every word with `confidence < ocr.lowConfidenceThreshold` (default 60), an orange-stroked rectangle is drawn at the word's `pdfRect`. Hover shows a tooltip with the recognized text + confidence.

```
   Original page renders with text underneath.

   Page 7
   ┌─────────────────────────────────────┐
   │ The qu1ck br0wn fox jumps over the  │
   │     ┌──────┐ ┌──────┐               │  ← orange box on "qu1ck" (conf=42)
   │ lazy dog. The qu1ck br0wn fox       │  ← orange box on "br0wn" (conf=38)
   │ jumps over the lazy dog.            │
   │                                     │
   └─────────────────────────────────────┘
```

**Render order:** PdfCanvas paints the page bitmap (Phase 4.1.1 thumbnail / PdfCanvas pattern). The OcrConfidenceOverlay sits ABOVE the bitmap in DOM z-order but BELOW the annotation layer. Confidence boxes are pointer-events: none — they don't intercept clicks. Tooltips appear via a separate hover handler at the OcrConfidenceOverlay's container level.

**Toggle keyboard:** Ctrl+Shift+H. Persists via `ocr.showConfidenceOverlayByDefault` setting (per-document state is derived from the persisted preference).

**Honesty reminder placement:** when the overlay is enabled and the page has any low-confidence words, a small banner sits above the viewer: "Orange boxes mark low-confidence words (< 60). Review before saving." With a link to the OCR trust floor section.

### 14.5 LanguagePackManagerModal (NEW)

Manage installed and downloadable language packs.

```
+-----------------------------------------------------------+
|  Language Packs                                  [X]      |
+-----------------------------------------------------------+
|  Installed:                                                |
|                                                            |
|    English (eng)              bundled       10.4 MB        |
|       Last used: just now                  (cannot remove) |
|                                                            |
|    Spanish (spa)             downloaded     9.0 MB         |
|       Last used: 3 days ago                [Remove]        |
|                                                            |
|  Available to download:                                    |
|                                                            |
|    French (fra)               ~10 MB        [Download]    |
|    German (deu)               ~10 MB        [Download]    |
|    Portuguese (por)           ~10 MB        [Download]    |
|    Italian (ita)              ~9 MB         [Download]    |
|    Russian (rus)              ~10 MB        [Download]    |
|    Chinese (Simplified) chi_sim  ~22 MB     [Download]    |
|    Chinese (Traditional) chi_tra ~21 MB     [Download]    |
|    Japanese (jpn)             ~13 MB        [Download]    |
|                                                            |
|  Honesty reminder: packs download from Tesseract's        |
|  official upstream (tessdata.projectnaptha.com).          |
|  SHA-256 verified against shipped catalog.                 |
|                                                            |
|                                          [Close]          |
+-----------------------------------------------------------+
```

Download click → in-row progress bar with cancel. On success, the row moves to the Installed section.

### 14.6 ScanModal (NEW — Phase 5.1 placeholder)

Stubbed UI that explains the deferral. Reachable via Tools → "Scan from device…" if a future Phase 5.1 wave enables the menu item. **In Phase 5 the menu item is disabled**; this modal exists only as a wire-up target for Phase 5.1 implementers — no operator-visible surface in Phase 5.

```
+-----------------------------------------------------------+
|  Scan from device                                  [X]     |
+-----------------------------------------------------------+
|                                                            |
|  Scanner integration is coming in Phase 5.1.              |
|                                                            |
|  Until then, please use:                                   |
|   • Windows Scan app, OR                                   |
|   • Windows Fax and Scan                                   |
|                                                            |
|  Save the scan as PDF, then drag it into this app.        |
|  You can then run OCR via Tools → Run OCR…                |
|                                                            |
|                                          [Close]          |
+-----------------------------------------------------------+
```

### 14.7 Annotation summary panel additions (Phase 5)

Extends Phase-4 `AnnotationSummaryPanel §13.7`:

The OCR text-behind-image layer is NOT shown in the annotation summary panel (it's not annotations; it's content). However, when a doc has been OCR'd, a small banner appears at the top of the panel:

> ℹ OCR was applied to this document on 2026-05-27. View [audit row] [trust floor].

The links open the OCR audit row and the OCR trust-floor user-guide anchor, respectively.

### 14.8 Settings additions (Phase 5)

Settings dialog (§9.2, §11, §12, §13.13) gains a new section **OCR**:

**OCR** (NEW section)
- Default language: [ English (eng) ▼ ]
- Low-confidence threshold: [ 60 ] (0–100)
- Rasterization DPI: [ 300 ] (72–600)
- Max concurrent language workers: [ 4 ] (1–8)
- Worker watchdog timeout: [ 60 ] seconds (10–600)
- Default preprocessing:
  - ☑ Deskew
  - ☐ Denoise (kernel: [3])
  - ☐ Boost contrast
- ☐ Show confidence overlay by default when opening an OCR'd document
- ☑ Confirm before invalidating signatures with OCR (uncheck = always proceed; can re-enable per session in OCR modal)

**Languages** (NEW section)
- [Manage language packs…] → opens `LanguagePackManagerModal` (§14.5)
- Disk usage: ~30 MB across 2 installed packs

### 14.9 Updated keyboard-shortcut table (Phase 5)

Add to the shortcut table (§10, extended §11.8, §12.8, §13.11):

| Shortcut | Action | Enabled when |
|---|---|---|
| Ctrl+Shift+R | Open OCR Run modal | document open |
| Ctrl+Shift+H | Toggle confidence overlay | OCR result loaded for current doc |
| Esc | Cancel running OCR job (when OCR modal is in step 3) | OCR modal step 3 |

### 14.10 Updated drag-drop matrix (Phase 5)

Add to the drag-drop matrix (§11, extended §11.9, §12.10, §13.12):

| File dropped | Where | Behavior |
|---|---|---|
| OS file (PNG / JPEG / TIFF — raster image) | anywhere outside the OCR modal | **CHANGED Phase 5:** instead of going to ImageImportModal (Phase 2), if no doc is open, opens OcrRunModal pre-loaded with the image as a single-page OCR target. If a doc IS open, the existing Phase 2 ImageImportModal still opens for image-overlay-or-page-insert; the OCR path is via Tools menu. (Toast on ambiguous case: "Drop image: insert into current PDF, or start a new OCR job?") |
| OS file (PNG/JPEG/TIFF) | OcrRunModal | Auto-loads as the OCR target |
| OS file (.traineddata.gz) | LanguagePackManagerModal | Imports a sideloaded pack (SHA-256-verified against catalog; rejected if unknown lang or hash mismatch) |
| OS file (.traineddata.gz) | anywhere else | Toast: "Drop language packs into the Language Packs modal. Tools → Manage language packs." |
| Internal: any existing Phase 1-4 drop | existing target | Unchanged |

L-001 cross-check: PNG / JPEG / TIFF / .traineddata.gz drag-drop uses the SAME `File.path` Electron property as Phase 1-4 drops. Phase 5 EXTENDS the L-001 pathway; does not weaken it. Wave 20 implementer (Riley) MUST NOT touch `src/main/window-manager.ts`.

### 14.11 Screen states (Phase 5 additions)

Extending §12 / §11.10 / §12.11 / §13.14:

**Empty — OcrRunModal step 1, no installed languages beyond `eng`:**
> Only English (eng) is installed. Click "Download more…" to add other languages.

**Loading — OCR worker initialization:**
- OcrRunModal step 3 sub-status: "Loading language data… (this takes 2-5 seconds on first use)"

**Loading — Language pack download:**
- LanguagePackManagerModal in-row progress bar with cancel
- Phases: starting → downloading → verifying → completed

**Error — language pack not installed:**
- Inline in OcrRunModal step 1: "Spanish (spa) is not installed. [Download now]"
- Step 2 button disabled until installed

**Error — PAdES signature present + invalidate not confirmed:**
- Inline in OcrRunModal step 2 as a non-skippable modal-within-modal (§14.3 step 2 mock)

**Error — language pack integrity failed:**
- Toast in LanguagePackManagerModal: "Download integrity check failed for <lang>. The file was rejected. Try again or use a different network."

**Error — worker watchdog timeout:**
- OcrRunModal step 3 turns red: "Page 12 didn't complete within 60 seconds. The OCR engine has been restarted. [Retry from page 12] [Cancel]"

**Populated — confidence overlay enabled:**
- Above-viewer banner (§14.4): "Orange boxes mark low-confidence words (< 60). Review before saving. [Learn more]"

**Populated — OCR complete:**
- OcrRunModal step 4 (§14.3); toast after Done: "OCR complete. 142 low-confidence words flagged. [Show overlay]"

### 14.12 Accessibility additions (Phase 7 floor extends)

Phase 5's new components ship with the Phase-1/2/3/4 accessibility floor:

- **OcrRunModal:** focus trap; Esc dismisses (with confirm if mid-run); Tab cycles through steps; all inputs labeled; progress bar has `aria-valuenow` + `aria-valuemax`; cancel button always reachable via Tab from any focus position in step 3.
- **OcrConfidenceOverlay:** boxes have `role="note"` + `aria-label="Low-confidence word: <text> (confidence <N>)"`. NOT focus targets (pointer-events: none); screen readers can opt-in via the renderer's "Read all confidence flags" affordance (Phase 7 a11y wave).
- **LanguagePackManagerModal:** Tab between rows; Enter activates Download/Remove buttons; download progress bars have `aria-valuenow` updates.
- **ScanModal:** focus trap (even though it's a placeholder); Close button is the focus default.

Phase 7's full a11y audit unchanged (still scoped to Phase 7).

### 14.13 Trust-floor honesty obligations — three-location placement (Wave 22 Nathan obligation)

Per the proven Phase 1 H-3 + Phase 3 forms + Phase 4 PAdES three-location pattern (Nathan Wave 18 lesson, global JSONL 2026-05-27), Phase 5 surfaces the four obligations from `architecture-phase-5.md §8` at:

1. **Top-of-guide preamble** — `docs/user-guide.md` (Wave 22 Nathan) gets 4 new bullets in the Phase-4-extended preamble.
2. **Dedicated trust-floor section** — new "OCR trust floor — what the app does and doesn't promise" section in `docs/user-guide.md`. Same structure as Phase 4 PAdES trust floor.
3. **Inline at every OCR-touching subsection** — Capturing → Running OCR / Reviewing low-confidence words / Saving OCR'd PDF / Re-running OCR all carry "Honesty reminder" callouts + direct anchor links back to the dedicated section.
4. **README front-door** — `README.md` Known Limitations section gets the 4 headlines.

The four obligations enumerated for Wave 22 (`architecture-phase-5.md §8.1`):

1. OCR text accuracy depends on scan quality; low-confidence words may be incorrect.
2. OCR runs locally; no cloud upload. Language packs downloaded from `tessdata.projectnaptha.com` on first use.
3. OCR-extracted text becomes part of the saved PDF and cannot be silently un-applied.
4. Re-running OCR adds another text layer; multiple OCR passes may produce duplicate selectable text.

UI surfaces that embed these obligations:

| Surface | Obligation(s) |
|---|---|
| OcrRunModal step 1 honesty reminder | #1, #4 |
| OcrRunModal step 2 sign-invalidate prompt | (Phase 4 obligation #1 — invalidates prior signatures) |
| OcrConfidenceOverlay above-viewer banner | #1 (low-confidence words may be wrong) |
| Save modal banner (when OCR has been applied) | #3 (committing to disk) |
| LanguagePackManagerModal honesty reminder | #2 (cloud-free local; download is the only network call) |
| Settings → OCR section header subtitle | All four headlines |

### 14.14 Cross-reference checklist (Wave 19 self-verification)

- [x] Toolbar additions — Run OCR + confidence overlay toggle + Scan placeholder (§14.1)
- [x] Menu additions (§14.2)
- [x] OcrRunModal 4-step (§14.3)
- [x] OcrConfidenceOverlay z-order + pointer-events + honesty banner (§14.4)
- [x] LanguagePackManagerModal (§14.5)
- [x] ScanModal Phase-5.1 placeholder (§14.6) — encodes Q-E deferral verdict
- [x] AnnotationSummaryPanel OCR banner (§14.7)
- [x] Settings additions — OCR + Languages sections (§14.8)
- [x] Updated shortcut table (§14.9)
- [x] Updated drag-drop matrix (§14.10) — TIFF + .traineddata.gz added
- [x] Screen states (§14.11) — empty / loading / 5 error cases / populated
- [x] Accessibility additions (§14.12) — overlay screen-reader contract
- [x] Trust-floor obligations — three-location placement specified for Wave 22 Nathan (§14.13)
- [x] L-001 unchanged (§14.10 + this row)

End of Phase-5 UI amendment.

---

## 15. Phase 6 additions (2026-05-27, Riley)

> ### Phase 6 amendment (2026-05-27, Riley)
>
> §1-§14 above remain authoritative for Phase 1-5 surfaces. Additions below extend the toolbar, menus, the modal layer (Export modal), sidebar tabs (Exports tab), the status bar (export-progress indicator), shortcut table, and settings panel. The IA (single-window, sidebar + viewer + inspector + status bar) is preserved. No new BrowserWindow (L-001 unchanged).

### 15.1 Toolbar additions (Phase 6)

Add to the toolbar table (§3, extended §11.1, §12.1, §13.1, §14.1) as additional rows:

| Button | Icon | Shortcut | Enabled when | Action |
|---|---|---|---|---|
| **Export…** | file-export | Ctrl+Shift+E | document open | opens `ExportModal` (Phase 6 multi-format picker) |

**Toolbar grouping:** the Phase 5 OCR group gets a new neighbor — an **Export group** with a single button. One item; minimal real-estate cost. Positioned to the right of the Save group (Phase 1) and to the right of the OCR group (Phase 5) — semantically grouped as "produce an output file".

### 15.2 Menu additions (Phase 6)

**File menu:**
- **Export to Word…** (Ctrl+Shift+E on a default-format guess) — opens `ExportModal` pre-selected to docx
- **Export to Excel…** — opens `ExportModal` pre-selected to xlsx
- **Export to PowerPoint…** — opens `ExportModal` pre-selected to pptx
- **Export to image…** ▸
  - PNG…
  - JPEG…
  - TIFF…
  Each opens `ExportModal` pre-selected to the chosen image format
- (Phase 1-5 items unchanged)

**View menu:**
- **Show Exports panel** — toggles the new Exports sidebar tab visibility (Phase 6.x; in Phase 6 v1 the tab is always visible alongside Pages / Bookmarks / Forms / Signatures / Annotations / OCR Results)

**Tools menu:**
- (Phase 1-5 items unchanged)

The File menu is the canonical entry — the toolbar's single Export button opens the modal with the user's last-chosen format pre-selected (renderer `export-slice` carries `lastChosenFormat`).

### 15.3 ExportModal (NEW)

Four-step modal: format → quality + per-format options → confirm + start → progress (the modal closes after enqueue; progress surfaces in the status bar + Exports sidebar tab; see §15.7).

```
+--------------------------------------------------------------------+
|  Export to Office                                          [X]     |
+--------------------------------------------------------------------+
|  Step 1 — Choose format                                            |
+--------------------------------------------------------------------+
|                                                                    |
|   [Word]      [Excel]      [PowerPoint]      [Image ▸]             |
|   .docx       .xlsx        .pptx             .png / .jpeg / .tiff  |
|                                                                    |
|   Selected: ◉ Word (.docx)                                         |
|                                                                    |
|  > NEXT                                                            |
+--------------------------------------------------------------------+
|  Step 2 — Quality and options                                      |
+--------------------------------------------------------------------+
|                                                                    |
|  Quality:  ◉ Layout-preserving (best-effort)  [recommended]        |
|            ○ Text-only (fast)                                      |
|                                                                    |
|  Pages:    ◉ All pages (1-N)                                       |
|            ○ Page range: [ 1 ] to [ N ]                            |
|                                                                    |
|  ☑ Include annotations                                             |
|                                                                    |
|  Page size:  [ Auto (use source) ▼ ]   (docx only)                 |
|                                                                    |
|  Output:   [ C:\Users\…\my-doc.docx     ] [ Browse… ]              |
|                                                                    |
|  ┌──────────────────────────────────────────────────────────────┐  |
|  │ About Word export — what to expect                           │  |
|  │                                                              │  |
|  │ • Layout-preserving is best-effort. Complex multi-column     │  |
|  │   layouts and intricate tables may not convert faithfully.   │  |
|  │ • Borderless tables won't be detected.                       │  |
|  │ • XFA form values don't export (flatten first if needed).    │  |
|  │ • Signed-PDF source stays valid; the .docx has no signature. │  |
|  │ • Time estimate: ~5-30 sec per page.                         │  |
|  │                                                              │  |
|  │   Full details → OCR & Export trust floor                    │  |
|  └──────────────────────────────────────────────────────────────┘  |
|                                                                    |
|  > BACK     > START EXPORT                                         |
+--------------------------------------------------------------------+
```

**Step 3 — Confirm + start:** a one-screen summary (format / quality / pages / annotations / output path) + a START button. Nothing pre-flight-confirmable except this summary (export doesn't mutate the source; no destructive-action gate).

**Step 4 — Progress (NEW behavior compared to Phase 5):** because the export is background-queued (Q-E), the modal does NOT pin while the job runs. On START EXPORT click:

1. Modal flashes a "Queued" toast for ~500ms.
2. Modal closes.
3. Status-bar export-progress widget appears (§15.7).
4. User can navigate freely. Re-opening the modal during a running job switches to a compact "Running job: page 3 of 10. [Cancel]" view rather than re-running the format picker.

#### 15.3.1 Per-format limitations panel (trust-floor honesty surface IN the UI)

The panel above the Step-2 BACK/START buttons surfaces 4-5 bullets calibrated per the selected format. The bullets are sourced from a static catalog in `export-modal/per-format-limitations.ts` that mirrors the trust-floor obligations enumerated in `architecture-phase-6.md §8.1`. Per-format catalog:

| Format | Limitation bullets |
|---|---|
| Word (.docx) | best-effort layout / borderless tables not detected / XFA doesn't export / signed-source-stays-valid / time estimate / Image is rasterized + embedded if layout-preserving |
| Excel (.xlsx) | best for table-shaped PDFs / borderless tables won't appear / text-only tier dumps all text to one sheet / numeric coercion best-effort / signed-source-stays-valid |
| PowerPoint (.pptx) | best-effort layout / one slide per page / 16:9 widescreen with letterboxing / borderless tables not detected / time estimate |
| PNG / JPEG / TIFF | rasterized at chosen DPI / annotations rendered inline / multi-page TIFF bundles into ONE file / large DPI = large files |

Plus the cross-cutting reminder ("Time estimate: ~5-30 sec per page for layout-preserving; ~0.5 sec per page for text-only") and a link to the user-guide's dedicated trust-floor section (Nathan Wave 26 owns the anchor name).

#### 15.3.2 Quality-tier picker

Per Q-D answer:

- **Layout-preserving (best-effort)** — radio selected by default for Word + PowerPoint.
- **Text-only (fast)** — radio selected by default for Excel.
- Both tiers visible regardless of format (user can opt out of the locked-decision default tier).
- Image formats do NOT show a tier picker (the section is hidden when `format ∈ {png, jpeg, tiff}`).

A small `[recommended]` badge appears next to the per-format default tier.

#### 15.3.3 Image-format sub-picker

When the user selects "Image" in Step 1, a sub-picker reveals:

```
   ◉ PNG (lossless; default)
   ○ JPEG  [Quality: ──◯───── 0.9]
   ○ TIFF  ☐ Bundle as multi-page file
   DPI: [ 150 ▼ ]   ← 72, 96, 150, 200, 300, 600
```

DPI presets via dropdown; range [72, 600] enforced. JPEG quality slider visible only when format='jpeg'. Multi-page TIFF toggle visible only when format='tiff'.

#### 15.3.4 Modal close behavior

- Step 1-2: closing reverts state (no in-flight job).
- Step 3-4 (after job enqueued): closing leaves the job running. The status-bar widget remains.

### 15.4 Exports sidebar tab (NEW)

Sidebar tab added alongside Pages / Bookmarks / Forms / Signatures / Annotations / OCR Results. The tab lists historical + in-flight export jobs for the currently-open doc (filtered by `doc_hash`).

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

**Older-version flag:** if a row's `doc_hash` differs from the currently-open doc's `doc_hash` (because the user resaved between exports), the row shows an inline badge "from older version" — surfaces the §6.2 honest UX without confusing users about file identity.

**Re-run button:** opens the Export modal pre-populated with the row's settings (format + quality + page range + annotations). Same source-doc; user can adjust then re-export.

**Show in folder:** uses `dialog.showItemInFolder(outputPath)` (Electron native).

### 15.5 Status-bar export-progress widget (NEW)

The status bar (existing — Phase 1 §3.5) gains a new section right of the page-count widget:

```
| Page 3 / 10 | Zoom 100% |  EXPORT: my-doc.docx — page 3 of 10  [Cancel] |
```

- Visible only when a job is `running` or `queued`.
- Click opens the modal in its "running job" view.
- Cancel button is the fast-path cancel (no confirm prompt — partial output cleanup is automatic per §4.5.3 / §8.3 in the engine docs).

### 15.6 Settings additions (Phase 6)

Settings page gains a new "Export" section with three sub-sections (Office defaults / Image defaults / Layout extractor tuning) populated from the 17 settings keys per `data-models.md §11.6`.

| Section | Setting | UI control |
|---|---|---|
| Office defaults | Word: default quality tier | radio (text-only / layout-preserving) |
| Office defaults | Word: default page size | dropdown (letter / a4 / auto) |
| Office defaults | Word: include annotations by default | checkbox |
| Office defaults | Excel: default quality tier | radio |
| Office defaults | Excel: include annotations by default | checkbox |
| Office defaults | PowerPoint: default quality tier | radio |
| Office defaults | PowerPoint: include annotations by default | checkbox |
| Image defaults | Default image format | dropdown (png / jpeg / tiff) |
| Image defaults | Default DPI | dropdown (72 / 96 / 150 / 200 / 300 / 600) |
| Image defaults | Default JPEG quality | slider 0.1-1.0 step 0.05 |
| Image defaults | Default multi-page TIFF bundling | checkbox |
| Image defaults | Default include annotations in image export | checkbox |
| Layout extractor | Line clustering ε (pt) | numeric input 0.5-10 step 0.5 — advanced |
| Layout extractor | Paragraph break ratio | numeric input 1.0-5.0 step 0.1 — advanced |
| Layout extractor | Heading ratio | numeric input 1.1-3.0 step 0.1 — advanced |
| Layout extractor | Column gap (pt) | numeric input 10-200 step 5 — advanced |
| Queue | Max queue size | numeric input 1-200 — advanced |

The "Layout extractor" + "Queue" rows are hidden behind a "Show advanced settings" toggle (these are tuning knobs power-users rarely need; defaults match common PDFs).

Tooltips for each setting summarize the trust-floor obligation in one line ("Layout-preserving is best-effort; complex layouts may not convert faithfully — full details in user guide").

### 15.7 Status during background export — global IA notes

Per Q-E + §4.5 + §15.5 + §15.4:

- The Phase 5 modal-driven blocking pattern (`OcrRunModal`) is NOT mirrored. Export is queued; modal closes after enqueue.
- The status-bar widget AND the sidebar tab AND the modal-reopened-during-run view all show the SAME progress state (single source of truth: `export-slice`).
- The user can run multiple exports back-to-back; they queue. Visible in the sidebar tab's "Running" section (one job) + a "Queued" section (collapsed to count if >1).

### 15.8 Empty / loading / error states

| Component | State | What is shown |
|---|---|---|
| ExportModal Step 1 | Initial open | Format picker; last-chosen format pre-selected from `export-slice.lastChosenFormat` |
| ExportModal Step 2 | Per-format options visible | Format-specific extras + per-format limitations panel |
| ExportModal Step 4 | Job enqueued | "Queued" toast for 500ms then modal closes |
| ExportModal re-opened during running job | Run in progress | "Running: page X of Y — [phase]" + Cancel button |
| Status-bar widget | No job | Hidden |
| Status-bar widget | Job running | Format / basename / page progress / Cancel |
| Status-bar widget | Job completed | Brief "Export complete — Open" toast then auto-hides after 5 sec |
| Status-bar widget | Job failed | "Export failed — Retry" toast (stays visible until clicked / dismissed) |
| Exports sidebar tab | No exports for current doc | "No exports yet. Use File → Export… to start." empty state |
| Exports sidebar tab | Job failed `output_path_unwritable` | "Path locked by another process. Close the file in the destination app and Retry." |
| Exports sidebar tab | Job failed `queue_full` | "Export queue is full (50 jobs). Cancel some queued jobs to add more." |
| Exports sidebar tab | Job failed `extraction_failed` / `writer_failed` | "Conversion failed: <error_message>. Try the text-only quality tier or contact support." |

### 15.9 Keyboard shortcuts (Phase 6 additions)

Add to the existing shortcut table (§7, extended §11.7, §12.6, §13.6, §14.9):

| Shortcut | Action | Scope |
|---|---|---|
| Ctrl+Shift+E | Open Export modal | document open |
| Esc (inside modal) | Close modal (Step 1-2 only; Step 3-4 closes after enqueue) | modal focused |

No new global shortcuts; the modal handles its own keyboard nav per existing modal-shortcut conventions.

### 15.10 Drag-drop matrix (Phase 6 additions — none)

No drag-drop additions for Phase 6. Export operates on the currently-open document; no new file-drop surface. L-001 is unchanged.

### 15.11 Accessibility (Phase 6 additions)

- ExportModal: focus management mirrors OcrRunModal (Phase 5 §14.12). Step transitions move focus to the first focusable element of the new step. Esc closes (Step 1-2).
- Status-bar widget: `aria-live="polite"` for progress updates; throttled to ≤ 1 announcement per page-completion (NOT per-event; that would overwhelm screen readers).
- Exports sidebar tab: each row is a list item with `aria-label` summarizing format / basename / status / duration.
- Per-format limitations panel: `aria-label="About <format> export"` on the panel container; bullet list is reachable via tab.

### 15.12 Visual design — leverage Phase 5 modal patterns

The ExportModal reuses the Phase 5 OcrRunModal's CSS module pattern + step-bar component. Per the Wave 19 lesson "library survey table format + auditable verdict" the design doc is explicit: same step-bar, same primary/secondary button row, same modal-overlay z-index. No new visual primitives.

### 15.13 Trust-floor honesty surface — where the five obligations land

Per the four-times-proven pattern (Phase 1 H-3, Phase 3 forms, Phase 4 PAdES, Phase 5 OCR), with Phase 6 the count rises to FIVE — this is by now the canonical pattern for any feature with capability limitations. Wave 26 Nathan applies it mechanically; Wave 24 Riley wires the UI-side surface as defined here.

| Obligation (per architecture-phase-6.md §8.1) | UI surface this wave defines | Inline text |
|---|---|---|
| #1 — Layout-preserving is best-effort | ExportModal Step 2 PerFormatLimitationsPanel | "Layout-preserving is best-effort. Complex multi-column layouts and intricate tables may not convert faithfully." |
| #2 — Borderless tables not detected | ExportModal Step 2 PerFormatLimitationsPanel (Word + Excel + PPT) | "Borderless tables (no visible grid lines) won't appear in the output. Use the OCR layer first if needed." |
| #3 — XFA forms do not export | ExportModal Step 2 PerFormatLimitationsPanel + Settings → Export tooltip | "XFA form values don't export. AcroForm values do; flatten via Forms → Flatten on export first if needed." |
| #4 — Signed-PDF source stays valid; exported file has no signature | ExportModal Step 2 PerFormatLimitationsPanel + Settings → Export tooltip | "Exporting from a signed PDF leaves the source signature intact. The exported file has no signature semantics." |
| #5 — OCR status determines text fidelity | ExportModal Step 2 PerFormatLimitationsPanel (Word + PPT) | "If the source PDF is image-only and hasn't been OCR'd, the exported Word/PowerPoint output is mostly raster with no selectable text. Run OCR first if needed." |
| Cross-cutting — duration estimate | ExportModal Step 2 PerFormatLimitationsPanel | "Time estimate: ~5-30 sec per page for layout-preserving; ~0.5 sec per page for text-only." |

Wave 26 Nathan's targets (the three-location ratchet + README front-door + UI modal = 4-location ratchet for Phase 6):

| Location | Wave 26 (Nathan) target |
|---|---|
| Top-of-guide preamble | `docs/user-guide.md` Phase-6 preamble — enumerate all 5 obligations + duration reminder |
| Dedicated trust-floor section | New section "Export to Office trust floor — what the app does and doesn't promise" |
| Inline at every export-touching subsection | Each per-format export how-to: "Honesty reminder" callout + anchor link |
| README front-door | `README.md` Phase 6 Known Limitations with the 5 headlines |
| ExportModal UI (this wave) | Per-format limitations panel — visible in-modal, not docs-only |

### 15.14 Cross-reference checklist (Wave 23 self-verification)

- [x] Toolbar additions — single Export button + Ctrl+Shift+E (§15.1)
- [x] Menu additions — File → Export to {Word, Excel, PowerPoint, Image ▸} (§15.2)
- [x] ExportModal 4-step including modal-closes-after-enqueue inversion of Phase 5 pattern (§15.3)
- [x] Per-format limitations panel (§15.3.1) — trust-floor surface IN the modal, not docs-only
- [x] Quality-tier picker — Q-D answer: layout-preserving default Word/PPT, text-only default Excel, no tier for images (§15.3.2)
- [x] Image-format sub-picker — Q-F answer: PNG default + JPEG quality slider + TIFF multi-page toggle (§15.3.3)
- [x] Exports sidebar tab (§15.4) — Q-E background-queue progress UI
- [x] Status-bar export-progress widget (§15.5)
- [x] Settings additions — 17 new keys in 3 sub-sections + advanced toggle for tuning knobs (§15.6)
- [x] Empty / loading / 5 error states (§15.8)
- [x] Keyboard shortcuts — Ctrl+Shift+E (§15.9)
- [x] Drag-drop matrix — NO additions; L-001 unchanged (§15.10)
- [x] Accessibility — focus management mirrors Phase 5; aria-live polite for status bar (§15.11)
- [x] Trust-floor obligations — three-location ratchet + README + UI modal placement specified for Wave 26 Nathan (§15.13)
- [x] L-001 unchanged (§15.10 + this row)

End of Phase-6 UI amendment.

---

## 16. Phase 7 additions (2026-05-27, Riley)

> ### Phase 7 amendment (2026-05-27, Riley)
>
> §1-§15 above remain authoritative for Phase 1-6 surfaces. Phase 7 is the **polish phase** — it adds **no new document-editing UI**. It extends the **Settings modal** (General tab: language picker, telemetry opt-in toggle, auto-update controls), the **About modal** (version, license acknowledgments, update status), a **telemetry debug panel**, and applies **accessibility improvements across the existing UI** (the deferred ARIA tab patterns + focus-trap standardization). The IA (single-window, sidebar + viewer + inspector + status bar) is preserved. This is the FINAL roadmap phase.

### 16.1 Settings → General tab additions

The existing General section (§9.2) gains three groups. The Theme / Recents / Confirm-close controls remain.

```
+------------------------------------------------------------+
|  Settings                                            [X]   |
+------------------------------------------------------------+
| [General] [Files] [Export] [Editing] [About]               |  ← proper ARIA tablist (R-2)
+------------------------------------------------------------+
|  GENERAL                                                   |
|                                                            |
|  Theme:           ( System | Light | Dark )                |
|  Recents max:     [ 25      ]                              |
|  [x] Confirm before closing unsaved                        |
|                                                            |
|  ── Language ───────────────────────────────────────────  |
|  Language:        [ English (US)            ▼ ]            |
|     Español (España) — translation sample, some            |  ← obligation #4 subtext
|     strings may appear in English                          |
|                                                            |
|  ── Privacy ────────────────────────────────────────────  |
|  [ ] Share anonymous usage statistics                      |  ← DEFAULT UNCHECKED (obligation #1)
|     Off by default. When on, the app records anonymous     |
|     feature-usage counts only — never document content,    |
|     file paths, or personal information. In this version   |
|     nothing leaves your computer (counts stay in a local   |
|     buffer you can inspect below).  [View collected data]  |  ← opens debug panel (§16.4)
|                                                            |
|  ── Updates ────────────────────────────────────────────  |
|  Check for updates:  ( ) Only when I click "Check now"     |  ← DEFAULT (obligation #2)
|                      ( ) Automatically on launch           |
|     [ Check for updates now ]                              |
|     Last checked: never                                    |  ← null → "never"; not "1970"
|     Updates check GitHub releases. The release channel is  |  ← obligation #2 honesty inline
|     a placeholder until the project is published — updates |
|     will not download until it is configured.              |
+------------------------------------------------------------+
```

**Controls:**

- **Language picker** — a `<select>` populated from `i18n:getAvailableLocales`. Each option's label is its `nativeName`. The proof-locale subtext ("translation sample…") renders when es-ES is highlighted/selected (obligation #4). Changing the value dispatches `i18n:setLocale` (persist) + `i18next.changeLanguage` (live apply, no restart). Native `<select>` for full keyboard + Narrator accessibility.
- **Telemetry toggle** — a checkbox, DEFAULT UNCHECKED. The privacy copy is always visible (not a tooltip — obligation #1 must be read, not hovered). Toggling dispatches `telemetry:setOptIn`. Turning OFF clears the buffer (UI confirms "Collected data cleared"). "View collected data" opens the debug panel (§16.4) — the auditability surface.
- **Update channel** — a radio group (`manual` / `check-on-launch`), DEFAULT `manual`. "Check for updates now" button dispatches `update:check { trigger: 'explicit' }`. "Last checked" reads `update.lastCheckedAt` (null → localized "never"). The placeholder-honesty copy is inline (obligation #2).

### 16.2 Settings → About tab additions

The existing About section (§9.2) is fleshed out:

```
+------------------------------------------------------------+
|  ABOUT                                                     |
|                                                            |
|  PDF_Viewer_Editor   v1.0.0-rc.1                           |
|  Electron 30.x · Chromium 124 · Node 20.x                  |
|                                                            |
|  ── Updates ────────────────────────────────────────────  |
|  ◑ Checking… / ✓ Up to date / ↑ Update available (1.0.1)  |  ← live update status
|    [ Download update ]  /  [ Restart and install ]         |  ← user-initiated only
|    ⚠ Update channel not configured (placeholder).          |  ← shown when status='not-configured'
|                                                            |
|  ── License & acknowledgments ──────────────────────────  |
|  PDF_Viewer_Editor is open-source under [MIT].             |
|  Built with: pdf.js (Apache-2.0), pdf-lib (MIT),           |
|  tesseract.js (Apache-2.0), docx · exceljs · pptxgenjs     |
|  (MIT), i18next · react-i18next · electron-updater (MIT),  |
|  node-signpdf (MIT), better-sqlite3 (MIT), and others.     |
|  [ View full acknowledgments ]                            |
|                                                            |
|  Documentation · Repository (links)                        |
+------------------------------------------------------------+
```

**Update status area** is the load-bearing trust-floor UI placement for obligations #2 + #6: when `status === 'not-configured'`, it shows the explicit "release channel not configured (placeholder)" notice — NOT a fake "up to date". When an update is available, "Download update" appears (user-initiated, never auto). After download, "Restart and install" appears.

The acknowledgments list must include the Phase-7-new libraries: **i18next, react-i18next, electron-updater** (all MIT) alongside the prior-phase deps. The full list links to a generated acknowledgments view (Nathan Wave 30 may produce the full text).

### 16.3 Update notification (status-bar widget)

When an update is available (and the user is not in the About modal), a non-modal status-bar widget appears (mirrors the Phase 6 export-progress widget pattern, §15.5):

```
status bar:  Page 3 of 12  ·  100%  ·  Saved        ↑ Update available  [Details]
```

"[Details]" opens the About modal's update area. The widget NEVER auto-downloads; it is a notice only. `aria-live="polite"` announces "Update available" once (not repeatedly).

### 16.4 Telemetry debug panel (the auditability surface)

Opened from Settings → "View collected data". A modal (or inline expansion) listing the in-memory ring-buffer contents — proving the opt-in is auditable:

```
+------------------------------------------------------------+
|  Collected usage data (this session)                 [X]   |
+------------------------------------------------------------+
|  Telemetry is currently: ON                                |
|  47 events buffered (max 500). Nothing has left your       |
|  computer — these counts live only in memory.              |
|                                                            |
|  Event                          Day                        |
|  feature.export.docx            2026-05-27                 |
|  doc.open                       2026-05-27                 |
|  feature.ocr.run                2026-05-27                 |
|  ...                                                       |
|                                                            |
|  [ Clear buffer ]                          [ Close ]       |
+------------------------------------------------------------+
```

Driven by `telemetry:getStatus { includeBuffer: true }`. Shows event name + day bucket ONLY (no other fields exist — the structural PII guard, conventions §18.5). "Clear buffer" dispatches a clear. This panel makes the privacy promise verifiable by the user, which is the point of an opt-in framework.

### 16.5 Accessibility improvements across existing UI (the deferred tab patterns)

Phase 7 applies the remediation map from `a11y-audit.md §4` to the existing UI. The headline change is the **proper ARIA tab pattern** (replacing the Phase-1 `jsx-a11y/aria-proptypes` workaround) on three surfaces:

| Surface | Phase-1 state | Phase-7 fix |
|---|---|---|
| **Sidebar tabs** (Thumbnails / Bookmarks / Forms / Exports) — `sidebar/index.tsx:11-16` | tab semantics dropped for the lint workaround | `role="tablist"` (vertical) + `role="tab"` + `aria-selected` + `role="tabpanel"` + roving tabindex + arrow-key nav |
| **Settings modal tabs** (General / Files / Export / Editing / About) | same workaround | `role="tablist"` (horizontal) + same pattern |
| **Toolbar** | no `role="toolbar"` | `role="toolbar"` + roving tabindex within groups + arrow-key nav |

Plus the neighboring deferred fixes (a11y-audit §4 R-4..R-10): thumbnail-strip arrow-key roving + Delete; bookmarks-panel Space activation; empty-state focusable recents; combine-modal `aria-invalid` error; a shared `useFocusTrap` hook on every modal (focus trapped within, Esc escapes, focus returns to trigger on close); `aria-live="polite"` on status-bar widgets.

**Visual + interactive spec for the ARIA tabs:** the visual appearance does not change (same tab chrome); only the semantics + keyboard behavior change. Keyboard: arrow keys move the active tab (vertical for sidebar, horizontal for settings); only the active tab is in the Tab order (roving tabindex); `Home`/`End` jump first/last. The active tabpanel is focusable (`tabIndex={0}`) so screen-reader users land in the panel content after activating a tab.

**ESLint restoration (acceptance criterion):** once the tab patterns land, `jsx-a11y/aria-proptypes` is restored to `error` (from `warn`) and renderer typecheck + lint stay at 0.

### 16.6 New Phase-7 controls accessibility

The new Settings/About controls (§16.1-§16.4) are all keyboard + Narrator accessible:

- Language picker: native `<select>`, `aria-label="Interface language"`.
- Telemetry toggle: native `<input type="checkbox">`, label associated; the privacy copy is `aria-describedby` so Narrator reads it on focus.
- Update radio group: `role="radiogroup"` `aria-label="Update check policy"`; arrow keys move within the group.
- "Check for updates now" / "Download update" / "Restart and install": real `<button>`s, focusable, Enter/Space.
- Debug panel: `role="dialog"`, focus-trapped; the buffer list is a `role="table"` or a `<table>` with proper headers.

### 16.7 Updated keyboard-shortcut table (Phase 7)

No new global shortcuts in Phase 7 (the polish phase adds no new commands). The existing `Ctrl+,` (Open Settings) is the entry to all Phase-7 settings UI. The ARIA-tab arrow-key navigation (§16.5) is NOT a global shortcut — it is contextual to the focused tablist.

| Shortcut | Action | Status |
|---|---|---|
| Ctrl+, | Open Settings (→ language / telemetry / updates) | Phase 1 (unchanged) |
| Arrow keys (in a tablist) | Move active tab (sidebar/settings) | **Phase 7 (NEW — contextual)** |
| Home / End (in a tablist) | First / last tab | **Phase 7 (NEW — contextual)** |

### 16.8 Drag-drop behavior — NO additions; L-001 unchanged

Phase 7 introduces **no new drag-drop entry points**. The §11 drag-drop matrix (extended in §11.x / §15.10) is unchanged. **L-001 is untouched** — Phase 7 does not modify `src/main/window-manager.ts`, does not reference `enableDragDropFiles`, and does not alter the renderer drag-drop `File.path` flow. (The cross-platform config in `architecture-phase-7.md §2.1` notes `File.path` exists on mac/linux too, but that is UNVERIFIED and changes nothing about the Windows-verified behavior L-001 protects.)

### 16.9 Trust-floor obligations — four-location ratchet + UI placement (P7-L-6, SIXTH instance)

Per the proven five-times pattern, Phase 7's six obligations (`architecture-phase-7.md §8`) surface at four locations. The **UI placements (Wave 28 Riley)** are the load-bearing point-of-action surfaces:

| Obligation | UI surface (Wave 28 Riley) | Docs surface (Wave 30 Nathan) |
|---|---|---|
| #1 telemetry OFF + anonymous | Settings telemetry toggle inline copy (§16.1) + debug panel (§16.4) | user-guide privacy section + README |
| #2 update publish placeholder | Settings updates inline copy (§16.1) + About status area (§16.2) | user-guide updates section + README known-limitations |
| #3 mac/linux UNVERIFIED | (no Windows UI surface; install-time concern) | README known-limitations + user-guide install |
| #4 proof locale = sample | Settings language picker subtext (§16.1) | user-guide language section |
| #5 a11y AA + known gaps | (About → accessibility note, optional) | user-guide accessibility section (a11y-audit §7) |
| #6 code-signing = user step | About update status area (§16.2) | code-signing-workflow.md (Diego) + README |

The Settings + About inline copy is where the user reads the honesty at the moment of action — mirroring the Phase 6 `PerFormatLimitationsPanel` load-bearing-UI lesson. Wave 29 Julian's a11y audit confirms this copy is screen-reader-readable (a11y-audit §3 Path 7 + §8.1 grep #8).

### 16.10 Component additions

```
src/client/components/
  modals/settings-modal/
    general-tab.tsx                 (EXTENDED — language + privacy + updates groups; §16.1)
    about-tab.tsx                   (EXTENDED — version + update status + acknowledgments; §16.2)
    settings-tabs.tsx               (REFACTORED — proper ARIA tablist; R-2)
  modals/telemetry-debug-panel/     (NEW — the auditability surface; §16.4)
    index.tsx
    telemetry-debug-panel.module.css
  status-bar/
    update-notice-widget.tsx        (NEW — non-modal update-available notice; §16.3)
  i18n/                             (NEW directory — see i18n-strategy.md §5)
    index.ts
    locales/en-US/*.json
    locales/es-ES/*.json
    i18next.d.ts
  telemetry/                        (NEW directory — see architecture-phase-7.md §4)
    telemetry-events.ts
    telemetry-transport.ts
    use-telemetry.ts
  hooks/
    use-focus-trap.ts               (NEW — shared modal focus-trap; a11y-audit R-8)
  state/slices/
    update-slice.ts                 (NEW — update status; architecture-phase-7.md §3.3)
```

(Riley owns all of `src/client/`. No `src/main/`, `src/ipc/`, `src/db/`, or engine file appears here — the IPC handlers for `update:*` / `telemetry:*` / `i18n:*` are David/Diego's Wave 28 implementation per `phase-7-plan.md` file ownership.)

### 16.11 Phase 7 UI amendment cross-reference checklist

- [x] Settings → General: language picker + telemetry toggle + update controls (§16.1)
- [x] Settings → About: version + update status + acknowledgments (§16.2)
- [x] Update notification status-bar widget (§16.3)
- [x] Telemetry debug panel — the auditability surface (§16.4)
- [x] Accessibility — deferred ARIA tab patterns + focus-trap + live regions (§16.5, → a11y-audit §4)
- [x] New Phase-7 controls accessibility (§16.6)
- [x] Keyboard shortcuts — contextual tablist arrow nav; no new global shortcut (§16.7)
- [x] Drag-drop — NO additions; **L-001 unchanged** (§16.8)
- [x] Trust-floor SIXTH instance — four-location ratchet + UI placements (§16.9)
- [x] Component additions (§16.10)

End of Phase-7 UI amendment.
