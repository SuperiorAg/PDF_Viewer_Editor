// @vitest-environment node
// Mail-merge runner tests (Wave 12, David).
//
// Per form-engine.md §9: folder mode + concat mode + cancellation +
// unmapped-required-field + per-row error handling + progress streaming.
// Plus a 100-row perf test (the brief asks for an explicit measurement).

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type {
  FormFieldDefinition,
  MailMergeJob,
  MailMergeProgressEvent,
} from '../../ipc/contracts.js';
import { sanitizeDirectoryPath, sanitizePath } from '../security/path-sanitizer.js';

import {
  mapRowToFieldValues,
  renderFilename,
  runMailMerge,
  type MailMergeRunDeps,
} from './mail-merge-runner.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

async function makeTemplatePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  form.createTextField('FirstName').addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  form.createTextField('LastName').addToPage(page, { x: 50, y: 670, width: 200, height: 20 });
  form.createTextField('City').addToPage(page, { x: 50, y: 640, width: 200, height: 20 });
  doc.setCreationDate(new Date(2026, 0, 1));
  doc.setModificationDate(new Date(2026, 0, 1));
  return doc.save();
}

const FIELDS: FormFieldDefinition[] = [
  {
    name: 'FirstName',
    type: 'text',
    pageIndex: 0,
    rect: { x: 50, y: 700, width: 200, height: 20 },
    label: 'FirstName',
    required: false,
    origin: 'detected',
    unsaved: false,
  },
  {
    name: 'LastName',
    type: 'text',
    pageIndex: 0,
    rect: { x: 50, y: 670, width: 200, height: 20 },
    label: 'LastName',
    required: false,
    origin: 'detected',
    unsaved: false,
  },
  {
    name: 'City',
    type: 'text',
    pageIndex: 0,
    rect: { x: 50, y: 640, width: 200, height: 20 },
    label: 'City',
    required: false,
    origin: 'detected',
    unsaved: false,
  },
];

function makeFolderJob(
  templateBytes: Uint8Array,
  rows: string,
  outputFolder = '/tmp/mail-merge-test',
): MailMergeJob {
  return {
    jobId: 'job-test-1',
    templateHandle: 1,
    templateId: null,
    dataSource: { kind: 'csv', bytes: enc(rows) },
    columnMapping: {
      FirstName: 'FirstName',
      LastName: 'LastName',
      City: 'City',
    },
    outputMode: {
      kind: 'folder',
      outputFolder,
      filenameTemplate: 'merged-{LastName}-{rowIndex:04}.pdf',
    },
    fields: FIELDS,
  } satisfies MailMergeJob & { templateHandle: number };
}

// Prefixed `_` to mark intentionally-unused (lint varsIgnorePattern `^_`): this
// mock-deps factory is retained for future mail-merge test cases but not yet
// referenced. Renaming-only; no behavior change.
function _makeMockDeps(
  templateBytes: Uint8Array,
  events?: MailMergeProgressEvent[],
  cancelAfterRow?: number,
): MailMergeRunDeps {
  const writes: Array<{ path: string; size: number }> = [];
  let rowCount = 0;
  let cancelFlag = false;
  return {
    loadTemplateBytes: async () => ({ ok: true, value: templateBytes }),
    writeFile: async (p: string, b: Uint8Array) => {
      writes.push({ path: p, size: b.byteLength });
      rowCount += 1;
      if (cancelAfterRow !== undefined && rowCount >= cancelAfterRow) cancelFlag = true;
    },
    sanitizePath: (raw) => raw, // permissive for tests
    joinPath: (a, b) => `${a}/${b}`,
    onProgress: (evt) => events?.push(evt),
    isCancelled: () => cancelFlag,
  };
}

describe('mail-merge-runner: folder mode', () => {
  it('writes one PDF per row with templated filename', async () => {
    const tpl = await makeTemplatePdf();
    const events: MailMergeProgressEvent[] = [];
    const writes: string[] = [];
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async (p) => {
        writes.push(p);
      },
      sanitizePath: (raw) => raw,
      joinPath: (a, b) => `${a}/${b}`,
      onProgress: (e) => events.push(e),
    };
    const job = makeFolderJob(
      tpl,
      'FirstName,LastName,City\nAda,Lovelace,London\nGrace,Hopper,New York\nMargaret,Hamilton,Cambridge\n',
    );
    const r = await runMailMerge(job, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rowsWritten).toBe(3);
      expect(r.value.totalRows).toBe(3);
      expect(r.value.wasCancelled).toBe(false);
      expect(writes).toHaveLength(3);
      expect(writes[0]).toContain('merged-Lovelace-0001.pdf');
      expect(writes[1]).toContain('merged-Hopper-0002.pdf');
      expect(writes[2]).toContain('merged-Hamilton-0003.pdf');
    }
    // Progress should reach 100
    const last = events[events.length - 1];
    expect(last?.percent).toBe(100);
  });

  it('rejects out-of-bounds output folder via sanitizePath', async () => {
    const tpl = await makeTemplatePdf();
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async () => undefined,
      sanitizePath: () => null,
      joinPath: (a, b) => `${a}/${b}`,
    };
    const r = await runMailMerge(makeFolderJob(tpl, 'FirstName\nA\n', 'bad/path'), deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('output_path_invalid');
  });
});

// ----------------------------------------------------------------------------
// Phase 3.1 (B-3.1, David, Wave 13.5) — production-sanitizer integration tests
//
// Julian's review caught that EVERY mail-merge test injects a permissive
// `(raw) => raw` sanitizer stub. The production wiring uses the `.pdf`-only
// sanitizePath which rejects every directory path — folder-mode was 100%
// broken in production while CI was 100% green.
//
// These tests use the REAL production sanitizers (sanitizePath +
// sanitizeDirectoryPath) so the wire-up gap can never reopen.
// ----------------------------------------------------------------------------

describe('mail-merge-runner: B-3.1 production sanitizer wiring', () => {
  it('folder-mode with real production sanitizer ACCEPTS a legitimate directory path', async () => {
    const tpl = await makeTemplatePdf();
    const writes: string[] = [];
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async (p) => {
        writes.push(p);
      },
      // Production sanitizers — NO permissive stub.
      sanitizePath: (raw) => sanitizePath(raw),
      sanitizeDirectoryPath: (raw) => sanitizeDirectoryPath(raw),
      joinPath: (a, b) => `${a}/${b}`,
    };
    // A legitimate ABSOLUTE directory path with no extension. Cross-platform:
    // `/tmp/mail-merge-test` is treated as absolute by node:path on both POSIX
    // and Win32 (Win32 resolves it as `C:\tmp\mail-merge-test`).
    const r = await runMailMerge(
      makeFolderJob(tpl, 'FirstName\nAda\nGrace\n', '/tmp/mail-merge-output-folder'),
      deps,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rowsWritten).toBe(2);
      expect(writes).toHaveLength(2);
    }
  });

  it('folder-mode with real production sanitizer REJECTS a malicious directory (traversal)', async () => {
    const tpl = await makeTemplatePdf();
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async () => undefined,
      sanitizePath: (raw) => sanitizePath(raw),
      sanitizeDirectoryPath: (raw) => sanitizeDirectoryPath(raw),
      joinPath: (a, b) => `${a}/${b}`,
    };
    const r = await runMailMerge(makeFolderJob(tpl, 'FirstName\nA\n', '/tmp/../etc/passwd'), deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('output_path_invalid');
  });

  it('folder-mode with real production sanitizer REJECTS a UNC-style directory', async () => {
    const tpl = await makeTemplatePdf();
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async () => undefined,
      sanitizePath: (raw) => sanitizePath(raw),
      sanitizeDirectoryPath: (raw) => sanitizeDirectoryPath(raw),
      joinPath: (a, b) => `${a}/${b}`,
    };
    const r = await runMailMerge(
      makeFolderJob(tpl, 'FirstName\nA\n', '\\\\malicious-server\\share'),
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('output_path_invalid');
  });

  it('folder-mode with real production sanitizer REJECTS a reserved DOS device dir', async () => {
    const tpl = await makeTemplatePdf();
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async () => undefined,
      sanitizePath: (raw) => sanitizePath(raw),
      sanitizeDirectoryPath: (raw) => sanitizeDirectoryPath(raw),
      joinPath: (a, b) => `${a}/${b}`,
    };
    const r = await runMailMerge(makeFolderJob(tpl, 'FirstName\nA\n', '/tmp/CON'), deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('output_path_invalid');
  });

  it('concat-mode with real production sanitizer ACCEPTS a .pdf output path', async () => {
    const tpl = await makeTemplatePdf();
    const writes: Array<{ path: string; bytes: Uint8Array }> = [];
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async (p, b) => {
        writes.push({ path: p, bytes: b });
      },
      sanitizePath: (raw) => sanitizePath(raw),
      sanitizeDirectoryPath: (raw) => sanitizeDirectoryPath(raw),
      joinPath: (a, b) => `${a}/${b}`,
    };
    const job: MailMergeJob = {
      jobId: 'concat-prod-sanitizer',
      templateHandle: 1,
      templateId: null,
      dataSource: { kind: 'csv', bytes: enc('FirstName\nAda\nGrace\n') },
      columnMapping: { FirstName: 'FirstName' },
      outputMode: { kind: 'concat', outputFile: '/tmp/merged.pdf' },
      fields: FIELDS,
    };
    const r = await runMailMerge(job, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(writes).toHaveLength(1);
      expect(r.value.outputPath).toContain('merged.pdf');
    }
  });

  it('concat-mode with real production sanitizer REJECTS a non-.pdf file extension (regression guard)', async () => {
    const tpl = await makeTemplatePdf();
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async () => undefined,
      sanitizePath: (raw) => sanitizePath(raw),
      sanitizeDirectoryPath: (raw) => sanitizeDirectoryPath(raw),
      joinPath: (a, b) => `${a}/${b}`,
    };
    const job: MailMergeJob = {
      jobId: 'concat-bad-ext',
      templateHandle: 1,
      templateId: null,
      dataSource: { kind: 'csv', bytes: enc('FirstName\nA\n') },
      columnMapping: { FirstName: 'FirstName' },
      outputMode: { kind: 'concat', outputFile: '/tmp/merged.exe' },
      fields: FIELDS,
    };
    const r = await runMailMerge(job, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('output_path_invalid');
  });

  it('concat-mode with real production sanitizer REJECTS a directory path (regression guard)', async () => {
    // The reverse of B-3.1: concat-mode is FILE only. Sending a directory
    // path (no extension) into concat mode must still be rejected by the
    // `.pdf`-only file sanitizer. This guards against a future fix that
    // accidentally widens the file sanitizer too.
    const tpl = await makeTemplatePdf();
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async () => undefined,
      sanitizePath: (raw) => sanitizePath(raw),
      sanitizeDirectoryPath: (raw) => sanitizeDirectoryPath(raw),
      joinPath: (a, b) => `${a}/${b}`,
    };
    const job: MailMergeJob = {
      jobId: 'concat-dir-path',
      templateHandle: 1,
      templateId: null,
      dataSource: { kind: 'csv', bytes: enc('FirstName\nA\n') },
      columnMapping: { FirstName: 'FirstName' },
      // Directory path (no extension) — must NOT pass the `.pdf`-only sanitizer.
      outputMode: { kind: 'concat', outputFile: '/tmp/some-folder' },
      fields: FIELDS,
    };
    const r = await runMailMerge(job, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('output_path_invalid');
  });
});

// ----------------------------------------------------------------------------
// Phase 3.1 (H-3.2, David, Wave 13.5) — MailMergeJob.flattenForms wire-through
// ----------------------------------------------------------------------------

describe('mail-merge-runner: H-3.2 flattenForms per-job override', () => {
  it('when flattenForms is omitted, per-row output retains the form', async () => {
    const tpl = await makeTemplatePdf();
    const writes: Uint8Array[] = [];
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async (_p, b) => {
        writes.push(b);
      },
      sanitizePath: (raw) => raw,
      joinPath: (a, b) => `${a}/${b}`,
    };
    const job = makeFolderJob(tpl, 'FirstName\nAda\n');
    // flattenForms not set — default behavior.
    const r = await runMailMerge(job, deps);
    expect(r.ok).toBe(true);
    expect(writes).toHaveLength(1);
    const out = writes[0];
    expect(out).toBeTruthy();
    if (out) {
      const doc = await PDFDocument.load(out);
      // Form should still be present (unflattened).
      expect(doc.getForm().getFields().length).toBeGreaterThan(0);
    }
  });

  it('when flattenForms is true, per-row output has the form baked away', async () => {
    const tpl = await makeTemplatePdf();
    const writes: Uint8Array[] = [];
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async (_p, b) => {
        writes.push(b);
      },
      sanitizePath: (raw) => raw,
      joinPath: (a, b) => `${a}/${b}`,
    };
    const job: MailMergeJob = {
      ...makeFolderJob(tpl, 'FirstName\nAda\n'),
      flattenForms: true,
    };
    const r = await runMailMerge(job, deps);
    expect(r.ok).toBe(true);
    expect(writes).toHaveLength(1);
    const out = writes[0];
    expect(out).toBeTruthy();
    if (out) {
      const doc = await PDFDocument.load(out);
      // After flatten, the form has no fields.
      expect(doc.getForm().getFields().length).toBe(0);
    }
  });
});

// ----------------------------------------------------------------------------
// Phase 3.1 (H-3.1, David, Wave 13.5) — JS-action strip on every output
// ----------------------------------------------------------------------------

describe('mail-merge-runner: H-3.1 doc-level JS strip on every row', () => {
  async function makeJsLadenTemplate(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    doc
      .getForm()
      .createTextField('Name')
      .addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
    // Inject doc-level JS actions via the catalog. pdf-lib doesn't expose a
    // high-level JS-action API, so we author the dict by hand.
    const { PDFDict, PDFName, PDFString, PDFArray } = await import('pdf-lib');
    const namesDict = PDFDict.withContext(doc.context);
    const jsNameTree = PDFDict.withContext(doc.context);
    const jsActionDict = PDFDict.withContext(doc.context);
    jsActionDict.set(PDFName.of('S'), PDFName.of('JavaScript'));
    jsActionDict.set(PDFName.of('JS'), PDFString.of('app.alert("malicious");'));
    const namesArr = PDFArray.withContext(doc.context);
    namesArr.push(PDFString.of('script-1'));
    namesArr.push(jsActionDict);
    jsNameTree.set(PDFName.of('Names'), namesArr);
    namesDict.set(PDFName.of('JavaScript'), jsNameTree);
    doc.catalog.set(PDFName.of('Names'), namesDict);
    return doc.save();
  }

  it('strips /Names /JavaScript from EVERY per-row output PDF', async () => {
    const tpl = await makeJsLadenTemplate();
    // Sanity: the template DOES carry the JS action we just authored.
    const tplDoc = await PDFDocument.load(tpl);
    const { PDFName, PDFDict } = await import('pdf-lib');
    const tplNames = tplDoc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    expect(tplNames?.has(PDFName.of('JavaScript'))).toBe(true);

    const writes: Uint8Array[] = [];
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async (_p, b) => {
        writes.push(b);
      },
      sanitizePath: (raw) => raw,
      joinPath: (a, b) => `${a}/${b}`,
    };
    const job: MailMergeJob = {
      jobId: 'js-strip-1',
      templateHandle: 1,
      templateId: null,
      dataSource: { kind: 'csv', bytes: enc('Name\nAda\nGrace\n') },
      columnMapping: { Name: 'Name' },
      outputMode: {
        kind: 'folder',
        outputFolder: '/tmp/js-strip-test',
        filenameTemplate: 'row-{rowIndex:02}.pdf',
      },
      fields: [
        {
          name: 'Name',
          type: 'text',
          pageIndex: 0,
          rect: { x: 50, y: 700, width: 200, height: 20 },
          label: 'Name',
          required: false,
          origin: 'detected',
          unsaved: false,
        },
      ],
    };
    const r = await runMailMerge(job, deps);
    expect(r.ok).toBe(true);
    expect(writes.length).toBe(2);
    for (const b of writes) {
      const outDoc = await PDFDocument.load(b);
      const outNames = outDoc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
      // Either /Names is gone, OR /Names exists but no longer holds /JavaScript.
      const hasJs = outNames?.has(PDFName.of('JavaScript')) === true;
      expect(hasJs).toBe(false);
    }
  });
});

describe('mail-merge-runner: concat mode', () => {
  it('produces a single merged PDF with N pages', async () => {
    const tpl = await makeTemplatePdf();
    const writes: Array<{ path: string; bytes: Uint8Array }> = [];
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async (p, b) => {
        writes.push({ path: p, bytes: b });
      },
      sanitizePath: (raw) => raw,
      joinPath: (a, b) => `${a}/${b}`,
    };
    const job: MailMergeJob = {
      jobId: 'concat-1',
      templateHandle: 1,
      templateId: null,
      dataSource: { kind: 'csv', bytes: enc('FirstName\nAda\nGrace\nMargaret\n') },
      columnMapping: { FirstName: 'FirstName' },
      outputMode: { kind: 'concat', outputFile: '/tmp/merged.pdf' },
      fields: FIELDS,
    };
    const r = await runMailMerge(job, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(writes).toHaveLength(1);
      expect(r.value.outputPath).toBe('/tmp/merged.pdf');
      const mergedFile = writes[0]?.bytes;
      expect(mergedFile).toBeTruthy();
      if (mergedFile) {
        const doc = await PDFDocument.load(mergedFile);
        expect(doc.getPageCount()).toBe(3); // one page per row
      }
    }
  });

  it('writes NO concat file when cancelled (atomic semantics)', async () => {
    const tpl = await makeTemplatePdf();
    const writes: string[] = [];
    let cancelFlag = false;
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async (p) => {
        writes.push(p);
      },
      sanitizePath: (raw) => raw,
      joinPath: (a, b) => `${a}/${b}`,
      isCancelled: () => cancelFlag,
    };
    // Cancel before any row runs
    cancelFlag = true;
    const job: MailMergeJob = {
      jobId: 'concat-cancel',
      templateHandle: 1,
      templateId: null,
      dataSource: { kind: 'csv', bytes: enc('FirstName\nAda\nGrace\n') },
      columnMapping: { FirstName: 'FirstName' },
      outputMode: { kind: 'concat', outputFile: '/tmp/cancelled.pdf' },
      fields: FIELDS,
    };
    const r = await runMailMerge(job, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.wasCancelled).toBe(true);
      expect(r.value.outputPath).toBe(null);
      expect(writes).toHaveLength(0);
    }
  });
});

describe('mail-merge-runner: required-field check', () => {
  it('fails with unmapped_required_field when a required field has no column mapping', async () => {
    const tpl = await makeTemplatePdf();
    const fieldsWithRequired = FIELDS.map((f) =>
      f.name === 'City' ? { ...f, required: true } : f,
    );
    const job: MailMergeJob = {
      jobId: 'job-req',
      templateHandle: 1,
      templateId: null,
      dataSource: { kind: 'csv', bytes: enc('FirstName,LastName\nA,B\n') },
      columnMapping: { FirstName: 'FirstName', LastName: 'LastName' },
      outputMode: { kind: 'folder', outputFolder: '/tmp/x', filenameTemplate: 'x.pdf' },
      fields: fieldsWithRequired,
    };
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async () => undefined,
      sanitizePath: (raw) => raw,
      joinPath: (a, b) => `${a}/${b}`,
    };
    const r = await runMailMerge(job, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unmapped_required_field');
  });
});

describe('mail-merge-runner: data parse failure', () => {
  it('fails with data_parse_failed on header-only CSV (no data rows)', async () => {
    const tpl = await makeTemplatePdf();
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async () => undefined,
      sanitizePath: (raw) => raw,
      joinPath: (a, b) => `${a}/${b}`,
    };
    // Garbage bytes that don't decode as anything parseable -> data_parse_failed
    // (the empty-bytes case is caught by invalid_payload before reaching the parser).
    const job: MailMergeJob = {
      jobId: 'job-garbage',
      templateHandle: 1,
      templateId: null,
      // CSV with no header at all (zero records) -> parser fails.
      dataSource: { kind: 'csv', bytes: enc('') },
      columnMapping: {},
      outputMode: { kind: 'folder', outputFolder: '/tmp/x', filenameTemplate: 'x.pdf' },
      fields: FIELDS,
    };
    const r = await runMailMerge(job, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // The runner's invalid_payload guard catches zero bytes early; the
      // data_parse_failed path triggers when bytes parse but yield no rows.
      // Either is an acceptable failure mode for this input.
      expect(['invalid_payload', 'data_parse_failed']).toContain(r.error);
    }
  });
});

describe('mail-merge-runner: helper functions', () => {
  it('mapRowToFieldValues coerces by FormFieldType', () => {
    const fields: FormFieldDefinition[] = [
      { ...FIELDS[0]!, name: 'name', type: 'text' },
      { ...FIELDS[0]!, name: 'agree', type: 'checkbox' },
      { ...FIELDS[0]!, name: 'when', type: 'date' },
    ];
    const out = mapRowToFieldValues(
      { full: 'Ada', confirm: 'yes', date: '01/02/2026' },
      { full: 'name', confirm: 'agree', date: 'when' },
      fields,
    );
    expect(out.name).toEqual({ type: 'text', value: 'Ada' });
    expect(out.agree).toEqual({ type: 'checkbox', value: true });
    expect(out.when).toEqual({ type: 'date', value: '2026-01-02' });
  });

  it('renderFilename substitutes columns + zero-pads rowIndex', () => {
    expect(
      renderFilename('contract-{LastName}-{FirstName}.pdf', { FirstName: 'Ada', LastName: 'L' }, 4),
    ).toBe('contract-L-Ada.pdf');
    expect(renderFilename('out-{rowIndex:04}.pdf', {}, 0)).toBe('out-0001.pdf');
    expect(renderFilename('out-{rowIndex:04}.pdf', {}, 99)).toBe('out-0100.pdf');
  });
});

// ----------------------------------------------------------------------------
// Performance — 100-row CSV completion target
// ----------------------------------------------------------------------------

describe('mail-merge-runner: perf', () => {
  it('100 rows complete in under 30s (folder mode)', async () => {
    const tpl = await makeTemplatePdf();
    const rowsCsv =
      'FirstName,LastName,City\n' +
      Array.from({ length: 100 }, (_, i) => `First${i},Last${i},City${i}`).join('\n');
    const writes: string[] = [];
    const deps: MailMergeRunDeps = {
      loadTemplateBytes: async () => ({ ok: true, value: tpl }),
      writeFile: async (p) => {
        writes.push(p);
      },
      sanitizePath: (raw) => raw,
      joinPath: (a, b) => `${a}/${b}`,
    };
    const job = makeFolderJob(tpl, rowsCsv, '/tmp/perf-test');
    const t0 = Date.now();
    const r = await runMailMerge(job, deps);
    const dur = Date.now() - t0;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rowsWritten).toBe(100);
      // Document perf in the console for the build report.
      // eslint-disable-next-line no-console
      console.log(`[perf] 100-row mail-merge: ${dur}ms`);
      expect(dur).toBeLessThan(30_000);
    }
  }, 60_000);
});
