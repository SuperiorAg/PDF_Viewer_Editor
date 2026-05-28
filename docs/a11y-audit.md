# Accessibility Audit — PDF_Viewer_Editor (Phase 7)

**Author:** Riley (front-end-architect)
**Date:** 2026-05-27 (Wave 27)
**Status:** Phase 7 audit + remediation map. Companion to `docs/architecture-phase-7.md §5`. Wave 28 implementers (Riley) work against the §4 + §6 checklists; Wave 29 Julian audits against §8.
**Target:** WCAG 2.1 Level AA. Test screen reader: **Windows Narrator** (locked per roadmap).
**Reads:** `ui-spec.md §13` (Phase 1 a11y floor), `code-review.md` (the deferred ARIA-tab backlog), `ARCHITECTURE.md` + `architecture-phase-2..7.md` (the surfaces being audited).

---

## 0. Why this audit exists

Phase 1 Riley shipped a **floor**, not an audit (ui-spec §13): keyboard reachability, visible focus ring, `aria-label` on icon buttons, 4.5:1 contrast, no-info-by-color-alone. To make that floor pass ESLint, the proper ARIA **tab pattern** was dropped to a workaround and `jsx-a11y/aria-proptypes` was downgraded to `warn` (code-review.md LOW, `sidebar/index.tsx:11-16`). That debt was explicitly deferred to "the Phase 7 a11y audit." **This document IS that audit.**

The deliverable is a remediation map an implementer can execute mechanically, plus a per-critical-path checklist Wave 28 works against and Wave 29 verifies.

---

## 1. Audit method

1. **Critical-path enumeration** (§3) — every flow a user must be able to complete: open, render/navigate, annotate, fill form, sign, OCR, export, save. For each: keyboard requirement, ARIA roles/labels, focus management, Narrator expectation.
2. **Component-level remediation map** (§4) — the specific components that need ARIA/keyboard fixes, keyed to the deferred backlog.
3. **Priority tiering** (§5, Q-D) — MUST (Wave 28) vs SHOULD vs DOCUMENT-ONLY.
4. **WCAG 2.1 AA success-criteria coverage table** (§6) — which SC each fix satisfies.
5. **Known gaps** (§7) — what Phase 7 honestly does NOT fully solve (trust-floor obligation #5).
6. **Wave 29 Julian audit checklist** (§8) — mechanical greps + Narrator drill.

---

## 2. Global a11y conventions (the rules every critical path inherits)

These are the cross-cutting rules; conventions §18.3 codifies them for code review. Every component in §3-§4 satisfies these:

1. **Every interactive element has an accessible name** — visible `<label>`, `aria-label`, or `aria-labelledby`. Icon-only buttons MUST have `aria-label` (carried from Phase 1 floor; now enforced as `error`).
2. **Focus is visible** — `:focus-visible` outline on every focusable element; never `outline: none` without a replacement focus indicator. Tokenized in `styles/tokens.css` (`--focus-ring`).
3. **No positive `tabIndex`** — only `0` (in natural order) or `-1` (programmatically focusable, removed from tab order). Positive tabindex is banned (jsx-a11y rule + conventions §18.3).
4. **Logical tab order** — Toolbar → Sidebar → Viewer → Inspector → Status bar (ui-spec §13). DOM order matches visual order; no `order:` CSS reflow that desyncs them.
5. **Focus is managed across route/modal changes** — opening a modal moves focus into it and traps it; closing returns focus to the trigger. Esc closes. (ui-spec modal sections already specify Esc; Phase 7 adds the focus-trap + focus-return discipline.)
6. **Live regions announce async state** — `aria-live="polite"` for non-urgent (page rendered, export progress); `aria-live="assertive"` for errors. Toasts use `role="status"` / `role="alert`.
7. **State conveyed beyond color** — modified `*`, error icon + text, selected checkmark (carried from Phase 1).
8. **Reduced motion respected** — `@media (prefers-reduced-motion: reduce)` disables non-essential transitions (modal slide, thumbnail fade).

---

## 3. Critical-path inventory (eight paths)

Each path lists: the keyboard contract, the ARIA roles/labels, focus management, and the Narrator expectation.

### Path 1 — Open a PDF (file dialog + drag-and-drop) — **MUST**

- **Keyboard:** `Ctrl+O` opens the file dialog (native; OS-accessible). Empty-state "Open file..." button is a real `<button>`, focusable, Enter/Space activates. The "or drag and drop" hint is informational; drag-drop is NOT the only path (keyboard parity holds — `Ctrl+O` covers it). RECENTS list items are focusable buttons (fixes `empty-state` clickable-recents LOW).
- **ARIA:** empty-state region `role="region"` `aria-label="No document open"`. Each recent is a `<button>` with accessible name = filename + relative time.
- **Focus:** on app launch, focus lands on the "Open file..." button. After open, focus moves to the viewer.
- **Narrator:** announces "Open file, button" → after open "Document loaded, N pages" via a polite live region.

### Path 2 — Render / navigate pages (pan, zoom, thumbnails, page nav) — **MUST**

- **Keyboard:** `PageDown`/`PageUp` next/prev page; `Ctrl++`/`Ctrl+-` zoom; `Ctrl+0` fit; arrow keys pan when viewer focused; `Home`/`End` first/last page. Thumbnail strip: arrow keys move focus thumbnail-to-thumbnail, Enter/Space navigates (fixes `thumbnail-strip` keyboard-nav LOW + ui-spec §11.7 I-4 which already added `tabIndex={0}` + `role="option"`).
- **ARIA:** thumbnail strip `role="listbox"` `aria-label="Pages"`; each thumbnail `role="option"` `aria-selected` + accessible name "Page N". The viewer canvas region `role="region"` `aria-label="Page N of M"` updated on navigation. Current page is `aria-current="page"`.
- **Focus:** navigating via keyboard keeps focus on the active control; the canvas does not steal focus on render.
- **Narrator:** announces "Page 3 of 12" on navigation (polite live region tied to the current-page status-bar widget). The page raster itself is not narrated (it's an image; documented gap §7).

### Path 3 — Annotate (highlight, sticky note, text box, freehand, shapes) — **MUST (tool selection + text); freehand drawing is DOCUMENT-ONLY**

- **Keyboard:** annotation toolbar buttons are focusable + Enter/Space selects the tool. Text-box + sticky-note content editors receive focus on open; Tab cycles editor ↔ Save/Cancel; Esc cancels (ui-spec §11.7 already specifies). Selecting an existing annotation: Tab into the annotation layer, arrow keys move between annotations, Enter opens its properties popover.
- **ARIA:** annotation toolbar `role="toolbar"` `aria-label="Annotation tools"` with arrow-key navigation within the group; each tool button `aria-pressed` for the active tool. Annotation layer `role="list"`; each annotation `role="listitem"` with accessible name = type + page (e.g. "Highlight, page 2"). Properties popover is a `role="dialog"` with focus trap.
- **Focus:** placing a text annotation moves focus into the contents editor. Closing the popover returns focus to the annotation.
- **Narrator:** announces the selected tool ("Highlight tool, pressed") and, on annotation creation, "Annotation added".
- **Honest gap:** freehand drawing is inherently pointer-driven — there is no keyboard equivalent for drawing an arbitrary stroke. Documented §7; not a Phase-7 blocker (the *other* annotation types provide a complete keyboard-accessible annotation workflow).

### Path 4 — Fill an existing form (AcroForm) — **SHOULD (rank 1)**

- **Keyboard:** Tab cycles form fields in field order; the viewer scrolls in lockstep (ui-spec §12.4 already specifies). Text fields, checkboxes, radios, dropdowns use native `<input>`/`<select>` controls so they inherit OS form-control accessibility. "Commit form values" is a focusable button.
- **ARIA:** form-fill overlay widgets are native controls with `aria-label` from the field name; required fields `aria-required`; the Forms sidebar tab `role="tab"` (see §4). Field-validation errors use `aria-describedby` pointing to the error text.
- **Focus:** Tab into the first field on entering fill mode; commit returns focus to the toolbar.
- **Narrator:** announces field name + type + value on focus ("Full name, edit, empty"); announces commit success.

### Path 5 — Sign (typed / drawn / image; PAdES) — **SHOULD (rank 4)**

- **Keyboard:** signature-capture modal: Tab between Typed/Drawn/Image method tabs (proper tab pattern — see §4); typed signature is a text input; image upload is a focusable button → native file dialog. Placement onto a field: Tab to select target field, Enter to place. The PAdES cert modal: Tab between PFX-file picker, password field, TSA toggle, Sign/Cancel.
- **ARIA:** method picker `role="tablist"`; password field is a native `<input type="password">` with `aria-label="Certificate password"`; the drawn-signature canvas has an `aria-label` + a "clear" button (drawing itself is pointer-only — documented gap, but typed + image methods give full keyboard parity).
- **Focus:** cert modal traps focus; on dismiss, focus returns AND the `releaseCertThunk` fires (conventions §15.1 rule 5 — the modal-cleanup discipline is also the focus-return discipline).
- **Narrator:** announces method tabs; announces "Signature applied" or the error.
- **Honest gap:** drawn signature requires a pointer; typed + image are the keyboard-accessible paths. Documented §7.

### Path 6 — OCR (run on document / page; review confidence) — **SHOULD (rank 3)**

- **Keyboard:** OCR modal: Tab through language picker, page-range inputs, preprocess checkboxes, Run/Cancel. The signed-PDF confirm dialog (conventions §16.5 — non-skippable) is keyboard-operable: Tab between Cancel / "Continue and invalidate", Enter activates the focused button (NO default to the destructive option).
- **ARIA:** confidence overlay boxes have `aria-label` = recognized text + confidence ("'invoice', 87 percent confidence"); the confirm dialog is `role="alertdialog"` with focus trapped on Cancel by default (safe default for a destructive confirm).
- **Focus:** the alertdialog focuses Cancel first (destructive-action safe default); the user must deliberately Tab to "Continue and invalidate".
- **Narrator:** announces the confirm dialog's full warning text via `role="alertdialog"` + `aria-describedby`; announces OCR completion + low-confidence count.

### Path 7 — Export to Office (docx/xlsx/pptx/image) — **SHOULD (rank 2)**

- **Keyboard:** Export modal: Tab through format cards, quality-tier radios, per-format options, output-path picker, Start Export. The `PerFormatLimitationsPanel` (Phase 6 trust-floor UI) is focusable + screen-reader-readable (NOT just visual) — this matters because the honesty copy must reach a Narrator user.
- **ARIA:** format picker `role="radiogroup"` `aria-label="Export format"`; each card `role="radio"` `aria-checked`. The limitations panel is `role="note"` `aria-label="Export limitations"` so Narrator reads it. Progress step uses `aria-live="polite"` for per-page progress.
- **Focus:** modal traps focus; Start Export disabled (with `aria-disabled`) until a valid output path is chosen.
- **Narrator:** announces format selection, the limitations note, per-page progress ("Page 4 of 10 exported"), and completion.

### Path 8 — Save (Save / Save As) — **MUST**

- **Keyboard:** `Ctrl+S` save; `Ctrl+Shift+S` Save As (native dialog). The ConfirmCloseUnsavedModal (ui-spec §9.3): Tab between Don't save / Cancel / Save and close; Esc = Cancel; Enter = Save and close (already specified) — Phase 7 adds focus-trap + initial focus on "Save and close" (the safe non-destructive default; "Don't save" is the destructive one and is NOT the default).
- **ARIA:** the unsaved-changes modal is `role="alertdialog"` `aria-describedby` the body text; the dirty indicator `*` in the title bar has `aria-label="unsaved changes"`.
- **Focus:** save returns focus to the toolbar; the modal returns focus to the triggering control.
- **Narrator:** announces "Saved" via a polite live region; announces the unsaved-changes alertdialog text.

---

## 4. Component-level remediation map (the deferred ARIA-tab backlog + neighbors)

The headline Phase-7 a11y debt is the **proper ARIA tab pattern**. The pattern (applied identically to all three tab surfaces below):

```tsx
// The correct ARIA tab pattern (Wave 28 — replaces the Phase-1 jsx-a11y/aria-proptypes workaround)
<div role="tablist" aria-label="Sidebar panels" aria-orientation="vertical">
  {tabs.map((tab, i) => (
    <button
      role="tab"
      id={`tab-${tab.id}`}
      aria-selected={tab.id === active}
      aria-controls={`panel-${tab.id}`}
      tabIndex={tab.id === active ? 0 : -1}   // roving tabindex
      onKeyDown={onTabKeyDown}                 // Arrow keys move active tab; Home/End jump
    >
      {t(tab.labelKey)}
    </button>
  ))}
</div>
<div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} tabIndex={0}>
  {/* active panel content */}
</div>
```

Roving tabindex: only the active tab is in the tab order (`tabIndex={0}`); arrow keys move the active tab (and focus); `Home`/`End` jump to first/last. This is the WAI-ARIA Authoring Practices tab pattern.

| # | Component (path) | Current gap (from code-review.md) | Wave 28 fix | Priority |
|---|---|---|---|---|
| R-1 | `sidebar/index.tsx:11-16` | tab semantics dropped for `jsx-a11y/aria-proptypes` workaround | apply the ARIA tab pattern above (Thumbnails / Bookmarks / Forms / Exports tabs) | **MUST** |
| R-2 | `modals/settings-modal/` (General / Files / Export / Editing / About) | same workaround; no tab semantics | apply the ARIA tab pattern (horizontal `aria-orientation`) | **MUST** |
| R-3 | `toolbar/` | no `role="toolbar"`; arrow-key group nav absent | add `role="toolbar"` + roving tabindex within toolbar groups | **MUST** |
| R-4 | `thumbnail-strip/` | keyboard nav (ui-spec §11.7 I-4 added `tabIndex`/`role=option`; arrow keys + Delete need wiring) | wire arrow-key roving + Enter/Space activate + Delete fires delete-page | **MUST** |
| R-5 | `bookmarks-panel/` | Space key doesn't activate (LOW, code-review.md:725) | map Space + Enter to activate bookmark; tree nodes `role="treeitem"` | MUST (cheap) |
| R-6 | `empty-state/` | recents not keyboard-clickable (LOW) | recents are `<button>`s, focusable, Enter/Space opens | MUST (cheap) |
| R-7 | `modals/combine-modal/` | empty-path validation surfaced visually only (LOW) | add `aria-invalid` + `aria-describedby` error text | SHOULD |
| R-8 | `modals/*` (all) | focus-trap + focus-return + `aria-modal` discipline inconsistent | standardize a `useFocusTrap` hook applied to every modal | **MUST** |
| R-9 | `status-bar/` | async announcements not in a live region | wrap the page/zoom/save-status widgets in `aria-live="polite"` | MUST |
| R-10 | `modals/settings-modal/` (NEW Phase 7 controls) | n/a (new) | telemetry toggle + locale picker + update controls all keyboard + Narrator accessible (see ui-spec §16) | MUST |

**ESLint restoration (acceptance criterion):** once R-1/R-2 land, Diego restores `jsx-a11y/aria-proptypes` to `error` (from `warn`) in the ESLint config and confirms renderer typecheck + lint stay at 0. The `allowedDynamic` option Diego flagged (code-review.md:160) may be the enabler; if the proper tab pattern resolves the warnings without it, the rule simply goes back to `error`.

---

## 5. Priority tiering (Q-D)

| Tier | Paths / components | Phase 7 (Wave 28) verdict |
|---|---|---|
| **MUST** | Path 1 (open) · Path 2 (render/navigate) · Path 3 (annotate — tool selection + text) · Path 8 (save) · R-1..R-6, R-8, R-9, R-10 | Ships in Wave 28. These are the walking-skeleton core + the deferred ARIA tab debt + focus-trap standardization. |
| **SHOULD** (Wave 28 if budget; else 7.1) | Path 4 (forms, rank 1) · Path 7 (export, rank 2) · Path 6 (OCR, rank 3) · Path 5 (sign, rank 4) · R-7 | Ranked by user frequency + risk. Forms first (high frequency, native controls = cheap). Export second (the limitations panel MUST reach Narrator — obligation overlap). OCR third (the destructive-confirm a11y matters). Sign last (lowest frequency, native password input already covers the critical surface). |
| **DOCUMENT-ONLY** (defer to 7.1, disclose now) | freehand annotation drawing via keyboard · drawn-signature canvas via keyboard · full Narrator narration of the rendered page raster | Inherently pointer-centric or image-content; no Phase-7 fix. Disclosed §7 + trust-floor obligation #5. The keyboard-accessible alternatives (typed/image signature; text/highlight/shape annotations) provide complete workflows. |

**Rationale for the MUST/SHOULD split:** the MUST set is the walking-skeleton (the Phase-1 milestone flows) plus the explicit deferred debt — these are what "the app is accessible" means at minimum. The SHOULD set is the later-phase features; they degrade gracefully (native form controls and the native password input are already accessible) so a Wave-28 budget overflow defers them to 7.1 without shipping an *inaccessible* feature — just an *unaudited* one, which is honestly disclosed.

---

## 6. WCAG 2.1 AA success-criteria coverage

| SC | Level | Covered by | Notes |
|---|---|---|---|
| 1.1.1 Non-text Content | A | aria-label on icon buttons (R-3), thumbnails (Path 2), annotations (Path 3) | page raster is decorative-image gap (§7) |
| 1.3.1 Info and Relationships | A | ARIA roles (tablist/tab/tabpanel, toolbar, listbox, radiogroup) R-1..R-4, Path 7 | the core of the deferred-debt fix |
| 1.4.3 Contrast (Minimum) | AA | Phase-1 floor (≥4.5:1) carried forward | re-verify default + dark theme |
| 1.4.11 Non-text Contrast | AA | focus ring + control borders ≥3:1 (tokens.css `--focus-ring`) | new in Phase 7 |
| 2.1.1 Keyboard | A | all critical paths §3; roving tabindex R-1..R-4 | freehand/drawn = documented exception (§7) |
| 2.1.2 No Keyboard Trap | A | focus-trap hook R-8 traps WITHIN modals but Esc always escapes | |
| 2.4.3 Focus Order | A | logical order (conventions §18.3 rule 4); focus-return on modal close (R-8) | |
| 2.4.7 Focus Visible | AA | `:focus-visible` discipline (global rule 2) | carried + enforced |
| 3.2.1 On Focus / 3.2.2 On Input | A | no context change on focus; commit boundaries are explicit (forms §14 commit) | |
| 3.3.1 Error Identification | A | `aria-invalid` + `aria-describedby` (R-7, Path 4) | |
| 4.1.2 Name, Role, Value | A | every interactive element named (global rule 1); ARIA states (aria-selected/pressed/checked) | the deferred-debt SC |
| 4.1.3 Status Messages | AA | live regions (global rule 6; R-9; Path 7 progress) | new in Phase 7 |
| 2.3.3 Animation from Interactions | AAA (bonus) | `prefers-reduced-motion` (global rule 8) | above-AA nicety |

---

## 7. Known a11y gaps (trust-floor obligation #5 — honest disclosure)

Documented for `user-guide.md` (Wave 30 Nathan) + the About modal. Phase 7 audits to AA for critical paths but does NOT fully solve:

1. **Freehand annotation drawing has no keyboard equivalent.** Drawing an arbitrary stroke is pointer-only. Mitigation: highlight, strikethrough, text box, sticky note, and shape annotations ARE keyboard-accessible, giving a complete keyboard annotation workflow without freehand.
2. **Drawn signature requires a pointer.** Mitigation: typed and image-based signatures are fully keyboard-accessible.
3. **The rendered page raster is not narrated.** Narrator cannot read the visual content of a page image (this is the nature of a rasterized PDF page; OCR'd text-behind-image IS exposed to the accessibility tree where present, but un-OCR'd image-only pages are opaque). Mitigation: run OCR (Phase 5) to make image-only pages searchable + screen-reader-readable.
4. **Narrator is the only tested SR.** NVDA / JAWS are not tested in Phase 7 (roadmap locked Narrator). Behavior on other SRs is unverified.
5. **Cross-platform a11y is Windows-only-tested.** macOS VoiceOver and Linux Orca are UNVERIFIED (ties to the cross-platform-UNVERIFIED obligation #3).

What Phase 7 DOES promise: keyboard navigation + Narrator support for the eight critical paths' keyboard-accessible variants; the proper ARIA tab pattern; standardized focus management; live-region announcements; WCAG 2.1 AA for critical paths per §6.

---

## 8. Wave 29 Julian audit checklist (mechanical + manual)

### 8.1 Mechanical greps

```bash
# (1) No positive tabindex anywhere in the renderer
rg -n 'tabIndex=\{[1-9]' src/client/        # expected: ZERO matches

# (2) No outline:none without a focus-visible replacement
rg -n 'outline:\s*none|outline:\s*0' src/client/    # each match must co-locate a :focus-visible rule

# (3) jsx-a11y/aria-proptypes restored to error (not warn)
rg -n 'aria-proptypes' .eslintrc.cjs eslint.config.*   # must read 'error', NOT 'warn'

# (4) The proper tab pattern is present on the three tab surfaces
rg -n 'role="tablist"' src/client/components/sidebar/ src/client/components/modals/settings-modal/   # >= 2 matches
rg -n 'role="toolbar"' src/client/components/toolbar/                                                # >= 1 match

# (5) Every icon-only button has an accessible name (spot-check: no <button> with only an <Icon/> child + no aria-label)
rg -n 'aria-label=' src/client/components/toolbar/    # non-zero; manual scan for any naked icon button

# (6) Modals use the shared focus-trap hook (R-8)
rg -n 'useFocusTrap' src/client/components/modals/    # matches in every modal index.tsx

# (7) Live regions on async status
rg -n 'aria-live' src/client/components/status-bar/ src/client/components/modals/export-modal/   # non-zero

# (8) No hardcoded user-facing string slipped past i18n in the a11y labels (aria-label must use t())
rg -n 'aria-label="[A-Z]' src/client/    # matches with a literal string (not {t(...)}) are flagged for review
```

### 8.2 Manual Narrator drill (Wave 29)

Run the packaged Windows binary with Windows Narrator on. Walk each MUST path (open → navigate → annotate text → save) and confirm:
- Each control announces name + role + state.
- Tab order matches §2 rule 4.
- Modals trap focus and return it on close.
- The unsaved-changes + OCR-invalidate alertdialogs announce their full warning AND default-focus the SAFE (non-destructive) button.
- Page navigation announces "Page N of M".

Capture an operator-level screenshot of the running app with Narrator's focus indicator visible on a tab control (proves the ARIA tab pattern landed). Per L-002, pixels-on-screen is the verification — not a passing lint.

### 8.3 Cross-reference checklist

- [x] Eight critical paths inventoried with keyboard + ARIA + focus + Narrator (§3)
- [x] Deferred ARIA-tab-pattern fix mapped to the three surfaces (§4, R-1/R-2/R-3)
- [x] Neighboring deferred LOWs (thumbnail nav, bookmarks Space, empty-state recents, combine validation) mapped (§4, R-4..R-7)
- [x] Focus-trap standardization (R-8) + live regions (R-9) + Phase-7 new controls (R-10)
- [x] Priority tiering MUST/SHOULD/DOCUMENT-ONLY (§5, Q-D)
- [x] WCAG 2.1 AA SC coverage table (§6)
- [x] Honest known gaps (§7, trust-floor obligation #5)
- [x] Wave 29 Julian mechanical greps + Narrator drill (§8)
- [x] L-001 untouched — this audit does not reference or weaken `enableDragDropFiles`

End of Phase-7 accessibility audit.
