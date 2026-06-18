// @vitest-environment node

import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { ruleDocumentTitlePresent } from './document-title-present.js';
import { fakeContext } from './test-helpers.js';

describe('rule a11y.document.title-present', () => {
  it('passes when /Info /Title is non-empty', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.setTitle('My Title');
    const ctx = await fakeContext({ catalog: doc.catalog });
    // Inject the same doc into context so the rule sees /Info via trailerInfo.
    const outcome = ruleDocumentTitlePresent.check({ ...ctx, doc });
    expect(outcome.status).toBe('pass');
  });

  it('fails when /Info /Title is empty / missing', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    // No setTitle call → trailer has no /Info or /Info has no /Title.
    const ctx = await fakeContext({ catalog: doc.catalog });
    const outcome = ruleDocumentTitlePresent.check({ ...ctx, doc });
    expect(outcome.status).toBe('fail');
    expect(outcome.quickFix?.kind).toBe('open-document-properties');
  });

  it('fails when /Title is set to whitespace only', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    // Manually inject a whitespace-only title via the trailer info dict.
    const infoRef = doc.context.trailerInfo.Info;
    if (infoRef) {
      const info = doc.context.lookup(infoRef);
      if (info instanceof PDFDict) {
        info.set(PDFName.of('Title'), PDFString.of('   '));
      }
    } else {
      const info = PDFDict.withContext(doc.context);
      info.set(PDFName.of('Title'), PDFString.of('   '));
      doc.context.trailerInfo.Info = doc.context.register(info);
    }
    const ctx = await fakeContext({ catalog: doc.catalog });
    const outcome = ruleDocumentTitlePresent.check({ ...ctx, doc });
    expect(outcome.status).toBe('fail');
  });
});
