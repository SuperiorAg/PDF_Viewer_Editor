#!/usr/bin/env node
// tests/fixtures/tagged-acrobat/generate-fixture.mjs
//
// R12 mitigation fixture generator — Phase 7.5 post-v0.8.0 follow-up (Diego,
// 2026-06-18; closes Julian §11.1 HIGH).
//
// HONESTY NOTE — read this carefully before adjusting the fixture:
//
//   This script hand-crafts a tagged PDF via pdf-lib that EMULATES Adobe
//   Acrobat's typical tagged-PDF output shape. It is **NOT** an
//   externally-authored Acrobat fixture. Reasons documented in the brief:
//
//     (a) Adobe Acrobat is not installed on this build machine.
//     (b) The W3C tagged-PDF test corpus is licensed under the W3C Document
//         License; while permissive, vendoring a corpus PDF adds a licensing
//         line-item that is not justified for a single round-trip smoke test.
//     (c) The brief explicitly authorizes the "hand-craft a minimal tagged
//         PDF via pdf-lib that EMULATES Acrobat's output shape" option,
//         provided the synthesis is documented honestly.
//
//   What this fixture EMULATES that a real Acrobat-authored tagged PDF would
//   carry (Acrobat's output is well-documented; the shape below mirrors the
//   ISO 32000-2 §14.7 structure-tree conventions Acrobat follows):
//
//     - /Catalog /MarkInfo /Marked true
//     - /Catalog /StructTreeRoot indirect ref
//     - /StructTreeRoot {
//         /Type /StructTreeRoot
//         /RoleMap {/Title /H1 /Subtitle /H2 /Body /P}   <-- Acrobat habit
//         /ParentTree {/Nums [0 <ref to ParentTree node>]}
//         /ParentTreeNextKey N
//         /K [<top-level struct elem refs>]
//       }
//     - Each /StructElem dict:
//         /Type /StructElem
//         /S /<Type>
//         /P <parent ref>      <-- Acrobat always writes the parent back-ref
//         /Pg <page ref>
//         /K <mcid or nested>
//         /Alt or /ActualText or /Lang where appropriate
//     - Multi-page tree (3 pages: title page, body page, figure page)
//     - Nested H1 > {P, P, H2 > P} structure with a Figure carrying /Alt text
//
//   What this fixture does NOT carry that a true Acrobat fixture would:
//
//     - `/IDTree` — Acrobat writes one when /StructElem dicts use /ID keys
//       for cross-references. Our tree uses no /ID keys (Wave 5b decoder
//       doesn't read them), so /IDTree is correctly absent.
//     - `/ClassMap` — Acrobat writes one when /A or /C entries reference a
//       class name. Our nodes carry only /Alt /ActualText /Lang, no class
//       attributes.
//     - Real page content streams with /MCID-marked text — Acrobat embeds
//       BDC/EMC operators around each marked-content range. Our fixture
//       declares the MCID refs in the struct tree but leaves the page
//       content streams empty (the round-trip test asserts on tree shape,
//       not content-stream marking). This is the same tradeoff the Wave 5b
//       engine itself makes for its in-test fixtures — see engine module
//       header: "Wave 5b preserves any /K mcid entries it reads so a
//       round-trip survives, but it does NOT rewrite page content streams
//       to add new /MCID marks."
//
//   The round-trip test (`struct-tree-engine.acrobat-roundtrip.test.ts`)
//   exercises the exact data-loss surface R12 was filed to mitigate:
//   reading an externally-shaped tagged tree, writing it back unchanged,
//   re-reading, and asserting structural equality. The Acrobat-emulation
//   shape (RoleMap, ParentTree, /P back-refs) is what the engine's read
//   path MIGHT mishandle if it strips entries it doesn't understand — the
//   test catches that class of regression even with a synthesised fixture.
//
// To regenerate: `node tests/fixtures/tagged-acrobat/generate-fixture.mjs`.
// The script is deterministic-ish (object numbers depend on pdf-lib's
// allocation order; the byte-level output is stable across runs for a given
// pdf-lib version). Commit the resulting sample.pdf alongside this script.
//
// Future migration path: when an externally-authored Acrobat-tagged fixture
// becomes available (real Acrobat installation OR a permissive corpus
// donation), drop the new sample.pdf in this directory and update the test
// to assert against it; this generator can stay for reference + as a
// regression-safe re-generation path.

import { writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
} from 'pdf-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const doc = await PDFDocument.create();

  // 3 pages — title page, body page, figure page.
  const page1 = doc.addPage([612, 792]);
  const page2 = doc.addPage([612, 792]);
  const page3 = doc.addPage([612, 792]);
  const pageRefs = [page1.ref, page2.ref, page3.ref];

  const ctx = doc.context;

  // ----- Build the /StructTreeRoot dict -----
  const structTreeRoot = PDFDict.withContext(ctx);
  structTreeRoot.set(PDFName.of('Type'), PDFName.of('StructTreeRoot'));

  // /RoleMap — Acrobat habit when authoring a doc with custom struct-element
  // type names that map to standard types. We seed three mappings so the
  // round-trip test can assert the engine preserves (or honestly drops, then
  // we know) the /RoleMap dict. (Today's engine drops it on rebuild — that
  // is documented as an honest gap that the test surfaces.)
  const roleMap = PDFDict.withContext(ctx);
  roleMap.set(PDFName.of('Title'), PDFName.of('H1'));
  roleMap.set(PDFName.of('Subtitle'), PDFName.of('H2'));
  roleMap.set(PDFName.of('Body'), PDFName.of('P'));
  structTreeRoot.set(PDFName.of('RoleMap'), roleMap);

  // We register the root upfront so child /P (parent) back-refs can point to
  // it. pdf-lib lets us obtain the ref via context.register(); we'll set the
  // catalog entry after we finish populating /K.
  const rootRef = ctx.nextRef();

  // Helper to build a /StructElem dict. Returns { dict, ref }.
  function makeStructElem({ type, parentRef, pageRef, mcids = [], alt = null, actualText = null, lang = null }) {
    const dict = PDFDict.withContext(ctx);
    dict.set(PDFName.of('Type'), PDFName.of('StructElem'));
    dict.set(PDFName.of('S'), PDFName.of(type));
    // /P — parent back-ref. Acrobat ALWAYS writes this; some PDF readers
    // require it (Adobe's accessibility report fails on docs missing /P).
    dict.set(PDFName.of('P'), parentRef);
    if (pageRef) dict.set(PDFName.of('Pg'), pageRef);
    if (alt !== null) dict.set(PDFName.of('Alt'), PDFString.of(alt));
    if (actualText !== null) dict.set(PDFName.of('ActualText'), PDFString.of(actualText));
    if (lang !== null) dict.set(PDFName.of('Lang'), PDFString.of(lang));

    // /K — content refs. For our fixture we always use bare MCID integers
    // (Acrobat's most common shape when /Pg matches the parent's /Pg).
    if (mcids.length === 1) {
      dict.set(PDFName.of('K'), PDFNumber.of(mcids[0]));
    } else if (mcids.length > 1) {
      const kArr = PDFArray.withContext(ctx);
      for (const m of mcids) kArr.push(PDFNumber.of(m));
      dict.set(PDFName.of('K'), kArr);
    }

    const ref = ctx.register(dict);
    return { dict, ref };
  }

  // Helper to add child refs to an existing struct elem's /K (mixing already-
  // present mcids with nested child refs). We rebuild /K to a PDFArray.
  function appendChildren(dict, childRefs) {
    if (childRefs.length === 0) return;
    const existingK = dict.get(PDFName.of('K'));
    const kArr = PDFArray.withContext(ctx);
    if (existingK instanceof PDFArray) {
      for (let i = 0; i < existingK.size(); i += 1) {
        const e = existingK.get(i);
        if (e !== undefined) kArr.push(e);
      }
    } else if (existingK !== undefined) {
      kArr.push(existingK);
    }
    for (const ref of childRefs) kArr.push(ref);
    dict.set(PDFName.of('K'), kArr);
  }

  // ----- Build the struct-tree structure -----
  // Top-level shape (Acrobat-typical document outline):
  //   Document (root)
  //     H1 "Title" (page 1) — mcid 0
  //       P "intro" (page 1) — mcid 1
  //       P "more intro" (page 2) — mcid 2
  //       H2 "Section" (page 2) — mcid 3
  //         P "section body" (page 2) — mcid 4
  //     Figure (page 3) — mcid 5, /Alt "logo"

  // Children registered first (bottom-up so parent /P refs are stable).
  // BUT pdf-lib refs are allocated as ctx.register(); we need the H1 ref to
  // set /P on its children. So we register parents BEFORE children, and use
  // ctx.nextRef() to reserve the H1 ref upfront. This mirrors Acrobat's
  // approach (Acrobat uses a placeholder pass + an emit pass).

  // Reserve refs for nodes that have children.
  const h1Ref = ctx.nextRef();
  const h2Ref = ctx.nextRef();

  // Children of H2 (deepest first).
  const { ref: pSectionBodyRef } = makeStructElem({
    type: 'P',
    parentRef: h2Ref,
    pageRef: pageRefs[1],
    mcids: [4],
    actualText: 'section body',
  });

  // H2 itself — register now using the reserved ref.
  const h2Dict = PDFDict.withContext(ctx);
  h2Dict.set(PDFName.of('Type'), PDFName.of('StructElem'));
  h2Dict.set(PDFName.of('S'), PDFName.of('H2'));
  h2Dict.set(PDFName.of('P'), h1Ref);
  h2Dict.set(PDFName.of('Pg'), pageRefs[1]);
  h2Dict.set(PDFName.of('ActualText'), PDFString.of('Section'));
  // /K = [3 (mcid), <ref to pSectionBody>] — Acrobat's typical pattern for
  // a heading with following body content. mcid 3 represents the heading
  // text marked on the page; the child <ref> is the body paragraph.
  const h2KArr = PDFArray.withContext(ctx);
  h2KArr.push(PDFNumber.of(3));
  h2KArr.push(pSectionBodyRef);
  h2Dict.set(PDFName.of('K'), h2KArr);
  ctx.assign(h2Ref, h2Dict);

  // Children of H1.
  const { ref: pIntroRef } = makeStructElem({
    type: 'P',
    parentRef: h1Ref,
    pageRef: pageRefs[0],
    mcids: [1],
    actualText: 'intro',
  });
  const { ref: pMoreIntroRef } = makeStructElem({
    type: 'P',
    parentRef: h1Ref,
    pageRef: pageRefs[1],
    mcids: [2],
    actualText: 'more intro',
  });

  // H1 itself.
  const h1Dict = PDFDict.withContext(ctx);
  h1Dict.set(PDFName.of('Type'), PDFName.of('StructElem'));
  h1Dict.set(PDFName.of('S'), PDFName.of('H1'));
  h1Dict.set(PDFName.of('P'), rootRef);
  h1Dict.set(PDFName.of('Pg'), pageRefs[0]);
  h1Dict.set(PDFName.of('ActualText'), PDFString.of('Title'));
  // /K = [0, <pIntro>, <pMoreIntro>, <h2>] — Acrobat's typical heading shape.
  const h1KArr = PDFArray.withContext(ctx);
  h1KArr.push(PDFNumber.of(0));
  h1KArr.push(pIntroRef);
  h1KArr.push(pMoreIntroRef);
  h1KArr.push(h2Ref);
  h1Dict.set(PDFName.of('K'), h1KArr);
  ctx.assign(h1Ref, h1Dict);

  // Figure on page 3.
  const { ref: figureRef } = makeStructElem({
    type: 'Figure',
    parentRef: rootRef,
    pageRef: pageRefs[2],
    mcids: [5],
    alt: 'company logo',
    lang: 'en-US',
  });

  // ----- /StructTreeRoot /K = [<h1>, <figure>] -----
  const rootKArr = PDFArray.withContext(ctx);
  rootKArr.push(h1Ref);
  rootKArr.push(figureRef);
  structTreeRoot.set(PDFName.of('K'), rootKArr);

  // /ParentTree — Acrobat ALWAYS writes one. We synthesise a minimal
  // /Nums array mapping page index -> page's struct-parent list (an array
  // of refs into the struct tree for each mcid). For our fixture, page 0
  // has mcids 0+1, page 1 has 2+3+4, page 2 has 5.
  //
  // The pdf-lib decoder in Wave 5b doesn't read /ParentTree (the engine
  // header documents this), so the round-trip test should accept that
  // /ParentTree may be regenerated or dropped — but our fixture must
  // CARRY one to exercise the "what if Acrobat wrote one" code path.
  const parentTree = PDFDict.withContext(ctx);
  const parentTreeNums = PDFArray.withContext(ctx);
  // Per-page StructParents arrays. Each page's array indexes by mcid into
  // the struct elem that owns that mcid.
  const page0Parents = PDFArray.withContext(ctx);
  page0Parents.push(h1Ref); // mcid 0 -> H1
  page0Parents.push(pIntroRef); // mcid 1 -> intro P
  const page0ParentsRef = ctx.register(page0Parents);

  const page1Parents = PDFArray.withContext(ctx);
  page1Parents.push(pMoreIntroRef); // mcid 2 -> more-intro P
  page1Parents.push(h2Ref); // mcid 3 -> H2
  page1Parents.push(pSectionBodyRef); // mcid 4 -> section-body P
  const page1ParentsRef = ctx.register(page1Parents);

  const page2Parents = PDFArray.withContext(ctx);
  page2Parents.push(figureRef); // mcid 5 -> Figure
  const page2ParentsRef = ctx.register(page2Parents);

  parentTreeNums.push(PDFNumber.of(0));
  parentTreeNums.push(page0ParentsRef);
  parentTreeNums.push(PDFNumber.of(1));
  parentTreeNums.push(page1ParentsRef);
  parentTreeNums.push(PDFNumber.of(2));
  parentTreeNums.push(page2ParentsRef);
  parentTree.set(PDFName.of('Nums'), parentTreeNums);
  structTreeRoot.set(PDFName.of('ParentTree'), parentTree);
  structTreeRoot.set(PDFName.of('ParentTreeNextKey'), PDFNumber.of(3));

  // Set the catalog refs.
  ctx.assign(rootRef, structTreeRoot);
  doc.catalog.set(PDFName.of('StructTreeRoot'), rootRef);

  // /MarkInfo /Marked true — required for a tagged PDF.
  const markInfo = PDFDict.withContext(ctx);
  markInfo.set(PDFName.of('Marked'), ctx.obj(true));
  doc.catalog.set(PDFName.of('MarkInfo'), markInfo);

  // Set /StructParents on each page so a real Acrobat would associate the
  // page with its parent-tree node.
  page1.node.set(PDFName.of('StructParents'), PDFNumber.of(0));
  page2.node.set(PDFName.of('StructParents'), PDFNumber.of(1));
  page3.node.set(PDFName.of('StructParents'), PDFNumber.of(2));

  // /Lang on the catalog (Acrobat habit for a tagged English doc).
  doc.catalog.set(PDFName.of('Lang'), PDFString.of('en-US'));

  // Save with object streams off — keeps the byte format inspectable + the
  // round-trip stable across pdf-lib versions.
  const bytes = await doc.save({ useObjectStreams: false });
  const outPath = resolvePath(__dirname, 'sample.pdf');
  await writeFile(outPath, bytes);

  process.stdout.write(`[fixture] wrote ${outPath} (${bytes.byteLength} bytes)\n`);
  process.stdout.write(`[fixture] tree shape: Document > [H1 > [P, P, H2 > [P]], Figure]\n`);
  process.stdout.write(`[fixture] mcid distribution: page0={0,1} page1={2,3,4} page2={5}\n`);
}

main().catch((e) => {
  process.stderr.write(`[fixture] FAIL ${e.stack || e.message}\n`);
  process.exit(1);
});
