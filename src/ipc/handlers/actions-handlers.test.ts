// Tests for the Phase 7.5 Wave 6 B9 Action Wizard handlers.

import { describe, expect, it, vi } from 'vitest';

import type { ReplayOk } from '../../main/pdf-ops/replay-engine.js';
import {
  ACTION_SCRIPT_SCHEMA_VERSION,
  ActionsStore,
} from '../../main/persistence/actions-store.js';
import { ok } from '../../shared/result.js';
import type { EditOperationSerialized } from '../contracts.js';

import {
  handleActionsDeleteScript,
  handleActionsExportScript,
  handleActionsGetScript,
  handleActionsImportScript,
  handleActionsListScripts,
  handleActionsRunScript,
  handleActionsSaveScript,
  type ActionsHandlersDeps,
} from './actions-handlers.js';

function rotateOp(pageIndex = 0): EditOperationSerialized {
  return {
    kind: 'rotate',
    meta: { id: 'op-1', authoredAt: 1 },
    pageIndex,
    fromRotation: 0,
    toRotation: 90,
  } as unknown as EditOperationSerialized;
}

// Platform-agnostic in-memory FS: normalize backslashes so that
// `node:path.join`'s Windows output (`\fake\...`) and POSIX output
// (`/fake/...`) both round-trip through the same canonical map keys.
const normPath = (p: string): string => p.replace(/\\/g, '/');

function makeStore(): ActionsStore {
  const files = new Map<string, string>();
  let n = 0;
  return new ActionsStore({
    baseDir: '/x/actions',
    fs: {
      mkdir: async () => undefined,
      readdir: async (rawPath: string) => {
        const dirPath = normPath(rawPath).replace(/\/$/, '');
        const out: string[] = [];
        for (const k of files.keys()) {
          if (k.startsWith(dirPath + '/')) {
            const rest = k.slice(dirPath.length + 1);
            if (!rest.includes('/')) out.push(rest);
          }
        }
        return out;
      },
      readFile: async (rawPath: string) => {
        const v = files.get(normPath(rawPath));
        if (v === undefined) {
          const e = new Error('ENOENT');
          (e as NodeJS.ErrnoException).code = 'ENOENT';
          throw e;
        }
        return v;
      },
      writeFile: async (rawPath: string, b: string) => {
        files.set(normPath(rawPath), b);
      },
      unlink: async (rawPath: string) => {
        if (!files.delete(normPath(rawPath))) {
          const e = new Error('ENOENT');
          (e as NodeJS.ErrnoException).code = 'ENOENT';
          throw e;
        }
      },
      rename: async (from: string, to: string) => {
        const f = normPath(from);
        const t = normPath(to);
        const v = files.get(f);
        if (v === undefined) {
          const e = new Error('ENOENT');
          (e as NodeJS.ErrnoException).code = 'ENOENT';
          throw e;
        }
        files.delete(f);
        files.set(t, v);
      },
    } as never,
    uuid: () => `uuid-${++n}`,
    now: () => 1_000 + n,
  });
}

function makeDeps(overrides: Partial<ActionsHandlersDeps> = {}): ActionsHandlersDeps {
  const store = overrides.store ?? makeStore();
  return {
    store,
    getBytes: overrides.getBytes ?? (() => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    getDisplayName: overrides.getDisplayName ?? (() => 'source.pdf'),
    getSourceDirectory: overrides.getSourceDirectory ?? (() => '/srcDir'),
    sanitizePath: overrides.sanitizePath ?? ((raw) => raw),
    sanitizeDirectoryPath: overrides.sanitizeDirectoryPath ?? ((raw) => raw),
    writeFile: overrides.writeFile ?? (async () => undefined),
    replay:
      overrides.replay ??
      (async () =>
        ok<ReplayOk>({
          newBytes: new Uint8Array([0x99]),
          warnings: [],
          engineUsed: 'pdf-lib',
          byteCount: 1,
          durationMs: 1,
          annotationRefAssignments: {},
        })),
    now: overrides.now ?? (() => 12_345),
  };
}

describe('handleActionsSaveScript', () => {
  it('rejects an invalid payload', async () => {
    const r = await handleActionsSaveScript({ name: '' }, makeDeps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_payload');
  });

  it('rejects a wrong schemaVersion', async () => {
    const r = await handleActionsSaveScript({ name: 'x', ops: [], schemaVersion: 99 }, makeDeps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('schema_version_unsupported');
  });

  it('rejects a banned op kind', async () => {
    const r = await handleActionsSaveScript(
      {
        name: 'bad',
        ops: [{ kind: 'signature-pades-applied' }],
        schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION,
      },
      makeDeps(),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('banned_op_in_script');
  });

  it('saves a valid script and returns an id', async () => {
    const deps = makeDeps();
    const r = await handleActionsSaveScript(
      { name: 'My action', ops: [rotateOp()], schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION },
      deps,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toMatch(/uuid-/);
  });
});

describe('handleActionsListScripts + getScript + deleteScript', () => {
  it('round-trips an empty list', async () => {
    const deps = makeDeps();
    const r = await handleActionsListScripts({}, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scripts).toEqual([]);
  });

  it('lists what was saved', async () => {
    const deps = makeDeps();
    await handleActionsSaveScript(
      { name: 'A', ops: [rotateOp()], schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION },
      deps,
    );
    const list = await handleActionsListScripts({}, deps);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.scripts.length).toBe(1);
    expect(list.value.scripts[0]!.name).toBe('A');
    expect(list.value.scripts[0]!.opCount).toBe(1);
  });

  it('returns the full script via getScript', async () => {
    const deps = makeDeps();
    const saved = await handleActionsSaveScript(
      { name: 'A', ops: [rotateOp()], schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION },
      deps,
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const got = await handleActionsGetScript({ id: saved.value.id }, deps);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.ops.length).toBe(1);
  });

  it('reports script_not_found on getScript with unknown id', async () => {
    const deps = makeDeps();
    const r = await handleActionsGetScript({ id: 'nope' }, deps);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('script_not_found');
  });

  it('deletes via deleteScript', async () => {
    const deps = makeDeps();
    const saved = await handleActionsSaveScript(
      { name: 'A', ops: [rotateOp()], schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION },
      deps,
    );
    if (!saved.ok) return;
    const del = await handleActionsDeleteScript({ id: saved.value.id }, deps);
    expect(del.ok).toBe(true);
    const list = await handleActionsListScripts({}, deps);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.scripts.length).toBe(0);
  });
});

describe('handleActionsRunScript', () => {
  it('rejects when scriptId missing', async () => {
    const r = await handleActionsRunScript({}, makeDeps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_payload');
  });

  it('reports script_not_found when the script id is unknown', async () => {
    const r = await handleActionsRunScript({ scriptId: 'nope', targetHandles: [1] }, makeDeps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('script_not_found');
  });

  it('rejects an invalid destinationFolder', async () => {
    const deps = makeDeps({ sanitizeDirectoryPath: () => null });
    const saved = await handleActionsSaveScript(
      { name: 'A', ops: [rotateOp()], schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION },
      deps,
    );
    if (!saved.ok) return;
    const r = await handleActionsRunScript(
      {
        scriptId: saved.value.id,
        targetHandles: [1],
        destinationFolder: '/bad',
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('destination_invalid');
  });

  it('rejects a non-.pdf filename pattern', async () => {
    const deps = makeDeps();
    const saved = await handleActionsSaveScript(
      { name: 'A', ops: [rotateOp()], schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION },
      deps,
    );
    if (!saved.ok) return;
    const r = await handleActionsRunScript(
      {
        scriptId: saved.value.id,
        targetHandles: [1],
        filenamePattern: '{name}.exe',
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('destination_invalid');
  });

  it('runs replay against each target and increments usageCount once', async () => {
    const writeFile = vi.fn(async () => undefined);
    const replay = vi.fn(async () =>
      ok<ReplayOk>({
        newBytes: new Uint8Array([0xaa, 0xbb]),
        warnings: [],
        engineUsed: 'pdf-lib',
        byteCount: 2,
        durationMs: 1,
        annotationRefAssignments: {},
      }),
    );
    const deps = makeDeps({ writeFile, replay });
    const saved = await handleActionsSaveScript(
      { name: 'A', ops: [rotateOp()], schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION },
      deps,
    );
    if (!saved.ok) return;
    const run = await handleActionsRunScript(
      {
        scriptId: saved.value.id,
        targetHandles: [1, 2, 3],
      },
      deps,
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.results.length).toBe(3);
    expect(run.value.results.every((r) => r.success)).toBe(true);
    expect(replay).toHaveBeenCalledTimes(3);
    expect(writeFile).toHaveBeenCalledTimes(3);

    const got = await handleActionsGetScript({ id: saved.value.id }, deps);
    if (!got.ok) return;
    expect(got.value.usageCount).toBe(1);
  });

  it('captures per-target failures without aborting the batch', async () => {
    let callIndex = 0;
    const replay = vi.fn(async () => {
      callIndex += 1;
      if (callIndex === 2) {
        return {
          ok: false as const,
          error: 'op_apply_failed',
          message: 'simulated',
        };
      }
      return ok<ReplayOk>({
        newBytes: new Uint8Array([1]),
        warnings: [],
        engineUsed: 'pdf-lib',
        byteCount: 1,
        durationMs: 1,
        annotationRefAssignments: {},
      });
    });
    const deps = makeDeps({ replay });
    const saved = await handleActionsSaveScript(
      { name: 'A', ops: [rotateOp()], schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION },
      deps,
    );
    if (!saved.ok) return;
    const run = await handleActionsRunScript(
      { scriptId: saved.value.id, targetHandles: [1, 2, 3] },
      deps,
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.results[0]!.success).toBe(true);
    expect(run.value.results[1]!.success).toBe(false);
    expect(run.value.results[1]!.error).toMatch(/op_apply_failed/);
    expect(run.value.results[2]!.success).toBe(true);
  });

  it('reports handle errors per-target', async () => {
    const getBytes = vi.fn((h: number) => (h === 2 ? null : new Uint8Array([0x25])));
    const getDisplayName = vi.fn((h: number) => (h === 2 ? null : 'src.pdf'));
    const deps = makeDeps({ getBytes, getDisplayName });
    const saved = await handleActionsSaveScript(
      { name: 'A', ops: [rotateOp()], schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION },
      deps,
    );
    if (!saved.ok) return;
    const run = await handleActionsRunScript(
      { scriptId: saved.value.id, targetHandles: [1, 2] },
      deps,
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.results[0]!.success).toBe(true);
    expect(run.value.results[1]!.success).toBe(false);
    expect(run.value.results[1]!.error).toMatch(/handle 2/);
  });
});

describe('handleActionsExportScript', () => {
  it('returns a JSON envelope', async () => {
    const deps = makeDeps();
    const saved = await handleActionsSaveScript(
      { name: 'X', ops: [rotateOp()], schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION },
      deps,
    );
    if (!saved.ok) return;
    const exp = await handleActionsExportScript({ id: saved.value.id }, deps);
    expect(exp.ok).toBe(true);
    if (!exp.ok) return;
    expect(exp.value.schemaVersion).toBe(ACTION_SCRIPT_SCHEMA_VERSION);
    const parsed = JSON.parse(exp.value.json);
    expect(parsed.name).toBe('X');
    expect(parsed.ops.length).toBe(1);
  });
});

describe('handleActionsImportScript', () => {
  it('imports an envelope as a new id', async () => {
    const deps = makeDeps();
    const envelope = JSON.stringify({
      id: 'IGNORED',
      name: 'From export',
      savedAt: 1,
      usageCount: 99,
      schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION,
      ops: [rotateOp()],
    });
    const r = await handleActionsImportScript({ json: envelope }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).not.toBe('IGNORED');
    expect(r.value.name).toBe('From export');
  });

  it('rejects invalid JSON', async () => {
    const r = await handleActionsImportScript({ json: 'not json' }, makeDeps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_json');
  });

  it('rejects an envelope with a banned op', async () => {
    const envelope = JSON.stringify({
      id: 'x',
      name: 'bad',
      savedAt: 1,
      usageCount: 0,
      schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION,
      ops: [{ kind: 'signature-pades-applied' }],
    });
    const r = await handleActionsImportScript({ json: envelope }, makeDeps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('banned_op_in_script');
  });
});
