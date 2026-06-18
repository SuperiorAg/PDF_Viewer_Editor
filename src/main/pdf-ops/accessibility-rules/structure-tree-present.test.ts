// @vitest-environment node

import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { ruleStructureTreePresent } from './structure-tree-present.js';
import { fakeContext } from './test-helpers.js';

describe('rule a11y.structure-tree-present', () => {
  it('passes when /Catalog has /StructTreeRoot', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const root = PDFDict.withContext(doc.context);
    root.set(PDFName.of('Type'), PDFName.of('StructTreeRoot'));
    const ref = doc.context.register(root);
    doc.catalog.set(PDFName.of('StructTreeRoot'), ref);
    const ctx = await fakeContext({ catalog: doc.catalog });
    const outcome = ruleStructureTreePresent.check({ ...ctx, doc });
    expect(outcome.status).toBe('pass');
  });

  it('fails when /Catalog has no /StructTreeRoot', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const ctx = await fakeContext({ catalog: doc.catalog });
    const outcome = ruleStructureTreePresent.check({ ...ctx, doc });
    expect(outcome.status).toBe('fail');
    expect(outcome.quickFix?.kind).toBe('open-tag-editor');
  });
});
