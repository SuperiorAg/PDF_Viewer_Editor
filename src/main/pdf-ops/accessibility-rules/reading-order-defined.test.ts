// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { ruleReadingOrderDefined } from './reading-order-defined.js';
import { elem, fakeContext } from './test-helpers.js';

describe('rule a11y.reading.order-defined', () => {
  it('passes when a non-empty struct tree exists', async () => {
    const ctx = await fakeContext({
      structElements: [elem({ type: 'H1' }), elem({ type: 'P' })],
    });
    const outcome = ruleReadingOrderDefined.check(ctx);
    expect(outcome.status).toBe('pass');
    expect(outcome.quickFix?.kind).toBe('open-reading-order');
  });

  it('is unevaluated when no struct tree exists (avoids double-failing)', async () => {
    const ctx = await fakeContext({ structElements: [] });
    const outcome = ruleReadingOrderDefined.check(ctx);
    expect(outcome.status).toBe('unevaluated');
  });
});
