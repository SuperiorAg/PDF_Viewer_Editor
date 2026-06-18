// Keyboard shortcut registry — single source of truth.
// Per docs/ui-spec.md §10. Phase 2 will make these user-configurable; Phase 1
// keeps them hard-coded but consolidated here so the swap is mechanical.

export type ShortcutId =
  | 'open'
  | 'save'
  | 'save-as'
  | 'close-document'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'select-all-pages'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-100'
  | 'fit-width'
  | 'fit-page'
  | 'rotate-cw'
  | 'rotate-ccw'
  | 'open-settings'
  | 'find'
  | 'print'
  | 'export-pdf'
  | 'tool-highlight'
  | 'tool-sticky'
  | 'tool-text'
  | 'tool-cursor'
  | 'tool-underline'
  | 'tool-strikethrough'
  | 'tool-freehand'
  | 'tool-text-edit'
  | 'insert-image'
  | 'delete'
  | 'cycle-sidebar-tab'
  | 'help'
  | 'toggle-fullscreen'
  | 'toggle-sidebar'
  | 'toggle-inspector'
  | 'page-prev'
  | 'page-next'
  | 'page-first'
  | 'page-last'
  // Phase 3 (ui-spec §12.8)
  | 'toggle-form-designer'
  | 'open-mail-merge'
  // Phase 6 (ui-spec §15.9)
  | 'open-export-office'
  // Phase 7.4 B1 — Redaction
  | 'redaction-apply'
  | 'redaction-mark-rect'
  // Phase 7.5 A3 — missing-shortcut suffixes for Bookmarks edit / Run OCR / Combine.
  | 'bookmark-edit'
  | 'ocr-run'
  | 'combine-open'
  // Phase 7.5 A7 — Find-a-tool palette (intrinsic; opens the registry-driven
  // search palette modal). Not surfaced as a ToolDef — it's a meta affordance.
  | 'find-a-tool'
  // Phase 7.5 B3 — Find bar Next / Prev across the document. F3 / Shift+F3.
  | 'find-next'
  | 'find-prev'
  // Phase 7.5 B16 — View-only rotation. Renderer-only CSS rotation; does NOT
  // write to the PDF. Distinct from `rotate-cw`/`rotate-ccw` which mutate.
  | 'view-rotate-cw'
  | 'view-rotate-ccw'
  // Phase 7.5 B17 — closed-polygon area measure tool (Shift+A). Shape
  // sub-toolbar peer of line-measure / polyline-measure.
  | 'tool-area-measure'
  // Phase 7.5 B7 — open Stamps panel (sidebar tab) via Ctrl+Shift+T.
  // Distinct from `tool-sticky` (S, sticky note) — stamps are reusable
  // text/image overlays managed in a sidebar panel.
  | 'comment-stamps'
  // Phase 7.5 B13 (Riley Wave 4) — arm the Add Link tool. Shift+L because
  // plain L is the existing Line / Arrow shape tool (shape-toolbar.tsx).
  | 'tool-add-link'
  // Phase 7.5 B21 (Riley Wave 5) — open File → Properties dialog.
  // Acrobat uses Ctrl+D. Free in our app (the existing "delete-page" is bound
  // to Del/Backspace via ThumbnailStrip + a global clear-selection on Delete).
  | 'file-properties'
  // Phase 7.5 C1 (Riley Wave 5a) — Read Aloud floating bar toggle.
  // The ui-spec §22 suggested `Ctrl+Shift+R` but that chord already binds to
  // `rotate-ccw` (Phase 1). Wave-5a tracks a Marcus follow-up to migrate
  // either chord; for now we ship Read Aloud on `Ctrl+Alt+R` so the bar is
  // reachable via keyboard without breaking existing rotate semantics.
  | 'read-aloud'
  // Phase 7.5 C6 (Riley Wave 5d) — Accessibility Checker run.
  // Ctrl+Shift+A picked after auditing shortcuts.ts: Ctrl+A is
  // `select-all-pages` (Phase 1), Ctrl+Shift+A is free. The chord opens
  // the Accessibility sidebar tab + immediately fires the Run thunk.
  | 'tools-a11y-check';

// Phase 7.5 B12 NOTE: page-content region Cut / Copy / Paste are NOT
// registered as ShortcutIds. They are CONTEXT-SENSITIVE — only active when
// a region marquee is drawn on a page — so the region-clipboard overlay
// binds Ctrl+X / Ctrl+C / Ctrl+V directly via React event handlers and
// short-circuits when focus is on an editable element or no marquee
// exists. Promoting them to ShortcutIds would pre-empt the OS-default
// clipboard on every text input in the app.

export interface ShortcutSpec {
  id: ShortcutId;
  label: string;
  // Keyboard event matcher fields. `key` matches `KeyboardEvent.key` (case-sensitive
  // for single-letter shortcuts because the user pressing 'H' vs 'h' matters).
  key: string | string[];
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  // Phase 1 hint retained for back-compat with shortcuts.test.ts. Phase 2
  // extends with `enabledInPhases` — a list of phases where the shortcut is
  // active. Phase 2 shortcuts get `[2,3,4,5,6,7]`. The matcher does not
  // currently consult either field — they're documentation for the help modal
  // and future feature-flag gating.
  enabledInPhase1: boolean;
  /** Phase 2 addition (ui-spec §11.8). */
  enabledInPhases?: ReadonlyArray<number>;
}

export const SHORTCUTS: readonly ShortcutSpec[] = [
  { id: 'open', label: 'Open PDF', key: 'o', ctrl: true, enabledInPhase1: true },
  { id: 'save', label: 'Save', key: 's', ctrl: true, enabledInPhase1: true },
  { id: 'save-as', label: 'Save As', key: 'S', ctrl: true, shift: true, enabledInPhase1: true },
  { id: 'close-document', label: 'Close document', key: 'w', ctrl: true, enabledInPhase1: true },
  { id: 'quit', label: 'Quit app', key: 'q', ctrl: true, enabledInPhase1: true },
  {
    id: 'undo',
    label: 'Undo',
    key: 'z',
    ctrl: true,
    enabledInPhase1: false,
    enabledInPhases: [2, 3, 4, 5, 6, 7],
  },
  {
    id: 'redo',
    label: 'Redo',
    key: ['y', 'Z'],
    ctrl: true,
    enabledInPhase1: false,
    enabledInPhases: [2, 3, 4, 5, 6, 7],
  },
  {
    id: 'select-all-pages',
    label: 'Select all pages',
    key: 'a',
    ctrl: true,
    enabledInPhase1: true,
  },
  { id: 'zoom-in', label: 'Zoom in', key: ['+', '='], ctrl: true, enabledInPhase1: true },
  { id: 'zoom-out', label: 'Zoom out', key: '-', ctrl: true, enabledInPhase1: true },
  { id: 'zoom-100', label: 'Zoom 100%', key: '0', ctrl: true, enabledInPhase1: true },
  { id: 'fit-width', label: 'Fit width', key: '1', ctrl: true, enabledInPhase1: true },
  { id: 'fit-page', label: 'Fit page', key: '2', ctrl: true, enabledInPhase1: true },
  { id: 'rotate-cw', label: 'Rotate 90° CW', key: 'r', ctrl: true, enabledInPhase1: true },
  {
    id: 'rotate-ccw',
    label: 'Rotate 90° CCW',
    key: 'R',
    ctrl: true,
    shift: true,
    enabledInPhase1: true,
  },
  { id: 'open-settings', label: 'Settings', key: ',', ctrl: true, enabledInPhase1: true },
  { id: 'find', label: 'Find', key: 'f', ctrl: true, enabledInPhase1: false },
  {
    id: 'print',
    label: 'Print',
    key: 'p',
    ctrl: true,
    enabledInPhase1: false,
    enabledInPhases: [2, 3, 4, 5, 6, 7],
  },
  {
    id: 'export-pdf',
    label: 'Export to PDF',
    key: 'P',
    ctrl: true,
    shift: true,
    enabledInPhase1: false,
    enabledInPhases: [2, 3, 4, 5, 6, 7],
  },
  // Phase 2 reassignment: Ctrl+I -> Insert Image (was Toggle Inspector Phase 1).
  // Toggle inspector moves to Ctrl+Alt+I.
  {
    id: 'insert-image',
    label: 'Insert image',
    key: 'i',
    ctrl: true,
    enabledInPhase1: false,
    enabledInPhases: [2, 3, 4, 5, 6, 7],
  },
  { id: 'tool-highlight', label: 'Highlight tool', key: 'h', enabledInPhase1: true },
  { id: 'tool-sticky', label: 'Sticky note tool', key: 's', enabledInPhase1: true },
  { id: 'tool-text', label: 'Text box tool', key: 't', enabledInPhase1: true },
  { id: 'tool-cursor', label: 'Default cursor', key: ['v', 'Escape'], enabledInPhase1: true },
  {
    id: 'tool-underline',
    label: 'Underline tool',
    key: 'u',
    enabledInPhase1: false,
    enabledInPhases: [2, 3, 4, 5, 6, 7],
  },
  {
    id: 'tool-strikethrough',
    label: 'Strikethrough tool',
    key: 'k',
    enabledInPhase1: false,
    enabledInPhases: [2, 3, 4, 5, 6, 7],
  },
  {
    id: 'tool-freehand',
    label: 'Freehand tool',
    key: 'F',
    enabledInPhase1: false,
    enabledInPhases: [2, 3, 4, 5, 6, 7],
  },
  {
    id: 'tool-text-edit',
    label: 'Text edit mode',
    key: 'e',
    enabledInPhase1: false,
    enabledInPhases: [2, 3, 4, 5, 6, 7],
  },
  { id: 'delete', label: 'Delete selection', key: ['Delete', 'Backspace'], enabledInPhase1: true },
  { id: 'cycle-sidebar-tab', label: 'Cycle sidebar tab', key: 'Tab', enabledInPhase1: true },
  { id: 'help', label: 'Help', key: 'F1', enabledInPhase1: true },
  { id: 'toggle-fullscreen', label: 'Toggle fullscreen', key: 'F11', enabledInPhase1: true },
  { id: 'toggle-sidebar', label: 'Toggle sidebar', key: 'b', ctrl: true, enabledInPhase1: true },
  {
    id: 'toggle-inspector',
    label: 'Toggle inspector',
    key: 'i',
    ctrl: true,
    alt: true,
    enabledInPhase1: true,
  },
  { id: 'page-prev', label: 'Previous page', key: 'PageUp', enabledInPhase1: true },
  { id: 'page-next', label: 'Next page', key: 'PageDown', enabledInPhase1: true },
  { id: 'page-first', label: 'First page', key: 'Home', enabledInPhase1: true },
  { id: 'page-last', label: 'Last page', key: 'End', enabledInPhase1: true },
  // Phase 3 (ui-spec §12.8). Ctrl+Shift+F was unused in Phase 1/2 (Phase 2 used
  // Shift+F for Freehand which is unmodified). Ctrl+M was unused.
  {
    id: 'toggle-form-designer',
    label: 'Toggle Form Designer mode',
    key: 'F',
    ctrl: true,
    shift: true,
    enabledInPhase1: false,
    enabledInPhases: [3, 4, 5, 6, 7],
  },
  {
    id: 'open-mail-merge',
    label: 'Open Mail Merge wizard',
    key: 'm',
    ctrl: true,
    enabledInPhase1: false,
    enabledInPhases: [3, 4, 5, 6, 7],
  },
  // Phase 6 (ui-spec §15.9). Ctrl+Shift+E opens the Export-to-Office modal.
  {
    id: 'open-export-office',
    label: 'Export to Office (Word/Excel/PowerPoint/Image)',
    key: 'E',
    ctrl: true,
    shift: true,
    enabledInPhase1: false,
    enabledInPhases: [6, 7],
  },
  // Phase 7.4 B1 — Apply redactions. Acrobat uses Ctrl+Shift+Y. Active only
  // when the redaction sub-toolbar is open AND there is at least one mark
  // pending — the handler in use-app-shortcuts.ts gates on those flags.
  {
    id: 'redaction-apply',
    label: 'Apply redactions',
    key: 'Y',
    ctrl: true,
    shift: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  // Phase 7.4 B1 — Arm the Mark Rectangle redaction tool. 'R' inside the
  // sub-toolbar mirrors the H/S/T tool-letter convention; the handler also
  // opens the panel if not already open.
  {
    id: 'redaction-mark-rect',
    label: 'Mark rectangle for redaction',
    key: 'R',
    shift: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  // Phase 7.5 A3 — three previously-toolbar-only actions get Alt-chord
  // shortcuts so keyboard-first users can reach them without the mouse. Alt+B
  // (Bookmarks edit), Alt+O (Run OCR), Alt+C (Combine PDFs).
  {
    id: 'bookmark-edit',
    label: 'Toggle bookmarks edit mode',
    key: 'b',
    alt: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  {
    id: 'ocr-run',
    label: 'Run OCR on this document',
    key: 'o',
    alt: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  {
    id: 'combine-open',
    label: 'Combine PDFs',
    key: 'c',
    alt: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  // Phase 7.5 A7 — Find-a-tool palette. Ctrl+/ opens the registry-driven
  // search palette. Intrinsic (not a ToolDef) per tool-registry-spec §1.1.
  {
    id: 'find-a-tool',
    label: 'Find a tool',
    key: '/',
    ctrl: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  // Phase 7.5 B3 — Find bar navigation. F3 / Shift+F3 cycle next / prev match
  // while the Find bar is open. The handler is a no-op when the bar is closed.
  {
    id: 'find-next',
    label: 'Find next match',
    key: 'F3',
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  {
    id: 'find-prev',
    label: 'Find previous match',
    key: 'F3',
    shift: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  // Phase 7.5 B16 — View-only rotation (renderer CSS only — does NOT mutate
  // the PDF). Acrobat uses Ctrl+Shift+Plus/Minus; we use Ctrl+Shift+ArrowRight
  // / ArrowLeft so it doesn't conflict with zoom-in (Ctrl+'+').
  {
    id: 'view-rotate-cw',
    label: 'Rotate view 90 CW',
    key: 'ArrowRight',
    ctrl: true,
    shift: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  {
    id: 'view-rotate-ccw',
    label: 'Rotate view 90 CCW',
    key: 'ArrowLeft',
    ctrl: true,
    shift: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  // Phase 7.5 B17 — area measure (closed polygon). 'A' alone would clash
  // with text input; require Shift to match the polyline-measure (Shift+M)
  // and area-tool convention.
  {
    id: 'tool-area-measure',
    label: 'Closed-polygon area measure',
    key: 'A',
    shift: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  // Phase 7.5 B7 — Stamps panel toggle. Ctrl+Shift+T mirrors the convention
  // of two-character chords for sidebar tab toggles. Doesn't conflict with
  // any existing 'T' shortcut (text-box is plain 'T').
  {
    id: 'comment-stamps',
    label: 'Open Stamps panel',
    key: 'T',
    ctrl: true,
    shift: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  // Phase 7.5 B13 (Riley Wave 4) — Add Link tool. Shift+L avoids clashing
  // with the existing Line / Arrow tool ('L' alone) on the shape sub-toolbar.
  {
    id: 'tool-add-link',
    label: 'Add Link tool',
    key: 'L',
    shift: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  // Phase 7.5 B21 (Riley Wave 5) — File → Properties (Acrobat parity Ctrl+D).
  {
    id: 'file-properties',
    label: 'Document properties',
    key: 'd',
    ctrl: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  // Phase 7.5 C1 (Riley Wave 5a) — Read Aloud floating bar toggle.
  // Ctrl+Alt+R picked to avoid the existing rotate-ccw chord (Ctrl+Shift+R).
  {
    id: 'read-aloud',
    label: 'Toggle Read Aloud bar',
    key: 'r',
    ctrl: true,
    alt: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
  // Phase 7.5 C6 (Riley Wave 5d) — Run the Accessibility Checker.
  // Ctrl+A is `select-all-pages`; Ctrl+Shift+A was free.
  {
    id: 'tools-a11y-check',
    label: 'Run Accessibility Check',
    key: 'A',
    ctrl: true,
    shift: true,
    enabledInPhase1: false,
    enabledInPhases: [7],
  },
] as const;

export function findShortcutForEvent(e: KeyboardEvent): ShortcutId | null {
  for (const s of SHORTCUTS) {
    if (s.ctrl !== undefined && s.ctrl !== (e.ctrlKey || e.metaKey)) continue;
    if (s.shift !== undefined && s.shift !== e.shiftKey) continue;
    if (s.alt !== undefined && s.alt !== e.altKey) continue;
    // Tool single-letter shortcuts (H, S, T, V) should NOT fire when modifiers
    // are pressed; if the spec didn't ask for ctrl/alt, then those pressed
    // means mismatch.
    if (s.ctrl === undefined && (e.ctrlKey || e.metaKey)) continue;
    if (s.alt === undefined && e.altKey) continue;
    if (s.shift === undefined && e.shiftKey && s.key !== 'Tab') {
      // Tab is unmodified; shift-tab is a different concept and we don't claim
      // it. Capital-letter `key` (e.g. 'F' for Freehand) implies the user
      // pressed shift to get it, so we don't reject those.
      const keys = Array.isArray(s.key) ? s.key : [s.key];
      const hasCapitalLetter = keys.some(
        (k) => k.length === 1 && k === k.toUpperCase() && k !== k.toLowerCase(),
      );
      if (!hasCapitalLetter) continue;
    }
    const keys = Array.isArray(s.key) ? s.key : [s.key];
    if (keys.includes(e.key)) return s.id;
  }
  return null;
}
