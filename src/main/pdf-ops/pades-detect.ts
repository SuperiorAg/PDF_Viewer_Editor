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

import { PDFName } from 'pdf-lib';
import type { PDFDocument, PDFDict } from 'pdf-lib';

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
      // the acroField's PDFDict.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acro: any = (field as unknown as { acroField?: unknown }).acroField;
      if (!acro) continue;
      const dict = acro.dict as PDFDict | undefined;
      if (!dict || typeof dict.get !== 'function') continue;

      const ft = dict.get(PDFName.of('FT'));
      // /FT serializes as `/Sig` (PDFName).toString returns the leading slash.
      // Robust check: stringify and look for 'Sig' (handles both inherited
      // and direct PDFName instances).
      if (!ft || !String(ft).includes('Sig')) continue;

      // /V is the signature value dict; it MUST be present for a signed
      // widget. Unsigned placeholder fields (Phase 3 form-design) have NO
      // /V entry.
      const v = dict.get(PDFName.of('V'));
      if (!v) continue;

      // /V is itself a PDFDict with a /Contents key holding the CMS bytes
      // (PDFHexString or PDFString). pdf-lib's PDFDict has both `.dict`
      // (which is itself a reference to this dict) AND a top-level `.get()`.
      // Try both code paths defensively.
      let contents: unknown;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vAny: any = v;
        contents = vAny.get
          ? vAny.get(PDFName.of('Contents'))
          : vAny.dict?.get?.(PDFName.of('Contents'));
      } catch {
        continue;
      }
      if (!contents) continue;
      // PDFHexString / PDFString surface their bytes via `.asString()` or
      // `.toString()`. Either way, length > 2 (i.e. NOT just an empty
      // `<>` placeholder reservation) signals a real signature.
      let asStr: string;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c: any = contents;
        asStr = typeof c.asString === 'function' ? c.asString() : String(c);
      } catch {
        continue;
      }
      // Empty `<>` is the unsigned placeholder; >2 chars means real bytes.
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
