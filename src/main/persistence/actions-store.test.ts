// Tests for ActionsStore (Phase 7.5 Wave 6 — B9 Action Wizard persistence).

import { describe, expect, it, vi } from 'vitest';

import type { EditOperationSerialized } from '../../ipc/contracts.js';

import {
  ACTION_SCRIPT_SCHEMA_VERSION,
  ActionsStore,
  ALLOWED_OP_KINDS,
  findBannedOp,
} from './actions-store.js';

// Normalize path separators so the platform-agnostic in-memory FS keys
// match regardless of whether `node:path.join` produced `/` (POSIX) or `\`
// (Windows). All store-internal calls go through `node:path.join`; mapping
// to a single canonical form keeps the test deterministic on both OSes.
function norm(p: string): string {
  return p.replace(/\\/g, '/');
}

function inMemoryFs(): {
  fs: {
    mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
    readdir: (path: string) => Promise<string[]>;
    readFile: (path: string, enc: string) => Promise<string>;
    writeFile: (path: string, body: string, enc: string) => Promise<void>;
    unlink: (path: string) => Promise<void>;
    rename: (from: string, to: string) => Promise<void>;
  };
  files: Map<string, string>;
} {
  const files = new Map<string, string>();
  return {
    files,
    fs: {
      async mkdir(_path: string): Promise<void> {
        // no-op for in-memory
      },
      async readdir(rawPath: string): Promise<string[]> {
        const dirPath = norm(rawPath).replace(/\/$/, '');
        const names = new Set<string>();
        for (const key of files.keys()) {
          const k = norm(key);
          if (k.startsWith(dirPath + '/')) {
            const rest = k.slice(dirPath.length + 1);
            if (!rest.includes('/')) {
              names.add(rest);
            }
          }
        }
        return Array.from(names);
      },
      async readFile(rawPath: string): Promise<string> {
        const v = files.get(norm(rawPath));
        if (v === undefined) {
          const e = new Error('ENOENT');
          (e as NodeJS.ErrnoException).code = 'ENOENT';
          throw e;
        }
        return v;
      },
      async writeFile(rawPath: string, body: string): Promise<void> {
        files.set(norm(rawPath), body);
      },
      async unlink(rawPath: string): Promise<void> {
        if (!files.delete(norm(rawPath))) {
          const e = new Error('ENOENT');
          (e as NodeJS.ErrnoException).code = 'ENOENT';
          throw e;
        }
      },
      async rename(from: string, to: string): Promise<void> {
        const f = norm(from);
        const t = norm(to);
        const v = files.get(f);
        if (v === undefined) {
          const e = new Error('ENOENT');
          (e as NodeJS.ErrnoException).code = 'ENOENT';
          throw e;
        }
        files.delete(f);
        files.set(t, v);
      },
    },
  };
}

const baseDir = '/fake/userData/actions';

function makeStore(): ActionsStore {
  const { fs } = inMemoryFs();
  let n = 0;
  return new ActionsStore({
    baseDir,
    fs: fs as never,
    uuid: () => `uuid-${++n}`,
    now: () => 1_000_000 + n * 1000,
  });
}

// Two minimal, allowlisted ops — both replayable across docs.
function makeRotateOp(pageIndex = 0): EditOperationSerialized {
  return {
    kind: 'rotate',
    meta: { id: 'op-1', authoredAt: 1 },
    pageIndex,
    fromRotation: 0,
    toRotation: 90,
  } as unknown as EditOperationSerialized;
}

function makeReorderOp(): EditOperationSerialized {
  return {
    kind: 'reorder',
    meta: { id: 'op-2', authoredAt: 2 },
    fromIndex: 0,
    toIndex: 1,
  } as unknown as EditOperationSerialized;
}

describe('ACTION_SCRIPT_SCHEMA_VERSION', () => {
  it('is pinned to 1', () => {
    expect(ACTION_SCRIPT_SCHEMA_VERSION).toBe(1);
  });
});

describe('ALLOWED_OP_KINDS allowlist', () => {
  it('includes only the cross-document-replayable kinds', () => {
    expect(ALLOWED_OP_KINDS.has('reorder')).toBe(true);
    expect(ALLOWED_OP_KINDS.has('rotate')).toBe(true);
    expect(ALLOWED_OP_KINDS.has('insert')).toBe(true);
    expect(ALLOWED_OP_KINDS.has('delete')).toBe(true);
    expect(ALLOWED_OP_KINDS.has('annot-add')).toBe(true);
    expect(ALLOWED_OP_KINDS.has('annot-add-shape')).toBe(true);
    expect(ALLOWED_OP_KINDS.has('image-insert')).toBe(true);
    expect(ALLOWED_OP_KINDS.has('image-overlay')).toBe(true);
    expect(ALLOWED_OP_KINDS.has('form-design-add')).toBe(true);
  });

  it('excludes ops that bind to a specific document', () => {
    // R5 mitigation: these must NEVER be replayed across documents.
    expect(ALLOWED_OP_KINDS.has('text-replace')).toBe(false);
    expect(ALLOWED_OP_KINDS.has('annot-edit')).toBe(false);
    expect(ALLOWED_OP_KINDS.has('annot-delete')).toBe(false);
    expect(ALLOWED_OP_KINDS.has('signature-pades-applied')).toBe(false);
    expect(ALLOWED_OP_KINDS.has('signature-visual-place')).toBe(false);
    expect(ALLOWED_OP_KINDS.has('form-commit')).toBe(false);
    expect(ALLOWED_OP_KINDS.has('form-flatten')).toBe(false);
    expect(ALLOWED_OP_KINDS.has('ocr-text-behind-applied')).toBe(false);
    expect(ALLOWED_OP_KINDS.has('image-overlay-edit')).toBe(false);
    expect(ALLOWED_OP_KINDS.has('image-overlay-delete')).toBe(false);
  });
});

describe('findBannedOp', () => {
  it('returns null when every op is allowlisted', () => {
    expect(findBannedOp([makeRotateOp(), makeReorderOp()])).toBeNull();
  });

  it('returns the first offending kind', () => {
    const ops = [
      makeRotateOp(),
      {
        kind: 'text-replace',
        meta: { id: 'x', authoredAt: 1 },
        pageIndex: 0,
        objectId: 'a',
        oldText: 'a',
        newText: 'b',
      } as unknown as EditOperationSerialized,
    ];
    expect(findBannedOp(ops)).toBe('text-replace');
  });

  it('flags non-object entries', () => {
    expect(findBannedOp([null as unknown as EditOperationSerialized])).toBe('<non-object>');
    expect(findBannedOp(['string' as unknown as EditOperationSerialized])).toBe('<non-object>');
  });
});

describe('ActionsStore.save / get / list / delete round-trip', () => {
  it('saves, retrieves, lists, and deletes a script', async () => {
    const store = makeStore();
    const ops = [makeRotateOp(), makeReorderOp()];

    const saved = await store.save('Apply watermark', ops, ACTION_SCRIPT_SCHEMA_VERSION);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const id = saved.value.id;
    expect(saved.value.savedAt).toBeGreaterThan(0);

    const got = await store.get(id);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.name).toBe('Apply watermark');
    expect(got.value.ops.length).toBe(2);
    expect(got.value.usageCount).toBe(0);
    expect(got.value.schemaVersion).toBe(ACTION_SCRIPT_SCHEMA_VERSION);

    const list = await store.listAll();
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.length).toBe(1);
    expect(list.value[0]!.id).toBe(id);
    expect(list.value[0]!.opCount).toBe(2);

    const del = await store.delete(id);
    expect(del.ok).toBe(true);

    const gotAfter = await store.get(id);
    expect(gotAfter.ok).toBe(false);
    if (gotAfter.ok) return;
    expect(gotAfter.error).toBe('script_not_found');
  });

  it('rejects save with a banned op kind', async () => {
    const store = makeStore();
    const ops = [
      makeRotateOp(),
      {
        kind: 'signature-pades-applied',
        meta: { id: 's', authoredAt: 1 },
      } as unknown as EditOperationSerialized,
    ];
    const saved = await store.save('Sign all', ops, ACTION_SCRIPT_SCHEMA_VERSION);
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error).toBe('banned_op_in_script');
  });

  it('rejects save with the wrong schemaVersion', async () => {
    const store = makeStore();
    const saved = await store.save('Future', [makeRotateOp()], 99);
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error).toBe('schema_version_unsupported');
  });

  it('rejects save with an empty name', async () => {
    const store = makeStore();
    const saved = await store.save('   ', [makeRotateOp()], ACTION_SCRIPT_SCHEMA_VERSION);
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error).toBe('invalid_payload');
  });

  it('reports script_not_found on get of a missing id', async () => {
    const store = makeStore();
    const r = await store.get('nope');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('script_not_found');
  });

  it('reports script_not_found on delete of a missing id', async () => {
    const store = makeStore();
    const r = await store.delete('nope');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('script_not_found');
  });

  it('flips usageCount on incrementUsage', async () => {
    const store = makeStore();
    const saved = await store.save('Increment me', [makeRotateOp()], ACTION_SCRIPT_SCHEMA_VERSION);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const inc = await store.incrementUsage(saved.value.id);
    expect(inc.ok).toBe(true);
    const got = await store.get(saved.value.id);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.usageCount).toBe(1);
  });
});

describe('ActionsStore.importFromJson', () => {
  it('persists a fresh id from a valid envelope', async () => {
    const store = makeStore();
    const envelope = {
      id: 'OLD-ID-IGNORED',
      name: 'Imported action',
      savedAt: 100,
      usageCount: 5,
      schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION,
      ops: [makeRotateOp()],
    };
    const r = await store.importFromJson(JSON.stringify(envelope));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).not.toBe('OLD-ID-IGNORED');
    const got = await store.get(r.value.id);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.name).toBe('Imported action');
    // usageCount resets when imported.
    expect(got.value.usageCount).toBe(0);
  });

  it('rejects invalid JSON', async () => {
    const store = makeStore();
    const r = await store.importFromJson('not json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_json');
  });

  it('rejects an envelope with a banned op', async () => {
    const store = makeStore();
    const envelope = {
      id: 'x',
      name: 'Bad',
      savedAt: 1,
      usageCount: 0,
      schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION,
      ops: [{ kind: 'signature-pades-applied' }],
    };
    const r = await store.importFromJson(JSON.stringify(envelope));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('banned_op_in_script');
  });

  it('rejects an envelope with the wrong schemaVersion', async () => {
    const store = makeStore();
    const envelope = {
      id: 'x',
      name: 'Old',
      savedAt: 1,
      usageCount: 0,
      schemaVersion: 99,
      ops: [makeRotateOp()],
    };
    const r = await store.importFromJson(JSON.stringify(envelope));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('schema_version_unsupported');
  });
});

describe('ActionsStore persistence_failed mapping', () => {
  it('surfaces writeFile failures as persistence_failed', async () => {
    const store = new ActionsStore({
      baseDir,
      fs: {
        mkdir: vi.fn().mockResolvedValue(undefined),
        readdir: vi.fn().mockResolvedValue([]),
        readFile: vi.fn().mockResolvedValue(''),
        writeFile: vi.fn().mockRejectedValue(new Error('EACCES')),
        unlink: vi.fn().mockResolvedValue(undefined),
        rename: vi.fn().mockResolvedValue(undefined),
      } as never,
      uuid: () => 'uuid-z',
      now: () => 1,
    });
    const r = await store.save('x', [makeRotateOp()], ACTION_SCRIPT_SCHEMA_VERSION);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('persistence_failed');
  });

  it('surfaces a schema-version mismatch on read', async () => {
    const { fs, files } = inMemoryFs();
    const store = new ActionsStore({
      baseDir,
      fs: fs as never,
      uuid: () => 'uuid-1',
      now: () => 1,
    });
    // Seed with the normalized form to match how the in-memory FS stores keys.
    files.set(
      norm(`${baseDir}/uuid-future.json`),
      JSON.stringify({
        id: 'uuid-future',
        name: 'From the future',
        savedAt: 1,
        usageCount: 0,
        schemaVersion: 99,
        ops: [],
      }),
    );
    const r = await store.get('uuid-future');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('schema_version_unsupported');
  });
});
