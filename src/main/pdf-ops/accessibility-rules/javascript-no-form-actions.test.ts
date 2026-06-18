// @vitest-environment node

import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFRef } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { ruleJavascriptNoFormActions } from './javascript-no-form-actions.js';
import { fakeContext } from './test-helpers.js';

function jsActionDict(doc: PDFDocument): PDFDict {
  const d = PDFDict.withContext(doc.context);
  d.set(PDFName.of('Type'), PDFName.of('Action'));
  d.set(PDFName.of('S'), PDFName.of('JavaScript'));
  return d;
}

describe('rule a11y.behavior.javascript-no-form-actions', () => {
  it('passes when the doc has no JavaScript actions', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const ctx = await fakeContext({ catalog: doc.catalog });
    const outcome = ruleJavascriptNoFormActions.check({ ...ctx, doc });
    expect(outcome.status).toBe('pass');
  });

  it('warns when /Catalog /OpenAction is a JavaScript action', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const action = jsActionDict(doc);
    doc.catalog.set(PDFName.of('OpenAction'), action);
    const ctx = await fakeContext({ catalog: doc.catalog });
    const outcome = ruleJavascriptNoFormActions.check({ ...ctx, doc });
    expect(outcome.status).toBe('warn');
  });

  it('warns when an AcroForm field has a JavaScript /A action', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const fieldDict = PDFDict.withContext(doc.context);
    fieldDict.set(PDFName.of('FT'), PDFName.of('Tx'));
    const action = jsActionDict(doc);
    fieldDict.set(PDFName.of('A'), action);
    const fieldRef: PDFRef = doc.context.register(fieldDict);
    const fieldsArr = PDFArray.withContext(doc.context);
    fieldsArr.push(fieldRef);
    const acroForm = PDFDict.withContext(doc.context);
    acroForm.set(PDFName.of('Fields'), fieldsArr);
    doc.catalog.set(PDFName.of('AcroForm'), acroForm);
    const ctx = await fakeContext({ catalog: doc.catalog });
    const outcome = ruleJavascriptNoFormActions.check({ ...ctx, doc });
    expect(outcome.status).toBe('warn');
  });
});
