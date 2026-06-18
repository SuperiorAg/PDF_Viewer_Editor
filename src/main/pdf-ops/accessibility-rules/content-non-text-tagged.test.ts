// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { ruleContentNonTextTagged } from './content-non-text-tagged.js';
import { elem, fakeContext } from './test-helpers.js';

describe('rule a11y.content.non-text-tagged', () => {
  it('is unevaluated when no extractor was wired', async () => {
    const ctx = await fakeContext({ pageDiagnostics: null });
    const outcome = ruleContentNonTextTagged.check(ctx);
    expect(outcome.status).toBe('unevaluated');
  });

  it('passes when every image-bearing page also has a Figure tag', async () => {
    const ctx = await fakeContext({
      structElements: [elem({ type: 'Figure', pageIndex: 0 })],
      pageDiagnostics: [{ pageIndex: 0, textItemCount: 5, hasImageXObject: true }],
    });
    const outcome = ruleContentNonTextTagged.check(ctx);
    expect(outcome.status).toBe('pass');
  });

  it('fails on any image-bearing page lacking a Figure tag', async () => {
    const ctx = await fakeContext({
      structElements: [elem({ type: 'Figure', pageIndex: 0 })],
      pageDiagnostics: [
        { pageIndex: 0, textItemCount: 5, hasImageXObject: true },
        { pageIndex: 1, textItemCount: 0, hasImageXObject: true },
      ],
    });
    const outcome = ruleContentNonTextTagged.check(ctx);
    expect(outcome.status).toBe('fail');
    expect(outcome.locations.map((l) => l.pageIndex)).toEqual([1]);
    expect(outcome.quickFix?.kind).toBe('open-tag-editor');
  });
});
