#!/usr/bin/env node
// scripts/ratchet-tool-registry-coverage.mjs — Phase 7.5 Wave 11 (Diego).
// Locked by L-007 (.learnings/locked-instructions.md).
//
// Enforces that every user-facing toolbar button, menu item, shape sub-toolbar
// entry, and palette entry is declared in `src/client/tools/registry.ts` as a
// `ToolDef`. A new surface that bypasses the registry is a hard CI block.
//
// Heuristic (intentionally transparent — documented for L-007 review):
//   1. Parse the three canonical surface files:
//        a) src/client/components/toolbar/index.tsx          (Toolbar)
//        b) src/client/components/menu-bar/index.tsx         (MenuBar)
//        c) src/client/components/shape-tools/shape-toolbar.tsx  (ShapeToolbar)
//      and one R1-cutover consumer that already reads from the registry:
//        d) src/client/components/find-a-tool-palette/index.tsx  (palette)
//      (d) is informational only — the palette IS a registry consumer, so any
//      mismatch there is a registry-side bug surfaced by the contract tests.
//   2. Extract every i18n key string used as a `label`, `tooltip`,
//      `aria-label`, or `t('toolbar:...')` / `t('menu:items....')` value.
//      Keys that match the registry's `nameKey` / `tooltipKey` / `ariaLabelKey`
//      sets count as REGISTERED. Keys that don't match any ToolDef are
//      candidate gaps.
//   3. Cross-reference candidate gaps against the ALLOWLIST below (a). Any
//      gap not in the allowlist is a HARD FAIL with file:line + suggested
//      ToolDef shape.
//
// Allowlist semantics:
//   - Each allowlist entry MUST carry a human-readable `reason` so reviewers
//     understand why the surface is exempt. The L-007 unlock procedure
//     requires the principal's approval to add new allowlist entries.
//   - Allowlist patterns are EXACT i18n-key string matches. No glob — we
//     want a reviewer to look at each addition.
//
// Exit codes:
//   0 — every user-facing surface covered (or covered by the allowlist).
//   1 — at least one un-registered, non-allowlisted surface found.
//   2 — script-level error (parse fail, missing file, etc.).
//
// Why a heuristic and not a full AST analyzer:
//   The three surface files (menu-bar, toolbar, shape-toolbar) all use a
//   uniform `t('<namespace>:<key>')` pattern for human-readable strings.
//   The ratchet's correctness is a function of that pattern, not of full
//   React semantics. A regex-driven first pass is honest about its scope;
//   when the pattern drifts (e.g. someone hard-codes 'Open' without
//   wrapping in `t(...)`), the i18n CI check catches it FIRST — and if
//   that one ever lapses, the registry contract tests' "every nameKey
//   resolves" assertion fails the build.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join as joinPath, resolve as resolvePath, relative as relPath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');

// ----------------------------------------------------------------------------
// Allowlist — exact i18n-key strings that are legitimately exempt from the
// registry coverage requirement. Each entry MUST carry a `reason`.
//
// L-007 unlock: adding a new entry here REQUIRES principal approval. The
// allowlist is the ratchet's accountability surface — the gap rate is
// supposed to trend toward zero, not be papered over by silent allowlist
// growth. Audit reviewers run `grep -c "i18nKey" allowlist` to spot drift.
// ----------------------------------------------------------------------------

const ALLOWLIST = [
  // ----- Toolbar -----
  {
    i18nKey: 'toolbar:scanDevice',
    file: 'src/client/components/toolbar/index.tsx',
    reason:
      'Phase 7.4 A1 honesty refresh — Scan button is intentionally disabled (TWAIN/WIA defer per docs/architecture-phase-5.md §7 + R9). The tooltip points users at the OS scan utility + drag-and-drop fallback. Surface is rendered for affordance/discoverability only; it dispatches nothing. Will be removed in the wave that lands a real scan engine (no current plan).',
  },
  {
    i18nKey: 'toolbar:scanDeviceTooltip',
    file: 'src/client/components/toolbar/index.tsx',
    reason: 'Sibling of toolbar:scanDevice (same disabled-affordance entry).',
  },
  {
    i18nKey: 'toolbar:label',
    file: 'src/client/components/toolbar/index.tsx',
    reason: 'Container ARIA label on the toolbar div — not a tool, just the WAI-ARIA roving-toolbar landmark name (a11y-audit R-3).',
  },
  {
    i18nKey: 'toolbar:groups.annotation',
    file: 'src/client/components/toolbar/index.tsx',
    reason: 'Toolbar GROUP ARIA label (container, not a tool surface).',
  },
  {
    i18nKey: 'toolbar:groups.pageOps',
    file: 'src/client/components/toolbar/index.tsx',
    reason: 'Toolbar GROUP ARIA label (container, not a tool surface).',
  },
  {
    i18nKey: 'toolbar:groups.output',
    file: 'src/client/components/toolbar/index.tsx',
    reason: 'Toolbar GROUP ARIA label (container, not a tool surface).',
  },
  {
    i18nKey: 'toolbar:groups.forms',
    file: 'src/client/components/toolbar/index.tsx',
    reason: 'Toolbar GROUP ARIA label (container, not a tool surface).',
  },
  {
    i18nKey: 'toolbar:groups.ocr',
    file: 'src/client/components/toolbar/index.tsx',
    reason: 'Toolbar GROUP ARIA label (container, not a tool surface).',
  },

  // ----- Shape sub-toolbar -----
  // The shape sub-toolbar's nine tool entries are dispatched by a single
  // `setActiveShapeTool` call, with eight of them (rect/ellipse/polygon/
  // line/arrow/callout/line-measure/polyline-measure) staying behind the
  // `shapesPanelOpen` slice flag. Only `area-measure` has a registry entry
  // today (Wave 3). The other 8 are tracked as a coherent unit under a
  // single allowlist cluster:
  //   - Each surface IS user-facing (visible button in the sub-toolbar
  //     when `ui.shapesPanelOpen === true`).
  //   - Each is reachable via a chord (`Q`/`C`/`G`/`L`/`B`/`M`/`Shift+M`)
  //     bound LOCALLY inside the sub-toolbar component, not via the
  //     global shortcut table.
  // Promoting these 8 to ToolDefs is a deliberate Riley follow-up
  // (Wave 5d/5e missed them; the principal's R14 mitigation requires the
  // gap to be documented honestly here rather than silently absorbed).
  //
  // The principal's standing rule (L-007 §why): "surfaces that bypass the
  // registry lose their chord, palette text, i18n key, accessibility
  // name, and Find-a-tool discoverability." For these 8, the i18n keys
  // ARE resolved (the in-component TOOLS table holds them); the palette
  // is the missing surface — typing "rectangle" in Find-a-tool today
  // doesn't find the shape tool. That gap is locked in the allowlist
  // until Riley promotes them (tracked as the post-Wave-11 follow-up).
  {
    i18nKey: 'toolbar:shapeTools.label',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sub-toolbar container ARIA label (not a tool surface).',
  },
  {
    i18nKey: 'toolbar:shapeTools.rect',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason:
      'Shape sub-toolbar entry (rectangle, chord Q). 8-entry cluster slated for ToolDef promotion in a Riley follow-up — see allowlist preamble for context. Tracked as Wave-12 open question to Marcus.',
  },
  {
    i18nKey: 'toolbar:shapeTools.rectAria',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.rect.',
  },
  {
    i18nKey: 'toolbar:shapeTools.rectTooltip',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.rect.',
  },
  {
    i18nKey: 'toolbar:shapeTools.ellipse',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Shape sub-toolbar entry (ellipse, chord C). Same cluster.',
  },
  {
    i18nKey: 'toolbar:shapeTools.ellipseAria',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.ellipse.',
  },
  {
    i18nKey: 'toolbar:shapeTools.ellipseTooltip',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.ellipse.',
  },
  {
    i18nKey: 'toolbar:shapeTools.polygon',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Shape sub-toolbar entry (polygon, chord G). Same cluster.',
  },
  {
    i18nKey: 'toolbar:shapeTools.polygonAria',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.polygon.',
  },
  {
    i18nKey: 'toolbar:shapeTools.polygonTooltip',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.polygon.',
  },
  {
    i18nKey: 'toolbar:shapeTools.line',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Shape sub-toolbar entry (line, chord L). Same cluster.',
  },
  {
    i18nKey: 'toolbar:shapeTools.lineAria',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.line.',
  },
  {
    i18nKey: 'toolbar:shapeTools.lineTooltip',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.line.',
  },
  {
    i18nKey: 'toolbar:shapeTools.arrow',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Shape sub-toolbar entry (arrow). Same cluster.',
  },
  {
    i18nKey: 'toolbar:shapeTools.arrowAria',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.arrow.',
  },
  {
    i18nKey: 'toolbar:shapeTools.arrowTooltip',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.arrow.',
  },
  {
    i18nKey: 'toolbar:shapeTools.callout',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Shape sub-toolbar entry (callout, chord B). Same cluster.',
  },
  {
    i18nKey: 'toolbar:shapeTools.calloutAria',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.callout.',
  },
  {
    i18nKey: 'toolbar:shapeTools.calloutTooltip',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.callout.',
  },
  {
    i18nKey: 'toolbar:shapeTools.lineMeasure',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Shape sub-toolbar entry (line measure, chord M). Same cluster.',
  },
  {
    i18nKey: 'toolbar:shapeTools.lineMeasureAria',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.lineMeasure.',
  },
  {
    i18nKey: 'toolbar:shapeTools.lineMeasureTooltip',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.lineMeasure.',
  },
  {
    i18nKey: 'toolbar:shapeTools.polylineMeasure',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Shape sub-toolbar entry (polyline measure, chord Shift+M). Same cluster.',
  },
  {
    i18nKey: 'toolbar:shapeTools.polylineMeasureAria',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.polylineMeasure.',
  },
  {
    i18nKey: 'toolbar:shapeTools.polylineMeasureTooltip',
    file: 'src/client/components/shape-tools/shape-toolbar.tsx',
    reason: 'Sibling of toolbar:shapeTools.polylineMeasure.',
  },

  // ----- Menu items not currently in the registry (legitimate cases) -----
  // The menu-bar contains many items dispatched via direct slice actions that
  // pre-date the registry. Each one below is either (a) a 1-of-N preset that
  // a parameterized ToolDef would cover poorly, or (b) waiting on a
  // registry-aware menu-bar cutover (the Wave 2-B cutover the registry
  // proposal §4 calls for, which has not landed yet).
  //
  // The acceptable cluster size for L-007's intent is "the ratchet's
  // EXISTING gap is documented; the ratchet's CI job blocks new gaps." So:
  // these stay allowlisted. A new menu item that doesn't match either
  // an existing ToolDef nor this allowlist trips the gate.
  {
    i18nKey: 'menu:items.exportWord',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      'Export Office submenu preset — one of {Word, Excel, PowerPoint, PNG, JPEG, TIFF}. All six are sub-presets of the single `file:export-office` ToolDef; a parameterized-ToolDef pattern would either explode the registry (six entries for one tool) or change ToolDef shape. Tracked as a Wave-12 open question to Marcus: do we expand `file:export-office` into six discrete entries (better palette discoverability — "export to word" would land) or keep one ToolDef + a preset arg.',
  },
  {
    i18nKey: 'menu:items.exportExcel',
    file: 'src/client/components/menu-bar/index.tsx',
    reason: 'Sibling of menu:items.exportWord (export preset cluster).',
  },
  {
    i18nKey: 'menu:items.exportPowerpoint',
    file: 'src/client/components/menu-bar/index.tsx',
    reason: 'Sibling of menu:items.exportWord (export preset cluster).',
  },
  {
    i18nKey: 'menu:items.exportPng',
    file: 'src/client/components/menu-bar/index.tsx',
    reason: 'Sibling of menu:items.exportWord (export preset cluster).',
  },
  {
    i18nKey: 'menu:items.exportJpeg',
    file: 'src/client/components/menu-bar/index.tsx',
    reason: 'Sibling of menu:items.exportWord (export preset cluster).',
  },
  {
    i18nKey: 'menu:items.exportTiff',
    file: 'src/client/components/menu-bar/index.tsx',
    reason: 'Sibling of menu:items.exportWord (export preset cluster).',
  },
  {
    i18nKey: 'menu:items.findATool',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      'The Find-a-tool palette toggle is an INTRINSIC shortcut (Ctrl+/) per registry.ts INTRINSIC_SHORTCUTS — by design it cannot itself be a ToolDef (the palette renders ToolDefs; making it one would be self-referential). The menu mirror exposes the palette for discoverability.',
  },
  {
    i18nKey: 'menu:items.viewRotateCcw',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      'Counter-clockwise rotation is handled by `view-rotate-ccw` in INTRINSIC_SHORTCUTS (the binding is intrinsic per registry.ts INTRINSIC_SHORTCUTS); the menu mirror dispatches the same handler `view:rotate-view` ToolDef triggers.',
  },
  {
    i18nKey: 'menu:items.viewRotateReset',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      'View rotation reset (back to 0deg). Sibling of menu:items.viewRotateCcw — the rotate-view ToolDef is the discoverable surface; reset is a "neutral state" preset of the same control.',
  },
  {
    i18nKey: 'menu:items.fullscreen',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      'F11 toggles BrowserWindow fullscreen via Electron. The `view:read-mode` ToolDef covers the app-level Read Mode (chromeless renderer); fullscreen is the OS-level window-state toggle and intentionally separate.',
  },
  {
    i18nKey: 'menu:items.pageFromFile',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      'Alias for `pages:insert-from-file` ToolDef (which is enabledWhen=() => false today per A1 honesty deferral). The menu mirror text differs from the ToolDef nameKey because the menu uses the "Insert > Page from File…" command-style label while the ToolDef uses "Insert pages from file". Will collapse to one key when Wave 2-B cutover lands.',
  },
  {
    i18nKey: 'menu:items.formFieldText',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      'Form-designer preset entry (Add Text Field). Same cluster as the export presets above — dispatches setDesignerMode(true) + arms a form-tool sub-mode. Three siblings (formFieldText / formFieldCheckbox / formFieldSignature) sit under the single `forms:designer` ToolDef.',
  },
  {
    i18nKey: 'menu:items.formFieldCheckbox',
    file: 'src/client/components/menu-bar/index.tsx',
    reason: 'Sibling of menu:items.formFieldText (form-designer preset cluster).',
  },
  {
    i18nKey: 'menu:items.formFieldSignature',
    file: 'src/client/components/menu-bar/index.tsx',
    reason: 'Sibling of menu:items.formFieldText (form-designer preset cluster).',
  },
  {
    i18nKey: 'menu:items.toggleFormsSidebar',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      'Sidebar-tab switcher to the Forms tab. Dispatch is `setSidebarTab(\'forms\')`; the `forms:designer` ToolDef covers the FORMS feature surface. The sidebar-tab switchers are a separate UX layer (View menu navigation) — promoting each tab to a ToolDef would blow up the registry without adding discoverability (the Find-a-tool palette already routes "forms" to forms:designer).',
  },
  {
    i18nKey: 'menu:items.toggleFormDesigner',
    file: 'src/client/components/menu-bar/index.tsx',
    reason: 'Menu mirror of the `forms:designer` ToolDef. Same dispatch; the menu uses a different label (mode-toggle phrasing) than the ToolDef nameKey (tool-name phrasing).',
  },
  {
    i18nKey: 'menu:items.showOcrOverlay',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      'Dynamic-label variant of the `ocr:confidence-overlay` ToolDef ("Show OCR overlay" when off, "Hide OCR overlay" when on). The ToolDef carries the toolbar surface + the canonical tooltip; the menu label flips with state to read more naturally.',
  },
  {
    i18nKey: 'menu:items.hideOcrOverlay',
    file: 'src/client/components/menu-bar/index.tsx',
    reason: 'Sibling of menu:items.showOcrOverlay (state-flipped menu label of the same ToolDef).',
  },
  {
    i18nKey: 'menu:items.help',
    file: 'src/client/components/menu-bar/index.tsx',
    reason: 'Already covered by `help:help` ToolDef nameKey. Listed defensively in case the matcher misses it.',
  },
  {
    i18nKey: 'menu:items.about',
    file: 'src/client/components/menu-bar/index.tsx',
    reason: 'Already covered by `help:about` ToolDef nameKey. Listed defensively in case the matcher misses it.',
  },
  {
    i18nKey: 'menu:items.replaceText',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      'Menu mirror of `annotation:text-edit` ToolDef (dispatch setTextEditMode(true)). Different label phrasing per menu UX vs toolbar UX. Same cluster as toggleFormDesigner — alternative menu names of registered tools.',
  },
  // Page Display submenu — the four ToolDef entries `view:page-display-*`
  // have menu-mirror labels with state-flipped prefixes ("• " on the active
  // one). The ratchet sees the prefixed strings as not matching the
  // registry's bare nameKey. List the bare keys here as covered-by-ToolDef
  // (so the matcher accepts them) and the prefixed concatenations are
  // tolerated because they include the bare key.

  // Page rotation - counter-clockwise menu mirror.
  {
    i18nKey: 'menu:items.rotateCcw',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      "Menu mirror of the `pages:rotate-cw` ToolDef's reverse direction. The page-rotation ToolDef exposes the CW direction (matching the toolbar button); CCW is a menu-only inverse dispatch. Wave-12 follow-up: promote to a dedicated `pages:rotate-ccw` ToolDef OR add to MENU_MIRROR_MAP once Riley confirms the canonical pair (the `view-rotate-ccw` intrinsic shortcut is the VIEW rotation, NOT page rotation — separate concept).",
  },

  // Forms — Flatten Forms menu entry.
  {
    i18nKey: 'menu:items.flattenForms',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      'Flatten Forms (commits form-field values into the page content stream so a saved PDF has non-editable filled fields). Standalone destructive op without a toolbar surface. Wave-12 follow-up: promote to a `forms:flatten` ToolDef once the canonical id is picked.',
  },

  // Redaction — show / clear marks helpers (sub-features of annotation:redact).
  {
    i18nKey: 'menu:items.redactShowMarks',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      "Visibility toggle on the redaction-marks layer. Helper of `annotation:redact` ToolDef (controls whether already-placed marks render on the page). Not a tool in its own right — a view-state preference for the same tool.",
  },
  {
    i18nKey: 'menu:items.redactClearMarks',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      "Bulk-clear all pending redaction marks. Sub-operation of `annotation:redact` ToolDef. The toolbar surface owns 'arm the rect tool'; the menu adds the 'clear all' inverse. Could be promoted to a dedicated ToolDef in Wave 12 if discoverability via Find-a-tool palette becomes a user ask.",
  },

  // Scan device — duplicate of toolbar:scanDevice but in the menu.
  {
    i18nKey: 'menu:items.scanDevice',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      'Menu mirror of toolbar:scanDevice — same A1 honesty refresh (TWAIN/WIA deferred indefinitely; tooltip points users at OS scan utility). Surface is rendered for affordance/discoverability only. Will be removed when a permissive scan engine surfaces.',
  },

  // OCR — Manage language packs (separate UX surface from ocr:run).
  {
    i18nKey: 'menu:items.manageLanguagePacks',
    file: 'src/client/components/menu-bar/index.tsx',
    reason:
      'Opens the OCR language-pack manager (download / remove / set default Tesseract language packs). Distinct UX surface from `ocr:run` (which RUNS OCR on the current document with the currently-installed language packs). Wave-12 follow-up: promote to a dedicated `ocr:language-packs` ToolDef so the Find-a-tool palette surfaces "manage language packs" / "download spanish" / etc.',
  },
];

// ----------------------------------------------------------------------------
// Registry parser — pull every i18n key referenced as `nameKey`/`tooltipKey`/
// `ariaLabelKey` from TOOLS in registry.ts.
// ----------------------------------------------------------------------------

async function readRegistry() {
  const path = joinPath(REPO_ROOT, 'src/client/tools/registry.ts');
  const content = await readFile(path, 'utf8');
  const keys = new Set();
  // Match `nameKey: 'toolbar:open',` / `tooltipKey: 'menu:items.foo',` etc.
  const KEY_RE = /(nameKey|tooltipKey|ariaLabelKey)\s*:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = KEY_RE.exec(content)) !== null) {
    keys.add(m[2]);
  }
  // Collect every ToolDef id — pattern `id: 'group:slug'`.
  const toolIds = new Set();
  const ID_RE = /\bid:\s*['"]([a-z]+:[a-z][a-z0-9-]*)['"]/g;
  while ((m = ID_RE.exec(content)) !== null) {
    toolIds.add(m[1]);
  }
  return { keys, toolIds };
}

// ----------------------------------------------------------------------------
// Surface scanner — find every i18n key used in the three canonical surface
// files. Returns array of { i18nKey, file, line }.
// ----------------------------------------------------------------------------

const SURFACE_FILES = [
  'src/client/components/toolbar/index.tsx',
  'src/client/components/menu-bar/index.tsx',
  'src/client/components/shape-tools/shape-toolbar.tsx',
];

// Match `t('toolbar:something')` / `t('menu:items.something')` / `t('toolbar:foo.bar.baz')` etc.
// The first capture group is the full key including namespace.
const T_CALL_RE = /\bt\(\s*['"`]([a-zA-Z][a-zA-Z0-9_.:-]+)['"`]\s*[),]/g;
// Also catch object-literal use: `labelKey: 'toolbar:foo'` and the
// shape-toolbar's `tooltipKey:` / `ariaKey:` table.
const KEY_LITERAL_RE = /\b(labelKey|tooltipKey|ariaKey|nameKey|ariaLabelKey)\s*:\s*['"]([^'"]+)['"]/g;

// I18n keys that the scanner intentionally SKIPS because they are not tool
// surfaces. These are container labels, error / toast strings, transient
// tooltip text shown only in error states, and other UI-chrome strings
// that the L-007 rule about "every tool surface in the registry" does NOT
// apply to.
//
// Patterns are evaluated against the FULL i18n key including namespace.
// Each entry carries a comment explaining why it is skipped — same
// accountability surface as the allowlist.
const SCANNER_SKIP_PATTERNS = [
  // Error / toast / flash message strings — never tool surfaces.
  /^errors:/,
  // Menu container labels (top-level menu name only, not menu items).
  // The menu items themselves are scanned; the container labels are
  // the menu-bar's section headings.
  /^menu:file$/,
  /^menu:edit$/,
  /^menu:view$/,
  /^menu:insert$/,
  /^menu:tools$/,
  /^menu:comment$/,
  /^menu:help$/,
  /^menu:barLabel$/,
  // Conditional menu-item TOOLTIPS shown only when the item is disabled
  // (e.g. "redact needs marks first", "scan deferred", "mail-merge
  // needs a field"). These accompany an EXISTING menu item; the menu
  // item itself is what gets scanned for registry coverage, not the
  // conditional tooltip text.
  /^menu:tooltips\./,
];

function shouldSkip(i18nKey) {
  for (const re of SCANNER_SKIP_PATTERNS) {
    if (re.test(i18nKey)) return true;
  }
  return false;
}

// ----------------------------------------------------------------------------
// Menu-mirror map — pairs each `menu:items.X` key with the ToolDef id whose
// dispatch the menu mirror fires. Every entry here is a CONCEPTUAL match
// (same tool, different surface, different label phrasing).
//
// Why this map and not the allowlist:
//   - The allowlist's purpose is "this surface is exempt from registry
//     coverage" (one-of-N preset entries, deliberately inert affordances,
//     intrinsic shortcuts that can't themselves be ToolDefs, etc.).
//   - The menu-mirror map's purpose is "this menu key IS a surface of an
//     EXISTING ToolDef; it just uses a different i18n key for the menu
//     label vs the toolbar tooltip." Documentation of an alias relation,
//     not an exemption.
//
// Wave 12 follow-up (open question for Marcus): promote this map into a
// `mirrorKeys: readonly I18nKey[]` field on ToolDef itself, populated by
// Riley in the registry. That makes the relation visible at the call site
// (registry.ts) instead of in a separate file, and lets the four
// `registry.contract.test.ts` tests assert the mirror keys resolve in
// both locales. For Wave 11, the map lives here because amending ToolDef
// shape crosses file ownership (Riley's domain).
// ----------------------------------------------------------------------------

const MENU_MIRROR_MAP = {
  // File menu
  'menu:items.open': 'file:open',
  'menu:items.save': 'file:save',
  'menu:items.saveAs': 'file:save-as',
  'menu:items.print': 'file:print',
  'menu:items.exportPdf': 'file:export-pdf',
  'menu:items.combine': 'file:combine',
  'menu:items.compareFiles': 'tools:compare-files',
  'menu:items.properties': 'file:properties',
  'menu:items.settings': 'file:settings',
  // Edit menu
  'menu:items.undo': 'edit:undo',
  'menu:items.redo': 'edit:redo',
  'menu:items.rotateCw': 'pages:rotate-cw',
  'menu:items.deletePage': 'pages:delete',
  'menu:items.addLink': 'annotation:add-link',
  // Insert / Pages menu
  'menu:items.insertImage': 'pages:insert-image',
  'menu:items.blankPage': 'pages:insert-blank',
  'menu:items.watermark': 'pages:watermark',
  'menu:items.headerFooter': 'pages:header-footer',
  'menu:items.background': 'pages:background',
  // View menu
  'menu:items.toggleBookmarksEdit': 'bookmarks:edit-mode',
  // Tools menu — annotation tool mirrors
  'menu:items.toolHighlight': 'annotation:highlight',
  'menu:items.toolSticky': 'annotation:sticky',
  'menu:items.toolTextBox': 'annotation:text-box',
  'menu:items.toolUnderline': 'annotation:underline',
  'menu:items.toolStrikethrough': 'annotation:strikethrough',
  'menu:items.toolFreehand': 'annotation:freehand',
  // Forms cluster
  'menu:items.formDesigner': 'forms:designer',
  'menu:items.mailMerge': 'forms:mail-merge',
  'menu:items.fillAndSign': 'forms:fill-and-sign',
  // Redaction cluster
  'menu:items.redactMarkRect': 'annotation:redact',
  // OCR cluster
  'menu:items.runOcr': 'ocr:run',
  // Export-Office cluster (siblings of menu:items.exportWord — also in ALLOWLIST as preset entries)
  'menu:items.exportAsWord': 'file:export-office',
  'menu:items.exportAsExcel': 'file:export-office',
  'menu:items.exportAsPowerpoint': 'file:export-office',
  'menu:items.exportAsImage': 'file:export-office',
  // Sanitize
  'menu:items.sanitize': 'tools:sanitize',
  // Accessibility checker
  'menu:items.runAccessibilityCheck': 'tools:run-accessibility-check',
};

async function scanSurfaceFiles() {
  const surfaces = []; // [{ i18nKey, file, line }]
  for (const relFile of SURFACE_FILES) {
    const path = joinPath(REPO_ROOT, relFile);
    const content = await readFile(path, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      T_CALL_RE.lastIndex = 0;
      while ((m = T_CALL_RE.exec(line)) !== null) {
        if (!shouldSkip(m[1])) {
          surfaces.push({ i18nKey: m[1], file: relFile, line: i + 1 });
        }
      }
      KEY_LITERAL_RE.lastIndex = 0;
      while ((m = KEY_LITERAL_RE.exec(line)) !== null) {
        if (!shouldSkip(m[2])) {
          surfaces.push({ i18nKey: m[2], file: relFile, line: i + 1 });
        }
      }
    }
  }
  return surfaces;
}

// ----------------------------------------------------------------------------
// Coverage analysis.
// ----------------------------------------------------------------------------

function analyzeCoverage(registryKeys, registryToolIds, surfaces) {
  // Group surfaces by i18nKey for dedup reporting; remember first file:line.
  const surfacesByKey = new Map();
  for (const s of surfaces) {
    if (!surfacesByKey.has(s.i18nKey)) {
      surfacesByKey.set(s.i18nKey, []);
    }
    surfacesByKey.get(s.i18nKey).push(s);
  }

  const allowed = new Map();
  for (const a of ALLOWLIST) {
    allowed.set(a.i18nKey, a);
  }

  const gaps = [];
  const allowedHits = [];
  const mirroredHits = [];
  const registered = [];

  for (const [i18nKey, occs] of surfacesByKey) {
    if (registryKeys.has(i18nKey)) {
      registered.push({ i18nKey, occs });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(MENU_MIRROR_MAP, i18nKey)) {
      const targetId = MENU_MIRROR_MAP[i18nKey];
      if (registryToolIds.has(targetId)) {
        mirroredHits.push({ i18nKey, occs, targetId });
        continue;
      }
      // Mirror map points at a non-existent ToolDef id — this is a real
      // gap (likely a stale mirror entry left behind after a registry
      // refactor). Fall through to gap reporting.
    }
    if (allowed.has(i18nKey)) {
      allowedHits.push({ i18nKey, occs, entry: allowed.get(i18nKey) });
      continue;
    }
    gaps.push({ i18nKey, occs });
  }

  return { gaps, allowedHits, mirroredHits, registered, surfacesByKey, allowed };
}

// ----------------------------------------------------------------------------
// Stale-allowlist detection — flag allowlist entries that no surface uses
// any more (so reviewers prune dead exemptions).
// ----------------------------------------------------------------------------

function findStaleAllowlist(allowed, surfacesByKey) {
  const stale = [];
  for (const i18nKey of allowed.keys()) {
    if (!surfacesByKey.has(i18nKey)) {
      stale.push(i18nKey);
    }
  }
  return stale;
}

// ----------------------------------------------------------------------------
// Reporting.
// ----------------------------------------------------------------------------

function formatGap(gap) {
  const first = gap.occs[0];
  const suggested = `{
  id: '<TODO:choose-id>',
  nameKey: '${gap.i18nKey}',
  tooltipKey: '<TODO:tooltip-key>',
  ariaLabelKey: '${gap.i18nKey}',
  icon: null,
  shortcutId: null,
  menu: { top: '<TODO:file|edit|view|insertAndPages|comment|tools|help>' },
  surfaces: { menu: true, palette: true },
  enabledWhen: docOpen,
  dispatch: (d) => { /* TODO */ },
  searchKeywords: [/* TODO */],
}`;
  return `  ${first.file}:${first.line}  ${gap.i18nKey}  (${gap.occs.length} occurrence${gap.occs.length === 1 ? '' : 's'})\n${suggested
    .split('\n')
    .map((l) => '    ' + l)
    .join('\n')}`;
}

async function main() {
  let registryKeys, registryToolIds, surfaces;
  try {
    const reg = await readRegistry();
    registryKeys = reg.keys;
    registryToolIds = reg.toolIds;
    surfaces = await scanSurfaceFiles();
  } catch (e) {
    process.stderr.write(`[ratchet] script error: ${e.stack || e.message}\n`);
    process.exit(2);
  }

  const { gaps, allowedHits, mirroredHits, registered, surfacesByKey, allowed } = analyzeCoverage(
    registryKeys,
    registryToolIds,
    surfaces,
  );
  const stale = findStaleAllowlist(allowed, surfacesByKey);

  // Stale menu-mirror map detection — entries that no surface uses any more.
  const staleMirror = [];
  for (const k of Object.keys(MENU_MIRROR_MAP)) {
    if (!surfacesByKey.has(k)) staleMirror.push(k);
  }
  // Mirror-map entries that point at a non-existent ToolDef id.
  const brokenMirror = [];
  for (const [k, v] of Object.entries(MENU_MIRROR_MAP)) {
    if (!registryToolIds.has(v)) brokenMirror.push({ key: k, missingId: v });
  }

  process.stdout.write(
    `[ratchet] tool-registry coverage scan\n` +
      `[ratchet]   registry ToolDefs: ${registryToolIds.size} (with ${registryKeys.size} unique i18n keys across nameKey/tooltipKey/ariaLabelKey)\n` +
      `[ratchet]   user-facing surfaces scanned: ${surfaces.length} occurrences across ${surfacesByKey.size} unique i18n keys\n` +
      `[ratchet]   registered:       ${registered.length}\n` +
      `[ratchet]   menu-mirrored:    ${mirroredHits.length}\n` +
      `[ratchet]   allowed:          ${allowedHits.length}\n` +
      `[ratchet]   GAPS:             ${gaps.length}\n` +
      `[ratchet]   stale allowlist:  ${stale.length}\n` +
      `[ratchet]   stale mirror map: ${staleMirror.length}\n` +
      `[ratchet]   broken mirror map (points at missing ToolDef id): ${brokenMirror.length}\n\n`,
  );

  if (brokenMirror.length > 0) {
    process.stdout.write(`[ratchet] BROKEN MENU_MIRROR_MAP entries (target ToolDef id missing — fix or remove):\n`);
    for (const b of brokenMirror) {
      process.stdout.write(`  - ${b.key} -> ${b.missingId} (no such ToolDef id)\n`);
    }
    process.stdout.write('\n');
  }
  if (staleMirror.length > 0) {
    process.stdout.write(`[ratchet] stale MENU_MIRROR_MAP entries (no surface uses them — prune):\n`);
    for (const k of staleMirror) {
      process.stdout.write(`  - ${k}\n`);
    }
    process.stdout.write('\n');
  }

  if (stale.length > 0) {
    process.stdout.write(`[ratchet] stale allowlist entries (no surface uses them — prune from ALLOWLIST):\n`);
    for (const s of stale) {
      process.stdout.write(`  - ${s}\n`);
    }
    process.stdout.write('\n');
  }

  if (brokenMirror.length > 0) {
    process.stdout.write(
      `[ratchet] FAIL — MENU_MIRROR_MAP has broken entries (see above). Fix the mirror map or update the registry before this passes.\n`,
    );
    process.exit(1);
  }

  if (gaps.length === 0) {
    process.stdout.write(`[ratchet] OK — every user-facing surface is registered, menu-mirrored, or allowlisted.\n`);
    // Stale entries are a soft warning, not a hard fail; reviewers prune
    // them at next L-007 audit. (Promoting to hard fail would be churn.)
    process.exit(0);
  }

  process.stdout.write(`[ratchet] FAIL — ${gaps.length} unregistered surface(s) found:\n\n`);
  for (const gap of gaps) {
    process.stdout.write(formatGap(gap) + '\n\n');
  }
  process.stdout.write(
    `[ratchet] L-007 requires every new user-facing surface to be declared in src/client/tools/registry.ts.\n` +
      `[ratchet] If the surface is legitimately exempt (e.g. an intentionally inert affordance, an existing-ToolDef alias),\n` +
      `[ratchet] add an entry to ALLOWLIST in scripts/ratchet-tool-registry-coverage.mjs with a justifying reason.\n` +
      `[ratchet] Allowlist additions require principal approval per L-007 unlock procedure.\n`,
  );
  process.exit(1);
}

main();
