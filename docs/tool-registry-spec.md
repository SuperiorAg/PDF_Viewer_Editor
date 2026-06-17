# Tool Registry Spec — Phase 7.5 marking foundation (R1 + R2 + R3 + L-007)

**Author:** Riley (VP of Product Design & Frontend Engineering)
**Date:** 2026-06-17 (Wave 1, Phase 7.5)
**Status:** Wave 1 design, locked at end-of-wave. Drives Riley's Wave 2 implementation of `src/client/tools/registry.ts` + four contract tests. Drives Diego's Wave 11 lock plumbing for L-007.
**Reads:** `docs/acrobat-parity-audit.md` §5 (the 7-dimension "well marked" definition + the four tests + the lock proposal), `docs/architecture-phase-7.5.md` §2, `docs/conventions.md` §19 (this wave), `.learnings/locked-instructions.md` (L-001..L-006 framing).

---

## 0. Why this exists

The audit §3 ("the menu lies") documented six real marking-lie defects in shipped code. All six share one root cause: each tool's representation is spread across 3–5 files (toolbar, menu-bar, shape-toolbar, shortcuts, i18n, help-content) with no compile-time check that the representations agree. This spec collapses those representations to one declarative source — `src/client/tools/registry.ts` — and gates further drift behind four Vitest contract tests + the L-007 CI ratchet.

The audit recommended (§5.4) to mature the pattern for one phase first before locking. The principal overrode that advice (project-plan.md §0): L-007 lands in Wave 11.

---

## 1. `ToolDef` interface (verbatim from audit §5.2)

Reproduced verbatim from the audit, with the small Phase 7.5 additions: `surfaces.palette: boolean` for the Find-a-tool palette (audit recommendation A7); a `deprecationNote?: string` field for retired tools; and tightened types around the ID enums.

```ts
// src/client/tools/registry.ts (Riley owns, Wave 2)

export type ToolId =
  // 'domain:action' — stable across UI renders; never reused after retirement
  | 'file:open'
  | 'file:save'
  | 'file:save-as'
  | 'file:close'
  | 'file:print'
  | 'file:export-pdf'
  | 'file:export-office'
  | 'file:combine'
  | 'file:compare'
  | 'file:properties'
  | 'file:compress'
  | 'file:settings'
  | 'edit:undo'
  | 'edit:redo'
  | 'edit:find'
  | 'edit:link'
  | 'view:toggle-sidebar'
  | 'view:toggle-inspector'
  | 'view:rotate-view'
  | 'view:read-mode'
  | 'view:read-aloud'
  | 'view:page-display-single-continuous'
  | 'view:page-display-two-up-continuous'
  | 'view:page-display-single'
  | 'view:page-display-two-up'
  | 'view:fit-width'
  | 'view:fit-page'
  | 'pages:insert-blank'
  | 'pages:insert-from-file'
  | 'pages:insert-image'
  | 'pages:delete'
  | 'pages:rotate-cw'
  | 'pages:rotate-ccw'
  | 'pages:crop'
  | 'pages:extract'
  | 'pages:split'
  | 'pages:replace'
  | 'pages:watermark'
  | 'pages:header-footer'
  | 'pages:background'
  | 'annotation:highlight'
  | 'annotation:sticky'
  | 'annotation:text-box'
  | 'annotation:underline'
  | 'annotation:strikethrough'
  | 'annotation:freehand'
  | 'annotation:text-edit'
  | 'annotation:shapes' // toggles the shape sub-toolbar
  | 'annotation:redact' // Phase 7.4 B1 shipped
  | 'comment:stamps'
  | 'cursor:default'
  | 'shape:rect'
  | 'shape:ellipse'
  | 'shape:polygon'
  | 'shape:line'
  | 'shape:arrow'
  | 'shape:callout'
  | 'shape:line-measure'
  | 'shape:polyline-measure'
  | 'shape:area-measure'
  | 'bookmarks:edit-mode'
  | 'bookmarks:auto-generate'
  | 'forms:designer'
  | 'forms:mail-merge'
  | 'forms:flatten'
  | 'forms:fill-and-sign'
  | 'forms:field-text'
  | 'forms:field-checkbox'
  | 'forms:field-signature'
  | 'ocr:run'
  | 'ocr:confidence-overlay'
  | 'ocr:scan-device' // placeholder; tooltip points at OS-scan workflow per A1
  | 'ocr:manage-language-packs'
  | 'tools:text-edit-mode'
  | 'tools:action-wizard'
  | 'tools:spell-check-settings'
  | 'tools:font-swap'
  | 'tools:sanitize'
  | 'tools:preflight'
  | 'tools:accessibility-tag-pdf'
  | 'tools:accessibility-reading-order'
  | 'tools:accessibility-alt-text'
  | 'tools:accessibility-check'
  | 'help:help'
  | 'help:about';

export type I18nKey = string; // narrowed via the Phase 7 typed-key augmentation
export type IconName = string; // matches src/client/components/icon/registry.ts

export type ShortcutId = string; // FK into shortcuts.ts ids

export type MenuTopId =
  | 'file'
  | 'edit'
  | 'view'
  | 'insertAndPages' // renamed from 'insert' per A4
  | 'comment' // new top-level per A4
  | 'tools'
  | 'help';

export type ToolbarGroupId =
  | 'file-ops'
  | 'history'
  | 'annotation'
  | 'shapes' // sub-toolbar group
  | 'page-ops'
  | 'output'
  | 'forms'
  | 'ocr'
  | 'combine'
  | 'redaction'; // shipped in Phase 7.4 B1

export type ContextMenuTargetId =
  | 'page-thumbnail'
  | 'page-content-selection'
  | 'bookmark-tree-node'
  | 'link-annotation';

export interface ToolDef {
  /** Stable identifier. Never reused after retirement (set deprecationNote instead). */
  readonly id: ToolId;

  /** i18n key for the visible name. Resolves in both en-US and es-ES. */
  readonly nameKey: I18nKey;

  /** i18n key for the tooltip. MUST include the shortcut text when shortcutId is set. */
  readonly tooltipKey: I18nKey;

  /** i18n key for the screen-reader name (often the same as nameKey, sometimes more descriptive). */
  readonly ariaLabelKey: I18nKey;

  /** Lucide-or-equivalent icon name. Null for menu-only tools that have no toolbar/palette icon. */
  readonly icon: IconName | null;

  /** FK into src/client/shortcuts.ts. Null for mouse-only tools. */
  readonly shortcutId: ShortcutId | null;

  /** Where in the menu this tool lives. REQUIRED. Every tool must be reachable from a menu. */
  readonly menu: { top: MenuTopId; section?: string };

  /** Which UI surfaces render this tool. */
  readonly surfaces: {
    toolbar?: ToolbarGroupId;
    /** Whether the tool appears in the menu-bar (most do; some are toolbar+palette only). */
    menu: boolean;
    contextMenu?: ContextMenuTargetId;
    /** Whether the tool appears in the Find-a-tool palette (default true). */
    palette: boolean;
  };

  /** Predicate over the root Redux state — true ⇒ tool is enabled. */
  readonly enabledWhen: (state: RootState) => boolean;

  /** The action to dispatch when the tool is invoked. */
  readonly dispatch: (dispatch: AppDispatch) => void;

  /** Free-text keywords for the Find-a-tool fuzzy matcher. */
  readonly searchKeywords: readonly string[];

  /** Populated when a tool is retired or moved. Surfaces in the palette as a deprecated badge. */
  readonly deprecationNote?: string;
}
```

### 1.1 IntrinsicShortcut — what is NOT a tool

Per audit §5.3 test (3), the "every shortcut surfaces as a tool" assertion has a documented allowlist of shortcuts that are NOT tools because they are not user-facing actions in the menu/toolbar sense:

```ts
// shortcuts that are intrinsic to the viewport / page navigation / app meta
export const INTRINSIC_SHORTCUTS = new Set<ShortcutId>([
  'page-next', // PgDn
  'page-prev', // PgUp
  'page-home', // Home
  'page-end', // End
  'zoom-in', // Ctrl++
  'zoom-out', // Ctrl+-
  'zoom-reset', // Ctrl+0
  'select-all-pages', // Ctrl+A (context-sensitive — thumbnail strip)
  'cycle-sidebar-tab', // Tab in sidebar
  'find-a-tool', // Ctrl+/ (opens the palette which itself isn't a tool)
  'escape', // global Esc handler
  'undo-redo-chord', // grouped under edit:undo / edit:redo tools but shortcut binding is intrinsic
]);
```

### 1.2 Worked example — `'annotation:highlight'`

```ts
{
  id: 'annotation:highlight',
  nameKey: 'toolbar:highlight',
  tooltipKey: 'toolbar:highlightTooltip',        // resolves to "Highlight tool (H)" in en-US
  ariaLabelKey: 'toolbar:highlightAria',
  icon: 'highlight',
  shortcutId: 'highlight-toggle',
  menu: { top: 'comment', section: 'mark-up' },
  surfaces: {
    toolbar: 'annotation',
    menu: true,
    palette: true,
  },
  enabledWhen: (s) => s.document.handle !== null,
  dispatch: (d) => d(setActiveTool({ id: 'annotation:highlight' })),
  searchKeywords: ['highlight', 'mark', 'yellow', 'fluorescent'],
}
```

### 1.3 Worked example — `'view:page-display-two-up-continuous'`

```ts
{
  id: 'view:page-display-two-up-continuous',
  nameKey: 'view.pageDisplay.twoUpContinuous',
  tooltipKey: 'view.pageDisplay.twoUpContinuousTooltip',
  ariaLabelKey: 'view.pageDisplay.twoUpContinuousAria',
  icon: 'two-up-continuous',
  shortcutId: null,                              // no shortcut
  menu: { top: 'view', section: 'page-display' },
  surfaces: {
    menu: true,                                  // menu-only tool
    palette: true,
  },
  enabledWhen: (s) => s.document.handle !== null,
  dispatch: (d) => d(setPageDisplayMode('two-up-continuous')),
  searchKeywords: ['page display', 'two-up', 'spread', 'facing pages'],
}
```

---

## 2. Renderers of the registry

Four surfaces, all reading the same registry:

### 2.1 Toolbar renderer

`src/client/components/toolbar/index.tsx` becomes:

```tsx
// pseudocode — Riley authors Wave 2
export function Toolbar() {
  const tools = TOOLS.filter((t) => t.surfaces.toolbar !== undefined);
  const byGroup = groupBy(tools, (t) => t.surfaces.toolbar);
  return (
    <div role="toolbar" aria-label={t('toolbar:label')}>
      {TOOLBAR_GROUP_ORDER.map((groupId) => (
        <ToolbarGroup key={groupId}>
          {byGroup[groupId]?.map((tool) => (
            <ToolbarButton tool={tool} key={tool.id} />
          ))}
        </ToolbarGroup>
      ))}
    </div>
  );
}
```

`ToolbarButton` reads `nameKey` / `tooltipKey` / `ariaLabelKey` / `icon` / `enabledWhen` / `dispatch` directly. No per-tool wiring; the component is generic.

### 2.2 Menu-bar renderer

`src/client/components/menu-bar/index.tsx` becomes:

```tsx
const tools = TOOLS.filter((t) => t.surfaces.menu);
const byTop = groupBy(tools, (t) => t.menu.top);
// Each top-level menu renders byTop[topId] grouped by t.menu.section
```

This is the mechanism that closes the audit's §3 toolbar↔menu mirror drift. It is now structurally impossible to add a toolbar button without also placing it in the menu — both surfaces consume the same `ToolDef`.

### 2.3 Shape sub-toolbar renderer

`src/client/components/shape-tools/shape-toolbar.tsx` becomes:

```tsx
const shapeTools = TOOLS.filter((t) => t.surfaces.toolbar === 'shapes');
return (
  <div role="toolbar" aria-label={t('shapes.toolbar.aria')}>
    {shapeTools.map((tool) => (
      <ToolbarButton tool={tool} key={tool.id} />
    ))}
  </div>
);
```

A2 i18n migration (Phase 7.5 ui-spec §1.2) lands at the same time.

### 2.4 Find-a-tool palette renderer

`src/client/components/tool-search-palette/index.tsx`:

```tsx
const candidates = TOOLS.filter((t) => t.surfaces.palette !== false && t.enabledWhen(state));
const matches = fuzzyMatch(
  query,
  candidates,
  (t) => `${t(t.nameKey)} ${t.searchKeywords.join(' ')}`,
);
```

(See ui-spec §1.7 for the palette UX.)

---

## 3. Contract tests (R2) — verbatim from audit §5.3 + Phase 7.5 hardening

File: `src/client/tools/registry.contract.test.ts`.

The four tests, with the Phase 7.5 hardening notes inline:

```ts
// (1) Every tool in registry has all 7 marking dimensions.
test('every tool is well marked', () => {
  for (const tool of TOOLS) {
    expect(tool.nameKey).toBeTruthy();
    expect(tool.tooltipKey).toBeTruthy();
    expect(tool.ariaLabelKey).toBeTruthy();
    // Phase 7.5 hardening — every tool MUST be reachable from a menu (audit §5.1 rule 4).
    expect(tool.menu).toBeTruthy();
    expect(tool.menu.top).toBeTruthy();
    expect(tool.icon !== null || tool.surfaces.menu === true).toBe(true);
    // i18n key exists in both locales (audit §5.1 rule 5).
    for (const locale of ['en-US', 'es-ES'] as const) {
      expect(getString(locale, tool.nameKey)).not.toBe(tool.nameKey); // resolved, not the key itself
      expect(getString(locale, tool.tooltipKey)).not.toBe(tool.tooltipKey);
      expect(getString(locale, tool.ariaLabelKey)).not.toBe(tool.ariaLabelKey);
    }
    // Phase 7.5 hardening — searchKeywords is non-empty so the palette finds every tool.
    expect(tool.searchKeywords.length).toBeGreaterThan(0);
  }
});

// (2) Every tool with a shortcut has the shortcut shown in its tooltip.
test('tooltips advertise their shortcut', () => {
  for (const tool of TOOLS) {
    if (!tool.shortcutId) continue;
    const tooltipEn = getString('en-US', tool.tooltipKey);
    const sc = SHORTCUTS.find((s) => s.id === tool.shortcutId);
    expect(sc).toBeDefined();
    expect(tooltipEn).toMatch(formatShortcut(sc!));
  }
});

// (3) Every shortcut maps to a tool (no orphan shortcuts).
test('every shortcut surfaces in the registry', () => {
  const unsurfacedShortcuts = SHORTCUTS.filter(
    (s) => !TOOLS.some((t) => t.shortcutId === s.id) && !INTRINSIC_SHORTCUTS.has(s.id),
  );
  expect(unsurfacedShortcuts).toEqual([]);
});

// (4) No stale "Coming in Phase N" tooltips for shipped phases.
test('no stale "coming in Phase N" tooltips', () => {
  const SHIPPED_PHASES = [1, 2, 3, 4, 5, 6, 7, 7.1, 7.2, 7.4, 7.5];
  const stalePattern = /Coming in Phase ([\d.]+)/i;
  const stale = TOOLS.filter((t) => {
    const tipEn = getString('en-US', t.tooltipKey);
    const m = stalePattern.exec(tipEn);
    return m !== null && SHIPPED_PHASES.includes(Number(m[1]));
  });
  expect(stale).toEqual([]);
});
```

### 3.1 Test (4) — phase list maintenance

The `SHIPPED_PHASES` array must be updated whenever a phase ships. Add a code comment pointing at this requirement in `registry.contract.test.ts` so future Marcus dispatches don't miss it:

```ts
// WHEN A PHASE SHIPS: add its number here. Otherwise a stale "Coming in Phase N"
// tooltip won't get flagged. (Update reviewed by Julian at every packaging wave.)
const SHIPPED_PHASES = [1, 2, 3, 4, 5, 6, 7, 7.1, 7.2, 7.4, 7.5];
```

### 3.2 Why these four tests are sufficient

The seven dimensions from audit §5.1 are:

1. Icon → covered by test (1): `tool.icon !== null || tool.surfaces.menu`.
2. Tooltip with shortcut → covered by test (2).
3. ARIA label → covered by test (1): `ariaLabelKey` resolves in both locales.
4. Menu entry → covered by test (1): `tool.menu` is required.
5. i18n in en-US + es-ES → covered by test (1).
6. Keyboard shortcut → covered by test (3): the orphan-shortcuts check ensures every registered shortcut maps to a tool; tools without shortcuts are allowed (the audit's exception for "mouse-only" sub-menu openers).
7. Discoverable via palette → covered by test (1): `searchKeywords.length > 0` AND `surfaces.palette !== false` (default true).

Plus test (4) catches the audit's specific "marking lies" pattern (stale phase tooltips).

---

## 4. Cutover plan — registry-additive THEN UI-cutover (R4 mitigation)

The retrofit is large (44 tools today; ~70 after Phase 7.5 lands all Bucket B + Bucket C). To prevent a single-commit landmine, Riley splits Wave 2 into TWO commits:

### 4.1 Commit 1 — registry-additive

- Land `src/client/tools/registry.ts` with all 70 tools declared.
- Land `src/client/tools/registry.contract.test.ts` (all four tests).
- DO NOT modify `toolbar/index.tsx`, `menu-bar/index.tsx`, or `shape-toolbar.tsx`.
- Acceptance: all four tests pass; typecheck green; no UI behaviour change (the registry exists but is not yet consumed).

This commit's diff is purely additive and easy to review. Julian's Wave 11 review re-confirms it without surprise.

### 4.2 Commit 2 — UI cutover

- Rewrite `toolbar/index.tsx` to render from `TOOLS` (per §2.1).
- Rewrite `menu-bar/index.tsx` to render from `TOOLS` (per §2.2).
- Rewrite `shape-toolbar.tsx` to render from `TOOLS` (per §2.3).
- Land the new `tool-search-palette/` component (A7).
- Wire `Ctrl+/` shortcut.
- Acceptance: all four tests still pass; typecheck green; lint green; full vitest suite green; manual smoke (every existing toolbar/menu item still works).

Two-commit pattern matches the proven Phase 7 i18n migration cutover (similar large-diff retrofit risk).

### 4.3 Failure mode: `as any` parallel-wave coordination scar

The cutover happens in Wave 2 in parallel with David's IPC handler work and Ravi's migration. Any leftover `as any` cast at the registry consumer site (e.g., `(tool as any).dispatch(dispatch)`) is the same coordination-scar pattern Julian flagged in Phase 7.4 B1 (finding 7.4.B1.1, `commit:9d9f731`). Mitigation:

- Riley's Wave 2 cleanup commit removes any `as any` before wave join.
- Julian's Wave 11 review files an explicit finding for any leftover cast at the registry consumer site.

---

## 5. Migration — what happens to existing strings + shortcuts

Existing toolbar/menu strings already live in i18n bundles per Phase 7 P7-L-5. The registry references those keys; **no new translations are required** for the registry itself. The new strings introduced by Phase 7.5 are listed per-feature in `docs/ui-spec-phase-7.5.md`.

Existing shortcuts in `shortcuts.ts` are re-used; the registry's `shortcutId` is just an FK into the existing shortcuts list. New shortcuts (A3 Alt+B/Alt+O/Alt+C + Phase 7.5 feature shortcuts) land in `shortcuts.ts` in the same Wave 2 commit pair.

---

## 6. L-007 lock (Wave 11 — principal override)

Audit §5.4 recommended deferring the lock. Principal overruled (project-plan.md §0.4): land in Wave 11. The lock text Diego will write follows the L-001..L-006 template:

### 6.1 Draft lock text (Diego authors final; Julian reviews; Marcus signs off)

```markdown
## L-007 (2026-MM-DD, Diego; principal override of audit §5.4) — Every user-facing tool MUST appear in src/client/tools/registry.ts

**Constraint:** Every user-facing tool surface (toolbar button, menu item, shape sub-toolbar entry, shortcut-only tool that the user can invoke) MUST be declared in `src/client/tools/registry.ts` as a `ToolDef` with all 7 marking dimensions filled. The four `registry.contract.test.ts` tests MUST pass in CI. Stale "Coming in Phase N" tooltips for shipped phases (per the `SHIPPED_PHASES` array in test 4) MUST NOT exist.

**Why locked:** The Phase 7.5 parity-close wave added 24 new tools; without the lock, the next agent dispatched to add a new tool will inevitably forget one of the 7 dimensions (the audit §3 demonstrated this failure mode happens organically). The lock makes the dimensions a CI-enforced contract, not a documentation discipline.

**Enforcement:**

1. The four contract tests in `src/client/tools/registry.contract.test.ts` (Riley Wave 2) — run in CI on every PR.
2. `scripts/ratchet-tool-registry-coverage.mjs` (Diego Wave 11) — walks `src/client/components/{toolbar,menu-bar,shape-tools,tool-search-palette}/` JSX for tool-rendering elements, computes the set of `ToolId`s actually rendered, computes the set declared in `registry.ts`, fails the build if the two sets diverge.
3. `SHIPPED_PHASES` constant in `registry.contract.test.ts` — updated at every phase-close per the in-code comment.

**Affected files:**

- `src/client/tools/registry.ts` (Riley)
- `src/client/tools/registry.contract.test.ts` (Riley)
- `src/client/components/toolbar/index.tsx` (Riley)
- `src/client/components/menu-bar/index.tsx` (Riley)
- `src/client/components/shape-tools/shape-toolbar.tsx` (Riley)
- `src/client/components/tool-search-palette/` (Riley)
- `scripts/ratchet-tool-registry-coverage.mjs` (Diego)
- `.github/workflows/ci.yml` (Diego — wires the ratchet)

**To unlock:** A future replacement mechanism that proves stronger coverage — e.g., a build-time plugin that fails compilation if a JSX `<ToolbarButton>` or `<MenuItem>` references a `ToolId` that doesn't exist in `registry.ts`, removing the need for both the contract tests AND the ratchet. The unlock entry must cite a green CI run that demonstrates equivalent or stronger coverage.
```

### 6.2 The ratchet script — `scripts/ratchet-tool-registry-coverage.mjs`

Diego implements this in Wave 11. Outline (Riley does not own; only specs the behaviour):

```js
// scripts/ratchet-tool-registry-coverage.mjs (Diego Wave 11)
//
// Walks src/client/tools/registry.ts → extracts TOOLS[].id set.
// Walks src/client/components/{toolbar,menu-bar,shape-tools,tool-search-palette}/ JSX → extracts the set
// of ToolId values referenced (via ts-morph or a simple AST walk).
// Fails the build if either set has members the other does not.
//
// Stable across formatting: parses TS, not raw strings.
// Stable across phases: the lock text + this script live in sync; updating SHIPPED_PHASES does not
// affect this script.

import { Project } from 'ts-morph';
// ...
```

### 6.3 Pre-flight cleanup before locking (R14 mitigation)

Project-plan.md R14: "Locking the registry before it's fully mature might trigger CI failures on legitimately-not-yet-registered tools that surface in Wave 11." Mitigation:

- Wave 11 Diego implements the ratchet AND runs it against the post-Wave-7 codebase BEFORE writing the lock entry.
- Any gap surfaced is fixed in the same Wave-11 dispatch (typically: a missing `surfaces.palette: false` for an internal/debug tool that should NOT appear in the palette).
- Lock entry references "all post-Wave-7 toolbar/menu surfaces" as the canonical scope.

### 6.4 Wave 11 sign-off

- Diego: ratchet implemented + green against current codebase + lock text drafted.
- Julian: reviews the lock text + the ratchet's coverage logic for the standard finding categories (does it claim more than it enforces? does it miss obvious surfaces? does it conflict with L-001..L-006?).
- Marcus: signs off and appends to `.learnings/locked-instructions.md` as L-007.

---

## 7. What this spec does NOT cover

- **Inspector tabs** are not "tools" in the registry sense — they are document-view modes the user toggles. Their tab labels still go through i18n, but they don't have `dispatch` semantics in the tool sense. Documented for the audit trail.
- **Annotation properties bar** (color picker, line weight, etc.) — these are tool-modal property editors, not tools. Out of scope.
- **Settings panel sub-tabs** — same reasoning.
- **Modal-internal buttons** (Apply / Cancel) — these are modal affordances, not tools.

If a future surface wants to claim "tool" status, the maintainer adds it to the registry per §1 and threads it through the cutover pattern (§4).

End of tool registry spec.
