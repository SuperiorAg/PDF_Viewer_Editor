// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { ruleScannedPagesSearchable } from './scanned-pages-searchable.js';
import { fakeContext } from './test-helpers.js';

describe('rule a11y.content.scanned-searchable', () => {
  it('is unevaluated when no extractor was wired', async () => {
    const ctx = await fakeContext({ pageDiagnostics: null });
    const outcome = ruleScannedPagesSearchable.check(ctx);
    expect(outcome.status).toBe('unevaluated');
  });

  it('passes when no image-only pages exist', async () => {
    const ctx = await fakeContext({
      pageDiagnostics: [
        { pageIndex: 0, textItemCount: 50, hasImageXObject: false },
        { pageIndex: 1, textItemCount: 100, hasImageXObject: true },
      ],
    });
    const outcome = ruleScannedPagesSearchable.check(ctx);
    expect(outcome.status).toBe('pass');
  });

  it('fails when a page has images but zero text glyphs', async () => {
    const ctx = await fakeContext({
      pageDiagnostics: [
        { pageIndex: 0, textItemCount: 0, hasImageXObject: true },
        { pageIndex: 1, textItemCount: 200, hasImageXObject: true },
      ],
    });
    const outcome = ruleScannedPagesSearchable.check(ctx);
    expect(outcome.status).toBe('fail');
    expect(outcome.locations.map((l) => l.pageIndex)).toEqual([0]);
    // Intentionally has no quickFix — OCR surface lives elsewhere.
    expect(outcome.quickFix).toBeUndefined();
  });
});
