// es-ES proof-locale coverage measurement + the no-raw-key guarantee across the
// ENTIRE en-US key surface (i18n-strategy.md §4, trust-floor obligation #4).
//
// The proof locale is intentionally PARTIAL (a sample, not complete). This test
// (a) computes coverage so the build-report figure is grounded in fact, and
// (b) proves that EVERY en-US key — translated or not — resolves to a real
// string in es-ES via fallback (never a raw `ns:key`). That is the structural
// guarantee that the half-extracted-mix problem cannot surface raw keys.

import { describe, expect, it } from 'vitest';

import { NAMESPACES, type Namespace } from './locales-meta';
import { resolveKey, _bundlesForTest } from './resolve';

type Tree = Record<string, unknown>;

/** Flatten a namespace tree to dotted leaf-key paths (strings only). */
function leafKeys(tree: Tree, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push(path);
    else if (v && typeof v === 'object') out.push(...leafKeys(v as Tree, path));
  }
  return out;
}

describe('es-ES proof locale — coverage + fallback completeness', () => {
  it('every en-US key resolves to a non-raw string in es-ES (fallback guarantee)', () => {
    for (const ns of NAMESPACES) {
      const keys = leafKeys(_bundlesForTest['en-US'][ns] as Tree);
      for (const path of keys) {
        // Strip plural suffix for the resolve call (resolveKey adds it back).
        const base = path.replace(/_(one|other)$/, '');
        const full = `${ns}:${base}`;
        const opts = /_(one|other)$/.test(path) ? { count: 2 } : undefined;
        const resolved = resolveKey('es-ES', full, opts);
        expect(resolved).not.toBe(base); // never the raw key path
        expect(resolved.length).toBeGreaterThan(0);
      }
    }
  });

  it('reports a meaningful es-ES coverage percentage (sample, not complete)', () => {
    let total = 0;
    let translated = 0;
    for (const ns of NAMESPACES) {
      const en = _bundlesForTest['en-US'][ns] as Tree;
      const es = _bundlesForTest['es-ES'][ns] as Tree;
      const enKeys = new Set(leafKeys(en));
      const esKeys = new Set(leafKeys(es));
      total += enKeys.size;
      for (const k of enKeys) if (esKeys.has(k)) translated += 1;
    }
    const pct = Math.round((translated / total) * 100);
    // The proof locale is a SAMPLE: it covers the high-traffic surface but is
    // deliberately incomplete. Assert it is substantial but not claimed-complete.
    expect(total).toBeGreaterThan(0);
    expect(pct).toBeGreaterThanOrEqual(40);
    expect(pct).toBeLessThan(100);
    // Surface the figure for the build-report (visible in vitest output).
    // eslint-disable-next-line no-console
    console.info(`[i18n] es-ES coverage: ${translated}/${total} keys = ${pct}%`);
  });
});

describe('en-US key count — order-of-magnitude check vs the ~890 estimate', () => {
  it('the baseline carries a substantial extracted-string count', () => {
    type Tree2 = Record<string, unknown>;
    const count = (tree: Tree2): number =>
      Object.values(tree).reduce<number>(
        (n, v) =>
          typeof v === 'string' ? n + 1 : v && typeof v === 'object' ? n + count(v as Tree2) : n,
        0,
      );
    let total = 0;
    for (const ns of NAMESPACES) total += count(_bundlesForTest['en-US'][ns as Namespace] as Tree2);
    // eslint-disable-next-line no-console
    console.info(`[i18n] en-US baseline key count: ${total}`);
    expect(total).toBeGreaterThan(250);
  });
});
