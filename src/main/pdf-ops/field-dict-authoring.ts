// Manual PDFDict authoring for AcroForm field types that pdf-lib doesn't
// expose via the high-level form.createXxx() API.
//
// Phase 3 covers the one gap pdf-lib leaves: signature placeholder fields
// (`/FT /Sig` with `/V` undefined). Authoring path is documented in
// `docs/form-engine.md §3.7` and mirrors the `/Ink` annotation hand-author
// pattern in `image-embed.ts` (`data-models.md §3.4`,
// `edit-replay-engine.md §5.2`).
//
// Pure helper. No FS, no DB, no logging. Mutates the in-flight `PDFDocument`
// (the caller's load+save shell serializes). Phase 4 will extend with a
// /ByteRange + PKCS#7 attachment when actual signing arrives.
//
// L-001 untouched (no BrowserWindow construction here).

import { PDFArray, PDFDict, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import type { PDFRef, PDFContext, PDFDocument, PDFPage } from 'pdf-lib';

import type { FormFieldDefinition } from '../../ipc/contracts.js';
import type { Result } from '../../shared/result.js';
import { fail, ok } from '../../shared/result.js';

export type SignaturePlaceholderError =
  | 'page_out_of_range'
  | 'duplicate_field_name'
  | 'authorship_failed';

export interface SignaturePlaceholderOk {
  fieldRef: PDFRef;
  widgetRef: PDFRef;
}

/**
 * Author a `/FT /Sig` field with one widget annotation. The field has no
 * `/V` (placeholder) and no appearance stream — viewers that support
 * unsigned signature fields (Acrobat) render a "Click to sign" affordance;
 * others may show an empty rectangle. Documented in user-guide §Forms.
 *
 * Why not pdf-lib's form.createXxx? pdf-lib has no createSignatureField;
 * the engine hand-authors the dict per ISO 32000 §12.7.4. The pattern is
 * the same one Phase 2 uses for /Ink annotation appearance streams.
 *
 * Note: the field is wired into the document's /AcroForm /Fields array
 * AND the target page's /Annots array. Both edges are required for the
 * field to be discoverable by `form.getFields()` after reload.
 */
export function createSignaturePlaceholder(
  doc: PDFDocument,
  fd: FormFieldDefinition,
): Result<SignaturePlaceholderOk, SignaturePlaceholderError> {
  if (fd.type !== 'signature') {
    return fail<SignaturePlaceholderError>(
      'authorship_failed',
      `createSignaturePlaceholder called with non-signature type '${fd.type}'`,
    );
  }

  const pageCount = doc.getPageCount();
  if (fd.pageIndex < 0 || fd.pageIndex >= pageCount) {
    return fail<SignaturePlaceholderError>(
      'page_out_of_range',
      `pageIndex ${fd.pageIndex} out of range (pageCount=${pageCount})`,
    );
  }

  let page: PDFPage;
  try {
    page = doc.getPage(fd.pageIndex);
  } catch (e) {
    return fail<SignaturePlaceholderError>(
      'page_out_of_range',
      `getPage threw: ${(e as Error).message}`,
    );
  }

  // Duplicate-name guard: walk /AcroForm /Fields for any field with /T == name.
  // We use a low-level walk (not form.getFieldMaybe) so this helper doesn't
  // require a fully-materialized PDFForm on call.
  if (acroFormHasFieldNamed(doc, fd.name)) {
    return fail<SignaturePlaceholderError>(
      'duplicate_field_name',
      `field name '${fd.name}' already exists`,
    );
  }

  try {
    const ctx = doc.context;
    // /Ff bit 2 (1-based) is Required → bit-mask 1 << 1 = 2
    const ffFlags = fd.required ? 2 : 0;

    const fieldDict = PDFDict.fromMapWithContext(
      new Map<PDFName, PDFNumber | PDFString | PDFName>([
        [PDFName.of('FT'), PDFName.of('Sig')],
        [PDFName.of('T'), PDFString.of(fd.name)],
        [PDFName.of('TU'), PDFString.of(fd.label || fd.name)],
        [PDFName.of('Ff'), PDFNumber.of(ffFlags)],
      ]),
      ctx,
    );

    const fieldRef = ctx.register(fieldDict);

    // Widget annotation: /Type /Annot /Subtype /Widget, attached to page.
    const widgetDict = PDFDict.withContext(ctx);
    widgetDict.set(PDFName.of('Type'), PDFName.of('Annot'));
    widgetDict.set(PDFName.of('Subtype'), PDFName.of('Widget'));
    const rectArray = PDFArray.withContext(ctx);
    rectArray.push(PDFNumber.of(fd.rect.x));
    rectArray.push(PDFNumber.of(fd.rect.y));
    rectArray.push(PDFNumber.of(fd.rect.x + fd.rect.width));
    rectArray.push(PDFNumber.of(fd.rect.y + fd.rect.height));
    widgetDict.set(PDFName.of('Rect'), rectArray);
    // /F bit 3 (1-based) = Print → 1 << 2 = 4
    widgetDict.set(PDFName.of('F'), PDFNumber.of(4));
    widgetDict.set(PDFName.of('P'), page.ref);
    widgetDict.set(PDFName.of('Parent'), fieldRef);

    const widgetRef = ctx.register(widgetDict);

    // The widget is the field's kid (single-widget field).
    const kidsArray = PDFArray.withContext(ctx);
    kidsArray.push(widgetRef);
    fieldDict.set(PDFName.of('Kids'), kidsArray);

    // Wire into the doc's /AcroForm /Fields.
    addToAcroFormFields(doc, fieldRef);

    // Wire the widget into the page's /Annots.
    addToPageAnnots(ctx, page, widgetRef);

    return ok({ fieldRef, widgetRef });
  } catch (e) {
    return fail<SignaturePlaceholderError>(
      'authorship_failed',
      `signature placeholder authorship threw: ${(e as Error).message}`,
    );
  }
}

// ============================================================================
// Internal helpers — minimal AcroForm + page-annot wiring without going
// through PDFForm (which would force a full form-tree materialization).
// ============================================================================

/**
 * Walk the doc's /AcroForm /Fields array. Returns true if any field's /T
 * matches `name`. Does NOT descend into nested fields (Phase 3 disallows
 * period-separated names per data-models §8.8).
 */
function acroFormHasFieldNamed(doc: PDFDocument, name: string): boolean {
  const acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!acroForm) return false;
  const fields = acroForm.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fields) return false;
  for (let i = 0; i < fields.size(); i += 1) {
    const fieldDict = fields.lookupMaybe(i, PDFDict);
    if (!fieldDict) continue;
    const t = fieldDict.lookupMaybe(PDFName.of('T'), PDFString);
    if (t && t.asString() === name) return true;
  }
  return false;
}

/**
 * Append a field-ref to /AcroForm /Fields. Creates /AcroForm and /Fields
 * if absent. Idempotent over the same ref.
 */
function addToAcroFormFields(doc: PDFDocument, fieldRef: PDFRef): void {
  const ctx = doc.context;
  let acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!acroForm) {
    acroForm = PDFDict.withContext(ctx);
    doc.catalog.set(PDFName.of('AcroForm'), acroForm);
  }
  let fields = acroForm.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fields) {
    fields = PDFArray.withContext(ctx);
    acroForm.set(PDFName.of('Fields'), fields);
  }
  // Avoid duplicate entries when called twice for the same ref (defensive).
  for (let i = 0; i < fields.size(); i += 1) {
    const existing = fields.get(i);
    if (existing === fieldRef) return;
  }
  fields.push(fieldRef);
}

/**
 * Append a widget ref to the page's /Annots array. Creates /Annots if absent.
 * Mirrors the /Ink-annotation pattern in `image-embed.ts`.
 */
function addToPageAnnots(ctx: PDFContext, page: PDFPage, widgetRef: PDFRef): void {
  const pageNode = page.node;
  let annots = pageNode.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) {
    annots = PDFArray.withContext(ctx);
    pageNode.set(PDFName.of('Annots'), annots);
  }
  annots.push(widgetRef);
}
