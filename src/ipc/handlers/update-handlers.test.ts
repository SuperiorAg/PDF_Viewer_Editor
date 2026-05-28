// @vitest-environment node
//
// Phase 7 (Wave 28a, David) — update:check / download / install handler tests.
//
// These pin the zod BOUNDARY (invalid_payload) + the delegation to the
// injected controller. Controller-behavior depth is in src/main/auto-update.test.ts.

import { describe, expect, it } from 'vitest';

import type { AutoUpdateController } from '../../main/auto-update.js';
import type {
  UpdateCheckResponse,
  UpdateDownloadResponse,
  UpdateInstallResponse,
} from '../contracts.js';

import { handleUpdateCheck } from './update-check.js';
import { handleUpdateDownload } from './update-download.js';
import { handleUpdateInstall } from './update-install.js';

function makeController(overrides: Partial<AutoUpdateController> = {}): AutoUpdateController {
  return {
    checkForUpdates: async () =>
      ({
        ok: true,
        value: {
          status: 'up-to-date',
          availableVersion: null,
          currentVersion: '1.0.0',
          lastCheckedAt: 1,
        },
      }) as UpdateCheckResponse,
    downloadUpdate: async () =>
      ({ ok: true, value: { status: 'downloaded', version: '2.0.0' } }) as UpdateDownloadResponse,
    quitAndInstall: async () => ({ ok: true, value: { quitting: true } }) as UpdateInstallResponse,
    ...overrides,
  };
}

describe('handleUpdateCheck', () => {
  it('delegates a valid explicit trigger to the controller', async () => {
    const r = await handleUpdateCheck({ trigger: 'explicit' }, { controller: makeController() });
    expect(r.ok).toBe(true);
  });

  it('accepts trigger:launch', async () => {
    const r = await handleUpdateCheck({ trigger: 'launch' }, { controller: makeController() });
    expect(r.ok).toBe(true);
  });

  it('rejects an invalid trigger value (invalid_payload)', async () => {
    const r = await handleUpdateCheck({ trigger: 'auto' }, { controller: makeController() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects a missing trigger', async () => {
    const r = await handleUpdateCheck({}, { controller: makeController() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects extra properties (strict)', async () => {
    const r = await handleUpdateCheck(
      { trigger: 'explicit', sneaky: 1 },
      { controller: makeController() },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('passes through the controller error (update_not_configured)', async () => {
    const controller = makeController({
      checkForUpdates: async () =>
        ({
          ok: false,
          error: 'update_not_configured',
          message: 'placeholder',
        }) as UpdateCheckResponse,
    });
    const r = await handleUpdateCheck({ trigger: 'explicit' }, { controller });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('update_not_configured');
  });
});

describe('handleUpdateDownload', () => {
  it('delegates a valid version to the controller', async () => {
    const r = await handleUpdateDownload({ version: '2.0.0' }, { controller: makeController() });
    expect(r.ok).toBe(true);
  });

  it('rejects an empty version (invalid_payload)', async () => {
    const r = await handleUpdateDownload({ version: '' }, { controller: makeController() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects a missing version', async () => {
    const r = await handleUpdateDownload({}, { controller: makeController() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });
});

describe('handleUpdateInstall', () => {
  it('delegates a valid version to the controller', async () => {
    const r = await handleUpdateInstall({ version: '2.0.0' }, { controller: makeController() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.quitting).toBe(true);
  });

  it('rejects a missing version (invalid_payload)', async () => {
    const r = await handleUpdateInstall({}, { controller: makeController() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('passes through no_downloaded_update', async () => {
    const controller = makeController({
      quitAndInstall: async () =>
        ({ ok: false, error: 'no_downloaded_update', message: 'nothing' }) as UpdateInstallResponse,
    });
    const r = await handleUpdateInstall({ version: '2.0.0' }, { controller });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_downloaded_update');
  });

  it('accepts + forwards confirmedDiscardUnsaved to the controller (H-29.1)', async () => {
    let received: { version: string; confirmedDiscardUnsaved?: boolean } | null = null;
    const controller = makeController({
      quitAndInstall: async (req) => {
        received = req;
        return { ok: true, value: { quitting: true } } as UpdateInstallResponse;
      },
    });
    const r = await handleUpdateInstall(
      { version: '2.0.0', confirmedDiscardUnsaved: true },
      { controller },
    );
    expect(r.ok).toBe(true);
    expect(received).toEqual({ version: '2.0.0', confirmedDiscardUnsaved: true });
  });

  it('rejects a non-boolean confirmedDiscardUnsaved (invalid_payload)', async () => {
    const r = await handleUpdateInstall(
      { version: '2.0.0', confirmedDiscardUnsaved: 'yes' },
      { controller: makeController() },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('passes through unsaved_work_blocks_install (H-29.1)', async () => {
    const controller = makeController({
      quitAndInstall: async () =>
        ({
          ok: false,
          error: 'unsaved_work_blocks_install',
          message: 'unsaved',
        }) as UpdateInstallResponse,
    });
    const r = await handleUpdateInstall({ version: '2.0.0' }, { controller });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unsaved_work_blocks_install');
  });
});
