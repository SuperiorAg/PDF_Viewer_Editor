// Handlers: settings:get, settings:set, settings:getAll
//
// All three are grouped in a single file (they share validation helpers and
// stay well below the 200-line modularization rule). Settings repo is injected.

import { fail, ok } from '../../shared/result.js';
import type {
  SettingKey,
  SettingValue,
  SettingsGetAllError,
  SettingsGetAllRequest,
  SettingsGetAllResponse,
  SettingsGetError,
  SettingsGetRequest,
  SettingsGetResponse,
  SettingsSetError,
  SettingsSetRequest,
  SettingsSetResponse,
} from '../contracts.js';

const KNOWN_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>([
  'recents.maxItems',
  'open.maxFileSizeMB',
  'export.defaultEngine',
  'export.showWarningsToast',
  'file_association.pdf.requested',
  'theme',
  'undo.maxHistory',
  // Phase 7 (Wave 28a, David — api-contracts.md §18, data-models.md §12.3).
  // Telemetry opt-in, selected locale, update channel + last-check timestamp.
  'telemetry.optIn',
  'i18n.locale',
  'update.channel',
  'update.lastCheckedAt',
]);

function isKnownKey(k: unknown): k is SettingKey {
  return typeof k === 'string' && KNOWN_KEYS.has(k as SettingKey);
}

function isValidValueFor<K extends SettingKey>(key: K, value: unknown): boolean {
  switch (key) {
    case 'recents.maxItems':
    case 'open.maxFileSizeMB':
    case 'undo.maxHistory':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    case 'export.defaultEngine':
      return value === 'auto' || value === 'pdf-lib' || value === 'chromium';
    case 'export.showWarningsToast':
    case 'file_association.pdf.requested':
      return typeof value === 'boolean';
    case 'theme':
      return value === 'system' || value === 'light' || value === 'dark';
    // Phase 7 (Wave 28a, David — data-models.md §12.8 validation matrix).
    case 'telemetry.optIn':
      return typeof value === 'boolean';
    case 'i18n.locale':
      // One of supportedLngs; reject others (api-contracts.md §18.10).
      return value === 'en-US' || value === 'es-ES';
    case 'update.channel':
      return value === 'manual' || value === 'check-on-launch';
    case 'update.lastCheckedAt':
      // null OR a >= 0 ms epoch; NEVER a sentinel 0 for "never" (use null).
      return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
    default:
      return false;
  }
}

export interface SettingsRepoLike {
  get<K extends SettingKey>(key: K): SettingValue<K> | null;
  set<K extends SettingKey>(key: K, value: SettingValue<K>): void;
  getAll(): Partial<{ [K in SettingKey]: SettingValue<K> }>;
}

export interface SettingsDeps {
  repo: SettingsRepoLike;
}

export function handleSettingsGet<K extends SettingKey>(
  req: SettingsGetRequest<K>,
  deps: SettingsDeps,
): SettingsGetResponse<K> {
  if (!isKnownKey(req.key)) {
    return fail<SettingsGetError>('unknown_key', `unknown setting key: ${String(req.key)}`);
  }
  try {
    const value = deps.repo.get<K>(req.key);
    return ok({ value });
  } catch (e) {
    return fail<SettingsGetError>('db_unavailable', (e as Error).message);
  }
}

export function handleSettingsSet<K extends SettingKey>(
  req: SettingsSetRequest<K>,
  deps: SettingsDeps,
): SettingsSetResponse {
  if (!isKnownKey(req.key)) {
    return fail<SettingsSetError>('unknown_key', `unknown setting key: ${String(req.key)}`);
  }
  if (!isValidValueFor(req.key, req.value)) {
    return fail<SettingsSetError>('invalid_value', `value rejected for key ${String(req.key)}`);
  }
  try {
    deps.repo.set<K>(req.key, req.value);
    return ok({});
  } catch (e) {
    return fail<SettingsSetError>('db_unavailable', (e as Error).message);
  }
}

export function handleSettingsGetAll(
  _req: SettingsGetAllRequest,
  deps: SettingsDeps,
): SettingsGetAllResponse {
  try {
    const entries = deps.repo.getAll();
    return ok({ entries });
  } catch (e) {
    return fail<SettingsGetAllError>('db_unavailable', (e as Error).message);
  }
}
