// Phase 3 inverse-map round-trip tests for document-inverses.ts.
// Covers the 5 new EditOperation variants per data-models.md §8.3.
//
// Pattern from Phase 2 B-2 (document-inverses.test.ts): assert the inverse
// SHAPE and the round-trip identity on a structural property the variant
// is supposed to preserve.

import { describe, expect, it } from 'vitest';

import {
  type EditMeta,
  type EditOperation,
  type FormFieldDefinition,
  type FormFieldValue,
  type PDFDocumentModel,
} from '../../types/ipc-contract';

import { inverseOf } from './document-inverses';

const meta = (id: string): EditMeta => ({
  ts: 0,
  undoable: true as const,
  operationId: id,
});

function blankDoc(): PDFDocumentModel {
  return {
    handle: 1,
    displayName: 't.pdf',
    fileHash: 'h',
    pageCount: 0,
    pages: [],
    annotations: [],
    dirtyOps: [],
    savedAtHandleVersion: 0,
    pdflibLoadWarnings: [],
  };
}

const FD: FormFieldDefinition = {
  name: 'email',
  type: 'text',
  pageIndex: 0,
  rect: { x: 0, y: 0, width: 100, height: 24 },
  label: 'Email',
  required: false,
  origin: 'authored',
  unsaved: true,
};

describe('inverseOf — form-commit', () => {
  it('inverse swaps fieldValues <-> previousValues for defined entries', () => {
    const fwd: EditOperation = {
      kind: 'form-commit',
      meta: meta('fc-1'),
      fieldValues: {
        first_name: { type: 'text', value: 'Bob' },
        subscribe: { type: 'checkbox', value: true },
      },
      previousValues: {
        first_name: { type: 'text', value: 'Alice' },
        subscribe: { type: 'checkbox', value: false },
      },
    };
    const inv = inverseOf(fwd, blankDoc());
    expect(inv.kind).toBe('form-commit');
    if (inv.kind !== 'form-commit') return;
    expect(inv.fieldValues['first_name']).toEqual({ type: 'text', value: 'Alice' });
    expect(inv.fieldValues['subscribe']).toEqual({ type: 'checkbox', value: false });
    expect(inv.previousValues['first_name']).toEqual({ type: 'text', value: 'Bob' });
    expect(inv.previousValues['subscribe']).toEqual({ type: 'checkbox', value: true });
  });

  it('inverse drops keys whose previous value was undefined (initially unset fields)', () => {
    const fwd: EditOperation = {
      kind: 'form-commit',
      meta: meta('fc-2'),
      fieldValues: { newly_typed: { type: 'text', value: 'fresh' } },
      previousValues: { newly_typed: undefined },
    };
    const inv = inverseOf(fwd, blankDoc());
    if (inv.kind !== 'form-commit') return;
    expect(inv.fieldValues['newly_typed']).toBeUndefined();
    // previousValues[name] should be the value we typed (so a redo restores it).
    expect(inv.previousValues['newly_typed']).toEqual({ type: 'text', value: 'fresh' });
  });

  it('round-trip: inverseOf(inverseOf(op)) ≡ op for symmetric commits', () => {
    const fwd: EditOperation = {
      kind: 'form-commit',
      meta: meta('fc-3'),
      fieldValues: { a: { type: 'text', value: 'A' } },
      previousValues: { a: { type: 'text', value: 'a' } },
    };
    const inv = inverseOf(fwd, blankDoc());
    const back = inverseOf(inv, blankDoc());
    if (back.kind !== 'form-commit') return;
    expect(back.fieldValues['a']).toEqual({ type: 'text', value: 'A' });
    expect(back.previousValues['a']).toEqual({ type: 'text', value: 'a' });
  });
});

describe('inverseOf — form-design-add', () => {
  it('inverse is form-design-remove carrying the full field def', () => {
    const fwd: EditOperation = {
      kind: 'form-design-add',
      meta: meta('fda-1'),
      fieldDefinition: FD,
    };
    const inv = inverseOf(fwd, blankDoc());
    expect(inv.kind).toBe('form-design-remove');
    if (inv.kind !== 'form-design-remove') return;
    expect(inv.fieldName).toBe('email');
    expect(inv.before).toEqual(FD);
  });

  it('round-trip identity preserves field shape', () => {
    const fwd: EditOperation = {
      kind: 'form-design-add',
      meta: meta('fda-2'),
      fieldDefinition: FD,
    };
    const back = inverseOf(inverseOf(fwd, blankDoc()), blankDoc());
    if (back.kind !== 'form-design-add') return;
    expect(back.fieldDefinition).toEqual(FD);
  });
});

describe('inverseOf — form-design-remove', () => {
  it('inverse is form-design-add carrying the same field def', () => {
    const fwd: EditOperation = {
      kind: 'form-design-remove',
      meta: meta('fdr-1'),
      fieldName: 'email',
      before: FD,
    };
    const inv = inverseOf(fwd, blankDoc());
    expect(inv.kind).toBe('form-design-add');
    if (inv.kind !== 'form-design-add') return;
    expect(inv.fieldDefinition).toEqual(FD);
  });

  it('round-trip identity preserves field name', () => {
    const fwd: EditOperation = {
      kind: 'form-design-remove',
      meta: meta('fdr-2'),
      fieldName: 'email',
      before: FD,
    };
    const back = inverseOf(inverseOf(fwd, blankDoc()), blankDoc());
    if (back.kind !== 'form-design-remove') return;
    expect(back.fieldName).toBe('email');
    expect(back.before).toEqual(FD);
  });
});

describe('inverseOf — form-design-edit', () => {
  it('inverse swaps before<->after', () => {
    const fwd: EditOperation = {
      kind: 'form-design-edit',
      meta: meta('fde-1'),
      fieldName: 'email',
      before: { label: 'Email' },
      after: { label: 'E-mail address' },
    };
    const inv = inverseOf(fwd, blankDoc());
    expect(inv.kind).toBe('form-design-edit');
    if (inv.kind !== 'form-design-edit') return;
    expect(inv.before).toEqual({ label: 'E-mail address' });
    expect(inv.after).toEqual({ label: 'Email' });
  });

  it('round-trip identity preserves before/after pair', () => {
    const fwd: EditOperation = {
      kind: 'form-design-edit',
      meta: meta('fde-2'),
      fieldName: 'email',
      before: { required: false },
      after: { required: true },
    };
    const back = inverseOf(inverseOf(fwd, blankDoc()), blankDoc());
    if (back.kind !== 'form-design-edit') return;
    expect(back.before).toEqual({ required: false });
    expect(back.after).toEqual({ required: true });
  });
});

describe('inverseOf — form-flatten', () => {
  it('inverse is a form-commit carrying beforeValues', () => {
    const beforeValues: Record<string, FormFieldValue> = {
      email: { type: 'text', value: 'foo@example.com' },
      subscribe: { type: 'checkbox', value: true },
    };
    const fwd: EditOperation = {
      kind: 'form-flatten',
      meta: meta('ff-1'),
      beforeFields: [FD],
      beforeValues,
    };
    const inv = inverseOf(fwd, blankDoc());
    // Per data-models §8.3, Phase 3 composite-inverse short form is a form-commit
    // restoring beforeValues. The form-design-add ops are documented as best-
    // effort (Phase 3.1 may expand).
    expect(inv.kind).toBe('form-commit');
    if (inv.kind !== 'form-commit') return;
    expect(inv.fieldValues['email']).toEqual({ type: 'text', value: 'foo@example.com' });
    expect(inv.fieldValues['subscribe']).toEqual({ type: 'checkbox', value: true });
  });
});
