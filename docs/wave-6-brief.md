# Wave 6 Brief — Riley (Phase 2 Architecture)

**Author:** Marcus (orchestration-manager)
**Date:** 2026-05-21
**Dispatch agent:** `front-end-architect` (Riley) — solo, sequential
**Estimated effort:** 3-5 hours
**Prerequisite:** Phase 1.1 (Wave 5) closes GREEN.

---

## 0. Required reading (in order)

Read these BEFORE starting any deliverable. Many of your Phase-2 design choices are pre-constrained by Phase-1 reality.

1. `d:/Projects/PDF_Viewer_Editor/CLAUDE.md` — project rules.
2. `d:/Projects/CLAUDE.md` — swarm rules.
3. `d:/Projects/PDF_Viewer_Editor/.learnings/locked-instructions.md` — L-001 must continue holding through every Phase-2 doc.
4. `d:/Projects/PDF_Viewer_Editor/.learnings/learnings.jsonl` — every prior wave's lessons. Filter for `front-end-architect` for your own past entries (Wave 1 architecture, Wave 2 implementation, Wave 3.5 H-2 fix); read Marcus's Wave 3.5 verdict and David's Wave 3.5 entry to understand the H-3 Phase-1 boundary you are designing-around in Phase 2.
5. `d:/Projects/PDF_Viewer_Editor/docs/phase-2-plan.md` — the master plan you are executing the architecture wave of. Read §0 (locked decisions), §4 (risk register), §7 (open questions), §10 (honesty obligations).
6. `d:/Projects/PDF_Viewer_Editor/ARCHITECTURE.md` — full read. Particularly:
   - §4 Document model
   - §5 State architecture (Phase-1 historyMiddleware is a passive shim — you need to activate it in Phase 2)
   - §6 Print-to-PDF dual-engine design (mostly drafted, you verify the heuristic table is exhaustive for Phase-2 ops)
   - §7 Annotation architecture
   - §8 Extension points for Phase 2-7 (your Wave 1 own work — Phase-2 entries are your stub commitments)
   - §11 Open architectural questions (some still open; address in Phase 2)
7. `d:/Projects/PDF_Viewer_Editor/docs/api-contracts.md` — full read. Note §11 backward-compatibility policy: Phase-1 surface is frozen; Phase-2 channels are additive.
8. `d:/Projects/PDF_Viewer_Editor/docs/data-models.md` — full read. The `EditOperation` discriminated union is your extension point. Bookmarks `parent_id` is the Phase-2 schema item.
9. `d:/Projects/PDF_Viewer_Editor/docs/ui-spec.md` — full read. UI affordances spec.
10. `d:/Projects/PDF_Viewer_Editor/docs/conventions.md` — particularly §6 (Redux), §10 (Performance — `Uint8Array` ban in store), §11 (i18n out of scope).
11. `d:/Projects/PDF_Viewer_Editor/docs/code-review.md` — Julian's Wave 2 audit. Re-read §E (Redux + state) and §H (Architecture compliance) since your H-2 fix in Wave 3.5 closed E-1 and Phase 2 extends the EditOperation surface.
12. `d:/Projects/PDF_Viewer_Editor/docs/build-report.md` — Wave 3.5 + Wave 4 sections especially. Decision A (H-3 boundary) is the Phase-1 honesty-floor you're now closing.

## 1. Locked decisions (must not weaken)

From `docs/phase-2-plan.md` §0:

| ID | Decision | Architecture implication |
|---|---|---|
| **P2-L-2** | **Edit-replay architecture: main keeps original bytes per handle.** Main retains the loaded PDF `Uint8Array` keyed by `DocumentHandle`. Renderer streams `EditOperation[]` via IPC; main applies via pdf-lib at save time. Renderer holds no large binaries. | Drives `fs:writePdf` `kind:'ops'` Live, drives `DocumentStore.getBytes(handle)` extension, drives Print-to-PDF pdf-lib engine. The lynchpin — every other Phase-2 design choice composes on this. |
| **P2-L-3** | **Text editing: replace-only with original font.** No reflow, no font substitution. Plus the existing Phase-1 FreeText annotation tool for net-new text. | New `EditOperation` variant `text-replace`. Architecture must specify failure modes (text doesn't fit, missing glyphs) and the UX response (warn/error, not auto-substitute). |
| **P2-L-4** | **Image import: both modes.** Insert-as-new-page AND overlay-on-existing-page. Formats: PNG, JPEG, TIFF. | New `EditOperation` variants `image-insert` (new page) and `image-overlay` (existing page rect). New IPC channel `pdf:embedImage`. TIFF decoder in main process; PNG/JPEG native to pdf-lib. |
| **P2-L-5** | `ARCHITECTURE.md` is **frozen**. Write `docs/architecture-phase-2.md` as the Phase-2 additions/deltas doc. Phase-1 readers see the original; Phase-2 readers see the delta. | Append-only edits to api-contracts.md, data-models.md, ui-spec.md, conventions.md — never destructive. New "Phase 2 additions" section in each. |
| **P2-L-6** | Bookmarks authoring: full CRUD + nesting + reorder. Schema migration `0002_phase2_bookmarks.sql` adds `parent_id` + `sort_order`. | New repo methods, new UI tree component, new EditOperation variants for bookmark mutations (or NO — they may stay outside the document-edit funnel; you decide). |

## 2. Deliverables

### 2.1 `docs/architecture-phase-2.md` (NEW — primary deliverable)

The Phase-2 architecture document. Modeled on `ARCHITECTURE.md`'s structure but only enumerating Phase-2 additions/changes. Specifically must address:

#### 2.1.1 Process model deltas
- `DocumentStore` extended to retain `Uint8Array` per handle. Lifetime contract: held from open (`dialog:openPdf` / `fs:readPdf`) to close (`fs:closePdf`).
- Memory budget per handle. Single-document Phase-1 invariant still holds in Phase-2 (no multi-document yet).
- Where the replay engine lives: `src/main/pdf-ops/replay-engine.ts` (NEW, David Wave 7).

#### 2.1.2 EditOperation extensions
List every new variant:
- `{ kind: 'text-replace'; meta: EditMeta; pageIndex: number; objectId: string; oldText: string; newText: string }` (oldText for inverse; objectId is pdf-lib's content-stream operator reference — Riley defines the encoding scheme)
- `{ kind: 'image-insert'; meta: EditMeta; atIndex: number; image: { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' | 'image/tiff'; width: number; height: number } }`
- `{ kind: 'image-overlay'; meta: EditMeta; pageIndex: number; rect: PdfRect; image: { ...same... }; overlayId: string }` (overlayId so we can edit/delete a specific overlay later)
- `{ kind: 'image-overlay-edit'; meta: EditMeta; pageIndex: number; overlayId: string; beforeRect: PdfRect; afterRect: PdfRect }` (move/resize an overlay)
- `{ kind: 'image-overlay-delete'; meta: EditMeta; pageIndex: number; overlayId: string; before: ... }`

For each, specify its **inverse** per data-models §3.2 table format. Add the rows to the data-models doc.

#### 2.1.3 Op-ordering policy
Answer phase-2-plan §7 question 1: **dispatch order**, no topological reorder. Document why (simpler reasoning, undo/redo invariants hold trivially, replay engine is a pure fold). Edge case: a `reorder` op that moves a page that has pending annotations/overlays — the rebind happens in the replay engine, not pre-replay.

#### 2.1.4 Partial-failure rollback policy
Answer phase-2-plan §7 question 2: **whole-save abort**, no partial commit. If op N fails, the original file is untouched (atomic-rename pattern in §2.1.5). Document why: partial-success UX is a trap — the user thinks they saved, half their edits are gone, and the next save mishandles `dirtyOps`. All-or-nothing keeps the contract simple.

#### 2.1.5 Atomic save
Answer phase-2-plan §7 question 3: **write to temp, then rename**. Temp file in same directory as destination (cross-FS rename is non-atomic). Document the failure mode if rename itself fails (rare; surface as `fs_write_failed` with the temp path still on disk for recovery).

#### 2.1.6 Bytes-retention lifetime
Answer phase-2-plan §7 question 4: **bytes held for handle lifetime, no eviction**. Phase-2 is single-document; the memory cost is bounded. Phase-5 (multi-document) will revisit if needed. Document the trade-off.

#### 2.1.7 Image-embedding caching
Answer phase-2-plan §7 question 5: **dedupe by content hash**. Same image dropped on 5 pages → embed once, reference five times via pdf-lib's `embedPng`/`embedJpg` returning a reusable ref. Replay engine maintains an in-flight `Map<sha256, PDFEmbeddedImage>` per save.

#### 2.1.8 Print-to-PDF determinism
Answer phase-2-plan §7 question 6: pdf-lib is deterministic; Chromium is not (timestamps in `/CreationDate` + `/ModDate`). Document the difference. **Decision:** strip timestamps from Chromium output post-emit if `export.deterministic` setting is true (NEW setting key — add to data-models.md §2.3). Default false.

#### 2.1.9 Text-edit span identification
Answer phase-2-plan §7 question 7. UX (defer detail to ui-spec.md addition):
- Click into a text region in the canvas overlay → renderer queries main via NEW channel `pdf:identifyTextSpan` for the operator-level identification at that point.
- Returns `{ objectId, runBoundingRect, currentText }`.
- Renderer renders an inline text input over the run; user edits; commit fires `text-replace` EditOperation.

This implies a new IPC channel — add it to the api-contracts §7 additions section.

#### 2.1.10 Failure-mode UX for text-replace
Per phase-2-plan §4.2 risk:
- **Text doesn't fit:** detection — preview engine measures the new string with the original font's glyph widths; if it exceeds the original run's bounding box, the preview shows the overflow + a tooltip "Text will be clipped on save. Phase 4 will support reflow." User can cancel or accept.
- **Missing glyph:** detection — font's glyph map doesn't have the codepoint. Preview shows a tofu (`￿`) or visible-missing-glyph marker. Same tooltip path. No auto-substitution.

#### 2.1.11 Undo/redo activation
Phase-1 has `historyMiddleware` as a passive shim. Phase-2 activates it. Specify:
- Where the inverse computation lives (data-models.md §3.2 already documents the table; you ensure the new EditOperation variants have inverses).
- How `meta.operationId` flows through the redux history stack.
- Cap at `undo.maxHistory` setting (already in data-models §2.3).
- What happens on Save: history is **not** cleared (undo across save is supported in Phase 2).

#### 2.1.12 Print-to-PDF heuristic update
Per phase-2-plan §4.5 risk:
- Update the heuristic table in ARCHITECTURE.md §6.1. New rows for: text-replace ops (pdf-lib safe), image-insert/overlay (pdf-lib safe for PNG+JPEG; TIFF is decoded to PNG first), bookmarks-changed (pdf-lib safe).
- Specifically, Ink annotations remain the Chromium-fallback trigger. Text-replace with missing-glyph fallback should NOT trigger Chromium (Chromium would substitute the font, which violates locked decision P2-L-3).

### 2.2 `docs/edit-replay-engine.md` (NEW — secondary deliverable)

Detailed design of the main-process pdf-lib replay engine that David implements in Wave 7. Must include:

#### Sections required:
1. **Inputs / outputs.** Inputs: `originalBytes: Uint8Array`, `ops: EditOperation[]`, `annotations: AnnotationModel[]`. Output: `Result<{ newBytes: Uint8Array; warnings: string[] }, ReplayError>`.
2. **Algorithm (high-level).** Step 1: load pdf-lib document. Step 2: build a `PageContext[]` map mirroring the renderer's `PageModel`. Step 3: fold ops in dispatch order. Step 4: emit annotations. Step 5: serialize.
3. **Op handlers — pseudocode for each variant.** `reorder`, `insert`, `delete`, `rotate`, `annot-add`, `annot-edit`, `annot-delete`, `text-replace`, `image-insert`, `image-overlay`, `image-overlay-edit`, `image-overlay-delete`. Reference pdf-lib API methods explicitly.
4. **Annotation emit phase.** When to emit annotations: AFTER all page-structure ops, in `pageIndex` order. The `pdfObjectNumber` is assigned at this point.
5. **Conflict resolution.** Per §2.1.3 — dispatch order is sacred. The only "conflict" is a delete-then-edit on the same op stream, which Phase-1 already guards in the renderer slice (deletes invalidate later edit ops by id-checking).
6. **Partial-failure rollback.** Per §2.1.4 — whole-save abort. The implementation is straightforward: any thrown error bubbles up, no temp file is finalized.
7. **Atomicity.** Per §2.1.5 — write-to-temp, rename. Specify the temp filename pattern (`.<name>.tmp-<pid>-<ts>` in same directory).
8. **Performance considerations.**
   - Streaming output for >50MB: how the engine cooperates with the `pdf:export:progress` event stream (yields between op phases).
   - In-flight image-embed cache (§2.1.7).
   - Font subsetting: pdf-lib's default behavior is acceptable for Phase 2; document it.
   - Compression: enable pdf-lib's `useObjectStreams` for output size (verify cross-viewer compatibility first — pdf-lib readers and most modern viewers support it).
9. **Error variants.**
   ```ts
   type ReplayError =
     | 'load_failed'
     | 'op_apply_failed'
     | 'annotation_emit_failed'
     | 'image_decode_failed'
     | 'text_span_not_found'
     | 'missing_glyph'    // text-replace with no fallback
     | 'serialize_failed';
   ```
10. **Testability.** What David's Wave-7 tests must cover. Specifically: a round-trip fidelity matrix — known-good PDFs with no edits should re-emit byte-identical (modulo pdf-lib's deterministic re-emit metadata). Edits should produce the expected mutations.
11. **Phase-2 fidelity boundary.** Honest enumeration of what the engine CANNOT do (e.g. preserve form-field appearance streams perfectly, preserve embedded JavaScript actions, preserve `/ObjStm` exactly). These become the Phase-3 / Phase-4 backlog. Document them so Nathan's Wave-9 user-guide update is honest.

### 2.3 `docs/api-contracts.md` — Phase 2 additions section

Add a new section `## 12. Phase 2 additions (2026-05-21)` at the bottom (NOT modifying §1-§11). Document:

- `pdf:embedImage` channel — request/response/errors.
- `pdf:replaceText` channel — same.
- `pdf:identifyTextSpan` channel — same. Called by renderer when user clicks into text.
- `pdf:print` channel — for physical printer.
- `pdf:export` real implementation (the channel is in §7.2 already, but the `'no_dirty_changes'` semantics in Phase 2 may shift now that ops actually round-trip).
- `fs:writePdf` `kind:'ops'` becomes Live — note the `'not_implemented'` variant is no longer returned for that payload kind.
- Any new event-stream phases for `pdf:export:progress` (e.g. `'pdflib-applying-text-replace'` as a sub-phase).

### 2.4 `docs/data-models.md` — Phase 2 additions section

Add a new section `## 7. Phase 2 additions (2026-05-21)` at the bottom. Document:

- New EditOperation variants with full TS shapes (per §2.1.2 above).
- Inverse table for the new variants (extending §3.2).
- Image embedding model (`PdfImageRef`, content-hash dedup).
- `0002_phase2_bookmarks.sql` schema delta: `parent_id INTEGER REFERENCES user_bookmarks(id) ON DELETE CASCADE` + `sort_order INTEGER NOT NULL DEFAULT 0`. Plus the new index `idx_user_bookmarks_parent_id`. Provide the DDL.
- `BookmarkRow` shape update (snake_case for Ravi, camelCase for IPC contract).
- New repo interface methods on `BookmarksRepo`: `listTree(fileHash)`, `move(id, newParentId, newSortOrder)`, `rename(id, title)`.
- New settings keys (if any — e.g. `export.deterministic` from §2.1.8).

### 2.5 `docs/ui-spec.md` — Phase 2 additions section

Add a new section `## 11. Phase 2 additions (2026-05-21)`. Document:

- Toolbar additions: Image button, Text-edit toggle, Print button, Export-to-PDF button, Undo/Redo buttons.
- Menu additions: Edit menu now has Undo/Redo enabled; Insert menu gets Image, Page from File; View menu gets Bookmarks-edit-mode toggle.
- New modals: Image Import modal (mode selector: New Page / Overlay), Bookmarks rename modal (or inline rename), Print Export Dialog.
- Text-edit overlay UX: how the user enters text-edit mode, how a span is selected, where the inline input renders, how the user commits or cancels.
- Bookmarks-authoring panel: tree structure, drag-to-reorder, indent/outdent, inline rename, context menu (Delete, Rename, New child).
- Shortcuts: Ctrl+Z / Ctrl+Y (enabled), Ctrl+B for bookmark, Ctrl+I for insert image, Ctrl+P for print.
- Failure-mode UI: text-replace clipping warning tooltip, missing-glyph indicator.

### 2.6 `docs/conventions.md` — Phase 2 additions (if needed)

Only edit if new patterns emerge. Likely additions:
- **§13 Main-process edit-ops pattern** (NEW section). When a feature touches both renderer (UI + state) and main (pdf-lib op application), the pattern is: (a) renderer dispatches the op via `applyEdit` funnel, (b) op accumulates in `dirtyOps`, (c) `fs:writePdf kind:'ops'` carries the op array to main, (d) main's `ReplayEngine.apply()` runs the op against the loaded bytes, (e) inverse computation lives in the renderer slice (`document-inverses.ts`) for undo, (f) tests live in both layers (renderer slice + main replay-engine test).
- Document the `Uint8Array` boundary loud and clear: bytes live in main; renderer never holds. Any thunk that needs bytes for any reason routes through an IPC channel.

## 3. NOT in your wave

Strict no-go list. If you draft any of these, Marcus will reject the Wave 6 close.

- **No source code under `src/`.** You spec; David / Ravi / Riley-self-in-Wave-7 implement.
- **No edits to ARCHITECTURE.md.** It is frozen. New content goes in `docs/architecture-phase-2.md`.
- **No retroactive edits to api-contracts.md §1-§11, data-models.md §1-§6, ui-spec.md §1-§10, conventions.md §1-§12.** Append-only.
- **No new locks added to `.learnings/locked-instructions.md`.** L-001 is the only lock; if you need a new one, return it to Marcus in your status row and Marcus adds it.
- **No briefs for Wave 7, 8, 9.** Marcus writes those after each wave closes.
- **No code-review or test authoring** — that's Julian / David / Riley-Wave-7 / Diego work.
- **No screenshots or operator-skill runs** — no UI exists for Phase-2 features yet.

## 4. Process

1. Read everything in §0 in order. Estimated 45-60 min.
2. Outline `docs/architecture-phase-2.md` headings + bullet points. Validate the structure against §2.1 here. Estimated 20 min.
3. Write `docs/edit-replay-engine.md` first (the design David needs most). Estimated 60-90 min.
4. Write `docs/architecture-phase-2.md`. Estimated 60-90 min.
5. Add the additions sections to api-contracts.md, data-models.md, ui-spec.md, conventions.md in that order. Estimated 30-60 min.
6. Self-improvement: read the last 50 lines of `~/.claude/learnings/global.jsonl` filtered for `front-end-architect`, then append your Wave 6 entry to `d:/Projects/PDF_Viewer_Editor/.learnings/learnings.jsonl`. Honest entry — note the non-obvious takeaway (likely something around "main-keeps-bytes is the right boundary because it preserves conventions §10 while solving H-3"). One JSONL line.
7. Return a status row to Marcus listing: each file written + size + the §7 open-question answers in one-line form.

## 5. Acceptance criteria

- [ ] `docs/architecture-phase-2.md` exists and addresses every sub-question in §2.1 above.
- [ ] `docs/edit-replay-engine.md` exists and covers every section in §2.2 above.
- [ ] `docs/api-contracts.md` has a `## 12.` Phase-2 additions section covering every new channel.
- [ ] `docs/data-models.md` has a `## 7.` Phase-2 additions section with EditOperation extensions + 0002 migration DDL.
- [ ] `docs/ui-spec.md` has a `## 11.` Phase-2 additions section.
- [ ] `docs/conventions.md` updated only if new patterns warrant it.
- [ ] Every phase-2-plan §7 open question has a written answer.
- [ ] All four locked decisions (P2-L-2 through P2-L-6) are reflected accurately in the architecture deltas.
- [ ] L-001 is not weakened anywhere.
- [ ] One JSONL learning entry appended to `.learnings/learnings.jsonl`.

## 6. Hard-Won Playbook callouts for your wave

From past learnings (`.learnings/learnings.jsonl` + global):

1. **"Convention docs that endorse a bug are more dangerous than the bug itself"** (Riley Wave 3.5 H-2 fix). Any new convention you write in §2.6 must be illustrated with a working pattern AND an explicit anti-pattern callout if the failure mode is plausible.
2. **"Reality-amendment > spec-retraction when the divergence is type-correct and renderer-tolerant"** (Marcus Wave 2 integration). If your Phase-2 design surfaces a Phase-1 doc inconsistency, append a Phase-2 amendment rather than retract Phase-1.
3. **"Override cascade audit — when one decision changes, audit every doc artifact"** (Riley Wave 1). The four P2-L decisions touch ALL four primary docs (architecture, api-contracts, data-models, ui-spec) plus conventions. Audit each.
4. **"Three impressions of honesty at point-of-action"** (Nathan Wave 4). Phase-2 closes H-3. Your architecture doc should already cue Nathan's Wave-9 doc updates by listing which user-facing doc lines must change. Don't make Nathan re-derive it.
5. **"Walking-skeleton fidelity boundary"** (Marcus Wave 3.5 verdict). Phase 2 has its OWN fidelity boundary — text-replace clipping, TIFF subset support, font subsetting edge cases. Document them loudly NOW so Phase-3 doesn't repeat the H-3 dance.

## 7. Open questions to surface in your status row (for Marcus / user)

If any of these surface during your design pass, flag them so Marcus can decide before Wave 7 dispatch:

1. Does pdf-lib's `import-and-modify` faithfully round-trip a representative set of test fixtures? (You can document the expected gaps; David's Wave-7 fidelity matrix confirms.)
2. Is `utif` (pure-JS MIT) sufficient for TIFF support, or do we need `sharp`? Phase-2 plan §4.3 prefers `utif`; verify before David adds a dep in Wave 7.
3. Is `pdf:identifyTextSpan` the right channel name, or should it be a sub-method of `pdf:replaceText`? (Naming consistency — your call as the contract designer.)
4. Should `export.deterministic` default to `false` (current proposal) or `true`? Reproducible-build users want `true`; mainstream users get fresh timestamps from `false`. Pick a default + document.
5. Are there Phase-2 ops the renderer needs to *preview* before sending (e.g. text-replace clipping detection)? If yes, that requires a renderer-side font-metrics shim — coordinate with David Wave 7 on whether that lives renderer-side or as a `pdf:previewTextReplace` channel.

These are non-blocking for Wave 6 close, but flag them in your final status row so Marcus has the context.
