// Phase 5 — PAdES signature detection helper.
//
// Used by the OCR handlers (and Wave 21 by future content-mutating handlers
// per conventions §16.5) to detect when a document carries a prior PAdES
// signature. Returns the list of /Sig widget field names with non-empty
// /V Contents — those are the cryptographic signatures that any subsequent
// content-mutating op (OCR, edit, etc.) will invalidate.
//
// FAST, READ-ONLY: walks the AcroForm field tree; does NOT mutate the doc.
//
// Cross-ref: docs/ocr-engine.md §8.1 + docs/architecture-phase-5.md §6.1.
//
// INDIRECT-REFERENCE HANDLING (Phase 7.2 7.2.5, David, 2026-06-10):
//   Real-world PAdES-signed PDFs (Adobe Acrobat, DocuSign, Adobe Sign, AND
//   node-signpdf v3 `plainAddPlaceholder`) write the /V signature value as
//   an INDIRECT REFERENCE (PDFRef → separate object), not as an inline
//   PDFDict. /FT and /Contents can also be indirect under aggressive
//   object-stream packing. Reading via the raw `dict.get(name)` returns the
//   un-resolved PDFRef, on which `.get(...)` does not exist; the prior
//   detector implementation silently fell through and returned `[]` for
//   every real-world signed PDF. We now route every dict-typed read through
//   pdf-lib's `dict.lookupMaybe(name, Type)`, which transparently resolves
//   PDFRefs via the document's PDFContext and returns `undefined` when the
//   value isn't of the expected type. The detector therefore handles BOTH
//   inline-dict and indirect-ref shapes correctly. The fixture-generator
//   workaround (`inlineSignatureDict` in
//   tests/fixtures/pdfs/scripts/generate-signed-fixture.mjs) is now
//   redundant — but kept in place because its byte-range-invalidating side
//   effect is independent of detection.

import { PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import type { PDFDocument } from 'pdf-lib';

/**
 * Detect prior PAdES signatures. Returns the field-name list (e.g.
 * `['Signature1']`) of /Sig widgets carrying a non-empty /V /Contents.
 *
 * An empty array means "no prior PAdES signatures present" — the doc is
 * safe to mutate without invalidating any signature.
 *
 * NEVER throws. Defensive against malformed PDFs (returns empty array on
 * any internal traversal failure — the caller's pre-flight is the load-
 * bearing check, not this helper).
 *
 * Handles BOTH inline-dict /V (Phase 3 hand-authored placeholders, our own
 * test fixtures) AND indirect-ref /V (node-signpdf, Acrobat, DocuSign —
 * every real-world PAdES tool) via `lookupMaybe`. /FT and /Contents are
 * resolved the same way for safety against deeply object-stream-packed
 * signed PDFs.
 */
export function detectPriorPadesSignatures(doc: PDFDocument): string[] {
  const out: string[] = [];
  try {
    const form = doc.getForm();
    for (const field of form.getFields()) {
      // Each field has an `acroField` with a `.dict` (a PDFDict).
      // After save+reload, pdf-lib auto-instantiates the typed subclass
      // (PDFAcroSignature for /FT=/Sig); `getType()` may not exist on
      // every subclass. The robust approach is to read /FT directly from
      // the acroField's PDFDict via lookupMaybe so indirect refs resolve.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acro: any = (field as unknown as { acroField?: unknown }).acroField;
      if (!acro) continue;
      const dict = acro.dict as PDFDict | undefined;
      if (!dict || typeof dict.lookupMaybe !== 'function') continue;

      // /FT is a PDFName; lookupMaybe(name, PDFName) resolves PDFRefs AND
      // type-guards. A non-/Sig (or absent) result skips the field.
      const ft = dict.lookupMaybe(PDFName.of('FT'), PDFName);
      if (!ft) continue;
      // PDFName.toString() emits the leading slash (`/Sig`); the exact-match
      // check is cleaner than the prior includes('Sig') heuristic AND avoids
      // false-positive matches on names like /SigFlags, /Signature.
      if (ft !== PDFName.of('Sig')) continue;

      // /V is the signature value dict. node-signpdf v3 stores it as an
      // indirect ref; Adobe Acrobat / DocuSign / Adobe Sign do too. Inline
      // PDFDict (our own hand-authored test fixtures) is also valid. Both
      // shapes resolve through lookupMaybe.
      const vDict = dict.lookupMaybe(PDFName.of('V'), PDFDict);
      if (!vDict) continue;

      // /Contents holds the CMS bytes. Typically PDFHexString; PDFString is
      // also valid per ISO 32000 §12.8.1. Both can be indirect refs under
      // object-stream packing — lookupMaybe handles both transparently.
      const contents = vDict.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString);
      if (!contents) continue;

      // PDFHexString / PDFString surface their bytes via `.asString()` /
      // `.toString()`. The empty `<>` placeholder reservation is 2 chars;
      // real signatures are thousands. Use the conservative >2 floor.
      let asStr: string;
      try {
        asStr =
          typeof (contents as { asString?: () => string }).asString === 'function'
            ? (contents as { asString: () => string }).asString()
            : String(contents);
      } catch {
        continue;
      }
      if (asStr.length > 2) {
        out.push(field.getName());
      }
    }
  } catch {
    // Defensive: pdf-lib's AcroForm API can throw on malformed PDFs.
    // The IPC handler does NOT depend on this for safety; an empty array
    // means "no prior signatures detected" which the handler treats as
    // "OK to OCR without confirm". That matches Phase 4 forms-detect.ts
    // behavior on malformed forms — we don't fail-close because a
    // malformed AcroForm is not itself evidence of a signature.
    return [];
  }
  return out;
}
