// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { ruleColorContrastSpotSample } from './color-contrast-spot-sample.js';
import { fakeContext } from './test-helpers.js';

describe('rule a11y.appearance.color-contrast-spot-sample', () => {
  it('is permanently unevaluated under pure pdf-lib (honest by design)', async () => {
    const ctx = await fakeContext();
    const outcome = ruleColorContrastSpotSample.check(ctx);
    expect(outcome.status).toBe('unevaluated');
    expect(outcome.message).toBe('a11y.colorContrast.unevaluated.pdf-lib-cannot-rasterize');
    expect(outcome.quickFix).toBeUndefined();
  });
});
