// Drift-gate test — Phase 7.5 Wave 6 (Riley).
//
// The renderer mirrors David's `ACTION_SCRIPT_SCHEMA_VERSION` literal +
// `ALLOWED_OP_KINDS` Set membership in `constants/actions.ts` because the
// canonical source (`src/main/persistence/actions-store.ts`) cannot be
// imported from a renderer bundle (it pulls in node:fs / node:crypto).
//
// This test reads David's source file as text and asserts:
//   1. The literal `ACTION_SCRIPT_SCHEMA_VERSION = N as const` exists, and
//      our renderer mirror equals N.
//   2. The `ALLOWED_OP_KINDS` Set literal contains exactly the same string
//      entries as the renderer mirror, in any order.
//
// If David bumps the schema version OR adds/removes an allowlist entry
// without Riley mirroring the change, this test fails loudly.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import { ACTION_SCRIPT_SCHEMA_VERSION, ALLOWED_OP_KINDS } from './actions';

const STORE_PATH = resolve(__dirname, '../../main/persistence/actions-store.ts');

describe('action-wizard constants — drift gate against David source', () => {
  test('ACTION_SCRIPT_SCHEMA_VERSION matches David source literal', () => {
    const source = readFileSync(STORE_PATH, 'utf-8');
    const m = /ACTION_SCRIPT_SCHEMA_VERSION\s*=\s*(\d+)\s+as\s+const/.exec(source);
    expect(m, 'ACTION_SCRIPT_SCHEMA_VERSION literal not found in David source').not.toBeNull();
    const davidValue = Number(m![1]);
    expect(davidValue).toBe(ACTION_SCRIPT_SCHEMA_VERSION);
  });

  test('ALLOWED_OP_KINDS contains exactly the same entries as David source', () => {
    const source = readFileSync(STORE_PATH, 'utf-8');
    // Match the Set literal: `new Set<string>([ 'a', 'b', ... ])`.
    const m = /ALLOWED_OP_KINDS\s*=\s*new Set<string>\(\[([\s\S]*?)\]\)/.exec(source);
    expect(m, 'ALLOWED_OP_KINDS Set literal not found in David source').not.toBeNull();
    const body = m![1];
    const davidEntries = Array.from(body.matchAll(/'([^']+)'/g)).map((mm) => mm[1]);
    const davidSet = new Set(davidEntries);
    const rendererSet = new Set(ALLOWED_OP_KINDS);
    expect(rendererSet.size, 'renderer ALLOWED_OP_KINDS size').toBe(davidSet.size);
    for (const k of davidSet) {
      expect(rendererSet.has(k), `renderer mirror missing op kind: ${k}`).toBe(true);
    }
    for (const k of rendererSet) {
      expect(davidSet.has(k), `David source missing op kind: ${k}`).toBe(true);
    }
  });
});
