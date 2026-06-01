// Handler: forms:designAdd (Phase 3, api-contracts.md §13.4)
//
// Returns a `form-design-add` EditOperation carrying a validated +
// rect-clamped FormFieldDefinition. The renderer dispatches applyEdit(op);
// the replay engine's step 3.6 calls form-engine.createField at save time.

import { randomUUID } from 'node:crypto';

import { PDFDocument } from 'pdf-lib';

import { detectForms } from '../../main/pdf-ops/form-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  EditOperation,
  EditOperationSerialized,
  FormFieldDefinition,
  FormsDesignAddError,
  FormsDesignAddRequest,
  FormsDesignAddResponse,
} from '../contracts.js';

export interface FormsDesignAddDeps {
  getBytes(handle: DocumentHandle): Uint8Array | null;
}

const VALID_TYPES = new Set(['text', 'checkbox', 'radio', 'dropdown', 'signature', 'date']);

export async function handleFormsDesignAdd(
  req: FormsDesignAddRequest,
  deps: FormsDesignAddDeps,
): Promise<FormsDesignAddResponse> {
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<FormsDesignAddError>('invalid_payload', 'handle must be an integer');
  }
  const fd = req.fieldDefinition;
  if (!fd || typeof fd !== 'object') {
    return fail<FormsDesignAddError>('invalid_payload', 'fieldDefinition required');
  }
  if (typeof fd.name !== 'string' || fd.name.length === 0 || fd.name.length > 63) {
    return fail<FormsDesignAddError>('invalid_field_definition', 'name must be 1..63 chars');
  }
  if (fd.name.includes('.')) {
    return fail<FormsDesignAddError>(
      'invalid_field_definition',
      "name must not contain '.' (Phase 3)",
    );
  }
  if (!VALID_TYPES.has(fd.type)) {
    return fail<FormsDesignAddError>('unsupported_field_type', `type '${fd.type}' not supported`);
  }
  if (
    !fd.rect ||
    !Number.isFinite(fd.rect.x) ||
    !Number.isFinite(fd.rect.y) ||
    !Number.isFinite(fd.rect.width) ||
    !Number.isFinite(fd.rect.height) ||
    fd.rect.width <= 0 ||
    fd.rect.height <= 0
  ) {
    return fail<FormsDesignAddError>('invalid_field_definition', 'rect invalid');
  }
  if (fd.type === 'radio' || fd.type === 'dropdown') {
    if (!Array.isArray(fd.options) || fd.options.length === 0) {
      return fail<FormsDesignAddError>(
        'invalid_field_definition',
        `${fd.type} requires non-empty options`,
      );
    }
  }

  const bytes = deps.getBytes(req.handle);
  if (!bytes) {
    return fail<FormsDesignAddError>('handle_not_found', `handle ${req.handle} not found`);
  }

  // Page-bounds + duplicate-name checks: parse the doc to get pageCount + walk fields.
  let pageCount = 0;
  let pageW = 0;
  let pageH = 0;
  try {
    const doc = await PDFDocument.load(bytes);
    pageCount = doc.getPageCount();
    if (fd.pageIndex < 0 || !Number.isInteger(fd.pageIndex) || fd.pageIndex >= pageCount) {
      return fail<FormsDesignAddError>(
        'page_out_of_range',
        `pageIndex ${fd.pageIndex} of ${pageCount}`,
      );
    }
    const page = doc.getPage(fd.pageIndex);
    pageW = page.getWidth();
    pageH = page.getHeight();
  } catch (e) {
    return fail<FormsDesignAddError>(
      'invalid_payload',
      safeMessage(e, 'Unable to load the document'),
    );
  }

  // Detect existing fields to enforce uniqueness
  const det = await detectForms(bytes);
  if (det.ok && det.value.fields.some((f) => f.name === fd.name)) {
    return fail<FormsDesignAddError>(
      'duplicate_field_name',
      `field name '${fd.name}' already exists`,
      { fieldName: fd.name },
    );
  }

  // Rect-clamp (api-contracts §13.14)
  const warnings: string[] = [];
  const clamped = clampRectToPage(fd.rect, pageW, pageH);
  if (clamped.changed) {
    warnings.push(`rect clamped to page bounds (${pageW.toFixed(0)}x${pageH.toFixed(0)})`);
  }

  const normalized: FormFieldDefinition = {
    ...fd,
    rect: clamped.rect,
    label: fd.label && fd.label.length > 0 ? fd.label : fd.name,
    origin: 'authored',
    unsaved: true,
  };

  const op: EditOperation = {
    kind: 'form-design-add',
    meta: { ts: Date.now(), undoable: true, operationId: randomUUID() },
    fieldDefinition: normalized,
  };
  return ok({
    op: op as EditOperationSerialized,
    normalizedFieldDefinition: normalized,
    warnings,
  });
}

function clampRectToPage(
  r: { x: number; y: number; width: number; height: number },
  pageW: number,
  pageH: number,
): {
  rect: { x: number; y: number; width: number; height: number };
  changed: boolean;
} {
  if (pageW <= 0 || pageH <= 0) return { rect: r, changed: false };
  let { x, y, width, height } = r;
  let changed = false;
  if (x < 0) {
    width += x;
    x = 0;
    changed = true;
  }
  if (y < 0) {
    height += y;
    y = 0;
    changed = true;
  }
  if (x + width > pageW) {
    width = pageW - x;
    changed = true;
  }
  if (y + height > pageH) {
    height = pageH - y;
    changed = true;
  }
  width = Math.max(1, width);
  height = Math.max(1, height);
  return { rect: { x, y, width, height }, changed };
}
