import { describe, expect, it } from 'vitest';

import { createMemoryDbBridge } from '../../main/db-bridge.js';
import type { SettingKey, SettingValue } from '../contracts.js';

import {
  handleSettingsGet,
  handleSettingsGetAll,
  handleSettingsSet,
  type SettingsDeps,
} from './settings.js';
import { expectErr, expectOk } from './test-support.js';

function makeDeps(): SettingsDeps {
  return { repo: createMemoryDbBridge().settings };
}

describe('settings:get / settings:set', () => {
  it('rejects unknown keys on get', () => {
    const res = handleSettingsGet(
      // any: deliberately testing an off-contract key
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { key: 'not-a-real-key' as any },
      makeDeps(),
    );
    expectErr(res, 'unknown_key');
  });

  it('rejects unknown keys on set', () => {
    const res = handleSettingsSet(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { key: 'bogus' as any, value: 1 as any },
      makeDeps(),
    );
    expectErr(res, 'unknown_key');
  });

  it('rejects wrong value type for known key', () => {
    const res = handleSettingsSet(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { key: 'export.defaultEngine', value: 'not-a-valid-engine' as any },
      makeDeps(),
    );
    expectErr(res, 'invalid_value');
  });

  it('round-trips a known key', () => {
    const deps = makeDeps();
    const setRes = handleSettingsSet<'export.defaultEngine'>(
      { key: 'export.defaultEngine', value: 'chromium' },
      deps,
    );
    expectOk(setRes);
    const getRes = expectOk(
      handleSettingsGet<'export.defaultEngine'>({ key: 'export.defaultEngine' }, deps),
    );
    expect(getRes.value).toBe('chromium');
  });

  it('returns null for unset key', () => {
    const value = expectOk(handleSettingsGet<'theme'>({ key: 'theme' }, makeDeps()));
    expect(value.value).toBeNull();
  });

  it('getAll returns all set entries', () => {
    const deps = makeDeps();
    handleSettingsSet<'theme'>({ key: 'theme', value: 'dark' }, deps);
    handleSettingsSet<'recents.maxItems'>({ key: 'recents.maxItems', value: 50 }, deps);
    const all = expectOk(handleSettingsGetAll({}, deps));
    const entries = all.entries as Partial<{
      [K in SettingKey]: SettingValue<K>;
    }>;
    expect(entries.theme).toBe('dark');
    expect(entries['recents.maxItems']).toBe(50);
  });
});
