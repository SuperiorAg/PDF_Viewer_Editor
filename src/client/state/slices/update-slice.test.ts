// update-slice tests — the nullable + late-init discipline + the HONEST
// not-configured placeholder state (architecture-phase-7.md §3.3, P7-L-2).

import { describe, expect, it } from 'vitest';

import reducer, {
  setUpdateChannel,
  updateCheckStarted,
  updateCheckSucceeded,
  updateNotConfigured,
  updateCheckFailed,
  updateDownloadProgress,
  updateDownloaded,
} from './update-slice';

const initial = reducer(undefined, { type: '@@INIT' });

describe('update-slice — defaults (nullable, no sentinels)', () => {
  it('defaults to manual channel, idle status, all nullable fields null', () => {
    expect(initial.channel).toBe('manual');
    expect(initial.status).toBe('idle');
    expect(initial.availableVersion).toBeNull();
    expect(initial.lastCheckedAt).toBeNull(); // NOT 0
    expect(initial.downloadProgressPercent).toBeNull();
    expect(initial.errorCode).toBeNull();
  });
});

describe('update-slice — check flow', () => {
  it('updateCheckStarted sets checking + clears error', () => {
    const s = reducer({ ...initial, errorCode: 'network_failed' }, updateCheckStarted());
    expect(s.status).toBe('checking');
    expect(s.errorCode).toBeNull();
  });

  it('updateNotConfigured routes to the HONEST placeholder state (not up-to-date)', () => {
    const s = reducer(initial, updateNotConfigured());
    expect(s.status).toBe('not-configured');
    expect(s.status).not.toBe('up-to-date'); // never a fake "up to date"
    expect(s.availableVersion).toBeNull();
  });

  it('updateCheckSucceeded carries the value through (available version + lastChecked)', () => {
    const s = reducer(
      initial,
      updateCheckSucceeded({
        status: 'available',
        availableVersion: '1.0.1',
        currentVersion: '1.0.0',
        lastCheckedAt: 1716900000000,
      }),
    );
    expect(s.status).toBe('available');
    expect(s.availableVersion).toBe('1.0.1');
    expect(s.lastCheckedAt).toBe(1716900000000);
  });

  it('updateCheckFailed records the error code', () => {
    const s = reducer(initial, updateCheckFailed('network_failed'));
    expect(s.status).toBe('error');
    expect(s.errorCode).toBe('network_failed');
  });
});

describe('update-slice — download flow', () => {
  it('progress sets downloading + percent; downloaded clears percent', () => {
    let s = reducer(initial, updateDownloadProgress(42));
    expect(s.status).toBe('downloading');
    expect(s.downloadProgressPercent).toBe(42);
    s = reducer(s, updateDownloaded());
    expect(s.status).toBe('downloaded');
    expect(s.downloadProgressPercent).toBeNull();
  });
});

describe('update-slice — channel', () => {
  it('setUpdateChannel switches the channel', () => {
    const s = reducer(initial, setUpdateChannel('check-on-launch'));
    expect(s.channel).toBe('check-on-launch');
  });
});
