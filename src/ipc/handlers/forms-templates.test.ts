// @vitest-environment node
// Combined tests for the three template channels — listTemplates, saveTemplate,
// loadTemplate — using the memory-backed FormTemplatesRepo until Ravi's
// SQLite repo lands. The brief calls out this sequence dependency: tests use
// a mock repo + flip to Ravi's at integration time.

import { describe, expect, it } from 'vitest';

import { createMemoryDbBridge } from '../../main/db-bridge.js';
import type { FormFieldDefinition } from '../contracts.js';

import { handleFormsListTemplates } from './forms-list-templates.js';
import { handleFormsLoadTemplate } from './forms-load-template.js';
import { handleFormsSaveTemplate } from './forms-save-template.js';

function mkDeps() {
  const bridge = createMemoryDbBridge();
  return {
    repo: bridge.formTemplates,
    hasHandle: (_h: number) => true,
    getDocumentHash: (_h: number) => 'abcd',
  };
}

const sampleFields: FormFieldDefinition[] = [
  {
    name: 'F1',
    type: 'text',
    pageIndex: 0,
    rect: { x: 0, y: 0, width: 10, height: 10 },
    label: 'F1',
    required: false,
    origin: 'authored',
    unsaved: true,
  },
];

describe('handleFormsListTemplates', () => {
  it('returns an empty list initially', async () => {
    const deps = mkDeps();
    const r = await handleFormsListTemplates({}, deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items).toHaveLength(0);
  });
});

describe('handleFormsSaveTemplate', () => {
  it('saves a new template and assigns an id', async () => {
    const deps = mkDeps();
    const r = await handleFormsSaveTemplate(
      { handle: 1, name: 'My Template', fields: sampleFields },
      deps,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.id).toBeGreaterThan(0);
  });

  it('returns name_in_use when the name is taken', async () => {
    const deps = mkDeps();
    await handleFormsSaveTemplate({ handle: 1, name: 'Dup', fields: sampleFields }, deps);
    const r = await handleFormsSaveTemplate({ handle: 1, name: 'Dup', fields: sampleFields }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('name_in_use');
  });

  it('rejects empty fields array', async () => {
    const deps = mkDeps();
    const r = await handleFormsSaveTemplate({ handle: 1, name: 'X', fields: [] }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });
});

describe('handleFormsLoadTemplate', () => {
  it('loads a previously-saved template with full field defs', async () => {
    const deps = mkDeps();
    const saved = await handleFormsSaveTemplate(
      {
        handle: 1,
        name: 'Loadable',
        fields: sampleFields,
        columnMappings: { col1: 'F1' },
      },
      deps,
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const r = await handleFormsLoadTemplate({ templateId: saved.value.id }, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Loadable');
      expect(r.value.fields).toHaveLength(1);
      expect(r.value.lastColumnMappings).toEqual({ col1: 'F1' });
    }
  });

  it('returns template_not_found for unknown id', async () => {
    const deps = mkDeps();
    const r = await handleFormsLoadTemplate({ templateId: 999 }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('template_not_found');
  });
});
