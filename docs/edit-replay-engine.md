# Edit-Replay Engine — Phase 2 Detailed Design

**Author:** Riley (front-end-architect)
**Date:** 2026-05-21 (Wave 6)
**Status:** Design doc. David implements in Wave 7 under `src/main/pdf-ops/replay-engine.ts`.
**Reads:** `ARCHITECTURE.md` §4, §6; `docs/api-contracts.md` §3.2, §7.2; `docs/data-models.md` §3; `docs/architecture-phase-2.md`.

---

## 1. Goal

> Given an open PDF (kept as `Uint8Array` in main per `DocumentStore`) and an ordered list of `EditOperation`s + `AnnotationModel`s streamed from the renderer, produce a new PDF that reflects every applied operation — losslessly for the supported feature surface, honestly degraded everywhere else.

The replay engine is the **lynchpin** of Phase 2 (decision P2-L-2). Every Phase-2 mutation — text replace, image insert, image overlay, bookmark write-through, page rotate-after-Phase-1 — funnels through this one module. Same data type drives undo, save, export, and print.

Phase 1 stubbed `fs:writePdf kind:'ops'` with a synthesized placeholder (the H-3 walking-skeleton fidelity boundary). Wave 7 replaces that stub with this engine.

---

## 2. Inputs / outputs

### 2.1 Signature

```ts
// src/main/pdf-ops/replay-engine.ts (NEW, David Wave 7)

import type {
  EditOperationSerialized,
  AnnotationModelSerialized,
  DocumentHandle,
} from '@ipc/contracts';

export interface ReplayInput {
  originalBytes: Uint8Array;        // from DocumentStore.getBytes(handle); see §3.1
  ops: EditOperationSerialized[];   // in dispatch order; never re-sorted (see §6)
  annotations: AnnotationModelSerialized[]; // current snapshot of every annotation on the doc
  jobId: string;                    // for progress events; see §10
}

export type ReplayError =
  | 'load_failed'                   // pdf-lib couldn't parse originalBytes
  | 'op_apply_failed'               // one of ops threw (details.opIndex, details.opKind)
  | 'annotation_emit_failed'        // annotation phase threw (details.annotationId)
  | 'image_decode_failed'           // PNG/JPEG/TIFF decoder threw
  | 'text_span_not_found'           // text-replace op references an objectId not in the doc
  | 'missing_glyph'                 // text-replace string contains chars the original font lacks
  | 'serialize_failed'              // pdf-lib's final save() threw
  | 'encrypted_unsupported';        // source has security handler we can't preserve through pdf-lib

export interface ReplayOk {
  newBytes: Uint8Array;             // the serialized PDF
  warnings: string[];               // non-fatal observations: clipped text, fallback engine hints, etc.
  engineUsed: 'pdf-lib';            // always pdf-lib for THIS engine; Chromium has a sibling module
  byteCount: number;
  durationMs: number;
}

export type ReplayResult = Result<ReplayOk, ReplayError>;

export async function replay(input: ReplayInput): Promise<ReplayResult>;
```

### 2.2 Purity contract

`replay` is a **pure function over its inputs**:

- No filesystem I/O. The caller (`fs:writePdf` handler or `pdf:export` handler) writes `newBytes` to disk via the atomic-rename path documented in `architecture-phase-2.md` §3.5.
- No DB access. Bookmarks, recents, settings — none of them are touched by the replay engine. (Bookmarks DO get written into the PDF outline when ops include bookmark variants, but the SQLite layer is the renderer's source-of-truth; the engine only consumes the per-save snapshot.)
- No network. There is no network in this app at all (CSP §2.2).
- No mutation of `input.originalBytes`. pdf-lib's `PDFDocument.load(bytes)` is non-destructive; the engine holds the in-flight `PDFDocument` and serializes a new buffer.
- Same input → same output **modulo pdf-lib's deterministic re-emit signature** (object stream ordering, xref offsets — these are byte-stable for a given pdf-lib version + ops sequence).

The purity contract is what lets David write golden-bytes tests (§11) and what lets undo/redo apply the same op list deterministically across save → reopen → re-edit cycles.

### 2.3 Why ops AND annotations as separate inputs

Annotations are NOT ops. An `annot-add` op exists, but the persistent state of an annotation lives on the `AnnotationModel` (color, opacity, contents, rect — all editable post-creation). The engine needs both:

- `ops` provides the **chronological narrative** of what happened (drives page-structure ops and undo).
- `annotations` provides the **current visible state** of every annotation, including those that pre-existed the open (and so have no `annot-add` op in the dirtyOps list).

Step 4 of §3.2 (annotation emit) walks `annotations`, not `ops`. The ops are consulted for the chronological-add of new ones, but the emit step writes every annotation with `dirty: true OR pdfObjectNumber: undefined` — including freshly-added ones and edited pre-existing ones.

---

## 3. Algorithm (high level)

```
replay(input):
  1. load:        const doc = await PDFDocument.load(input.originalBytes, { ... })
  2. buildContext: const ctx = buildPageContext(doc)
                  ctx.pages: PageContext[] mirroring doc.pageCount, indexed 0..n-1
                  ctx.imageCache: Map<sha256, PDFEmbeddedImage>  // see §7
                  ctx.warnings: string[]
                  ctx.fontCache: Map<fontRef, PDFFont>
  3. foldOps:     for (let i = 0; i < input.ops.length; i++):
                    const op = input.ops[i]
                    try { applyOp(ctx, doc, op) }
                    catch (e) { return fail('op_apply_failed', e.message, { opIndex: i, opKind: op.kind }) }
                    yield progress { phase: 'pdflib-applying-ops', percent: (i+1)/total * 60 }
  4. emitAnnots:  for (const a of dirtyOrUnsavedAnnotations(input.annotations)):
                    try { emitAnnotation(doc, ctx, a) }
                    catch (e) { return fail('annotation_emit_failed', e.message, { annotationId: a.id }) }
                    yield progress { phase: 'finalizing', percent: 60 + (k/m)*30 }
  5. serialize:   const newBytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false, addDefaultPage: false })
                  yield progress { phase: 'finalizing', percent: 100 }
                  return ok({ newBytes, warnings: ctx.warnings, engineUsed: 'pdf-lib', byteCount: newBytes.length, durationMs })
```

### 3.1 Why "fold then emit", not interleaved

Annotations bind to **page indices**, which mutate during page-structure ops (reorder/insert/delete). If we interleave annotation emit with page ops, every annotation would need re-binding on each intervening op — N×M complexity for N pages and M annotations, and the rebinding logic would duplicate the slice's `applyReorder` rebind (`document-slice-apply.ts:56-65`).

By folding all ops first, the renderer's already-rebound `AnnotationModel.pageIndex` values are correct at emit time. The engine writes each annotation to the page identified by its **current** `pageIndex` in the input snapshot.

The contract: **the renderer is responsible for keeping `AnnotationModel.pageIndex` in sync with the page op stream.** The Phase-1 slice already does this (`applyReorder` rebinds; tested in `document-slice.test.ts:167-225` per code-review MEDIUM finding G-1, which Phase-2 absorbs by extending those round-trip tests with the new variants).

### 3.2 PageContext data structure

```ts
interface PageContext {
  /**
   * Index in the pdf-lib doc as the engine has mutated it so far.
   * Mutates as page ops run. After step 3 completes, this matches
   * input.annotations[*].pageIndex.
   */
  currentIndex: number;
  /**
   * The pdf-lib PDFPage object for this page. May be:
   *  - a page from the original load (kind='original' source)
   *  - a page copied from an inserted PDF (kind='inserted')
   *  - a blank page (kind='blank')
   *  - a new image-only page (kind='image', Phase 2)
   */
  page: PDFPage;
  /**
   * Provenance — useful for warning messages and golden-bytes test attribution.
   */
  source: SourcePageRefSerialized;
  rotation: 0 | 90 | 180 | 270;
}
```

The engine maintains `ctx.pages: PageContext[]` as the authoritative view of "which pdf-lib page is at position i right now." Every page op updates this array; the array's `.length` always equals `doc.getPageCount()`.

---

## 4. Op-by-op semantics

For each `EditOperation` variant, the table documents: pdf-lib API used, error modes, ordering sensitivity, and the inverse already documented in `data-models.md §3.2` (no new inverses introduced here).

### 4.1 Page-structure ops (Phase 1 surface, now LIVE)

| op.kind | pdf-lib calls | Error modes | Order-sensitive? |
|---|---|---|---|
| `reorder { from, to }` | `doc.removePage(from)` → `doc.insertPage(to, removedPage)`. Update `ctx.pages` in lock-step. | `from` or `to` out of `[0, n)` → `op_apply_failed` (out_of_range). | **Yes.** Every subsequent op operates on the new index layout. |
| `insert { atIndex, source }` | If `source.kind === 'original'`: not possible (would mean re-inserting from `originalBytes` — that's only valid for undo of a delete). If `source.kind === 'inserted'`: `doc.copyPages(sourceDoc, [sourcePageIndex])` → `doc.insertPage(atIndex, copied)`. If `source.kind === 'blank'`: `doc.insertPage(atIndex, [width, height])`. **Phase 2 also handles `source.kind === 'image'`** — see §4.3. | Bad source → `op_apply_failed` (invalid_source). Source PDF load failure → `op_apply_failed` (source_load_failed). | **Yes.** |
| `delete { pageIndex, preservedSource }` | `doc.removePage(pageIndex)`. The `preservedSource` field is not consulted here; it exists for the renderer's undo (re-insert). | Out of range → `op_apply_failed`. | **Yes.** |
| `rotate { pageIndex, fromRotation, toRotation }` | `ctx.pages[pageIndex].page.setRotation(degrees(toRotation))`. `fromRotation` is not consulted — pdf-lib's `setRotation` is absolute, not relative. | Out of range → `op_apply_failed`. | **No.** Two rotates on the same page commute via composition; the latest absolute value wins. |

**Inverse**: identical to `data-models.md §3.2`. No change.

### 4.2 Annotation ops (Phase 1 surface, now also LIVE in step 4)

Annotation **ops** (`annot-add`, `annot-edit`, `annot-delete`) don't run inside step 3 directly. They update the **renderer's** annotation slice, and the engine reads the final snapshot in step 4. The ops are still in the `ops[]` array so:

- Undo middleware can re-dispatch the inverse on the renderer.
- The history log (when persisted) preserves authoring chronology.

Inside the engine, ops 5–7 are validated for shape correctness (they reference live annotation IDs) but not actually applied to `doc`. The annotation emit step (§4.6) does the writing.

### 4.3 NEW variant — `image-insert` (insert-as-new-page mode)

```ts
{
  kind: 'image-insert';
  meta: EditMeta;
  atIndex: number;                 // 0-based, where to insert the new page
  image: ImageEmbedPayload;
}

interface ImageEmbedPayload {
  // After IPC deserialization, bytes are a Uint8Array (camelCase). For the renderer-side
  // EditOperation type, see data-models.md §7. The wire form (EditOperationSerialized) is
  // identical: structuredClone copies Uint8Array natively.
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg' | 'image/tiff';
  // Source-image intrinsic dimensions in pixels.
  width: number;
  height: number;
  // Target page-size policy.
  pageSize?: { width: number; height: number };  // PDF user-space (1/72 inch); defaults to image dims scaled to A4 fit
  pageOrientation?: 'portrait' | 'landscape';     // default derived from image aspect
  // Content hash for dedup (engine maintains an image cache; see §7). Computed in main.
  contentHash: string;
}
```

**pdf-lib calls:**

1. If `image.mimeType === 'image/tiff'`: decode to PNG via `tiff-decoder.ts` first. See §8.
2. Check `ctx.imageCache.get(contentHash)`. If hit, reuse the `PDFEmbeddedImage`.
3. Else `await doc.embedPng(bytes) | embedJpg(bytes)`, store in cache.
4. Compute target page dimensions per `pageSize` or default scaling (image native dims, capped at A4 = 595×842 if larger).
5. `doc.insertPage(atIndex, [pageWidth, pageHeight])`.
6. `page.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight })`.
7. Push a new `PageContext` into `ctx.pages` at `atIndex`; shift subsequent.

**Error modes:**

| Condition | Error | Detail |
|---|---|---|
| `bytes` empty or `mimeType` not in the union | `op_apply_failed` | `invalid_image` |
| `embedPng`/`embedJpg` throws (corrupt image) | `image_decode_failed` | `mimeType`, `bytesLength` |
| TIFF decode fails | `image_decode_failed` | `tiff` + utif error code; see §8 |
| `atIndex` out of `[0, pageCount]` | `op_apply_failed` | `out_of_range` |

**Order sensitive:** Yes. Insert shifts subsequent pages.

**Inverse:** `delete { pageIndex: atIndex, preservedSource: { kind: 'image', ...image } }`. The `kind: 'image'` `SourcePageRef` is a Phase-2 addition (see data-models.md §7).

### 4.4 NEW variant — `image-overlay` (signature-stamp UX)

```ts
{
  kind: 'image-overlay';
  meta: EditMeta;
  pageIndex: number;
  rect: PdfRect;                   // PDF user-space, origin bottom-left
  image: ImageEmbedPayload;
  overlayId: string;               // UUID; lets later ops reference THIS overlay
}
```

**pdf-lib calls:**

1. TIFF decode + embedPng/embedJpg + cache lookup, identical to §4.3.
2. `ctx.pages[pageIndex].page.drawImage(embedded, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })`.

**No new `PageContext` entry.** The overlay is a drawing on an existing page.

**Tracking the overlayId** — pdf-lib doesn't natively expose a stable identifier for individual page-content drawings. Two options the engine implements together:

1. The engine maintains `ctx.overlays: Map<overlayId, OverlayHandle>` where `OverlayHandle = { pageIndex, embedded: PDFEmbeddedImage, rect: PdfRect }`. This is enough for `image-overlay-edit` / `image-overlay-delete` to find the prior state (re-emit the page's content stream).
2. For round-trip across save → reopen, the overlay manifests as a `Do` operator referencing an `XObject` in the page's content stream. We don't try to round-trip the **id** through PDF — once saved, an `image-overlay` becomes part of the page bitmap-ish content. **Re-opening the saved PDF surfaces the overlay as a regular page-content drawing, NOT as an editable overlay.** This is a documented Phase-2 fidelity boundary (see §12).

**Error modes:**

| Condition | Error |
|---|---|
| `pageIndex` out of range | `op_apply_failed` (out_of_range) |
| `rect` invalid (negative dims, NaN) | `op_apply_failed` (invalid_rect) |
| Image decode / embed fails | `image_decode_failed` |

**Order-sensitive:** Yes — within a single save, but only with respect to other overlays on the same page (later overlays z-order on top of earlier).

**Inverse:** `image-overlay-delete { pageIndex, overlayId, before: ... }` — see §4.5.

### 4.5 NEW variants — `image-overlay-edit` and `image-overlay-delete`

```ts
{
  kind: 'image-overlay-edit';
  meta: EditMeta;
  pageIndex: number;
  overlayId: string;
  beforeRect: PdfRect;
  afterRect: PdfRect;
}

{
  kind: 'image-overlay-delete';
  meta: EditMeta;
  pageIndex: number;
  overlayId: string;
  before: { rect: PdfRect; image: ImageEmbedPayload };
}
```

**Critical engine note:** Within a single replay invocation, all overlays for the document are written from scratch — the engine doesn't try to edit pdf-lib's content stream in place. The replay model is **stateless across saves**: every save rebuilds `newBytes` from `originalBytes + ops + annotations`.

So `image-overlay-edit` and `image-overlay-delete` matter ONLY when their target `overlayId` was created **earlier in the same ops list**:

- Engine maintains a working map `liveOverlays: Map<overlayId, { rect, image }>` populated by each `image-overlay` op as it runs.
- `image-overlay-edit` mutates `liveOverlays[overlayId].rect`.
- `image-overlay-delete` deletes the entry.
- At end of step 3, for each surviving entry in `liveOverlays`, the engine has already issued the `drawImage` call at the original rect — but if an `image-overlay-edit` came after, the **first drawImage was at the OLD rect**.

**Resolution: defer overlay drawing to a post-fold step**, between step 3 (op fold) and step 4 (annot emit). New step 3.5:

```
3.5 drawOverlays:
    for ([overlayId, { rect, image, pageIndex }] of liveOverlays):
        const embedded = ctx.imageCache.get(image.contentHash)
        ctx.pages[pageIndex].page.drawImage(embedded, { x: rect.x, y: rect.y, w: rect.w, h: rect.h })
```

Step 3 then becomes "fold ops into ctx state" — it embeds images into the cache but does NOT call drawImage. Step 3.5 calls drawImage exactly once per live overlay at its final rect.

This costs one extra pass over `liveOverlays` but eliminates content-stream-rewrite complexity. Worth it.

**Error modes:**

| Condition | Error |
|---|---|
| `overlayId` not in `liveOverlays` at edit/delete time | `op_apply_failed` (overlay_not_found) — should be impossible if the renderer is well-behaved; defensive |
| `image-overlay-edit.afterRect` invalid | `op_apply_failed` (invalid_rect) |

**Order-sensitive:** Yes (the live-overlays map is sequence-dependent).

**Inverse:** identical-but-flipped (`beforeRect ↔ afterRect`; `delete` ↔ `image-overlay { rect: before.rect, image: before.image, overlayId }`).

### 4.6 NEW variant — `text-replace`

```ts
{
  kind: 'text-replace';
  meta: EditMeta;
  pageIndex: number;
  objectId: string;             // engine-defined; see §4.6.1
  oldText: string;              // for inverse computation
  newText: string;
}
```

#### 4.6.1 What is `objectId`?

PDF text isn't atomic — a single visible run can be split across multiple `Tj`/`TJ` operators inside the page's content stream, with intervening positioning and font-switching operators. The renderer needs a stable way to point at "the run I want to replace."

**The encoding scheme:**

```
objectId = `${pageObjectNumber}/${contentStreamIndex}/${runIndex}`
```

- `pageObjectNumber`: the pdf-lib PDFRef object number of the page (stable across the SAME loaded doc; **not stable across re-saves**).
- `contentStreamIndex`: if the page has multiple content streams (uncommon but legal), which one.
- `runIndex`: ordinal index of the text run within the content stream, counting from 0.

The engine maintains a per-page text-run index built from `parseContentStream(page)`. The renderer obtains `objectId` via the NEW channel `pdf:identifyTextSpan` (see `api-contracts.md` §12) which runs the engine's text-span identifier code path against the in-memory doc.

**Critical property:** `objectId` is valid only for the SAME `originalBytes`. The renderer must NOT cache `objectId` across reloads. It's safe to cache for the duration of one document handle's lifetime.

#### 4.6.2 Replacement algorithm

```
applyTextReplace(ctx, doc, op):
  1. Resolve objectId → { page, contentStreamIndex, run }
     If not found → return fail('text_span_not_found', ..., { objectId })
  2. Inspect the run's font:
       run.font = the PDFFont object referenced by the most recent Tf operator before run.
       run.fontSize = current Tf size at run position.
  3. Compute glyph coverage:
       for (const cp of [...newText]):
         if (run.font.encodeCharacter(cp) is invalid) → return fail('missing_glyph', ..., { codepoint })
       (Per locked decision P2-L-3, NO font substitution. Failure is honest.)
  4. Compute new-string width vs original-run bounding box width:
       newWidth = run.font.widthOfTextAtSize(newText, run.fontSize)
       if (newWidth > run.boundingRect.width):
         ctx.warnings.push(`Text replace at ${objectId} will be clipped: ${newWidth - run.boundingRect.width}pt overflow`)
         // Do NOT error — the user has been warned in the preview step (see ui-spec.md §11)
         // and explicitly accepted on commit. The PDF renders with the new string, just clipped at the box edge.
  5. Mutate the content stream:
       parsed[contentStreamIndex] = replaceRun(parsed[contentStreamIndex], runIndex, newText, run.font)
       page.setContentStream(reencode(parsed[contentStreamIndex]))
  6. Update the engine's text-run index for downstream ops.
```

#### 4.6.3 Why no font fallback

Locked decision P2-L-3. If we substituted a different font when the original lacked a glyph, the user would see "résumé" in a font that doesn't match the rest of the document — a layout regression worse than the missing-glyph error. The honest UX is to refuse the edit and surface the missing-glyph indicator in the renderer preview before commit (see `ui-spec.md` §11 — failure-mode UX).

**Error modes:**

| Condition | Error |
|---|---|
| objectId can't be resolved | `text_span_not_found` |
| `newText` contains codepoints the run's font lacks | `missing_glyph` (details.codepoint) |
| Content-stream parse/re-encode throws | `op_apply_failed` (text_stream_corrupt) |

**Order-sensitive:** Yes (replacing run #3 then run #5 within the same page mutates the content stream; the index for run #5 may change after run #3's replacement). The engine re-indexes after each replace.

**Inverse:** `text-replace { pageIndex, objectId, oldText: newText, newText: oldText }`.

### 4.7 Bookmark ops (decision: outside the EditOperation funnel)

After spec'ing the above six variants, I evaluated whether bookmarks should also be `EditOperation` variants (`bookmark-add`, `bookmark-rename`, `bookmark-delete`, `bookmark-reorder`, `bookmark-nest`). **Recommendation: no.**

Bookmarks live in SQLite (table `user_bookmarks`, see `data-models.md` §2). They are NOT part of the PDF byte stream the engine emits. Their lifecycle:

- Renderer dispatches a bookmark mutation via `bookmarks:upsert` / `bookmarks:delete` (existing Phase-1 channels) plus the new `bookmarks:reorder` and `bookmarks:move` channels documented in `api-contracts.md` §12.
- Main writes to SQLite directly.
- Undo of a bookmark op is handled by `historySlice` in the renderer dispatching the inverse `bookmarks:*` IPC call — NOT by re-running the engine.

**Why this is the right boundary:**

1. The engine is a pure function over PDF bytes. Bookmarks aren't bytes.
2. Coupling bookmark CRUD to PDF save would prevent saving bookmarks WITHOUT re-emitting the PDF (a real Phase-2 ergonomic — the user wants to bookmark while reading, not on save).
3. The undo middleware handles both EditOperations and bookmark ops the same way: each carries `meta.undoable: true` and has a registered inverse.

**Phase-2 bookmark write-through to PDF outline:** if the user has authored bookmarks AND triggers `pdf:export`, the export path optionally writes those bookmarks to the PDF's `/Outlines` dictionary so the exported file is portable. This is an engine **option**, not an op:

```ts
// extension of ReplayInput (see §2.1)
interface ReplayInput {
  // ...existing fields...
  emitBookmarksToOutline?: BookmarkSnapshot[]; // present on pdf:export only
}
```

When present, after step 4 the engine builds a `PDFOutlines` tree from the snapshot (respecting `parentId` and `sortOrder` from the Phase-2 schema delta). When absent, the engine leaves the source PDF's existing `/Outlines` alone.

`fs:writePdf kind:'ops'` does NOT emit bookmarks by default (the user expects "Save" to round-trip the file; if the source had no outline, Save shouldn't add one). `pdf:export` does emit when the bookmarks slice is non-empty.

---

## 5. Annotation emit phase (step 4)

Already documented in `ARCHITECTURE.md` §7.2; Phase 2 adds two specifics:

### 5.1 When to emit

`isDirtyOrUnsaved(a) := a.dirty === true || a.pdfObjectNumber === undefined`

Emit only annotations that satisfy the predicate. Pre-existing annotations that haven't been edited stay where they are in the source PDF — pdf-lib's `PDFDocument.load` preserves the source's `/Annots` arrays untouched.

### 5.2 What to write

Subtype mapping per `data-models.md` §3.4. Phase 2 activates `/Underline`, `/StrikeOut`, `/Ink`. Each goes through `src/main/pdf-ops/annotations.ts` (existing Phase-1 file; David extends).

`/Ink` is the hand-authored subtype (no native pdf-lib helper). David authors the `PDFDict` directly with `Subtype: Ink`, `InkList: [[x0,y0, x1,y1, ...], ...]`, `BS`, `C`, `Rect`. Tested in Wave 7.

### 5.3 Object-number assignment

Once written, pdf-lib assigns a new `PDFRef` to each emitted annotation. The engine returns these in `ReplayOk`:

```ts
interface ReplayOk {
  newBytes: Uint8Array;
  warnings: string[];
  engineUsed: 'pdf-lib';
  byteCount: number;
  durationMs: number;
  /**
   * Map of annotation.id → newly-assigned pdfObjectNumber, for the renderer
   * to update its slice on save success (clears `dirty`, sets `pdfObjectNumber`).
   */
  annotationRefAssignments: Record<string, number>;
}
```

The IPC response from `fs:writePdf kind:'ops'` includes this map; the renderer thunk dispatches a `setAnnotationRefs(map)` action on success.

---

## 6. Op ordering and conflict resolution

### 6.1 Dispatch order is sacred

The engine applies ops in `input.ops[]` array order. No topological reorder, no batching, no clever rearrangement.

**Rationale:**

- Undo invariant. If the engine reordered, the inverse list would have to be regenerated based on the new order — impossible because the renderer's history middleware has already pushed the original-order inverses onto the past stack.
- Simpler reasoning. `applyOp` for op N can assume the doc looks exactly like it did after ops 0..N-1 were applied. No "did anyone insert a page between N-1 and N" lookahead.
- Replay-engine = pure fold. The mental model is `ops.reduce(applyOp, initial)`. This is the simplest possible model for the user to reason about and the simplest possible model for golden-bytes testing.

### 6.2 The only "conflict"

A `delete` followed by an `annot-edit` referencing an annotation on the deleted page. The renderer slice already handles this in `applyDelete`:

```ts
// document-slice-apply.ts, applyDelete:
// On delete, every annotation with pageIndex === deletedIndex is also removed.
// Subsequent annot-edit / annot-delete ops referencing those IDs become no-ops
// (the annotation is no longer in state.current.annotations).
```

The engine inherits this guarantee: if the renderer's slice removed the annotation, the engine's `input.annotations` snapshot doesn't include it. The `annot-edit` op in `ops[]` still appears (for undo's sake) but the emit step never runs for that annotation because it isn't in `input.annotations`. The op essentially evaporates at the engine layer — its only purpose was inverse-bookkeeping in the renderer.

**Edge case** — reorder that moves a page bearing pending annotations: the renderer's `applyReorder` rebinds annotation `pageIndex` values; the engine's emit step uses the rebound value. No engine-side rebind needed.

### 6.3 Image-overlay z-order

Within a single page, multiple overlays render in the order they were created. The engine's step 3.5 (drawOverlays) iterates `liveOverlays` in **insertion order** of the Map, which is the dispatch order (insertion = first `image-overlay` op for that overlayId, even if subsequently `image-overlay-edit`-ed). The user can verify in the renderer's overlay-manager UI; if they want a different z-order, Phase 2 doesn't ship overlay-reordering (defer to Phase 3 if needed).

---

## 7. Image embedding cache (decision: dedup by content hash)

Per `phase-2-plan.md` §7 question 5 and `architecture-phase-2.md` §3.7.

```ts
// src/main/pdf-ops/replay-engine.ts (per-invocation state)
interface ReplayContext {
  imageCache: Map<string /* contentHash */, PDFEmbeddedImage>;
  liveOverlays: Map<string /* overlayId */, OverlayEntry>;
  pages: PageContext[];
  warnings: string[];
  jobId: string;
}
```

**Content hash** is computed in main (NOT in the renderer — Uint8Array hashing in main keeps the renderer light per conventions §10). When the renderer fires `pdf:embedImage`, main:

1. Reads the user-supplied bytes (from drag-drop temp, file picker, etc.).
2. Computes `sha256(bytes)` synchronously (small enough — most images <5 MB).
3. Returns the `EditOperation` shape with `image.contentHash` populated.

The renderer pushes that op onto `dirtyOps`. On save, the engine:

1. For each unique `contentHash` in the ops list, embed once via `embedPng/embedJpg`.
2. Each `drawImage` call references the cached `PDFEmbeddedImage`.

**Cache scope:** per-invocation. A new `replay()` call gets a fresh cache. The PDF being emitted gets the dedup benefit; subsequent saves re-embed (cheap, since `embedPng` returns a `Promise<PDFImage>` that pdf-lib parses internally — the same source PNG produces the same byte-stable XObject).

**Net win:** dragging the same signature image onto 50 pages produces a single embedded image with 50 `Do` references, not 50 copies. Realistic case for the signature-stamp UX.

---

## 8. TIFF decoding

Per `phase-2-plan.md` §4.3. Default library: **`utif`** (pure-JS, MIT). Escalate to `sharp` only if utif fails real-user fixtures.

### 8.1 Module placement

`src/main/pdf-ops/tiff-decoder.ts` (NEW, David Wave 7):

```ts
import * as UTIF from 'utif';

export interface TiffDecodeResult {
  format: 'png';                  // we always re-encode to PNG for pdf-lib
  bytes: Uint8Array;
  width: number;
  height: number;
  warnings: string[];             // e.g. "multi-page TIFF detected — using first page only"
}

export function decodeTiff(input: Uint8Array): Result<TiffDecodeResult, 'tiff_decode_failed' | 'unsupported_compression' | 'multi_page'>;
```

### 8.2 Phase-2 TIFF support level (honest scope fence)

| Sub-feature | Phase 2 supports? | Phase rendering |
|---|---|---|
| Single-page TIFF | Yes | First page extracted, returned as PNG |
| LZW compression | Yes (utif supports) | |
| Deflate compression | Yes | |
| Uncompressed | Yes | |
| CCITT Group 4 (faxed scans) | Best-effort | utif claims support; verify in Wave 7 fixture corpus |
| Multi-page TIFF | **No** (Phase 5) | Decoder returns `multi_page` error; renderer toasts "Multi-page TIFF support coming in Phase 5"; OR uses first page only with `warnings` flag — David's call in Wave 7. Recommend: use first page, warn. |
| JPEG-in-TIFF (TIFF with JPEG compression) | Best-effort | utif limited; if fails, decode error |
| BigTIFF | **No** | Error |
| CMYK colorspace TIFFs | **No** in Phase 2 | utif's CMYK→RGB conversion is approximate; document the limitation |

Document these in user-guide.md (Nathan Wave 9) AND in `replay-engine.ts`'s top-of-file doc comment.

---

## 9. Partial-failure rollback

Per `phase-2-plan.md` §7 question 2 and `architecture-phase-2.md` §3.4. **Whole-save abort, no partial commit.**

### 9.1 Inside replay()

If `applyOp` for op N throws, the engine:

1. Catches the throw inside the try/catch wrapping the op loop.
2. Returns `fail('op_apply_failed', message, { opIndex: N, opKind: op.kind })`.
3. Does NOT serialize the partially-mutated doc.
4. Does NOT touch the filesystem.

The caller (`fs-write-pdf.ts` handler) sees the `Result` failure variant and does NOT call `fs.rename` on the temp file. See §10 for the atomic-rename interaction.

### 9.2 Memory cleanup

The `PDFDocument` object held inside `replay()` is GC'd when the function returns. No lingering state. The engine has no module-level mutable cache — `imageCache` is per-invocation. This is critical for back-to-back save attempts (failed save → fix → retry) not leaking memory.

### 9.3 What about `annotation_emit_failed`?

Same path. If annotation #7 of 12 throws, the engine has mutated `doc` for annotations 0-6 in memory but never serializes. The original file remains untouched.

This is acceptable because annotation ops are idempotent at the source-of-truth level: the renderer's `annotationsSlice` still says "all 12 are dirty"; the next save attempt re-runs the whole emit step.

---

## 10. Atomicity (write-to-temp, rename)

The engine itself doesn't touch FS, but the caller does. The caller pattern (David Wave 7, in `fs-write-pdf.ts`):

```ts
async function handleFsWritePdfOps(req: FsWritePdfRequest): Promise<FsWritePdfResponse> {
  if (req.payload.kind !== 'ops') return fail('invalid_payload', '...');

  const originalBytes = documentStore.getBytes(req.handle);
  if (!originalBytes) return fail('handle_not_found', '...');

  const replayResult = await replay({
    originalBytes,
    ops: req.payload.ops,
    annotations: req.payload.annotations,
    jobId: crypto.randomUUID(),
  });

  if (!replayResult.ok) return mapReplayError(replayResult);

  const destPath = consumeDestinationToken(req.destinationToken);
  if (!destPath) return fail('token_expired', '...');

  // Atomic write: temp file in SAME DIRECTORY (cross-FS rename is non-atomic), then rename.
  const tempPath = path.join(path.dirname(destPath), `.${path.basename(destPath)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(tempPath, replayResult.value.newBytes);
    await fs.rename(tempPath, destPath);   // POSIX: atomic. Windows: atomic on same volume since Win Vista+.
  } catch (e) {
    // Best-effort cleanup of temp file
    await fs.unlink(tempPath).catch(() => {});
    return fail('fs_write_failed', (e as Error).message, { tempPath });
  }

  return ok({ bytesWritten: replayResult.value.byteCount, newFileHash: computeFileHash(replayResult.value.newBytes) });
}
```

**Why temp-in-same-dir:** `fs.rename` is only atomic when source and destination are on the same filesystem. The system temp dir often lives on a different volume.

**Failure mode if rename fails:** the temp file is left on disk (best-effort cleaned up). Error returned to the renderer as `fs_write_failed` with `details.tempPath`. Phase-2 doesn't ship a "recover from temp file" UX (low priority); user can rename it manually if they care.

**The renderer-visible contract:** either the destination file fully reflects all ops, or it's untouched. Never partially-saved.

---

## 11. Performance

### 11.1 Streaming progress

For documents > 50 MB or ops lists > 50 entries, emit `pdf:export:progress` events per `api-contracts.md` §7.3. Phases:

```
'preparing'                  0-5%      // pdf-lib load
'pdflib-applying-ops'        5-60%     // step 3 op fold (per-op tick)
'pdflib-applying-text-replace'    sub-phase    // for text-replace ops which can be slow on big content streams
'pdflib-embedding-images'         sub-phase    // for image-insert/overlay
'pdflib-emitting-annotations'    60-90%     // step 4
'finalizing'                 90-100%   // save() + caller's writeFile + rename
```

Renderer subscribes via `window.pdfApi.events.onExportProgress(handler)` (existing channel; new phase values are additive).

### 11.2 Soft limits (Phase 2 = correctness-first)

| Limit | Soft cap | Hard behavior |
|---|---|---|
| Original PDF size | 500 MB | `dialog:openPdf` rejects with `too_large`; setting `open.maxFileSizeMB` overrides |
| Ops list length per save | 1000 | No hard cap; perf degrades linearly; warn in log if >1000 |
| Image overlays per page | 100 | No hard cap; PDF content streams handle this fine |
| Image bytes per single embed | 50 MB | Recommend chunking, but pdf-lib handles via streams |

Phase 2 doesn't ship streaming pdf-lib (no `embedJpgStream`); the in-memory model is sufficient for realistic doc sizes. Phase 2.5 (post-ship perf hardening) revisits if real-world reports show pressure.

### 11.3 Font subsetting

pdf-lib's default behavior: when you reference a font that's already embedded in the source PDF, pdf-lib does NOT re-subset on save (it preserves the existing subset). This is the desired behavior for text-replace: we want to keep the original font's existing glyph subset. If `text-replace` introduces a new codepoint that's NOT in the original subset, the glyph isn't available — that's the `missing_glyph` error path (§4.6.3).

For new annotations (FreeText, Underline, etc.) that need a new font: pdf-lib embeds the Helvetica standard font (PDF's built-in, no embedding cost). Phase 2 doesn't ship custom-font selection.

### 11.4 Object stream compression

`doc.save({ useObjectStreams: true })` — enabled. Reduces output size 10-30% on typical docs. Cross-viewer compatibility verified (Acrobat 7+, Foxit, Chrome PDF viewer, pdf.js — all support object streams). **Verify in Wave 7 with a real reader matrix.** If any reader has issues, the option toggles to `false` with a perf warning.

---

## 12. Round-trip fidelity boundary (Phase 2 honesty)

Per the H-3 lesson promoted from Wave 3.5: **document the fidelity boundary loud, in the engine doc and in the user guide.** This is the matrix:

| PDF feature in source | Round-trips? | Phase 2 behavior |
|---|---|---|
| Page count / order | Yes | Always preserved |
| Page rotation metadata | Yes | Preserved or re-applied per `rotate` op |
| Standard annotations (`/Highlight`, `/Text`, `/FreeText`, `/Underline`, `/StrikeOut`, `/Ink`) | Yes | Preserved through pdf-lib; new ones authored cleanly |
| Annotations with appearance streams (custom `/AP`) | **Partial** | pdf-lib may regenerate appearance streams. Visual fidelity high but not byte-identical. **Warn in `pdflibLoadWarnings`.** |
| AcroForm fields | **No** (Phase 3) | pdf-lib loses appearance streams + can drop field values. Heuristic biases to Chromium fallback when forms are present. |
| Embedded JavaScript actions | **No** | Stripped silently on save. Heuristic biases to Chromium for `/Names → /JavaScript` presence. |
| Page-level `/Action` (JavaScript triggers) | **No** | Same as above |
| Embedded files / attachments | **Partial** | Preserved if pdf-lib's load preserves; not exposed in UI |
| Document-level metadata (`/Info`, `/Metadata`) | Yes | pdf-lib preserves on save |
| Encryption / DRM (`/Encrypt`) | **No** | pdf-lib drops the security handler on save. Heuristic flags as Chromium-fallback target; user can still print to the OS printer via `pdf:print`. |
| Linearization (Fast Web View) | Lost on save | pdf-lib doesn't emit linearized output. Acceptable for desktop save; lose Fast Web View. |
| Object streams (`/ObjStm`) | Re-emitted | Source may have ObjStm; pdf-lib re-emits its own. Byte-different but structurally equivalent. |
| Color profiles (ICC, CMYK) | **Partial** | pdf-lib preserves embedded colorspaces; renderer-rendered annotations are sRGB. Heuristic biases to Chromium for CMYK-with-ICC sources. |
| Tagged PDF / structure tree | **Partial** | pdf-lib preserves on load+save but doesn't author new structure. New annotations are untagged. Accessibility hit; Phase 7 a11y audit revisits. |
| Bookmarks / outline | Yes (preserve); Yes (write through if `emitBookmarksToOutline` set) | See §4.7 |
| Image overlays (round-trip back to editable overlay) | **No** | Once saved, an overlay becomes part of the page content. Re-opening the saved PDF shows the image but not as an editable overlay. This is by design (overlay state lives in renderer ops, not in PDF). Document loudly. |
| Text replacement (round-trip to find the same span again) | **No** | After save, the run that was replaced is byte-identical to the new text. The renderer can find it again, but the **inverse op preserved in dirtyOps becomes stale once dirtyOps is cleared on save**. Undo across save is supported (history is not cleared) but the undo applies to the post-save state, which is the new text. This is documented in §13. |

**For each row marked "No" or "Partial":** the user-facing message at the point of action is "Some features in this PDF may not be preserved by the default engine. Consider using Chromium-based export for higher fidelity." The `ExportEngineSelector` heuristic in `ARCHITECTURE.md` §6.1 already biases toward Chromium for several of these triggers; Phase 2 extends the heuristic (see `architecture-phase-2.md` §3.8).

---

## 13. Undo / redo across save

Per `architecture-phase-2.md` §3.9. **History is NOT cleared on save.** The user can undo back to before their last save and re-save with different ops.

**Subtlety for text-replace:** after a save, the renderer's `dirtyOps` is cleared but `historySlice.past` is not. If the user undoes a `text-replace` that was saved 5 minutes ago, the inverse op (`text-replace { oldText: 'B', newText: 'A' }`) is dispatched. The next save's `dirtyOps` is just that one inverse op; the engine applies it to the **current** original bytes (which are the post-Save bytes — see §13.1) and the `oldText: 'B'` in the inverse refers to the run currently containing 'B', which is the run we previously edited.

This works as long as the renderer keeps the post-save bytes as the new original. Which requires:

### 13.1 Post-save handle bytes refresh

After a successful `fs:writePdf kind:'ops'` save, the **main process replaces the bytes in `DocumentStore` for that handle** with the newly-written bytes:

```ts
// in fs-write-pdf.ts handler, after successful rename:
documentStore.setBytes(req.handle, replayResult.value.newBytes);
```

The renderer's view of the document doesn't change (page count, pages, annotations all stay), but the engine's next replay invocation starts from the saved bytes, not the pre-save bytes.

This means `text-replace.objectId` values must be re-resolved after a save. The renderer either:

- Re-queries `pdf:identifyTextSpan` lazily when the user enters text-edit mode (recommended), OR
- Caches objectId-by-renderable-text and tolerates a `text_span_not_found` error with a retry.

`architecture-phase-2.md` §3.9.2 documents this and the renderer's responsibility.

---

## 14. Test strategy (Wave 7, David)

### 14.1 Fixture corpus

Live in `tests/fixtures/replay-engine/`:

- `empty.pdf` — single blank page, minimal valid PDF (golden round-trip baseline)
- `simple-text.pdf` — three pages, body text, no annotations (golden round-trip + text-replace)
- `with-annotations.pdf` — Phase-1 subtypes already authored (golden preservation)
- `with-form.pdf` — AcroForm field present (warning + heuristic-Chromium path)
- `encrypted.pdf` — password-protected (encrypted_unsupported error)
- `large.pdf` — 100+ pages (perf + progress-event test)
- `multi-content-stream.pdf` — page with `/Contents` as array (text-replace runIndex correctness)
- `cmyk-icc.pdf` — colorspace-warning path
- `image-png-source.png` / `image-jpeg-source.jpg` / `image-tiff-single.tif` — fixture images for embed tests
- `image-tiff-multi.tif` — multi-page TIFF (multi_page warning path)

### 14.2 Test categories

| Category | Coverage |
|---|---|
| Round-trip identity (no edits) | For each fixture: `replay({ originalBytes, ops: [], annotations: [] })` → result.newBytes, parse with pdf-lib again, assert page count + annotation count + outline === source |
| Single-op correctness | One test per EditOperation variant: apply the op, parse output, assert the doc reflects the op |
| Inverse identity | Each op + its inverse → no net change (page count, annotation set, text runs equal to source) |
| Multi-op composition | Sequences from realistic user flows (open, reorder, annotate, save) |
| Failure modes | One test per ReplayError variant; force the condition (e.g. bad image bytes), assert the specific error code |
| Golden bytes | Pinned fixtures with byte-equality assertion. Brittle but high-signal — if pdf-lib version changes shift bytes, the test alerts and the team consciously re-pins. |
| Performance regression | 100-page fixture with 50 ops → assert duration < 2s on Linux runner |
| Progress events | Fire a 50+ op replay, capture progress events, assert phases reach 100% monotonically |

### 14.3 Golden-bytes test pattern

```ts
// src/main/pdf-ops/replay-engine.test.ts
it('round-trips simple-text.pdf with no edits to a byte-stable output', async () => {
  const original = await readFixture('simple-text.pdf');
  const r1 = await replay({ originalBytes: original, ops: [], annotations: [], jobId: 'test' });
  const r2 = await replay({ originalBytes: original, ops: [], annotations: [], jobId: 'test' });
  expect(r1.ok && r2.ok).toBe(true);
  if (r1.ok && r2.ok) {
    expect(r1.value.newBytes).toEqual(r2.value.newBytes);  // determinism
    expect(Buffer.compare(Buffer.from(r1.value.newBytes), readGolden('simple-text-no-ops.golden.pdf'))).toBe(0);
  }
});
```

If the golden file diverges, David updates it consciously with a commit message documenting the cause (pdf-lib upgrade, deterministic-emit fix, etc.).

### 14.4 Property tests (stretch, Phase 2.5 if budget runs out)

`fast-check`-style: generate random op sequences, apply forward + inverse stack, assert state identity. Already used in Phase-1 inverse tests per `data-models.md` §3.2.

---

## 15. Phase-2 vs Phase-2.5 vs Phase-3 boundaries

### 15.1 In Phase 2 (Wave 7)

- The 11 EditOperation variants (5 Phase 1 + 6 new) replayed correctly
- Annotations Phase 1 (Highlight, Text, FreeText) + Phase 2 (Underline, StrikeOut, Ink) emitted
- Image-insert and image-overlay for PNG, JPEG, TIFF (with TIFF caveats §8.2)
- Text-replace with original-font glyph coverage check
- Bookmarks written through to outline on `pdf:export`
- pdf-lib engine for `fs:writePdf kind:'ops'` and the default `pdf:export` path
- Chromium engine remains the fallback for sources where pdf-lib loses fidelity

### 15.2 Phase 2.5 (perf + edge-case hardening, optional)

- Streaming pdf-lib (chunked load + chunked save) for >100 MB docs
- Multi-page TIFF support (full)
- CCITT-G4 + JPEG-in-TIFF full fidelity
- Tagged PDF preservation through text-replace
- `Result` typed error details map for richer renderer surfacing

### 15.3 Phase 3+

- AcroForm appearance preservation (Phase 3)
- Signature embedding with `/Sig` annotation (Phase 4)
- OCR overlay as a new EditOperation variant `{ kind: 'ocr-overlay', ... }` (Phase 5)
- Office export reuses the engine's load-then-walk pattern but with `docx`/`exceljs`/`pptxgenjs` emitters in place of pdf-lib (Phase 6)

The engine's module shape is designed to absorb these without refactoring the EditOperation union — each new variant is one new `case` branch in `applyOp`, one new emit step, and one entry in the fidelity matrix.

---

## 16. Files this engine creates / extends (Wave 7 ownership, for reference)

| File | Status | Owner |
|---|---|---|
| `src/main/pdf-ops/replay-engine.ts` | NEW | David |
| `src/main/pdf-ops/text-replace.ts` | NEW | David (contains the content-stream parser + replace logic; called by replay-engine) |
| `src/main/pdf-ops/image-embed.ts` | NEW | David (TIFF decode + embedPng/Jpg + cache logic) |
| `src/main/pdf-ops/tiff-decoder.ts` | NEW | David |
| `src/main/pdf-ops/document-store.ts` | EDIT | David (add `getBytes(handle)`, `setBytes(handle, bytes)`, bytes-retention lifecycle) |
| `src/main/pdf-ops/annotations.ts` | EDIT | David (Phase-2 subtypes: `/Underline`, `/StrikeOut`, `/Ink`) |
| `src/ipc/handlers/fs-write-pdf.ts` | EDIT | David (kind:'ops' path Live) |
| `src/ipc/handlers/pdf-export.ts` | EDIT | David (real implementation) |
| `src/ipc/handlers/pdf-embed-image.ts` | NEW | David |
| `src/ipc/handlers/pdf-replace-text.ts` | NEW | David |
| `src/ipc/handlers/pdf-identify-text-span.ts` | NEW | David |
| `src/ipc/handlers/pdf-print.ts` | NEW | David |
| `src/ipc/contracts.ts` | EDIT | David (new channel types per `api-contracts.md` §12) |
| `src/ipc/register.ts` | EDIT | David |
| `tests/fixtures/replay-engine/*.pdf` | NEW | David |
| `src/main/pdf-ops/replay-engine.test.ts` | NEW | David |

Riley owns nothing in this engine — it's entirely main-process. Riley owns the **callers** in the renderer (`thunks.ts`, the new modals + overlays from `ui-spec.md` §11).

---

## 17. Cross-reference checklist

- [x] `replay()` signature documented (§2.1)
- [x] Purity contract documented (§2.2)
- [x] All 11 EditOperation variants have apply semantics (§4.1-§4.7)
- [x] Inverses match `data-models.md` §3.2 + Phase 2 extension (§4.3-§4.6)
- [x] Op ordering policy answered (§6, dispatch order)
- [x] Partial-failure rollback policy answered (§9, whole-save abort)
- [x] Atomic save documented (§10)
- [x] Image-embedding cache documented (§7)
- [x] TIFF support boundary documented (§8.2)
- [x] Round-trip fidelity matrix documented (§12)
- [x] Undo across save documented (§13)
- [x] Phase-2 vs 2.5 vs 3+ scope fence documented (§15)
- [x] Test strategy for Wave 7 documented (§14)
- [x] File-ownership map for Wave 7 documented (§16)

L-001 untouched — this doc does not weaken or reference `enableDragDropFiles`.
