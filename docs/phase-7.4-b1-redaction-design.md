# Phase 7.4 B1 — Redaction Design (Wave 1)

**Owner:** Riley (front-end-architect)
**Status:** Wave 1 draft, 2026-06-15. Hands off to David (IPC + engine, Wave 2) + Riley (UI, Wave 2) + Julian (review, Wave 3).
**Brief:** `docs/acrobat-parity-audit.md` §4 Bucket B1 ("the Acrobat parity gap most-cited by enterprise/legal customers").
**Predecessors:** `docs/architecture-phase-7.md`, `docs/api-contracts.md §18`, `docs/data-models.md §10` (OCR PAdES-invalidation precedent), `docs/conventions.md §16.5` (signed-PDF-confirm pattern), `src/main/pdf-ops/pades-detect.ts`, `src/main/pdf-ops/ocr-bootstrap.ts` (rasterize-prod path), `src/main/pdf-ops/combine.ts` (pdf-lib copy-page pattern).
**Out of scope for THIS wave:** any code in `src/`, the UI build, tests. This is a design-only doc.

---

## 0. TL;DR

| Decision     | Pick                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **1. Path**  | **R1 — Rasterize-redact** for v1. Correctness over searchability; R2/R3 deferred to a future phase.                                  |
| **2. UX**    | Redaction sub-toolbar (mirrors `ShapeToolbar` / `FormDesignerToolbar`); `Mark Rectangle` tool; preview overlay; modal Apply confirm. |
| **3. IPC**   | One channel: `pdf:applyRedactions`. No preview channel (renderer-side overlay is enough).                                            |
| **4. Sanit** | Strip `/Info`, XMP, doc-level + named-action JS, embedded files, document outline, AcroForm tree, all annotations on redacted pages. |
| **5. PAdES** | Reuse `detectPriorPadesSignatures`; if signatures present, second-step confirm + auto-invalidate via a NEW backref column.           |
| **6. Files** | David: engine + handler + tests. Riley (Wave 2): slice + sub-toolbar + modal + i18n.                                                 |
| **7. Tests** | Unit (David): text-extract == empty on redacted rect; multi-rect/page; sanitize asserts; PAdES backref. E2e (Diego, optional).       |

**The non-negotiable:** v1 MUST produce a redacted PDF where the redacted bytes are _not recoverable_ by any text-extract / copy-paste / "search inside file" path. We achieve this by replacing the entire page's content stream with a rasterized image with black rectangles burned in. Acrobat's R2 behaviour (preserve searchability outside the rect) is a v2 enhancement — explicitly deferred.

---

## 1. Decision 1 — Implementation path (R1 / R2 / R3)

### 1.1 Pick: **R1 (rasterize-redact)** for v1

**Rationale paragraph 1 — correctness budget.** Redaction is a security feature. A redaction tool that _looks_ right but leaves recoverable bytes underneath is worse than no redaction tool at all: the user thinks they're safe and ships a document that leaks. Adobe's own decades-old reputational scar tissue (the 2008 TSA redaction leak, the 2010 DOJ-Manning failure, the 2023 NY Times court-filing leak) is the same failure mode every time — a black rectangle drawn _over_ text rather than replacing it. R1 makes that failure mode structurally impossible: there are no underlying bytes to recover because the entire page content stream is replaced with a raster image into which the black rectangle is burned. The text doesn't exist in the output PDF in any form. Compare R2, where correctness depends on correctly identifying _every_ `Tj` / `TJ` / `'` / `"` operator whose glyph bounding box intersects the rect — a textbook missed-edge-case domain (CID fonts, embedded subsets, ligatures, overlapping glyphs, off-page text, rotated runs). pdf-lib gives us no first-class content-stream walker; David would have to write one. The probability of shipping R2 with a correctness hole on real-world PDFs is high. The probability of shipping R1 with a correctness hole is essentially zero (the failure mode collapses to "rasterizer skipped the page", which is loud, not silent).

**Rationale paragraph 2 — cost & reuse.** We already own the rasterize pipeline. Phase 5 ships `rasterizePageProd` in `src/main/pdf-ops/ocr-bootstrap.ts` (line 724) — production-grade pdfjs-dist raster at configurable DPI through the L-005-compliant `loadPdfJs` helper with the L-004-compliant `toPdfJsBuffer` copy. The Phase 6 export-to-image pipeline rasterizes the same way. R1 redaction is "rasterize the page, draw black rectangles on the raster via `@napi-rs/canvas`, embed the PNG as the new page via `pdf-lib`'s `embedPng()` + a 1-page replacement, repeat per redacted page". Each step has a green-on-CI precedent. R2 in contrast adds a brand-new content-stream parser to the main process — not free, not reused, and the test surface to prove it correct is 10x R1's. R1 ships in one wave; R2 is a separate phase. The shipped-correctness trade-off is: R1 wins on safety; R2 wins on searchability + file size. For v1 we pick safety. The audit (`acrobat-parity-audit.md §4 B1`) explicitly named "enterprise/legal" as the demand population — they prioritize "the bytes are gone" over "the rest of the page is still searchable". For most legal redaction workflows the _whole page_ is what's at issue anyway (privilege review, PII strikethrough of a witness statement).

**What R1 gives up, made explicit (trust-floor obligation #B1-1):**

> "Redacted pages become rasterized images. The non-redacted text on those pages is no longer searchable until you re-run OCR. To preserve searchability of non-redacted text, re-run OCR after applying redactions — the Phase 5 OCR pipeline re-creates a searchable text layer behind the raster."

This is honest. The user-guide and the Apply-confirm modal both surface it (§2.4 below).

### 1.2 R2 deferred to a future phase — when it becomes worth it

The path to R2 is real and we should document it so we don't forget. The shape is roughly:

1. Walk every page's content-stream operators via pdf-lib's `PDFContentStream.parse()` (currently undocumented, accessible via `page.node.normalize()` then `getContents()`).
2. For each text-show operator (`Tj`, `'`, `"`, `TJ`), compute the glyph bounding box in user space by tracking the current CTM + text-matrix state. Reject if the font is a CID subset where glyph metrics aren't enumerable (fall back to R1 on that page).
3. If the glyph bbox intersects any redaction rect on that page, replace the text-show with a width-equivalent whitespace run (or a content-stream-level no-op + a black-rect draw).
4. Re-serialize the page.
5. Sanitize the same things R1 sanitizes (§4 below — sanitize is path-orthogonal).

The deferral criterion is: when at least one enterprise customer cites "searchability after redaction" as a blocker AND we have the engineering budget for ~3-4 weeks of content-stream-walker work + a large fixture corpus. Until then, R1 + a post-redaction "Run OCR" call is the documented workflow.

### 1.3 R3 (hybrid) — never

R3's selling point evaporates the moment you accept the R2 trade-off table: per-page R2 with R1 fallback means the user can't predict whether their output will be searchable until they look at it. That's worse UX than "all R1, always". If we ship R2 it should be R2 everywhere or fall back to R1 + a loud warning at apply time — not a silent mix.

---

## 2. Decision 2 — UI / UX shape

### 2.1 Surface pattern — follow ShapeToolbar / FormDesignerToolbar

**Surface:** A new `RedactionToolbar` sub-component at `src/client/components/redaction-tools/redaction-toolbar.tsx`, mounted from `app.tsx` exactly like `ShapeToolbar` (`shape-toolbar.tsx`). Returns `null` when its open flag (`ui.redactionPanelOpen`) is false. Mirrors the Phase 7.4 A5 mount pattern Riley shipped for shapes (see `src/client/components/shape-tools/shape-toolbar.tsx:99-155`).

**Toolbar button:** A new toolbar entry in the Annotation group of `src/client/components/toolbar/index.tsx` titled "Redact" with icon `square-dashed` (Lucide) — `aria-pressed` reflects `ui.redactionPanelOpen`. Click toggles the sub-toolbar.

**Menu mirror (per `acrobat-parity-audit.md §3.5` marking convention):** A new "Tools → Redact…" entry that does the same dispatch.

**Acrobat parity placement:** Acrobat puts Redact under the right-rail "Tools" panel. We're a toolbar-first app, so the equivalent is a dedicated toolbar button + Tools-menu mirror.

### 2.2 Sub-toolbar contents

Five buttons in a single `role="toolbar"` with the same hardcoded-Esc-closes pattern as `ShapeToolbar`:

| #   | Button                       | Tooltip + shortcut                                                              | Visual state                                                                | Notes                                           |
| --- | ---------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | **Mark Rectangle**           | "Mark area for redaction (R)"                                                   | `aria-pressed` when `redactions.activeTool === 'rect'`                      | Default tool when sub-toolbar opens.            |
| 2   | **Mark Text** (v1: deferred) | "Mark text for redaction — coming in v2" (disabled, tooltip cites the deferral) | always disabled in v1                                                       | Honest disabled — no toast lie (§7 surprise 2). |
| 3   | **Show Markups**             | "Preview markups (no PDF mutation yet)"                                         | `aria-pressed`; default ON when sub-toolbar opens                           | Toggles overlay layer; client-side only.        |
| 4   | **Clear Marks**              | "Remove all pending redaction marks"                                            | disabled when `redactions.byPage` is empty                                  | Confirms with `window.confirm` if N≥5 marks.    |
| 5   | **Apply Redactions**         | "Apply and sanitize — IRREVERSIBLE (Shift+Ctrl+Y)"                              | disabled when `redactions.byPage` is empty; "danger" style (red background) | Opens the Apply modal (§2.4).                   |

**Keyboard shortcut for Apply:** `Shift+Ctrl+Y`. Cites Acrobat's "Apply Redactions" Shift+Ctrl+Y verbatim. Register in `src/client/shortcuts.ts` under id `redaction.apply` with `enabledWhen: (s) => s.ui.redactionPanelOpen && s.redactions.totalMarks > 0`.

**Keyboard shortcut for tool:** `R` to enter Mark Rectangle when the sub-toolbar is open (consistent with `H`/`S`/`T` annotation-tool single-letter convention).

**Esc behaviour:** Esc with focus inside the sub-toolbar closes it but **does NOT clear marks**. Marks persist in the slice until explicit Clear or successful Apply. This matches Acrobat: re-opening the redaction tool re-shows pending marks. Esc-clears is a footgun.

### 2.3 Mark visualization (renderer-only; no main mutation until Apply)

While the sub-toolbar is open AND `Show Markups` is on, an SVG overlay layer on top of each `pdf-canvas` paints a red-outlined rectangle for each pending mark on that page. Outline only (not filled) so the underlying text remains visible for the user to verify "yes, that's what I want gone". On hover the outline thickens; right-click context-menu offers "Remove this mark".

When `Show Markups` is OFF, the overlay paints a fully-opaque black rectangle for each mark — a "preview of what Apply will look like". This is the WYSIWYG affordance Acrobat ships as "Show Redactions Properties → Use overlay text".

Both views are **client-side only**. The PDF on disk is untouched until Apply. No IPC channel is needed for preview (this is Decision 3's "no preview channel" rationale).

### 2.4 Apply confirmation modal (`role="alertdialog"` per `conventions.md §16.5`)

A blocking modal — NOT a `window.confirm`, because the copy is too important to truncate.

**Title:** "Apply redactions — this cannot be undone"

**Body (i18n keys under `redaction:applyConfirm.*`):**

```
You are about to redact <N> area(s) across <M> page(s).

After Apply:
  • The marked content will be permanently removed from the PDF.
  • Redacted pages will become rasterized images. Non-redacted text on those
    pages will not be searchable until you re-run OCR (Tools → Run OCR).
  • Document metadata, embedded files, JavaScript, and annotations on
    redacted pages will be removed.
  • This action cannot be undone, and is NOT part of the editor's undo stack.

The original file on disk is unchanged until you Save. You may Cancel and
the marks remain pending.
```

**If signatures detected** (see Decision 5), append a second paragraph BEFORE the buttons:

```
This document carries <N> digital signature(s):
  • <field-name-1>
  • <field-name-2>
Applying redaction will invalidate every signature listed. The signature audit
panel will be updated to reflect this.
```

**Buttons:** `Cancel` (focus default, Esc closes) + `Apply` (red, requires explicit click — no keyboard "Enter" shortcut on this button per the destructive-action discipline; user must click).

**Why `role="alertdialog"`:** matches the OCR-signed-PDF-confirm modal (`conventions.md §16.5`); Narrator reads the full body before announcing the buttons. Trust-floor pattern: the user reads the obligation at the moment of action, not in a docs file.

### 2.5 State indication

**Status-bar widget** (left of the page indicator): `<N> redaction marks pending on <M> pages — Apply…` when `redactions.totalMarks > 0`. Clicking opens the sub-toolbar (if closed) and scrolls to the first marked page. Disappears when marks are cleared or applied.

**Per-page count** in the thumbnail strip (small red dot + count overlaid on a thumbnail when that page has pending marks). Reuses the thumbnail-overlay machinery from the bookmarks-edit-mode indicator.

### 2.6 The slice — `redactions-slice.ts`

```ts
// src/client/state/slices/redactions-slice.ts (Riley Wave 2 — DESIGN SHAPE)

export type RedactionTool = 'rect' | null;

export interface RedactionRect {
  /** Stable id (uuid) so the overlay can key-and-Remove individual marks. */
  id: string;
  /** Page index (0-based). */
  pageIndex: number;
  /** PDF user-space rect (data-models.md §3.5 coords). */
  rect: PdfRect;
  /** ms epoch when added — for "last added" UI. */
  createdAt: number;
}

export interface RedactionsState {
  /** Active tool inside the sub-toolbar. Null when no tool is armed. */
  activeTool: RedactionTool;
  /** Per-page marks; sparse map, page index → mark list. */
  byPage: Record<number, RedactionRect[]>;
  /** Sum of marks across pages — cached selector value mirror. */
  totalMarks: number;
  /** When Apply is in flight, blocks the UI. */
  applying: boolean;
  /** Last Apply outcome surface for inline error display. */
  lastApplyError: 'invalid_payload' | 'handle_not_found' | 'engine_failed' | 'cancelled' | null;
}

// Actions:
// - setActiveTool(tool: RedactionTool)
// - addMark({ pageIndex, rect })          // synthesizes id + createdAt
// - removeMark({ pageIndex, id })
// - clearMarks()
// - setApplying(b: boolean)
// - setApplyError(e | null)
```

The slice is **per-edit-session** — it does NOT persist to SQLite. Closing the document or quitting the app discards pending marks. This matches Acrobat (pending marks are session-scope) and avoids a Phase-7.4 SQLite schema bump for what's an in-flight UI state.

### 2.7 ARIA / a11y (per `docs/a11y-audit.md` + conventions §18.3)

- The sub-toolbar uses `role="toolbar"` + `aria-label={t('redaction:toolbarLabel')}` (mirrors `ShapeToolbar`).
- The overlay layer uses `role="img"` + `aria-label={t('redaction:overlayPageLabel', { count, page })}` so Narrator announces "3 redaction marks on page 7".
- The Apply modal is `role="alertdialog"` with `aria-labelledby` on the title + `aria-describedby` on the body.
- Focus management: opening the sub-toolbar focuses the Mark Rectangle button (same `useEffect` pattern as `ShapeToolbar:110-114`).
- All keys i18n-wrapped (en-US + es-ES, per Phase 7 obligation #4 — the es-ES strings are a proof-locale sample; trust-floor copy in the locale picker subtext already covers this).

---

## 3. Decision 3 — IPC contract

### 3.1 Channel: `pdf:applyRedactions`

```ts
// src/ipc/contracts.ts — NEW additions (Phase 7.4 B1)
//
// One channel. Renderer previews marks client-side; nothing crosses IPC until
// Apply. Returns sanitized bytes (or a path token for large outputs — see §3.3).

export interface RedactionRectIpc {
  /** PDF user-space rect (data-models.md §3.5; same shape as PdfRect used elsewhere). */
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfApplyRedactionsRequest {
  handle: DocumentHandle;
  /** Flat list — pageIndex is on each item for serialization simplicity. */
  redactions: RedactionRectIpc[];
  /**
   * Set to true after the user confirmed the signature-invalidation step
   * in the Apply modal. Mirror of OcrRunOnDocument's
   * `invalidatesSignaturesConfirmed` (see ocr-run-on-document.ts:179).
   * If absent / false and signatures are present, handler returns
   * `signed_pdf_requires_confirm` with the field-name list so the renderer
   * can re-prompt.
   */
  invalidatesSignaturesConfirmed?: boolean;
  /** DPI at which redacted pages are rasterized. Default 200; see §1.2 trade-off. */
  rasterDpi?: number;
}

export type PdfApplyRedactionsError =
  | 'invalid_payload' // zod failed at boundary
  | 'handle_not_found' // doc handle stale
  | 'no_redactions' // redactions[] empty
  | 'page_out_of_range' // a rect references a page beyond pageCount
  | 'rect_invalid' // negative width/height or off-page
  | 'signed_pdf_requires_confirm' // PAdES present + not confirmed (data carries field-name list)
  | 'pdf_load_failed' // pdf-lib load threw
  | 'rasterize_failed' // pdfjs page render threw
  | 'engine_failed' // generic catch-all with safeMessage
  | 'output_too_large' // sanitized output > MAX_OUTPUT_BYTES (mirrors combine §7.1)
  | 'cancelled'; // user cancelled mid-Apply (deferred to v2; spec'd for forward-compat)

export interface PdfApplyRedactionsValue {
  /**
   * The sanitized output bytes. Renderer writes via fs:writePdf (or refreshes
   * document-store via setBytes, then prompts Save As). See §3.3 on size.
   */
  bytes: Uint8Array;
  /** Counts for the post-Apply toast. */
  pagesRedacted: number;
  rectsApplied: number;
  /** True iff a prior PAdES signature was invalidated (audit-log already updated). */
  invalidatedSignatures: boolean;
  /** Field-name list of invalidated signatures (empty if none). */
  invalidatedSignatureFields: string[];
  /** Honest warning strings. Always populated with "non-redacted text is no
   *  longer searchable — re-run OCR" when at least one page was rasterized. */
  warnings: string[];
}

export type PdfApplyRedactionsResponse = Result<PdfApplyRedactionsValue, PdfApplyRedactionsError>;
```

### 3.2 Channel registration

- Channel name: `'pdf:applyRedactions'` (follows `pdf:*` convention; new entry in `Channels` const at `src/ipc/contracts.ts:3236`).
- Preload bridge: `window.pdfApi.pdf.applyRedactions(req)` — extends the existing `pdf` sub-namespace (see `PdfApi.pdf` at `contracts.ts:3387`).
- Handler: `src/ipc/handlers/pdf-apply-redactions.ts` (David, Wave 2). Pattern matches `pdf-combine.ts` (zod safeParse → engine call → Result wrap).
- Registered in `src/ipc/register.ts` next to the existing `pdf:*` registrations.

### 3.3 No preview channel

Per Decision 2, mark preview is renderer-only (SVG overlay). We do NOT add `pdf:previewRedaction`. Reasoning:

1. The renderer already has the rasterized page (pdf.js text layer + canvas) and can draw arbitrary overlays cheaply.
2. A preview channel means main raster work happens every mouse-up — bad budget.
3. The "what will Apply look like" is conveyed by the `Show Markups` OFF state (fully-opaque black rectangle on top of the rendered page) — a faithful preview that doesn't need main intervention.
4. Adding a channel we don't need violates the "minimal IPC surface" discipline (`conventions.md §11`).

### 3.4 Size — the >50 MB streaming variant (mirrors `pdf:export`)

For documents large enough that the sanitized output bytes are unwieldy across IPC (the `pdf:export` precedent at `api-contracts.md §7.2` cites 50 MB as the cutoff), the handler returns a _path token_ via the existing `consumeDestinationToken` document-store pattern instead of inline `bytes`. The renderer then `fs:readBytesByHandle` or routes through `dialog:saveAs`. **Decision for v1:** ship inline-bytes only; flag the cutoff as a v2 follow-up. Same calibration cliff `pdf:export` faces — and on real-world redaction inputs (legal contracts, scanned discovery), 50 MB is well above the 95th percentile. If we hit the cliff in QA, lift the precedent.

### 3.5 Error mapping → renderer UI

| Error                         | Renderer behaviour                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `invalid_payload`             | Dev-mode console.warn + toast "Something went wrong applying redactions." (defensive — should never reach prod) |
| `handle_not_found`            | Toast "Document is no longer open." + close sub-toolbar.                                                        |
| `no_redactions`               | Should never reach (Apply button is disabled when empty). Defensive: log + ignore.                              |
| `page_out_of_range`           | Toast "Some marks reference removed pages — refresh and try again." + clear stale marks.                        |
| `rect_invalid`                | Toast "Invalid redaction shape detected; please remark."                                                        |
| `signed_pdf_requires_confirm` | Re-open the Apply modal with the signature-invalidation paragraph (Decision 5).                                 |
| `pdf_load_failed`             | Toast "PDF could not be parsed for redaction."                                                                  |
| `rasterize_failed`            | Toast "Page rasterization failed — see Help for diagnostics."                                                   |
| `engine_failed`               | Toast "Redaction engine error: {safeMessage}."                                                                  |
| `output_too_large`            | Toast "Redacted output exceeded 200 MB; reduce pages or DPI."                                                   |
| `cancelled`                   | Silent — restore sub-toolbar to idle.                                                                           |

---

## 4. Decision 4 — Sanitize scope

What Apply MUST remove from the sanitized output. Default to Acrobat's "Remove Hidden Information" set; nothing deferred to v2 except where called out.

### 4.1 The full purge list

| #   | Category                          | What to remove                                                                                                                                                                              | How (pdf-lib)                                                                                                                                            | v1 / v2 |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Document `/Info` dictionary       | Title, Author, Subject, Keywords, Creator, Producer, CreationDate, ModDate. Replace with a minimal `{ Producer: 'PDF_Viewer_Editor', ModDate: <now> }` (PDF spec requires Producer/Mod).    | `doc.setTitle('')`/`setAuthor('')`/etc — or, more reliably, drop the `/Info` ref from the trailer and re-attach a minimal dict.                          | **v1**  |
| 2   | XMP metadata stream               | The `/Metadata` stream on the catalog. Replace with an empty XMP doc OR remove the ref. Acrobat removes it.                                                                                 | `doc.catalog.delete(PDFName.of('Metadata'))` after detection.                                                                                            | **v1**  |
| 3   | Document-level JavaScript         | `/Names → /JavaScript` name tree; `/OpenAction` if it's a JS action; `/AA` (Additional Actions) on the catalog.                                                                             | Reuse the **existing `stripDocLevelJavaScript` helper** at `src/main/pdf-ops/replay-engine.ts:36,395` (already proven across Phase 3 form-commit saves). | **v1**  |
| 4   | Embedded files                    | `/Names → /EmbeddedFiles` name tree; per-page `/FileAttachment` annotations.                                                                                                                | Delete `/EmbeddedFiles` entry from `/Names`; the per-page deletion is covered by #6 (we drop all annotations on redacted pages).                         | **v1**  |
| 5   | Document outline (bookmarks)      | `/Outlines` from catalog. Outline destinations may name a redacted region; safest to drop wholesale. **Honest warning emitted.**                                                            | `doc.catalog.delete(PDFName.of('Outlines'))`. Warn: "Bookmarks removed during redaction."                                                                | **v1**  |
| 6   | Annotations on redacted pages     | EVERY annotation (Highlight, Text, FreeText, Square, Sticky, Link…) on a page that has at least one redaction rect. The page becomes a raster; annotations on the original are meaningless. | When replacing the page, do NOT carry over `/Annots`. Acrobat does the same.                                                                             | **v1**  |
| 7   | AcroForm tree                     | `/AcroForm` from catalog (form-field hierarchy + widget annotations). A redaction-applied doc is a final artifact; form fields don't survive. Acrobat flattens before redact.               | `doc.catalog.delete(PDFName.of('AcroForm'))`. Warn: "Form fields removed during redaction. Flatten the form first if you need to keep filled values."    | **v1**  |
| 8   | Hidden / off-page content         | Text drawn off-page; white-on-white text; clipped content. R1's whole-page rasterize collapses all of this to "what the rasterizer drew" — anything not visible at the chosen DPI is gone.  | Free (R1 falls out of the rasterize step).                                                                                                               | **v1**  |
| 9   | Optional content groups (layers)  | `/OCProperties` on catalog. Hidden layers could leak.                                                                                                                                       | `doc.catalog.delete(PDFName.of('OCProperties'))`. Warn: "Layers removed during redaction."                                                               | **v1**  |
| 10  | Structure tree / Tagged PDF       | `/StructTreeRoot`, `/MarkInfo`, `/Lang`. Tagged-PDF accessibility tree references content by MCID; after page-content replacement those refs dangle. Acrobat drops them.                    | `doc.catalog.delete(PDFName.of('StructTreeRoot'))`/`'MarkInfo'`/`'Lang'`. Warn: "Accessibility structure removed during redaction."                      | **v1**  |
| 11  | Thread / Article references       | `/Threads` (rare).                                                                                                                                                                          | `doc.catalog.delete(PDFName.of('Threads'))`. Quiet.                                                                                                      | **v1**  |
| 12  | Catalog-level Additional Actions  | `/AA` on the document catalog (DocOpen/DocWillClose JS actions). Doc-level JS may also fire from here.                                                                                      | `doc.catalog.delete(PDFName.of('AA'))`. Quiet (#3 covers most paths; #12 is the belt-and-suspenders).                                                    | **v1**  |
| 13  | PieceInfo / SpiderInfo            | `/PieceInfo`, `/SpiderInfo` — application-specific scratch data; sometimes leaks the original draft text.                                                                                   | `doc.catalog.delete(PDFName.of('PieceInfo'))`/`'SpiderInfo'`. Quiet.                                                                                     | **v1**  |
| 14  | Object-stream + xref recompaction | After all the deletes above, `doc.save({ useObjectStreams: false })` emits a clean serialized form. Object streams can hide deleted-but-not-freed orphans.                                  | `useObjectStreams: false` in the save() call — same as our fixture-determinism setting at `tests/fixtures/pdfs/scripts/generate.ts`.                     | **v1**  |
| 15  | Trailer `/ID` reset               | The `/ID` array in the trailer (two-byte-string array used by some tooling for change detection). Acrobat keeps this; we follow.                                                            | n/a (pdf-lib regenerates).                                                                                                                               | **v1**  |
| 16  | Comments (Phase 1 annotations)    | Subsumed by #6 — annotations on redacted pages are dropped wholesale.                                                                                                                       | n/a                                                                                                                                                      | **v1**  |
| 17  | Web-capture / accessibility tags  | Subsumed by #10 + #11.                                                                                                                                                                      | n/a                                                                                                                                                      | **v1**  |

**Honest warnings emitted in `PdfApplyRedactionsValue.warnings[]`** when the corresponding category had content:

```
- "Bookmarks removed during redaction."
- "Form fields removed during redaction. Flatten the form first to keep filled values."
- "Layers removed during redaction."
- "Accessibility structure removed during redaction."
- "Redacted pages are now rasterized images. Re-run OCR to restore text search."
```

These surface as a post-Apply toast list (collapsible if >2). They are not errors; they're disclosures.

### 4.2 What is NOT removed (and why)

- **Non-redacted-page annotations.** A redaction on page 3 does not delete the sticky note on page 7. R1's per-page raster only replaces pages that have at least one redaction rect.
- **Non-redacted-page form fields.** Same — the AcroForm tree is dropped wholesale (#7) because page-content replacement breaks the field-widget linkage on redacted pages, and a half-removed AcroForm is worse than no AcroForm. **Trade-off documented in the warning.** Acrobat handles this by forcing a Flatten before Apply — we surface the same trade-off in the warning rather than blocking.
- **Existing PAdES signatures.** Not removed (the audit-log row is _marked invalidated_ per Decision 5). Removing the `/AcroForm → /Sig` widget would erase the audit trail of "this was signed". We keep the signature visible-but-invalidated, same as Acrobat.

### 4.3 Cross-references to existing strip helpers

- **JS strip:** `stripDocLevelJavaScript()` at `src/main/pdf-ops/replay-engine.ts:36,395` — proven on every save path since Phase 3 (`replay-engine-strip-js.test.ts` is the regression).
- **The `combine.ts` precedent:** combine never carries `/Names → /JavaScript` because `pdf-lib.copyPages` only copies page content, never catalog-level dicts. The redaction engine is _not_ a copyPages flow (it's a raster-replace flow), so the JS strip must be explicit. **David: do not assume the combine "strip-by-construction" property holds; it does not for R1.**

### 4.4 What gets logged for diagnosis

When `warnings[]` is populated, also `console.info` (main-process) each warning prefixed with `[redact-engine]` for grep-ability during QA. Same pattern as the OCR engine.

---

## 5. Decision 5 — PAdES signature invalidation interaction

### 5.1 Detection (reuse existing helper)

Before any rasterize work, the handler calls `detectPriorPadesSignatures(doc)` (`src/main/pdf-ops/pades-detect.ts`). Same pre-flight as `ocr-run-on-document.ts:239-247`.

### 5.2 The two-step Apply UX

1. User clicks Apply in the sub-toolbar.
2. The Apply confirm modal opens (§2.4).
3. **If signatures present**, the modal includes the signature-invalidation paragraph from §2.4 with the field-name list David's `detectPriorPadesSignatures` returns.
4. User clicks Apply.
5. Renderer calls `pdf:applyRedactions` with `invalidatesSignaturesConfirmed: true`.
6. Handler verifies the flag matches the current PAdES state. If signatures exist and the flag is false, handler returns `signed_pdf_requires_confirm` with the field-name list — defensive against stale UI state.

This is the **exact same `invalidatesSignaturesConfirmed` discipline** as `ocr-run-on-document.ts` (line 179 in the contracts; line 240-246 in the handler).

### 5.3 Audit-log invalidation backref

Phase 5 added `signature_audit_log.invalidated_by_ocr_job_id` (data-models.md §10, line 1586). Phase 7.4 B1 adds a sibling column for redaction provenance:

```sql
-- migrations/0008_phase7.4_redaction_audit.sql (Ravi, Phase 7.4 B1 Wave 2)
-- Forward-only. Adds nullable backref for redaction-invalidated signatures.

ALTER TABLE signature_audit_log
  ADD COLUMN invalidated_by_redaction_at INTEGER;  -- ms epoch; NULL = not invalidated by redaction

CREATE INDEX idx_signature_audit_log_invalidated_by_redaction_at
  ON signature_audit_log(invalidated_by_redaction_at) WHERE invalidated_by_redaction_at IS NOT NULL;

INSERT INTO schema_migrations (version, applied_at) VALUES (8, strftime('%s', 'now') * 1000);
```

**Why a timestamp column, not an FK to a `redaction_jobs` table:** redaction has no long-running job lifecycle (it's synchronous within one IPC round-trip). We don't need a job-tracking table; we just need to mark "this signature was invalidated by a redaction that happened at <ts>". A nullable timestamp is the minimal schema delta. If Phase 7.5 introduces background redaction jobs, the column upgrades cleanly to an FK.

**Repo method** (mirrors `markInvalidatedByOcrJob` at `src/db/repositories/signature-audit-repo.ts:573`):

```ts
// SignatureAuditRepo (Ravi extends; David's bridge surfaces it to the handler)
markInvalidatedByRedaction(rowIds: number[], at: number): number;
listInvalidatedByRedaction(since: number): SignatureAuditRow[];
```

**Bridge contract** (mirrors `SignatureAuditOcrInvalidationRepoBridge` at `ocr-run-on-document.ts:118`):

```ts
export interface SignatureAuditRedactionInvalidationRepoBridge {
  markInvalidatedByRedaction(docHash: string, fieldNames: string[], at: number): number;
}
```

**Handler call** (after a successful `engineRes`, before returning):

```ts
if (invalidatesSignatures && deps.signatureAuditRedaction) {
  deps.signatureAuditRedaction.markInvalidatedByRedaction(docHash, signedFields, clock());
}
```

### 5.4 The signature-audit panel UX

`src/client/components/signature-audit-panel/index.tsx` (Riley, Wave 2 extension) renders an "Invalidated by redaction on YYYY-MM-DD" badge on any audit row whose `invalidatedByRedactionAt !== null`. Mirrors the existing OCR-invalidation badge. New i18n key `signatureAudit:invalidatedByRedaction`.

### 5.5 Cross-link to 7.2.5 indirect-ref fix

`pades-detect.ts` was hardened in Phase 7.2.5 to handle indirect refs for `/V` and `/Contents`. The redaction handler benefits from that fix for free; no further work needed. If a future regression breaks `detectPriorPadesSignatures` for indirect refs, redaction's PAdES gate breaks the same way — surface that in the Wave-2 test catalog (§7).

### 5.6 Nullable + late-init discipline

Per the project's four-times-bitten sentinel-default lesson: `invalidatedByRedactionAt: number | null`, default `null`, no sentinel `0`/`''`/`-1`. Same as `cert_not_before`/`cert_not_after`/`invalidated_by_ocr_job_id`.

---

## 6. Decision 6 — File ownership matrix (Wave 2 prep)

| Path                                                               | Owner      | New / Edit    | Notes                                                                                                                                                |
| ------------------------------------------------------------------ | ---------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/pdf-ops/redact-engine.ts`                                | **David**  | new           | The R1 rasterize-redact-sanitize pipeline. Pure module; injects rasterizer + canvas-drawer for testability.                                          |
| `src/main/pdf-ops/redact-engine.test.ts`                           | **David**  | new           | Unit tests per §7.1.                                                                                                                                 |
| `src/ipc/handlers/pdf-apply-redactions.ts`                         | **David**  | new           | Zod safeParse + PAdES pre-flight + engine call + audit-log update. Pattern: `ocr-run-on-document.ts`.                                                |
| `src/ipc/handlers/pdf-apply-redactions.test.ts`                    | **David**  | new           | Handler-level zod + error-mapping unit tests.                                                                                                        |
| `src/ipc/contracts.ts`                                             | **David**  | edit          | Add `PdfApplyRedactionsRequest/Value/Error/Response`, add `PdfApi.pdf.applyRedactions`, add `Channels.PdfApplyRedactions`.                           |
| `src/ipc/register.ts`                                              | **David**  | edit          | Register the new handler.                                                                                                                            |
| `src/main/index.ts`                                                | **David**  | edit          | Wire `signatureAuditRedaction` bridge into handler deps.                                                                                             |
| `src/preload/index.ts`                                             | **David**  | edit          | Expose `pdf.applyRedactions` on the bridge.                                                                                                          |
| `src/db/repositories/signature-audit-repo.ts`                      | **Ravi**   | edit          | Add `markInvalidatedByRedaction` + `listInvalidatedByRedaction`.                                                                                     |
| `src/db/repositories/signature-audit-repo.test.ts`                 | **Ravi**   | edit          | Mirror the existing `markInvalidatedByOcrJob` test block.                                                                                            |
| `src/main/db-bridge.ts`                                            | **David**  | edit          | Construct + inject `SignatureAuditRedactionInvalidationRepoBridge`.                                                                                  |
| `migrations/0008_phase7.4_redaction_audit.sql`                     | **Ravi**   | new           | Schema v8 — single nullable column + partial index.                                                                                                  |
| `docs/data-models.md`                                              | **Riley**  | edit          | Phase 7.4 B1 section documenting the new column.                                                                                                     |
| `docs/api-contracts.md`                                            | **Riley**  | edit          | Phase 7.4 B1 section for the channel.                                                                                                                |
| `src/client/components/redaction-tools/redaction-toolbar.tsx`      | **Riley**  | new           | The sub-toolbar component. Pattern: `shape-toolbar.tsx`.                                                                                             |
| `src/client/components/redaction-tools/redaction-overlay.tsx`      | **Riley**  | new           | The SVG overlay layer over `pdf-canvas`.                                                                                                             |
| `src/client/components/redaction-tools/apply-redactions-modal.tsx` | **Riley**  | new           | `role="alertdialog"` confirmation.                                                                                                                   |
| `src/client/components/redaction-tools/redaction-tools.module.css` | **Riley**  | new           | Styles.                                                                                                                                              |
| `src/client/components/redaction-tools/redaction-toolbar.test.tsx` | **Riley**  | new           | Unit tests for the sub-toolbar UI.                                                                                                                   |
| `src/client/state/slices/redactions-slice.ts`                      | **Riley**  | new           | The slice (§2.6 shape).                                                                                                                              |
| `src/client/state/slices/redactions-slice.test.ts`                 | **Riley**  | new           | Reducer + selector tests.                                                                                                                            |
| `src/client/state/store.ts`                                        | **Riley**  | edit          | Wire the new slice into the root reducer.                                                                                                            |
| `src/client/components/toolbar/index.tsx`                          | **Riley**  | edit          | Add Redact toolbar button.                                                                                                                           |
| `src/client/components/menu-bar/index.tsx`                         | **Riley**  | edit          | Add Tools → Redact menu entry.                                                                                                                       |
| `src/client/components/signature-audit-panel/index.tsx`            | **Riley**  | edit          | Render the "invalidated by redaction" badge.                                                                                                         |
| `src/client/app.tsx`                                               | **Riley**  | edit          | Mount the redaction sub-toolbar; same pattern as `ShapeToolbar`.                                                                                     |
| `src/client/shortcuts.ts`                                          | **Riley**  | edit          | Register `redaction.apply` (Shift+Ctrl+Y) + `redaction.markRect` (R).                                                                                |
| `src/client/hooks/use-app-shortcuts.ts`                            | **Riley**  | edit          | Dispatch handlers for the two new shortcuts.                                                                                                         |
| `src/client/i18n/locales/en-US/redaction.json`                     | **Riley**  | new           | New namespace; all sub-toolbar + modal + overlay strings.                                                                                            |
| `src/client/i18n/locales/es-ES/redaction.json`                     | **Riley**  | new           | Proof-locale entries (per Phase 7 obligation #4 — initial pass, non-native-speaker authored, deferrable for native review).                          |
| `src/client/i18n/locales/en-US/signatureAudit.json`                | **Riley**  | edit          | Add `invalidatedByRedaction` key.                                                                                                                    |
| `src/client/i18n/locales/es-ES/signatureAudit.json`                | **Riley**  | edit          | Spanish for same.                                                                                                                                    |
| `docs/conventions.md`                                              | **Riley**  | edit          | Add Phase 7.4 B1 §17 entry documenting the destructive-mutation discipline + audit backref pattern (one short paragraph).                            |
| `docs/code-review.md`                                              | **Julian** | edit (Wave 3) | Review entry per the standard wave pattern.                                                                                                          |
| `docs/build-report.md`                                             | **Diego**  | edit (Wave 3) | Wave entry + L-002 screenshot if a packaging cut goes out.                                                                                           |
| **OUT of scope for this wave**                                     | —          | —             | tests/e2e/redaction-\*.spec.ts; Nathan's user-guide section. Diego may write an e2e harness if budget permits; Nathan documents in a follow-up Wave. |

**No path overlap.** Each file has exactly one owner per the project's "one agent per file" discipline.

---

## 7. Decision 7 — Test catalog (Wave 2 spec)

### 7.1 Unit-test surface — David must hit

In `src/main/pdf-ops/redact-engine.test.ts`:

| #    | Test                                                                                                                                                                  | Why                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| U-1  | One rect on one page → assert text-extract from the OUTPUT PDF over the rect returns empty. (Use pdf.js to extract text and check none of the original text appears.) | The non-negotiable correctness invariant. R1 fails this → bug.              |
| U-2  | One rect on one page → assert text-extract from a NON-redacted page is unchanged.                                                                                     | Confirms per-page scope (we don't rasterize what we don't have to).         |
| U-3  | N rects on M pages (e.g. 3 rects across 2 pages) → assert (a) each redacted page's output is image-only, (b) each rect's bounding region returns no text.             | Multi-rect correctness.                                                     |
| U-4  | Rect covering 100% of a page → output page is a black raster; no text recoverable.                                                                                    | Edge case.                                                                  |
| U-5  | Rect with zero area → handler returns `rect_invalid` (defensive — the UI should not produce these).                                                                   | Boundary.                                                                   |
| U-6  | Rect off-page → handler returns `rect_invalid`.                                                                                                                       | Boundary.                                                                   |
| U-7  | Empty `redactions[]` → returns `no_redactions`.                                                                                                                       | Boundary.                                                                   |
| U-8  | **Sanitize: metadata.** Input doc with Title=Author=Subject=Keywords populated → output doc's `/Info` has only Producer + ModDate; no fields readable.                | Sanitize invariant #1.                                                      |
| U-9  | **Sanitize: XMP.** Input doc with `/Metadata` stream → output doc's catalog has no `/Metadata`.                                                                       | Sanitize invariant #2.                                                      |
| U-10 | **Sanitize: JS.** Input doc with `/Names → /JavaScript` action → output has no JS reference (`stripDocLevelJavaScript` returns true on input, false on output).       | Sanitize invariant #3. Cross-ref existing `replay-engine-strip-js.test.ts`. |
| U-11 | **Sanitize: embedded files.** Input doc with `/Names → /EmbeddedFiles` → output has no embedded files.                                                                | Sanitize invariant #4.                                                      |
| U-12 | **Sanitize: outline.** Input doc with bookmarks → output has no `/Outlines`. Warning emitted.                                                                         | Sanitize invariant #5.                                                      |
| U-13 | **Sanitize: annotations on redacted pages.** Input doc with 3 annotations on page 0; redact page 0 → output page 0 has zero `/Annots`.                                | Sanitize invariant #6.                                                      |
| U-14 | **Sanitize: AcroForm.** Input doc with AcroForm → output has no `/AcroForm`. Warning emitted.                                                                         | Sanitize invariant #7.                                                      |
| U-15 | **Sanitize: structure tree.** Input tagged PDF → output has no `/StructTreeRoot`. Warning emitted.                                                                    | Sanitize invariant #10.                                                     |
| U-16 | **PAdES not present + no confirm flag** → handler succeeds; `invalidatesSignatures === false`; audit log not touched.                                                 | Happy path with no signatures.                                              |
| U-17 | **PAdES present + no confirm flag** → handler returns `signed_pdf_requires_confirm` with field-name list; audit log not touched; no rasterize occurred.               | PAdES gate.                                                                 |
| U-18 | **PAdES present + confirm flag** → handler succeeds; `invalidatesSignatures === true`; `signedFields` echoed; audit log row for each field marked invalidated.        | PAdES backref invariant.                                                    |
| U-19 | `handle_not_found` when handle is stale.                                                                                                                              | Boundary.                                                                   |
| U-20 | `pdf_load_failed` when input bytes are not a PDF.                                                                                                                     | Boundary.                                                                   |
| U-21 | `rasterize_failed` when the injected rasterizer throws.                                                                                                               | Boundary.                                                                   |
| U-22 | Warning list is correct: combined "bookmarks", "form fields", "OCR" warnings appear when each source content was present.                                             | Warning surface invariant.                                                  |
| U-23 | Determinism: same input + same redactions → same output bytes (with `useObjectStreams: false` + fixed Producer + fixed ModDate via injected clock).                   | Test-friendliness; mirrors the fixture-determinism discipline.              |

### 7.2 Slice tests — Riley owns

In `src/client/state/slices/redactions-slice.test.ts`:

- `addMark` synthesizes id + createdAt; `totalMarks` mirror selector increments.
- `removeMark` decrements; removing the last mark on a page deletes the page entry.
- `clearMarks` resets `byPage` + `totalMarks` to zero/empty.
- `setActiveTool` updates without touching marks.
- `setApplying(true)` + `setApplyError('engine_failed')` flows.

### 7.3 Component tests — Riley owns

In `src/client/components/redaction-tools/redaction-toolbar.test.tsx`:

- Sub-toolbar renders nothing when `ui.redactionPanelOpen === false`.
- When open: Mark Rectangle button has `aria-pressed=true` when active.
- Apply button is disabled when `totalMarks === 0`.
- Esc inside the sub-toolbar dispatches `setRedactionPanelOpen(false)` and does NOT dispatch `clearMarks`.
- All visible labels + ARIA labels resolve to i18n keys (no hardcoded English) — same a11y-grep contract Phase 7.4 A2 established for shape-toolbar.
- Apply button click opens the modal; modal renders the signature-warning paragraph when `signatures.length > 0` is mocked into props.

### 7.4 E2e — optional this wave (Diego's call)

Diego may write `tests/e2e/redaction.spec.ts` in Wave 3 if budget permits. Spec contract:

1. Launch app (NODE_ENV=test, fresh userData).
2. Open `tests/fixtures/pdfs/redaction-1p-eng.pdf` (NEW fixture — Diego authors per the Phase 7.1 provenance rule §1.3).
3. Drive Mark Rectangle via `pdfApi.__test.seedRedaction({ pageIndex, x, y, w, h })` (mirrors `__test.seedOcrJob`).
4. Call `pdfApi.pdf.applyRedactions(...)`.
5. Reopen output via `fs.openPdf`; run `pdfApi.ocr.runOnDocument` on the redacted region; assert OCR finds no text from the redacted source string.

If e2e slips to Phase 7.4.1, the unit-test contract above (U-1, U-3) covers the same correctness invariant at a smaller blast radius.

### 7.5 Determinism floor

Same `useObjectStreams: false` + fixed Producer + injected-clock pattern as `tests/fixtures/pdfs/scripts/generate.ts`. The unit suite hashes the redacted output bytes and asserts a stable value when the same inputs go in. This catches future regressions where pdf-lib's serialization order drifts. (Optional but recommended; Diego can fold into Wave 3.)

---

## 8. Risk register

| ID   | Risk                                                                                                                                                                                  | Likelihood | Impact   | Mitigation                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | **R1 rasterization produces a page that visually matches but contains an `/XObject` with the original text re-included by a pdf-lib quirk.** False security.                          | Low        | Critical | U-1 + U-3 extract text from output via pdf.js. If any redacted text shows up, the suite fails. Catches the rare pdf-lib pitfall.             |
| R-2  | DPI choice (200) yields visible loss of detail on small-font pages; user complains.                                                                                                   | Medium     | Low      | DPI is a `request.rasterDpi` parameter (default 200); UI exposes it in a "Redaction quality" Settings sub-panel (Phase 7.4.1).               |
| R-3  | Sanitize misses a category — Acrobat's "Remove Hidden Information" set is ~14 items and we pick 13. A leak slips into the wild.                                                       | Low        | High     | §4.1 is a literal checklist; one unit test per category (U-8..U-15). Julian Wave 3 audits the list.                                          |
| R-4  | PAdES detection misses an exotic signature shape (e.g. signature in a non-`/Sig` field type — non-standard but real).                                                                 | Low        | Medium   | Inherits from `detectPriorPadesSignatures`. If a future PDF exposes a new shape, the audit panel doesn't show the badge — surfaceable in QA. |
| R-5  | Output bytes exceed inline-IPC budget (50 MB) for legal-discovery-style 500-page redactions.                                                                                          | Medium     | Medium   | §3.4 escape hatch; v1 ships inline-only and we surface `output_too_large` honestly.                                                          |
| R-6  | `useObjectStreams: false` makes the output ~5-15% larger than Acrobat's. User complains "your tool produces bigger files".                                                            | Medium     | Low      | Accept; the safety win is worth it. Documented in user-guide as a known trade-off.                                                           |
| R-7  | The new `signature_audit_log.invalidated_by_redaction_at` column needs schema v8; if a user is mid-doc when the migration runs, pdf-bytes are loose but the column doesn't yet exist. | Low        | Low      | Migrations run at app boot (data-models.md §2.2). The handler ships with the migration; users don't hit the partial state.                   |
| R-8  | `stripDocLevelJavaScript` strips JS but the `/AA` (additional actions) on the catalog could re-introduce JS execution. Catch covered by #12 in §4.1 but easy to forget.               | Low        | Medium   | U-10 must also assert no `/AA` reference; Julian re-checks.                                                                                  |
| R-9  | A redaction-on-PAdES-signed-doc workflow leaves a "ghost" widget that visually says "Signed by John Doe" on a page that's now a raster. Confusing UX.                                 | Medium     | Low      | Trust-floor copy in the audit-panel badge: "Signed by … — invalidated by redaction on YYYY-MM-DD." Clarity over hiding.                      |
| R-10 | A locked instruction we don't yet know about (e.g. a hypothetical "no destructive ops without confirm") is silently broken.                                                           | Low        | Medium   | Pre-flight reads `.learnings/locked-instructions.md`. L-001..L-006 reviewed; none restrict redaction. Wave-2 pre-flight re-reads.            |

---

## 9. Open questions (for David / Julian / Marcus)

1. **(David)** Should the `redact-engine.ts` reuse `rasterizePageProd` directly (the OCR helper) or take a `RasterPageOptions → Uint8Array` callback like `OcrRunOnDocumentDeps.rasterizePage`? **Riley's recommendation:** callback (dep injection), matches the OCR handler's testability discipline.
2. **(David)** Is there a clean pdf-lib API to "replace one page's content stream with an embedded PNG image filling the MediaBox", or does the engine drop the old page entirely and insert a fresh page in its place (preserving the page index)? **Riley's recommendation:** insert+remove. Cleaner than `node.set(PDFName.of('Contents'), ...)` munging; preserves rotation/MediaBox via explicit copy.
3. **(David)** Worth adding a `redaction_jobs` SQLite table (mirroring `ocr_jobs`) for diagnostic logging even if redaction is synchronous? **Riley's recommendation:** no — adds schema bumps for thin value. The audit-log column captures the security-relevant fact.
4. **(Julian)** Is the AcroForm-drop trade-off (§4.2) acceptable, or should the engine refuse to apply when an AcroForm is present + un-flattened, forcing the user to Flatten first (Acrobat's path)? **Riley's recommendation:** drop with a warning (current spec). Refuse-and-force-Flatten is a UX cliff. Open for Julian's call.
5. **(Marcus)** Should Phase 7.4 B1 ship a packaging cut (v0.7.20 or v0.8.0)? **Riley's recommendation:** v0.8.0. Redaction is a flagship enterprise feature; the minor-version bump signals it. Diego owns the call.
6. **(Diego)** Is an e2e fixture (`redaction-1p-eng.pdf`) cheap enough to author in Wave 3 (per §7.4)? **Riley's recommendation:** yes if the existing `scan-1p-eng.pdf` generator is reusable; if a new generator path is needed, defer to Phase 7.4.1.
7. **(David)** The `output_too_large` error variant: do we need streaming-by-path (§3.4) in v1, or is the 200 MB ceiling enough to defer it? **Riley's recommendation:** defer streaming. Inline-bytes with a hard ceiling is the right v1 cut.

---

## 10. Wave 2 dispatch shape

```
Wave 2 (parallel; one focused branch each)
  ├── David   → redact-engine + handler + IPC contract entries + db-bridge
  │             + tests (U-1..U-23)
  │             ── owns src/main/pdf-ops/redact-engine.ts
  │             ── owns src/ipc/handlers/pdf-apply-redactions.ts
  │             ── edits src/ipc/contracts.ts, register.ts, main/index.ts, preload/index.ts
  ├── Ravi    → signature-audit-repo column + repo methods + migration v8
  │             ── new migrations/0008_phase7.4_redaction_audit.sql
  │             ── extends src/db/repositories/signature-audit-repo.ts
  └── Riley   → sub-toolbar + overlay + modal + slice + toolbar/menu/shortcut wiring
                + i18n entries (en-US + es-ES proof)
                ── owns src/client/components/redaction-tools/**
                ── owns src/client/state/slices/redactions-slice.ts
                ── edits app.tsx, toolbar/index.tsx, menu-bar/index.tsx,
                   signature-audit-panel/index.tsx, shortcuts.ts,
                   hooks/use-app-shortcuts.ts, i18n/locales/{en-US,es-ES}/
                   redaction.json + signatureAudit.json

Wave 3 (parallel)
  ├── Diego   → optional e2e harness + packaging cut + build-report
  └── Julian  → code review (sanitize completeness, PAdES gate correctness,
                 R1 invariant proof in tests, locked-instructions compliance)

Wave 4 (sequential)
  └── Nathan  → user-guide redaction section + trust-floor copy + README update
                (the four-location ratchet for the obligation "redacted pages
                lose searchability; rerun OCR")
```

**Coordination point:** David's `signatureAuditRedaction` bridge field name must match Ravi's repo method name. Both should grep for the agreed string `markInvalidatedByRedaction` before pushing — same pattern as Phase 5's `markInvalidatedByOcrJob` coordination.

---

## 11. Lock compliance

| Lock      | Compliance                                                                                                                                                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L-001** | Untouched. No `enableDragDropFiles` interaction. Redaction operates on already-open docs.                                                                                                                                                                                                                               |
| **L-002** | If Diego cuts a packaging build in Wave 3, the operator-screenshot drill applies. Otherwise out of scope (no new BrowserWindow).                                                                                                                                                                                        |
| **L-003** | Node-20 baseline preserved. No new native module introduced. Redaction reuses existing `@napi-rs/canvas` + pdf-lib + pdfjs.                                                                                                                                                                                             |
| **L-004** | The R1 rasterize path calls `rasterizePageProd` → `loadPdfJs` → `getDocument({ data: toPdfJsBuffer(bytes) })`. The buffer-copy discipline already lives in `ocr-bootstrap.ts`. Redaction is a CONSUMER of that helper, not a new call site that bypasses it. **No new pdf.js direct-import call sites are introduced.** |
| **L-005** | Same — redaction goes through `loadPdfJs` via the OCR/export rasterize pipeline. No new dynamic-import call site outside the helper.                                                                                                                                                                                    |
| **L-006** | Redaction adds NO test-only channel. No `__test:*` channel proposed. The standard dot-form `process.env.NODE_ENV` gate is irrelevant here.                                                                                                                                                                              |

No new locked instructions are proposed by this design. If Julian's Wave-3 review finds a recurring sanitize-completeness failure pattern across multiple PRs, propose L-007 then.

---

## 12. Trust-floor obligations (Phase 7.4 B1 — local to this feature)

Per the project's six-times-and-counting pattern. Two new obligations introduced by B1:

1. **"Redacted pages become rasterized images and lose text-search."** Surfaced in:
   - Apply confirm modal body (§2.4).
   - Post-Apply toast warning (§3.1).
   - User-guide Redaction section (Nathan, Wave 4).
   - README front-door Known Limitations (Nathan, Wave 4).
2. **"Applying redaction invalidates any existing digital signatures."** Surfaced in:
   - Apply confirm modal — signature-list paragraph when `signatures.length > 0` (§2.4).
   - Signature-audit panel badge (§5.4).
   - User-guide Redaction + Signing sections (Nathan, Wave 4).
   - README front-door Known Limitations (Nathan, Wave 4).

Both follow the four-location ratchet codified by H-3 + Phases 3-7 (`conventions.md §18`).

---

## 13. Acceptance checklist (Riley's Wave-1 deliverable self-check)

- [x] Decision 1 picked (R1) with two-paragraph rationale.
- [x] Decision 2 spec'd: sub-toolbar pattern, mark visualization, Apply modal, slice shape.
- [x] Decision 3 spec'd: one channel, full request/response/error shapes, no preview channel, size cutoff documented.
- [x] Decision 4: 17-row sanitize matrix; cross-refs to existing strip helpers.
- [x] Decision 5: detection re-use, two-step UX, audit-log column + bridge + repo method, signature-audit-panel badge.
- [x] Decision 6: file ownership matrix; no overlaps.
- [x] Decision 7: 23 unit tests, slice tests, component tests, optional e2e.
- [x] Risk register: 10 entries.
- [x] Open questions for David / Julian / Marcus / Diego: 7.
- [x] Lock compliance reviewed (L-001..L-006).
- [x] Trust-floor obligations enumerated + placed via the four-location ratchet.
- [x] Length: ~620 lines, within 400-700 budget.

End of design.
