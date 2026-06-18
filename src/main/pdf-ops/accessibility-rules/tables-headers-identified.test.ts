// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { ruleTablesHeadersIdentified } from './tables-headers-identified.js';
import { elem, fakeContext } from './test-helpers.js';

describe('rule a11y.tables.headers-identified', () => {
  it('passes (no tables) on a doc with no /Table elements', async () => {
    const ctx = await fakeContext({ structElements: [elem({ type: 'P' })] });
    const outcome = ruleTablesHeadersIdentified.check(ctx);
    expect(outcome.status).toBe('pass');
  });

  it('passes when at least one TH exists anywhere alongside tables', async () => {
    const ctx = await fakeContext({
      structElements: [
        elem({ type: 'Table' }),
        elem({ type: 'TR' }),
        elem({ type: 'TH' }),
        elem({ type: 'TD' }),
      ],
    });
    const outcome = ruleTablesHeadersIdentified.check(ctx);
    expect(outcome.status).toBe('pass');
  });

  it('fails when tables exist but no TH anywhere', async () => {
    const ctx = await fakeContext({
      structElements: [
        elem({ type: 'Table', structNodeId: 'struct:5' }),
        elem({ type: 'TR' }),
        elem({ type: 'TD' }),
      ],
    });
    const outcome = ruleTablesHeadersIdentified.check(ctx);
    expect(outcome.status).toBe('fail');
    expect(outcome.locations[0]!.structNodeId).toBe('struct:5');
    expect(outcome.quickFix?.kind).toBe('open-tag-editor');
  });
});
