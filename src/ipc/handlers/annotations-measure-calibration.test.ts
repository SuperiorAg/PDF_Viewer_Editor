// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { clearAllCalibrations } from '../../main/pdf-ops/annotations/measure-calibration-store.js';

import {
  handleAnnotationsGetMeasureCalibration,
  handleAnnotationsSetMeasureCalibration,
} from './annotations-measure-calibration.js';

const deps = { hasHandle: (h: number) => h === 7 };

afterEach(() => {
  clearAllCalibrations();
});

describe('annotations:setMeasureCalibration + getMeasureCalibration', () => {
  it('round-trip: set then get', async () => {
    const set = await handleAnnotationsSetMeasureCalibration(
      { handle: 7, calibration: { unit: 'inch', scale: 1.5 } },
      deps,
    );
    expect(set.ok).toBe(true);
    const get = await handleAnnotationsGetMeasureCalibration({ handle: 7 }, deps);
    expect(get.ok).toBe(true);
    if (get.ok) {
      expect(get.value.calibration).toEqual({ unit: 'inch', scale: 1.5 });
    }
  });

  it('get on missing handle returns handle_not_found', async () => {
    const r = await handleAnnotationsGetMeasureCalibration({ handle: 999 }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('handle_not_found');
  });

  it('get on uncalibrated doc returns null', async () => {
    const r = await handleAnnotationsGetMeasureCalibration({ handle: 7 }, deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.calibration).toBeNull();
  });

  it('rejects invalid calibration (zero scale)', async () => {
    const r = await handleAnnotationsSetMeasureCalibration(
      { handle: 7, calibration: { unit: 'cm', scale: 0 } },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });

  it('rejects custom unit without label is ALLOWED (label optional in schema)', async () => {
    // Per data-models §9.8 customUnitLabel is optional; the calibration is
    // accepted; downstream rendering supplies a fallback label.
    const r = await handleAnnotationsSetMeasureCalibration(
      { handle: 7, calibration: { unit: 'custom', scale: 1 } },
      deps,
    );
    expect(r.ok).toBe(true);
  });
});
