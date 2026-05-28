// Handlers: annotations:setMeasureCalibration + annotations:getMeasureCalibration
// (Phase 4, api-contracts.md §14.9)

import { z } from 'zod';

import {
  getCalibration,
  setCalibration,
} from '../../main/pdf-ops/annotations/measure-calibration-store.js';
import { fail, ok } from '../../shared/result.js';
import type {
  AnnotationsGetMeasureCalibrationError,
  AnnotationsGetMeasureCalibrationRequest,
  AnnotationsGetMeasureCalibrationResponse,
  AnnotationsSetMeasureCalibrationError,
  AnnotationsSetMeasureCalibrationRequest,
  AnnotationsSetMeasureCalibrationResponse,
  DocumentHandle,
} from '../contracts.js';

const measureSchema = z.object({
  unit: z.union([
    z.literal('inch'),
    z.literal('cm'),
    z.literal('mm'),
    z.literal('pt'),
    z.literal('px'),
    z.literal('custom'),
  ]),
  customUnitLabel: z.string().max(16).optional(),
  scale: z.number().positive(),
});

export interface MeasureCalibrationDeps {
  /** Optional handle-presence check; returns null when handle missing. */
  hasHandle?(h: DocumentHandle): boolean;
}

export async function handleAnnotationsSetMeasureCalibration(
  req: AnnotationsSetMeasureCalibrationRequest,
  deps: MeasureCalibrationDeps,
): Promise<AnnotationsSetMeasureCalibrationResponse> {
  if (typeof req.handle !== 'number') {
    return fail<AnnotationsSetMeasureCalibrationError>('invalid_payload', 'handle must be number');
  }
  const parsed = measureSchema.safeParse(req.calibration);
  if (!parsed.success) {
    return fail<AnnotationsSetMeasureCalibrationError>('invalid_payload', parsed.error.message);
  }
  if (deps.hasHandle && !deps.hasHandle(req.handle)) {
    return fail<AnnotationsSetMeasureCalibrationError>(
      'handle_not_found',
      `handle ${req.handle} not found`,
    );
  }
  // Conditional spread for exactOptionalPropertyTypes — zod gives us
  // `customUnitLabel?: string | undefined` but the MeasureCalibration type
  // forbids the explicit `undefined`.
  setCalibration(req.handle, {
    unit: parsed.data.unit,
    scale: parsed.data.scale,
    ...(parsed.data.customUnitLabel !== undefined
      ? { customUnitLabel: parsed.data.customUnitLabel }
      : {}),
  });
  return ok({});
}

export async function handleAnnotationsGetMeasureCalibration(
  req: AnnotationsGetMeasureCalibrationRequest,
  deps: MeasureCalibrationDeps,
): Promise<AnnotationsGetMeasureCalibrationResponse> {
  if (typeof req.handle !== 'number') {
    return fail<AnnotationsGetMeasureCalibrationError>('handle_not_found', 'handle must be number');
  }
  if (deps.hasHandle && !deps.hasHandle(req.handle)) {
    return fail<AnnotationsGetMeasureCalibrationError>(
      'handle_not_found',
      `handle ${req.handle} not found`,
    );
  }
  return ok({ calibration: getCalibration(req.handle) });
}
