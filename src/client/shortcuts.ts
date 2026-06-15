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
  | 'redaction-mark-rect';

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
