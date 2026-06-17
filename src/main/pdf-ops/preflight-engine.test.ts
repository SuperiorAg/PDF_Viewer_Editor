// @vitest-environment node
// Phase 7.5 Wave 5a — Preflight engine unit tests.
//
// Strategy: hand-author pdf-lib documents with the specific catalog shapes
// each rule probes, then assert pass/fail with the EXACT ruleIds the engine
// emits. This is a per-rule smoke set; profile-level integration scenarios
// (all rules pass on a known-compliant fixture) are covered in
// preflight-engine.integration.test.ts.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { runPreflight } from './preflight-engine.js';
import { ALL_PREFLIGHT_RULES } from './preflight-rules/index.js';

async function makeMinimalPdf(
  opts: {
    withJsAction?: boolean;
    withLaunchAction?: boolean;
    withEmbeddedFiles?: boolean;
    withOutputIntent?: boolean;
    withXmpA1b?: boolean;
    withXmpA2b?: boolean;
    withTrappedUnknown?: boolean;
  } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 300]);
  const ctx = doc.context;

  if (opts.withJsAction) {
    const oa = PDFDict.withContext(ctx);
    oa.set(PDFName.of('S'), PDFName.of('JavaScript'));
    oa.set(PDFName.of('JS'), PDFString.of('app.alert("hi")'));
    doc.catalog.set(PDFName.of('OpenAction'), oa);
  }

  if (opts.withLaunchAction) {
    const oa = PDFDict.withContext(ctx);
    oa.set(PDFName.of('S'), PDFName.of('Launch'));
    oa.set(PDFName.of('F'), PDFString.of('evil.exe'));
    doc.catalog.set(PDFName.of('OpenAction'), oa);
  }

  if (opts.withEmbeddedFiles) {
    const names = PDFDict.withContext(ctx);
    const ef = PDFDict.withContext(ctx);
    const arr = PDFArray.withContext(ctx);
    arr.push(PDFString.of('attachment.txt'));
    arr.push(PDFDict.withContext(ctx));
    ef.set(PDFName.of('Names'), arr);
    names.set(PDFName.of('EmbeddedFiles'), ef);
    doc.catalog.set(PDFName.of('Names'), names);
  }

  if (opts.withOutputIntent) {
    const oi = PDFArray.withContext(ctx);
    const oiDict = PDFDict.withContext(ctx);
    oiDict.set(PDFName.of('Type'), PDFName.of('OutputIntent'));
    oiDict.set(PDFName.of('S'), PDFName.of('GTS_PDFX'));
    oi.push(oiDict);
    doc.catalog.set(PDFName.of('OutputIntents'), oi);
  }

  if (opts.withTrappedUnknown) {
    doc.context.trailerInfo.Info = ctx.register(
      PDFDict.fromMapWithContext(new Map([[PDFName.of('Trapped'), PDFName.of('Unknown')]]), ctx),
    );
  }

  if (opts.withXmpA1b || opts.withXmpA2b) {
    const part = opts.withXmpA1b ? '1' : '2';
    // No BOM in the source string — ESLint flags U+FEFF as irregular whitespace.
    const xmp = `<?xpacket begin='' id='W5M0MpCehiHzreSzNTczkc9d'?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
    <pdfaid:part>${part}</pdfaid:part>
    <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
</rdf:RDF>
</x:xmpmeta>`;
    const stream = PDFRawStream.of(
      PDFDict.fromMapWithContext(
        new Map([
          [PDFName.of('Type'), PDFName.of('Metadata')],
          [PDFName.of('Subtype'), PDFName.of('XML')],
        ]),
        ctx,
      ),
      new TextEncoder().encode(xmp),
    );
    const ref = ctx.register(stream);
    doc.catalog.set(PDFName.of('Metadata'), ref);
  }

  return doc.save({ useObjectStreams: false });
}

function resultsByRuleId(results: { ruleId: string; profile: string; passed: boolean }[]) {
  const out = new Map<string, { passed: boolean; profile: string }>();
  for (const r of results)
    out.set(`${r.profile}::${r.ruleId}`, { passed: r.passed, profile: r.profile });
  return out;
}

describe('preflight-engine', () => {
  it('rejects empty bytes / empty profiles', async () => {
    const a = await runPreflight({ pdfBytes: new Uint8Array(0), profiles: ['pdf-a-1b'] });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toBe('invalid_payload');
    const bytes = await makeMinimalPdf();
    const b = await runPreflight({ pdfBytes: bytes, profiles: [] });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toBe('invalid_payload');
  });

  it('shippedRuleCount matches the rule registry length (honest-disclosure regression)', async () => {
    const bytes = await makeMinimalPdf();
    const r = await runPreflight({
      pdfBytes: bytes,
      profiles: ['pdf-a-1b', 'pdf-a-2b', 'pdf-x-1a', 'pdf-x-4'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.shippedRuleCount).toBe(ALL_PREFLIGHT_RULES.length);
  });

  it('detects encryption is absent on a fresh doc', async () => {
    const bytes = await makeMinimalPdf();
    const r = await runPreflight({ pdfBytes: bytes, profiles: ['pdf-a-1b'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const map = resultsByRuleId(r.value.results);
    expect(map.get('pdf-a-1b::preflight.no-encryption')!.passed).toBe(true);
  });

  it('detects /JS action and fails no-javascript across every profile', async () => {
    const bytes = await makeMinimalPdf({ withJsAction: true });
    const r = await runPreflight({
      pdfBytes: bytes,
      profiles: ['pdf-x-1a', 'pdf-x-4', 'pdf-a-1b', 'pdf-a-2b'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const map = resultsByRuleId(r.value.results);
    for (const p of ['pdf-x-1a', 'pdf-x-4', 'pdf-a-1b', 'pdf-a-2b']) {
      expect(map.get(`${p}::preflight.no-javascript`)!.passed).toBe(false);
    }
  });

  it('detects /Launch action and fails the PDF/A-1b launch-actions rule', async () => {
    const bytes = await makeMinimalPdf({ withLaunchAction: true });
    const r = await runPreflight({ pdfBytes: bytes, profiles: ['pdf-a-1b'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const map = resultsByRuleId(r.value.results);
    expect(map.get('pdf-a-1b::preflight.actions.no-launch-actions')!.passed).toBe(false);
  });

  it('detects embedded files in PDF/X-1a', async () => {
    const bytes = await makeMinimalPdf({ withEmbeddedFiles: true });
    const r = await runPreflight({ pdfBytes: bytes, profiles: ['pdf-x-1a', 'pdf-a-2b'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const map = resultsByRuleId(r.value.results);
    expect(map.get('pdf-x-1a::preflight.no-embedded-files')!.passed).toBe(false);
    // PDF/A-2b allows embedded files — the no-embedded-files rule should not
    // fire for that profile at all.
    expect(map.has('pdf-a-2b::preflight.no-embedded-files')).toBe(false);
  });

  it('passes PDF/X-1a output-intent when /OutputIntents is wired', async () => {
    const bytes = await makeMinimalPdf({ withOutputIntent: true });
    const r = await runPreflight({ pdfBytes: bytes, profiles: ['pdf-x-1a'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const map = resultsByRuleId(r.value.results);
    expect(map.get('pdf-x-1a::preflight.output-intent.present')!.passed).toBe(true);
  });

  it('flags /Trapped /Unknown on PDF/X-1a', async () => {
    const bytes = await makeMinimalPdf({ withTrappedUnknown: true });
    const r = await runPreflight({ pdfBytes: bytes, profiles: ['pdf-x-1a'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const map = resultsByRuleId(r.value.results);
    expect(map.get('pdf-x-1a::preflight.trapping.specified')!.passed).toBe(false);
  });

  it('PDF/A-1b xmp-pdfaid-marker passes on an A-1b-marked XMP', async () => {
    const bytes = await makeMinimalPdf({ withXmpA1b: true });
    const r = await runPreflight({ pdfBytes: bytes, profiles: ['pdf-a-1b'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const map = resultsByRuleId(r.value.results);
    expect(map.get('pdf-a-1b::preflight.metadata.xmp-pdfaid-marker')!.passed).toBe(true);
    expect(map.get('pdf-a-1b::preflight.metadata.xmp-present')!.passed).toBe(true);
  });

  it('PDF/A-2b xmp-pdfaid-part-2 fails when the XMP says part=1', async () => {
    const bytes = await makeMinimalPdf({ withXmpA1b: true });
    const r = await runPreflight({ pdfBytes: bytes, profiles: ['pdf-a-2b'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const map = resultsByRuleId(r.value.results);
    expect(map.get('pdf-a-2b::preflight.metadata.xmp-pdfaid-part-2')!.passed).toBe(false);
  });

  it('A-2b doc with A-2b XMP passes the PDF/A-2b marker rule', async () => {
    const bytes = await makeMinimalPdf({ withXmpA2b: true });
    const r = await runPreflight({ pdfBytes: bytes, profiles: ['pdf-a-2b'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const map = resultsByRuleId(r.value.results);
    expect(map.get('pdf-a-2b::preflight.metadata.xmp-pdfaid-part-2')!.passed).toBe(true);
  });
});
