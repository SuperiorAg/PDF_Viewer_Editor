// Phase 4 (Wave 16, David) — Visual signature engine.
//
// Contract: docs/signature-engine.md §5; docs/architecture-phase-4.md §4 + §7.
//
// Visual signatures are APPEARANCE ONLY — they look like a signature but
// carry no cryptographic binding. The pipeline:
//
//   1. Compose the appearance image (typed / drawn / image) → see
//      signature-appearance.ts. Embeds the image XObject into the doc.
//   2. Locate the placeholder field (mode='placeholder') OR author a new
//      /FT /Sig field at the rect (mode='freeform').
//   3. Draw the appearance onto the target page at the widget rect.
//   4. Mark the field as visually-signed by setting /V to an EMPTY dict
//      (`<< >>`) per R-W15-D — distinguishes placeholder (no /V),
//      visual-signed (empty /V), and PAdES-signed (/V with /Contents).
//
// Pure function over (doc, input). No FS, no DB, no logging.
//
// File length justification: the placeholder-locate + appearance-draw +
// /V-marker write are interleaved with the appearance-stream composition
// and the field-dict authoring; splitting them risks losing the single
// transactional view of the widget mutation. Wave 17 Julian audits this
// surface for visual-vs-PAdES boundary correctness.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFSignature,
  PDFString,
  type PDFContext,
  type PDFPage,
} from 'pdf-lib';

import type { PdfRect, SignaturePlacement, VisualAppearanceSpec } from '../../ipc/contracts.js';
import { fail, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';

import { composeAppearance, drawAppearanceOnPage } from './signature-appearance.js';

export type ApplyVisualError =
  | 'load_failed'
  | 'placeholder_field_not_found'
  | 'placeholder_field_already_signed'
  | 'invalid_placement'
  | 'appearance_compose_failed'
  | 'serialize_failed';

export interface ApplyVisualInput {
  bytes: Uint8Array;
  placement: SignaturePlacement;
  appearance: VisualAppearanceSpec;
}

export interface ApplyVisualOk {
  newBytes: Uint8Array;
  /** The field name the signature was applied to (existing or newly authored). */
  fieldName: string;
  warnings: string[];
}

export type ApplyVisualResult = Result<ApplyVisualOk, ApplyVisualError>;

export async function applyVisualSignature(input: ApplyVisualInput): Promise<ApplyVisualResult> {
  // 1) Load the document.
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input.bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch (e) {
    return fail<ApplyVisualError>('load_failed', `pdf-lib load: ${(e as Error).message}`);
  }

  // 2) Resolve placement → (pageIndex, rect, fieldName, fieldRef).
  const resolved = resolvePlacement(doc, input.placement);
  if (!resolved.ok) return resolved as Result<never, ApplyVisualError>;
  const { pageIndex, rect, fieldName, fieldRef } = resolved.value;

  // 3) Compose appearance.
  const appearance = await composeAppearance(doc, {
    ...input.appearance,
    rect,
    signedAt: Date.now(),
  });
  if (!appearance.ok) {
    return fail<ApplyVisualError>('appearance_compose_failed', `compose: ${appearance.message}`);
  }

  // 4) Draw onto the page.
  const drew = await drawAppearanceOnPage(doc, pageIndex, appearance.value, rect);
  if (!drew.ok) {
    if (drew.error === 'page_out_of_range') {
      return fail<ApplyVisualError>('invalid_placement', drew.message);
    }
    return fail<ApplyVisualError>('appearance_compose_failed', drew.message);
  }

  // 5) Write empty /V <<>> marker to distinguish "visual-signed" from
  //    "placeholder" (R-W15-D). The empty dict is intentional: it tells our
  //    own form-engine that this field has been signed visually, while
  //    leaving the /Contents entry absent (which is how PAdES-signed fields
  //    are distinguished).
  try {
    const fieldDict = lookupFieldDict(doc, fieldRef);
    if (!fieldDict) {
      // Shouldn't happen; resolvePlacement returned a fieldRef.
      return fail<ApplyVisualError>(
        'placeholder_field_not_found',
        'field dict not resolvable post-resolve',
      );
    }
    const emptyV = PDFDict.withContext(doc.context);
    fieldDict.set(PDFName.of('V'), emptyV);
  } catch (e) {
    return fail<ApplyVisualError>('serialize_failed', `set /V threw: ${(e as Error).message}`);
  }

  // 6) Save.
  let newBytes: Uint8Array;
  try {
    newBytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  } catch (e) {
    return fail<ApplyVisualError>('serialize_failed', `save: ${(e as Error).message}`);
  }

  return ok({
    newBytes,
    fieldName,
    warnings: [...appearance.value.warnings, ...drewWarnings(drew)],
  });
}

// ============================================================================
// Placement resolution
// ============================================================================

interface ResolvedPlacement {
  pageIndex: number;
  rect: PdfRect;
  fieldName: string;
  fieldRef: PDFRef;
}

function resolvePlacement(
  doc: PDFDocument,
  placement: SignaturePlacement,
): Result<ResolvedPlacement, ApplyVisualError> {
  if (placement.mode === 'placeholder') {
    if (!placement.fieldName) {
      return fail<ApplyVisualError>('invalid_placement', "mode='placeholder' requires fieldName");
    }
    const found = findPlaceholderField(doc, placement.fieldName);
    if (!found) {
      return fail<ApplyVisualError>(
        'placeholder_field_not_found',
        `field '${placement.fieldName}' not found`,
      );
    }
    if (found.alreadySigned) {
      return fail<ApplyVisualError>(
        'placeholder_field_already_signed',
        `field '${placement.fieldName}' already has /V`,
      );
    }
    return ok({
      pageIndex: found.pageIndex,
      rect: found.rect,
      fieldName: placement.fieldName,
      fieldRef: found.fieldRef,
    });
  }

  // freeform
  if (placement.pageIndex === undefined || !placement.rect) {
    return fail<ApplyVisualError>('invalid_placement', "mode='freeform' requires pageIndex + rect");
  }
  if (placement.pageIndex < 0 || placement.pageIndex >= doc.getPageCount()) {
    return fail<ApplyVisualError>('invalid_placement', 'pageIndex out of range');
  }
  if (placement.rect.width <= 0 || placement.rect.height <= 0) {
    return fail<ApplyVisualError>('invalid_placement', 'rect width/height must be > 0');
  }
  // Author a NEW /FT /Sig field at the rect.
  const created = createSigFieldAt(
    doc,
    placement.pageIndex,
    placement.rect,
    `Signature_${Date.now()}`,
  );
  if (!created.ok) return created;
  return ok({
    pageIndex: placement.pageIndex,
    rect: placement.rect,
    fieldName: created.value.fieldName,
    fieldRef: created.value.fieldRef,
  });
}

interface PlaceholderFound {
  pageIndex: number;
  rect: PdfRect;
  fieldRef: PDFRef;
  alreadySigned: boolean;
}

function findPlaceholderField(doc: PDFDocument, fieldName: string): PlaceholderFound | null {
  // Use pdf-lib's high-level form API: doc.getForm() materializes the
  // /AcroForm tree (creating it if absent) and field.acroField provides
  // typed access to the underlying dict. The PDFSignature class identifies
  // /FT /Sig fields uniformly. Mirrors the form-engine.ts detection path.
  let form;
  try {
    form = doc.getForm();
  } catch {
    return null;
  }
  let field;
  try {
    field = form.getFieldMaybe(fieldName);
  } catch {
    return null;
  }
  if (!field) return null;
  if (!(field instanceof PDFSignature)) return null;

  const acroField = field.acroField;
  // pdf-lib's PDFAcroField exposes .ref (the field's PDFRef) and a dict.
  // We use the dict() method to write /V later.
  const fieldRef = acroField.ref;
  const fieldDict = acroField.dict;

  // Find widget rect + page.
  const widgets = acroField.getWidgets();
  if (widgets.length === 0) return null;
  const widget = widgets[0];
  if (!widget) return null;
  const rectArr = widget.Rect();
  if (!rectArr || rectArr.size() < 4) return null;
  const x = numAt(rectArr, 0);
  const y = numAt(rectArr, 1);
  const x2 = numAt(rectArr, 2);
  const y2 = numAt(rectArr, 3);
  const rect: PdfRect = { x, y, width: x2 - x, height: y2 - y };

  // Find the page that owns this widget. The widget dict carries a /P
  // entry pointing at its host page; we match that ref against each page's
  // ref to find the page index.
  const widgetDict = widget.dict;
  const pRefRaw = widgetDict.get(PDFName.of('P'));
  const pRef = pRefRaw instanceof PDFRef ? pRefRaw : null;
  const pages = doc.getPages();
  let pageIndex = 0;
  for (let i = 0; i < pages.length; i += 1) {
    const p = pages[i];
    if (!p) continue;
    if (pRef && p.ref === pRef) {
      pageIndex = i;
      break;
    }
  }

  const v = fieldDict.lookupMaybe(PDFName.of('V'), PDFDict);
  const alreadySigned = v !== undefined && v !== null;

  return { pageIndex, rect, fieldRef, alreadySigned };
}

function numAt(arr: PDFArray, index: number): number {
  const obj = arr.get(index);
  if (obj instanceof PDFNumber) return obj.asNumber();
  return 0;
}

function lookupFieldDict(doc: PDFDocument, fieldRef: PDFRef): PDFDict | null {
  // doc.context.lookup may return the dict directly OR a PDFRef that needs
  // further deref; PDFRef-typed lookup returns the dict.
  try {
    const d = doc.context.lookup(fieldRef);
    return d instanceof PDFDict ? d : null;
  } catch {
    return null;
  }
}

interface CreateSigFieldOk {
  fieldRef: PDFRef;
  fieldName: string;
}

function createSigFieldAt(
  doc: PDFDocument,
  pageIndex: number,
  rect: PdfRect,
  fieldName: string,
): Result<CreateSigFieldOk, ApplyVisualError> {
  let page: PDFPage;
  try {
    page = doc.getPage(pageIndex);
  } catch (e) {
    return fail<ApplyVisualError>('invalid_placement', `getPage: ${(e as Error).message}`);
  }
  const ctx: PDFContext = doc.context;

  const fieldDict = PDFDict.withContext(ctx);
  fieldDict.set(PDFName.of('FT'), PDFName.of('Sig'));
  fieldDict.set(PDFName.of('T'), PDFString.of(fieldName));
  fieldDict.set(PDFName.of('Ff'), PDFNumber.of(0));
  const fieldRef = ctx.register(fieldDict);

  const widgetDict = PDFDict.withContext(ctx);
  widgetDict.set(PDFName.of('Type'), PDFName.of('Annot'));
  widgetDict.set(PDFName.of('Subtype'), PDFName.of('Widget'));
  const rectArray = PDFArray.withContext(ctx);
  rectArray.push(PDFNumber.of(rect.x));
  rectArray.push(PDFNumber.of(rect.y));
  rectArray.push(PDFNumber.of(rect.x + rect.width));
  rectArray.push(PDFNumber.of(rect.y + rect.height));
  widgetDict.set(PDFName.of('Rect'), rectArray);
  widgetDict.set(PDFName.of('F'), PDFNumber.of(4));
  widgetDict.set(PDFName.of('P'), page.ref);
  widgetDict.set(PDFName.of('Parent'), fieldRef);
  const widgetRef = ctx.register(widgetDict);

  const kidsArray = PDFArray.withContext(ctx);
  kidsArray.push(widgetRef);
  fieldDict.set(PDFName.of('Kids'), kidsArray);

  // Wire into /AcroForm /Fields.
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
  fields.push(fieldRef);

  // Wire widget into page /Annots.
  let annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) {
    annots = PDFArray.withContext(ctx);
    page.node.set(PDFName.of('Annots'), annots);
  }
  annots.push(widgetRef);

  return ok({ fieldRef, fieldName });
}

function drewWarnings(_drew: Result<{ font: unknown }, string>): string[] {
  return [];
}
