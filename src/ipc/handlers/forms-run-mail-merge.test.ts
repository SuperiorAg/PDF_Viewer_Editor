// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';

import { createMemoryDbBridge } from '../../main/db-bridge.js';
import { sanitizeDirectoryPath, sanitizePath } from '../../main/security/path-sanitizer.js';
import type { FormFieldDefinition, MailMergeJob } from '../contracts.js';

import {
  _resetMailMergeJobRegistryForTests,
  handleFormsCancelMailMerge,
  handleFormsRunMailMerge,
} from './forms-run-mail-merge.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

async function makeTemplatePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p = doc.addPage([612, 792]);
  doc.getForm().createTextField('N').addToPage(p, { x: 0, y: 0, width: 50, height: 20 });
  return doc.save();
}

const FIELDS: FormFieldDefinition[] = [
  {
    name: 'N',
    type: 'text',
    pageIndex: 0,
    rect: { x: 0, y: 0, width: 50, height: 20 },
    label: 'N',
    required: false,
    origin: 'detected',
    unsaved: false,
  },
];

afterEach(() => {
  _resetMailMergeJobRegistryForTests();
});

describe('handleFormsRunMailMerge', () => {
  it('writes one PDF per row and returns rowsWritten', async () => {
    const tpl = await makeTemplatePdf();
    const bridge = createMemoryDbBridge();
    const writes: string[] = [];
    const job: MailMergeJob = {
      jobId: 'run-1',
      templateHandle: 1,
      templateId: null,
      dataSource: { kind: 'csv', bytes: enc('N\nAda\nGrace\n') },
      columnMapping: { N: 'N' },
      outputMode: {
        kind: 'folder',
        outputFolder: '/tmp/out',
        filenameTemplate: 'r-{rowIndex:02}.pdf',
      },
      fields: FIELDS,
    };
    const r = await handleFormsRunMailMerge(
      { job },
      {
        getBytes: () => tpl,
        formTemplatesRepo: bridge.formTemplates,
        writeFile: async (p) => {
          writes.push(p);
        },
        sanitizePath: (raw) => raw,
        joinPath: (a, b) => `${a}/${b}`,
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rowsWritten).toBe(2);
      expect(r.value.wasCancelled).toBe(false);
      expect(writes).toHaveLength(2);
    }
  });

  it('rejects job-id duplicates while one is in flight', async () => {
    // Stash a fake in-flight job in the registry, then attempt to run another
    // with the same id.
    const tpl = await makeTemplatePdf();
    const bridge = createMemoryDbBridge();
    // Inject a slot into the registry by starting a job that resolves a tick
    // later (the test starts two parallel runs).
    const job: MailMergeJob = {
      jobId: 'dup-1',
      templateHandle: 1,
      templateId: null,
      dataSource: { kind: 'csv', bytes: enc('N\nAda\n') },
      columnMapping: { N: 'N' },
      outputMode: {
        kind: 'folder',
        outputFolder: '/tmp/out',
        filenameTemplate: 'r-{rowIndex:02}.pdf',
      },
      fields: FIELDS,
    };
    const deps = {
      getBytes: () => tpl,
      formTemplatesRepo: bridge.formTemplates,
      writeFile: async () => undefined,
      sanitizePath: (raw: string) => raw,
      joinPath: (a: string, b: string) => `${a}/${b}`,
    };
    const p1 = handleFormsRunMailMerge({ job }, deps);
    // Immediately start a duplicate before p1 resolves
    const r2 = await handleFormsRunMailMerge({ job }, deps);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe('invalid_payload');
    // Let p1 settle so afterEach can reset the registry cleanly.
    await p1;
  });
});

describe('handleFormsCancelMailMerge', () => {
  it('returns job_not_found when no job is in flight', async () => {
    const r = await handleFormsCancelMailMerge({ jobId: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('job_not_found');
  });
});

// ---------------------------------------------------------------------------
// Phase 3.1 (B-3.1, David, Wave 13.5) — production-sanitizer integration test
//
// Pin the wiring contract: with PRODUCTION sanitizers (not the permissive
// `(raw) => raw` stub the Wave 12 tests used), folder-mode mail-merge MUST
// still succeed against a real directory path. This guards against a future
// refactor that drops the `sanitizeDirectoryPath` injection.
// ---------------------------------------------------------------------------

describe('handleFormsRunMailMerge: B-3.1 production sanitizer wiring', () => {
  it('folder-mode succeeds with real sanitizePath + sanitizeDirectoryPath', async () => {
    const tpl = await makeTemplatePdf();
    const bridge = createMemoryDbBridge();
    const writes: string[] = [];
    const job: MailMergeJob = {
      jobId: 'run-prod-sanitizer',
      templateHandle: 1,
      templateId: null,
      dataSource: { kind: 'csv', bytes: enc('N\nAda\nGrace\n') },
      columnMapping: { N: 'N' },
      outputMode: {
        kind: 'folder',
        outputFolder: '/tmp/handler-test-output',
        filenameTemplate: 'r-{rowIndex:02}.pdf',
      },
      fields: FIELDS,
    };
    const r = await handleFormsRunMailMerge(
      { job },
      {
        getBytes: () => tpl,
        formTemplatesRepo: bridge.formTemplates,
        writeFile: async (p) => {
          writes.push(p);
        },
        // PRODUCTION sanitizers, no permissive stub.
        sanitizePath: (raw) => sanitizePath(raw),
        sanitizeDirectoryPath: (raw) => sanitizeDirectoryPath(raw),
        joinPath: (a, b) => `${a}/${b}`,
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rowsWritten).toBe(2);
      expect(writes).toHaveLength(2);
    }
  });

  it('folder-mode rejects a malicious directory path even with production sanitizers', async () => {
    const tpl = await makeTemplatePdf();
    const bridge = createMemoryDbBridge();
    const job: MailMergeJob = {
      jobId: 'run-prod-malicious',
      templateHandle: 1,
      templateId: null,
      dataSource: { kind: 'csv', bytes: enc('N\nAda\n') },
      columnMapping: { N: 'N' },
      outputMode: {
        kind: 'folder',
        outputFolder: '/tmp/../etc/passwd',
        filenameTemplate: 'r-{rowIndex:02}.pdf',
      },
      fields: FIELDS,
    };
    const r = await handleFormsRunMailMerge(
      { job },
      {
        getBytes: () => tpl,
        formTemplatesRepo: bridge.formTemplates,
        writeFile: async () => undefined,
        sanitizePath: (raw) => sanitizePath(raw),
        sanitizeDirectoryPath: (raw) => sanitizeDirectoryPath(raw),
        joinPath: (a, b) => `${a}/${b}`,
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('output_path_invalid');
  });
});
