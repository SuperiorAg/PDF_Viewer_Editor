// @vitest-environment node

import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { ruleDocumentLanguageSet } from './document-language-set.js';
import { fakeContext } from './test-helpers.js';

describe('rule a11y.document.language-set', () => {
  it('passes when catalog /Lang is non-empty', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.catalog.set(PDFName.of('Lang'), PDFString.of('en-US'));
    const ctx = await fakeContext({ catalog: doc.catalog });
    const outcome = ruleDocumentLanguageSet.check({ ...ctx, doc });
    expect(outcome.status).toBe('pass');
  });

  it('fails when catalog /Lang is absent', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    // No setLanguage / no /Lang.
    const ctx = await fakeContext({ catalog: doc.catalog });
    const outcome = ruleDocumentLanguageSet.check({ ...ctx, doc });
    expect(outcome.status).toBe('fail');
    expect(outcome.quickFix?.kind).toBe('open-document-properties');
  });

  it('fails when catalog /Lang is whitespace only', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.catalog.set(PDFName.of('Lang'), PDFString.of('   '));
    const ctx = await fakeContext({ catalog: doc.catalog });
    const outcome = ruleDocumentLanguageSet.check({ ...ctx, doc });
    expect(outcome.status).toBe('fail');
  });
});
