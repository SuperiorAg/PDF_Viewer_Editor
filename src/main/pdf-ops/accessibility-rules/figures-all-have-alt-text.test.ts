// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { ruleFiguresAllHaveAltText } from './figures-all-have-alt-text.js';
import { elem, fakeContext } from './test-helpers.js';

describe('rule a11y.figures.all-have-alt-text', () => {
  it('passes (no figures) on a doc with no /Figure elements', async () => {
    const ctx = await fakeContext({ structElements: [elem({ type: 'P' })] });
    const outcome = ruleFiguresAllHaveAltText.check(ctx);
    expect(outcome.status).toBe('pass');
  });

  it('passes when every figure has /Alt (including empty = decorative)', async () => {
    const ctx = await fakeContext({
      structElements: [
        elem({ type: 'Figure', hasAltKey: true, hasNonEmptyAlt: true, altValue: 'A cat' }),
        elem({ type: 'Figure', hasAltKey: true, hasNonEmptyAlt: false, altValue: '' }),
      ],
    });
    const outcome = ruleFiguresAllHaveAltText.check(ctx);
    expect(outcome.status).toBe('pass');
  });

  it('fails when any figure has no /Alt key', async () => {
    const ctx = await fakeContext({
      structElements: [
        elem({ type: 'Figure', hasAltKey: true, hasNonEmptyAlt: true, altValue: 'A cat' }),
        elem({ type: 'Figure', hasAltKey: false, structNodeId: 'struct:42' }),
      ],
    });
    const outcome = ruleFiguresAllHaveAltText.check(ctx);
    expect(outcome.status).toBe('fail');
    expect(outcome.locations).toHaveLength(1);
    expect(outcome.locations[0]!.structNodeId).toBe('struct:42');
    expect(outcome.quickFix?.kind).toBe('open-alt-text-inspector');
  });
});
