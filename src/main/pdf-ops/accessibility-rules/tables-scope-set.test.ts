// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { ruleTablesScopeSet } from './tables-scope-set.js';
import { elem, fakeContext } from './test-helpers.js';

describe('rule a11y.tables.scope-set', () => {
  it('passes when no TH elements exist (rule trivially holds)', async () => {
    const ctx = await fakeContext({
      structElements: [elem({ type: 'Table' }), elem({ type: 'TD' })],
    });
    const outcome = ruleTablesScopeSet.check(ctx);
    expect(outcome.status).toBe('pass');
  });

  it('passes when every TH has /Scope', async () => {
    const ctx = await fakeContext({
      structElements: [
        elem({ type: 'TH', hasScopeAttribute: true }),
        elem({ type: 'TH', hasScopeAttribute: true }),
      ],
    });
    const outcome = ruleTablesScopeSet.check(ctx);
    expect(outcome.status).toBe('pass');
  });

  it('warns when any TH is missing /Scope', async () => {
    const ctx = await fakeContext({
      structElements: [
        elem({ type: 'TH', hasScopeAttribute: true }),
        elem({ type: 'TH', hasScopeAttribute: false, structNodeId: 'struct:7' }),
      ],
    });
    const outcome = ruleTablesScopeSet.check(ctx);
    expect(outcome.status).toBe('warn');
    expect(outcome.locations[0]!.structNodeId).toBe('struct:7');
    expect(outcome.quickFix?.kind).toBe('open-tag-editor');
  });
});
