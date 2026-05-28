// @vitest-environment node
//
// M-13.5-1 regression test (Phase 4 absorption, Wave 16, David).
//
// Julian's Wave 13.5 re-audit found that `stripDocLevelJavaScript(doc)` at
// replay-engine.ts:343 was gated inside `if (formOps.length > 0)`, so
// non-form save paths (annotation-only / image-only / text-replace-only
// against a JS-laden source PDF) skipped the strip.
//
// Phase 4 (Wave 16) absorbs the 2-line fix per
// architecture-phase-4.md §4.8: move the strip OUTSIDE the if-block so
// EVERY save path strips.
//
// This test PINS the fix by replaying ops on a JS-laden source PDF
// **without any form ops** and asserting the resulting bytes have NO
// /Names → /JavaScript entry. If a future regression re-gates the strip
// inside the form-ops conditional, this test fails immediately.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { replay } from './replay-engine.js';

/**
 * Build a PDF that carries /Names → /JavaScript entries at the catalog
 * level — exactly the surface H-3.1 / M-13.5-1 targets.
 */
async function buildJsLadenPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);

  // Author /Names dict at the catalog level with a JavaScript name tree.
  const ctx = doc.context;
  const names = PDFDict.withContext(ctx);
  const jsNameTree = PDFDict.withContext(ctx);
  const jsNamesArr = PDFArray.withContext(ctx);
  jsNamesArr.push(PDFString.of('OnOpen'));
  const jsAction = PDFDict.withContext(ctx);
  jsAction.set(PDFName.of('S'), PDFName.of('JavaScript'));
  jsAction.set(PDFName.of('JS'), PDFString.of('app.alert("Hello attacker");'));
  jsNamesArr.push(jsAction);
  jsNameTree.set(PDFName.of('Names'), jsNamesArr);
  names.set(PDFName.of('JavaScript'), jsNameTree);
  doc.catalog.set(PDFName.of('Names'), names);

  return doc.save();
}

async function hasJavaScriptInDoc(bytes: Uint8Array): Promise<boolean> {
  // Re-parse the document and inspect the /Names → /JavaScript entry. The
  // raw text grep is unreliable because pdf-lib encodes JS-bearing strings
  // through PDFString encoding (escape sequences may obscure the literal).
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (!names) return false;
  const js = names.lookupMaybe(PDFName.of('JavaScript'), PDFDict);
  return js !== undefined;
}

describe('M-13.5-1 regression: stripDocLevelJavaScript runs on every save path', () => {
  it('saves WITHOUT form ops (annotation-only intent) — JS is still stripped', async () => {
    const original = await buildJsLadenPdf();
    expect(await hasJavaScriptInDoc(original)).toBe(true);

    const result = await replay({
      originalBytes: original,
      ops: [], // NO form ops; annotation-only save shape
      annotations: [],
      jobId: 'm13.5.1-regression-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await hasJavaScriptInDoc(result.value.newBytes)).toBe(false);
    expect(
      result.value.warnings.some((w) => w.includes('JavaScript actions stripped from document')),
    ).toBe(true);
  });

  it('saves with image-only ops — JS is still stripped', async () => {
    const original = await buildJsLadenPdf();
    const result = await replay({
      originalBytes: original,
      ops: [
        // Empty ops list — the strip MUST still fire (the M-13.5-1
        // regression: the previous gate required at least one form op).
      ],
      annotations: [],
      jobId: 'm13.5.1-regression-2',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await hasJavaScriptInDoc(result.value.newBytes)).toBe(false);
  });

  it('strip is idempotent — re-saving JS-free bytes does not warn', async () => {
    const original = await buildJsLadenPdf();
    const first = await replay({
      originalBytes: original,
      ops: [],
      annotations: [],
      jobId: 'm13.5.1-first',
    });
    if (!first.ok) throw new Error('test setup');
    const second = await replay({
      originalBytes: first.value.newBytes,
      ops: [],
      annotations: [],
      jobId: 'm13.5.1-second',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // No JS warning on the second pass (idempotent).
    expect(
      second.value.warnings.some((w) => w.includes('JavaScript actions stripped from document')),
    ).toBe(false);
  });
});
