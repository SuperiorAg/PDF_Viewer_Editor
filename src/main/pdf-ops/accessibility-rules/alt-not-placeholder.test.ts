// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { ruleAltNotPlaceholder } from './alt-not-placeholder.js';
import { elem, fakeContext } from './test-helpers.js';

describe('rule a11y.figures.alt-not-placeholder', () => {
  it('passes when no figures exist', async () => {
    const ctx = await fakeContext({ structElements: [elem({ type: 'P' })] });
    const outcome = ruleAltNotPlaceholder.check(ctx);
    expect(outcome.status).toBe('pass');
  });

  it('passes when all alt texts are real prose', async () => {
    const ctx = await fakeContext({
      structElements: [
        elem({
          type: 'Figure',
          hasAltKey: true,
          hasNonEmptyAlt: true,
          altValue: 'A red barn at dusk',
        }),
        elem({
          type: 'Figure',
          hasAltKey: true,
          hasNonEmptyAlt: true,
          altValue: 'Pie chart of Q1 sales',
        }),
      ],
    });
    const outcome = ruleAltNotPlaceholder.check(ctx);
    expect(outcome.status).toBe('pass');
  });

  it('warns when an alt text looks like a placeholder', async () => {
    const ctx = await fakeContext({
      structElements: [
        elem({ type: 'Figure', hasAltKey: true, hasNonEmptyAlt: true, altValue: 'image1' }),
        elem({ type: 'Figure', hasAltKey: true, hasNonEmptyAlt: true, altValue: 'photo.jpg' }),
      ],
    });
    const outcome = ruleAltNotPlaceholder.check(ctx);
    expect(outcome.status).toBe('warn');
    expect(outcome.locations.length).toBeGreaterThan(0);
    expect(outcome.quickFix?.kind).toBe('open-alt-text-inspector');
  });

  it('treats empty-string alt as decorative (not a placeholder)', async () => {
    const ctx = await fakeContext({
      structElements: [
        elem({ type: 'Figure', hasAltKey: true, hasNonEmptyAlt: false, altValue: '' }),
      ],
    });
    const outcome = ruleAltNotPlaceholder.check(ctx);
    expect(outcome.status).toBe('pass');
  });
});
