// Phase 7.5 Wave 5d follow-up (David, 2026-06-18) — pure-pdf-lib per-page
// image XObject scan.
//
// What this module does:
//   Walk every page in the doc, inspect its /Resources/XObject dict, and
//   report whether at least one XObject with `/Subtype /Image` is present.
//   Used by the production accessibility extractor in `src/ipc/register.ts`
//   to feed `PageTextDiagnostic.hasImageXObject` to the
//   `a11y.content.non-text-tagged` + `a11y.content.scanned-searchable`
//   rules.
//
// Why pure pdf-lib (not pdf.js):
//   The signal we need ("does this page reference at least one image
//   XObject?") is a structural property of the page's Resources dict.
//   pdf-lib already has the doc loaded; calling out to pdf.js to walk the
//   operator list would be heavier machinery for a strictly less precise
//   signal (pdf.js's getOperatorList sees inline images too but doesn't
//   give us a cleaner result for THIS rule's purpose). Cleaner separation:
//   text counting → pdf.js (it owns getTextContent); image-XObject
//   detection → pdf-lib (it owns the Resources walk).
//
// What this module does NOT do (honest deferrals):
//   - Inline images (BI..EI in content streams). Inline images are rare in
//     practice and a strict scanned-page detector would need to walk the
//     content stream. v0.8.0 accepts the false-negative — the
//     'scanned-pages-searchable' rule errs on the side of "pass" for
//     inline-image pages, which is the safer direction for an a11y
//     warning (we'd rather miss a flag than falsely accuse a doc).
//   - Image XObjects referenced from form XObjects (/Subtype /Form). A
//     Form XObject can in turn reference image XObjects in its own
//     Resources. v1 doesn't recurse — the typical case has the image
//     directly on the page's Resources/XObject. Recursing one level is a
//     small follow-up if the false-negative rate is too high in practice.
//
// Locked-instruction compliance:
//   - L-001..L-006 (no BrowserWindow, pure pdf-lib module, no test
//     channel, no pdf.js direct import).

import { PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from 'pdf-lib';

/** Per-page result. `pageIndex` mirrors `PageTextDiagnostic.pageIndex`. */
export interface PageImageXObjectFlag {
  pageIndex: number;
  hasImageXObject: boolean;
}

/** Load the doc once and return a flag per page. Loads with
 *  `throwOnInvalidObject: false` to match the accessibility engine's
 *  defensive parse — a partially malformed Resources dict on one page
 *  shouldn't kill the run. */
export async function scanPagesForImageXObject(
  pdfBytes: Uint8Array,
): Promise<PageImageXObjectFlag[]> {
  const doc = await PDFDocument.load(pdfBytes, {
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
  return scanPagesForImageXObjectFromDoc(doc);
}

/** Same as `scanPagesForImageXObject` but takes a pre-loaded doc. Useful
 *  if a caller has already paid the load cost. */
export function scanPagesForImageXObjectFromDoc(doc: PDFDocument): PageImageXObjectFlag[] {
  const out: PageImageXObjectFlag[] = [];
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    if (!page) continue;
    let has = false;
    try {
      const resources = page.node.lookupMaybe(PDFName.of('Resources'), PDFDict);
      if (resources) {
        const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
        if (xobjects) {
          for (const [, value] of xobjects.entries()) {
            // Image XObjects are encoded as PDFStream (the stream's .dict
            // carries /Subtype /Image). Form XObjects are also streams.
            // Indirect refs are common in practice — resolve them.
            let xoDict: PDFDict | undefined;
            const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value;
            if (resolved instanceof PDFStream) {
              xoDict = resolved.dict;
            } else if (resolved instanceof PDFDict) {
              xoDict = resolved;
            }
            if (!xoDict) continue;
            const subtype = xoDict.lookupMaybe(PDFName.of('Subtype'), PDFName);
            // PDFName.asString() returns '/Image' (with the leading slash)
            // in pdf-lib's representation. Compare against both forms to
            // be defensive — if pdf-lib's stringification ever changes we
            // still match.
            if (subtype) {
              const s = subtype.asString();
              if (s === '/Image' || s === 'Image') {
                has = true;
                break;
              }
            }
          }
        }
      }
    } catch {
      // A malformed Resources dict on a single page → honest "false".
      // The whole-doc run continues; the rule sees this page as having
      // no image, which is a safer false-negative for an a11y warning.
      has = false;
    }
    out.push({ pageIndex: i, hasImageXObject: has });
  }
  return out;
}
