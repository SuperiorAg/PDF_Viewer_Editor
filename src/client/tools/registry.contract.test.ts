// Tool registry contract tests — the four enforcement tests from
// docs/acrobat-parity-audit.md §5.3 / docs/tool-registry-spec.md §3.
// Phase 7.5 R2 (Riley).
//
// These tests are the "well-marked" definition's CI mechanism. The L-007 lock
// in Wave 11 makes failing this suite a hard block; Phase 7.5 Wave 2 already
// runs it on every PR through the standard vitest gate.

import { describe, expect, test } from 'vitest';

import { resolveKey, hasBaselineKey } from '../i18n/resolve';
// Wave 5d follow-up (Riley): `formatShortcut` was previously a local
// helper here; promoted to a named export in `shortcuts.ts` so the
// palette + menu-bar mirrors render the same string the contract test
// asserts against.
import { formatShortcut, formatShortcutById, SHORTCUTS } from '../shortcuts';

import { INTRINSIC_SHORTCUTS, TOOLS } from './registry';

// ---------------------------------------------------------------------------
// (1) Every tool in registry has all 7 marking dimensions resolvable.
// ---------------------------------------------------------------------------

describe('tool registry — contract tests', () => {
  test('every tool is well marked', () => {
    for (const tool of TOOLS) {
      // Phase 7.5 dim 1+2+3 — three i18n keys must exist.
      expect(tool.nameKey, `${tool.id} nameKey`).toBeTruthy();
      expect(tool.tooltipKey, `${tool.id} tooltipKey`).toBeTruthy();
      expect(tool.ariaLabelKey, `${tool.id} ariaLabelKey`).toBeTruthy();

      // dim 4 — every tool reachable from a menu (top-level required).
      expect(tool.menu, `${tool.id} menu`).toBeTruthy();
      expect(tool.menu.top, `${tool.id} menu.top`).toBeTruthy();

      // dim 1 (icon) OR menu-only — at least one surface must render the tool.
      expect(
        tool.icon !== null || tool.surfaces.menu === true,
        `${tool.id} must have either an icon or a menu surface`,
      ).toBe(true);

      // dim 5 — i18n keys resolve in both en-US and es-ES (fallback OK).
      for (const locale of ['en-US', 'es-ES'] as const) {
        for (const key of [tool.nameKey, tool.tooltipKey, tool.ariaLabelKey]) {
          const resolved = resolveKey(locale, key);
          // The resolver returns the bare key path if a key is missing in BOTH
          // the active locale AND en-US. The path is the substring after ':'.
          // For es-ES we accept either the es-ES translation or the en-US
          // fallback (per i18n-strategy.md §4 fallback rule).
          const pathOnly = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
          expect(
            resolved !== pathOnly,
            `${tool.id}: i18n key ${key} did not resolve in ${locale} (got "${resolved}")`,
          ).toBe(true);
        }
        // Stronger: the key must exist as a baseline (en-US) entry.
        expect(
          hasBaselineKey(tool.nameKey),
          `${tool.id} nameKey ${tool.nameKey} missing from en-US baseline`,
        ).toBe(true);
      }

      // dim 7 — palette discoverability requires non-empty searchKeywords.
      expect(
        tool.searchKeywords.length,
        `${tool.id} must have at least one searchKeyword`,
      ).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // (2) Every tool with a shortcut has the shortcut shown in its tooltip.
  // -------------------------------------------------------------------------

  test('tooltips advertise their shortcut', () => {
    // The spec (audit §5.1 rule 2) calls out tooltips for VISUAL surfaces —
    // toolbar buttons and palette entries whose tooltip is the only hint of
    // the keyboard chord. Menu-only tools (`surfaces.toolbar === undefined`)
    // surface their shortcut via the menu's dedicated shortcut column, so
    // duplicating it in the tooltip would be ergonomically noisy. Test 2
    // therefore requires the shortcut in the tooltip ONLY for tools that
    // actually appear on the toolbar.
    for (const tool of TOOLS) {
      if (tool.shortcutId === null) continue;
      if (tool.surfaces.toolbar === undefined) continue; // menu-only is OK
      const sc = SHORTCUTS.find((s) => s.id === tool.shortcutId);
      expect(sc, `${tool.id} references unknown shortcut ${tool.shortcutId}`).toBeDefined();
      if (!sc) continue;
      const tooltipEn = resolveKey('en-US', tool.tooltipKey);
      const shortcutText = formatShortcut(sc);
      expect(
        tooltipEn.includes(shortcutText),
        `${tool.id}: en-US tooltip "${tooltipEn}" must include shortcut "${shortcutText}"`,
      ).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // (3) Every shortcut surfaces as a ToolDef OR is in INTRINSIC_SHORTCUTS.
  // -------------------------------------------------------------------------

  test('every shortcut surfaces in the registry (or is intrinsic)', () => {
    const referenced = new Set(TOOLS.map((t) => t.shortcutId).filter((id) => id !== null));
    const orphans = SHORTCUTS.filter(
      (s) => !referenced.has(s.id) && !INTRINSIC_SHORTCUTS.has(s.id),
    );
    expect(
      orphans.map((s) => s.id),
      'every shortcut must either be a ToolDef.shortcutId or in INTRINSIC_SHORTCUTS',
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // (4) No stale "Coming in Phase N" tooltips for shipped phases.
  // -------------------------------------------------------------------------

  // WHEN A PHASE SHIPS: add its number here. Otherwise a stale "Coming in
  // Phase N" tooltip won't get flagged. (Update reviewed by Julian at every
  // packaging wave.)
  const SHIPPED_PHASES = [1, 2, 3, 4, 5, 6, 7, 7.1, 7.2, 7.4, 7.5];

  test('no stale "Coming in Phase N" tooltips', () => {
    const stalePattern = /Coming in Phase ([\d.]+)/i;
    const stale = TOOLS.filter((t) => {
      const tipEn = resolveKey('en-US', t.tooltipKey);
      const m = stalePattern.exec(tipEn);
      return m !== null && SHIPPED_PHASES.includes(Number(m[1]));
    });
    expect(
      stale.map((t) => t.id),
      'no tool tooltip may say "Coming in Phase N" for a shipped phase',
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // (5) Wave 5d follow-up (Riley) — chord-resolution at render time.
  //
  // The palette and the menu mirrors render the keyboard chord text via
  // `formatShortcutById(tool.shortcutId)`. The contract test fixes the
  // canonical format for any tool with a shortcut so the chord that
  // appears in the UI cannot drift from the chord the global handler
  // actually fires on. Specifically pins `tools:run-accessibility-check`
  // at `Ctrl+Shift+A` because that exact string is the C6 discoverability
  // ask — but the test scans every menu-only tool with a shortcut for
  // symmetry, so adding a new accel-bound menu tool gets the same
  // protection automatically.
  // -------------------------------------------------------------------------

  test('formatShortcutById resolves Ctrl+Shift+A for tools:run-accessibility-check', () => {
    const chord = formatShortcutById('tools-a11y-check');
    expect(chord).toBe('Ctrl+Shift+A');
  });

  test('every tool with a shortcutId resolves to a non-empty chord string', () => {
    for (const tool of TOOLS) {
      if (tool.shortcutId === null) continue;
      const chord = formatShortcutById(tool.shortcutId);
      expect(
        chord,
        `${tool.id}: shortcutId ${tool.shortcutId} did not resolve via formatShortcutById`,
      ).not.toBeNull();
      expect(
        chord!.length,
        `${tool.id}: chord text is empty for shortcutId ${tool.shortcutId}`,
      ).toBeGreaterThan(0);
    }
  });
});
