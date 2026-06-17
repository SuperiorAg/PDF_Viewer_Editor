# Accessibility-Authoring Spec — C3 / C4 / C5 / C6 (Phase 7.5 Waves 5b–5d)

**Author:** Riley (VP of Product Design & Frontend Engineering)
**Date:** 2026-06-17 (Wave 1, Phase 7.5)
**Status:** Wave 1 design, locked at end-of-wave. Drives David's engine work in Waves 5b–5d, Riley's UI work in the same waves, and Julian's Wave 11 review of the rules-engine honesty claims (R13).
**Reads:** `docs/project-plan.md` §2 Wave 5b/5c/5d; `docs/architecture-phase-7.5.md` §4.8–§4.9; `docs/api-contracts.md` §19.7–§19.8; `docs/data-models.md` §13.7–§13.8; `docs/a11y-audit.md` (our own internal a11y audit, Phase 7).

> **Scope.** This spec covers the four accessibility-authoring features the Phase 7.5 "do all" ruling brings into scope: C3 Tag PDF (structure-tree authoring), C4 Reading Order, C5 Alt Text inspector, C6 Accessibility Checker. They share a single structure-tree model + a SQLite side-table for in-progress edits + an in-PDF `/StructTreeRoot` materializer at Save time.

---

## 0. Why these four ship together

PDF accessibility is a stack:

- **Structure tree** — the document's semantic skeleton (P, H1, H2, Figure, Table, List, etc.).
- **Reading order** — the order in which a screen reader traverses content.
- **Alt text** — the spoken description for non-text content.
- **Accessibility audit** — what rules the doc passes/fails (WCAG, PDF/UA).

C3 builds the skeleton. C4 orders it. C5 describes the figures. C6 checks the whole. None of these features makes sense without the others — shipping any one alone gives the user a partial workflow. The principal's "do all" ruling makes the dependency explicit.

Acrobat's right-rail tools surface these as four panels driven by one underlying structure-tree model. We mirror that architecture.

---

## 1. The structure-tree model

Every Acrobat-tagged PDF has a `/StructTreeRoot` dict in the catalog pointing at a tree of structure-element dicts. Each leaf references marked content on a page via `/MCID` (marked-content identifier).

The PDF-spec shape:

```
catalog (/Root)
  /StructTreeRoot → StructTreeRoot dict
    /K → [StructElem dict, StructElem dict, ...]
      /S → name (/Document, /Part, /Sect, /P, /H1..6, /Figure, /Table, /TR, /TD, /TH, /L, /LI, /Lbl, /LBody, /Caption, /Code, /Span, /Reference, /Annot, /Link, /...)
      /K → kids array (StructElem | int (mcid) | { /Type /MCR /Pg /MCID } | { /Type /OBJR /Pg /Obj })
      /P → parent dict (back-pointer)
      /Pg → page dict (which page this element's content lives on)
      /Alt → string (alt text)
      /ActualText → string (literal text equivalent)
      /Lang → string (BCP-47)
```

### 1.1 Our in-memory shape

```ts
export interface StructTreeNode {
  /** Stable client-side id (uuid v4). NOT the PDF object number — the renderer creates these on first load. */
  id: string;
  /** PDF-spec structure type (S entry). Open string; common values enumerated. */
  type:
    | 'Document'
    | 'Part'
    | 'Art'
    | 'Sect'
    | 'Div'
    | 'BlockQuote'
    | 'Caption'
    | 'TOC'
    | 'TOCI'
    | 'Index'
    | 'P'
    | 'H1'
    | 'H2'
    | 'H3'
    | 'H4'
    | 'H5'
    | 'H6'
    | 'L'
    | 'LI'
    | 'Lbl'
    | 'LBody'
    | 'Figure'
    | 'Formula'
    | 'Form'
    | 'Table'
    | 'TR'
    | 'TD'
    | 'TH'
    | 'THead'
    | 'TBody'
    | 'TFoot'
    | 'Link'
    | 'Annot'
    | 'Span'
    | 'Quote'
    | 'Note'
    | 'Reference'
    | 'BibEntry'
    | 'Code'
    | string; // open string for forward-compat with PDF-spec extensions
  altText?: string; // /Alt
  actualText?: string; // /ActualText
  language?: string; // /Lang (BCP-47)
  contentRefs: MarkedContentRef[]; // marked-content refs this element wraps
  children: StructTreeNode[];
  /** Source PDF object number, if known. -1 for newly-authored elements that haven't been written yet. */
  sourceObjectNumber?: number;
}

export type MarkedContentRef =
  | { kind: 'mcid'; pageIndex: number; mcid: number }
  | { kind: 'object'; pageIndex: number; sourceObjectNumber: number };
```

### 1.2 Materializer responsibilities (David)

The materializer (`src/main/pdf-ops/struct-tree-engine.ts`) does both directions:

**Read direction:** `pdf:getStructTree` walks the `/StructTreeRoot/K` array recursively, decoding each entry into a `StructTreeNode`, building parent back-pointers from the tree structure (NOT from `/P` — we ignore `/P` on read because some authors mis-write it; the tree structure is canonical).

**Write direction:** on Save, the materializer walks the rendered tree (after merging with the side-table — §3), allocates PDF objects for each element via `context.register(...)`, writes the `/StructTreeRoot/K` array, attaches `/Alt` / `/ActualText` / `/Lang` per node, and re-stamps the catalog. Existing `/MarkInfo` and `/StructTreeRoot` references in the catalog are replaced.

### 1.3 What happens to docs without an existing structure tree

`pdf:getStructTree` returns `root: null` and `hasExistingTags: false`. The renderer offers "Auto-tag from content (heuristic)" as the entry point. Subsequent edits create a new tree from scratch; materializer writes a fresh `/StructTreeRoot` + sets `/MarkInfo`'s `/Marked` to `true`.

### 1.4 What happens to docs WITH an existing structure tree (R12 mitigation)

`pdf:getStructTree` returns the existing tree and `hasExistingTags: true`. Per P7.5-L-5: the renderer treats subsequent edits as candidate-destructive. The Save dispatcher defaults to **Save-As-Copy**, with a checkbox "Overwrite original (loses existing tags)" off-by-default. The user must explicitly opt in to overwrite.

This protects against the worst case: a user opens a doc tagged in Adobe Acrobat, makes a small edit, and silently loses the original's tag structure.

---

## 2. The side-table — `accessibility_edit_session`

Per architecture §4.8 and data-models §13.8, in-progress edits accumulate in a SQLite side-table keyed by `doc_hash` so they survive app crashes.

### 2.1 Row shape (data-models §13.8 reaffirmed)

```
TABLE accessibility_edit_session
  id                      INTEGER PRIMARY KEY AUTOINCREMENT
  doc_hash                TEXT NOT NULL UNIQUE     -- one session per open doc
  struct_tree_json        TEXT NOT NULL            -- full tree
  reading_order_json      TEXT NOT NULL DEFAULT '[]'
  alt_text_overrides_json TEXT NOT NULL DEFAULT '{}'
  has_existing_tags       INTEGER NOT NULL         -- 0/1
  created_at              INTEGER NOT NULL
  updated_at              INTEGER NOT NULL
```

### 2.2 Lifecycle

```
[no row]
   ↓ first edit (pdf:setStructTree or pdf:setReadingOrder or pdf:setAltText)
[row created with current tree + flag has_existing_tags from initial getStructTree]
   ↓ subsequent edits
[row updated incrementally — updated_at bumped each write]
   ↓ Save (any kind: Save, Save As, Save As Copy)
[materializer reads merged tree → writes /StructTreeRoot → deletes row]
   ↓ OR Cancel / app crash
[row survives — startup GC resumes if updated_at within TTL]
```

### 2.3 Startup GC

On every `pdf:openPdf`, main checks: is there an `accessibility_edit_session` row for this `doc_hash`?

| Condition                     | Action                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `updated_at >= now - 14 days` | Offer to resume: "Resume in-progress accessibility edits for this document?" (modal). |
| `updated_at < now - 14 days`  | Silent delete + log line (no toast — too old to surface).                             |
| No row                        | No-op.                                                                                |

The 14-day TTL is configurable via `settings.accessibility.editSessionTtlDays` (data-models §13.9).

### 2.4 Merge logic — side-table + in-PDF tree

When `pdf:getStructTree({ mergeWithEditSession: true })` is called:

1. Read in-PDF `/StructTreeRoot` → `inPdfTree`.
2. Read side-table row → `sessionEdits` (or null if no row).
3. If `sessionEdits === null`: return `inPdfTree`.
4. Else: return `sessionEdits.structTree` (it already incorporates earlier-session merging — the side-table is the source of truth during an edit session).

Reading order and alt-text overrides similarly come from `sessionEdits.readingOrder` / `sessionEdits.altTextOverrides` when present, else from the in-PDF tree.

**Determinism (architecture AR-merge):** children arrays sort by `id` (stable uuid). This is so React's reconciliation does not thrash on every render.

### 2.5 Privacy bound (AR2 mitigation)

The side-table stores STRUCTURE only. It does NOT store page content bytes. A Wave 5b unit test asserts the row size is bounded:

```ts
test('side-table row size is bounded for typical docs', async () => {
  const handle = await openTestFixture('typical-tagged-doc.pdf');
  // perform 100 edits
  for (let i = 0; i < 100; i++) {
    await pdf.setStructTree({ handle, root: mutateTreeMinor(currentRoot) });
  }
  const row = await db.get(
    'SELECT struct_tree_json FROM accessibility_edit_session WHERE doc_hash = ?',
    docHash,
  );
  expect(row.struct_tree_json.length).toBeLessThan(2_000_000); // 2 MB cap on typical docs
});
```

If the cap fires in practice on real docs, the cap is the early-warning sign that the schema is leaking content (which would be a bug — fix by trimming the leak, not raising the cap).

---

## 3. C3 Tag PDF — structure-tree authoring (Wave 5b)

### 3.1 UI surface

`docs/ui-spec-phase-7.5.md` §24 specifies the tree-editor visual + interaction. Summary:

- Sidebar panel under a new "Accessibility" sidebar tab.
- Drag-and-drop reparenting.
- Add / rename / delete tags.
- "Auto-tag" button runs the heuristic on selected page range.
- Warning icons on figures without alt text + headings nested incorrectly (e.g., H3 directly under H1 with no H2).

### 3.2 Engine surface

| IPC                 | Engine module                            | Purpose                                     |
| ------------------- | ---------------------------------------- | ------------------------------------------- |
| `pdf:getStructTree` | `src/main/pdf-ops/struct-tree-engine.ts` | Read the tree (merged or raw)               |
| `pdf:setStructTree` | same                                     | Persist edits to the side-table             |
| `pdf:autoTagPages`  | `src/main/pdf-ops/auto-tag-heuristic.ts` | Generate a proposed tree from the heuristic |

### 3.3 Heuristic — `auto-tag-heuristic.ts` (David)

The Wave 5b heuristic uses **font-size cluster + position-on-page** to label each text run:

```
INPUT: pages[], extracted via pdf.js TextLayer.
STEP 1: Collect all font-size values across the requested pages → bucket into clusters (k-means k=4, or simple quantile bucketing at 25/50/75).
STEP 2: For each text run on each page:
  a. fontSize bucket determines candidate label:
     - largest bucket → H1
     - second-largest → H2
     - third-largest → H3
     - smallest (modal) → P
  b. position-on-page refinements:
     - top 15% of page + largest bucket → H1
     - bbox alignment with image → Figure caption (Caption)
     - inside a row-detected table → TD or TH (top row TH)
STEP 3: Image XObjects → Figure (no alt text yet — C5 inspector handles that).
STEP 4: Detect lists via leading-bullet/number on a sequence of runs → L > LI > LBody.
STEP 5: Build a tree: Document > [H1 sections] > [paragraphs / figures / tables].
OUTPUT: proposed StructTreeNode tree + warnings (e.g. "Page 14: single font size — no headings detected").
```

### 3.4 Auto-tag honesty (P7.5-L-10 obligation #3)

The Auto-tag button shows a confirm modal:

> **Auto-tagging is a HEURISTIC.** Every tag should be reviewed before saving. The heuristic uses font-size clustering and position-on-page — it produces a reasonable starting point for most documents but will be wrong on documents with unusual layouts (multi-column scientific papers, infographics, forms).
>
> [Cancel] [Run heuristic]

The proposed tree opens in the tree-editor with a yellow border indicating "unreviewed". Each node the user explicitly reviews (clicks, types, or moves) loses the yellow border.

### 3.5 Auto-tag accuracy expectations

Documented honestly in the user-guide (Wave 12 Nathan):

> Auto-tagging is most accurate on standard-layout documents (single-column body text, distinct heading sizes, clear figures). Expect ~80% correct tags on typical business documents; ~40% correct on multi-column or visually-rich documents. Always review.

---

## 4. C4 Reading Order overlay (Wave 5c)

### 4.1 UI surface

`docs/ui-spec-phase-7.5.md` §25 specifies. Summary: numbered badges over each content block; drag-to-reorder; "Auto-detect from layout" button.

### 4.2 Reading order data shape

```ts
interface ReadingOrderEntry {
  structNodeId: string; // FK into StructTreeNode.id
  pageIndex: number;
  order: number; // 0-based across the whole document
  bbox: [number, number, number, number];
}
```

### 4.3 Engine surface

| IPC                   | Purpose                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `pdf:getReadingOrder` | Derive current order from the side-table's struct tree (DFS pre-order traversal yields default order) |
| `pdf:setReadingOrder` | Persist a new order; updates the side-table                                                           |

### 4.4 How order materializes to the PDF

PDF reading order is the order of structure elements in the `/StructTreeRoot/K` array (and child `/K` arrays). When the user reorders entries, the materializer:

1. Computes the new linear order from `ReadingOrderEntry[]`.
2. Walks the structure tree; for each structure element, ensures its position in `/K` matches the new order.
3. Writes the modified tree back to `/StructTreeRoot`.

This is a STRUCTURAL change to the tree, not a separate "reading order" data structure in the PDF.

### 4.5 Auto-detect-from-layout

Sorts content blocks top-to-bottom, then left-to-right within bands (~5% of page height). Multi-column detection uses k-means on the X-coordinate of left edges; columns are read top-to-bottom within each column.

Same honesty caveat as auto-tag: "Auto-detect produces a reasonable starting point; complex layouts may need manual reordering."

---

## 5. C5 Alt Text inspector (Wave 5c)

### 5.1 UI surface

`docs/ui-spec-phase-7.5.md` §26 specifies. Summary: list of all `/Figure` nodes without `altText`; per-figure alt-text input; bulk-set for visually-similar figures (pHash match).

### 5.2 Engine surface

| IPC                             | Purpose                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `pdf:listFiguresWithoutAltText` | Walk the struct tree; return `/Figure` nodes whose `altText` is empty             |
| `pdf:setAltText`                | Set / clear `altText` and optionally `actualText` on a node; writes to side-table |

### 5.3 Bulk-set — pHash similarity detection

pHash (perceptual hash) computed from the rasterized image bytes (already rasterized by pdf.js TextLayer extraction — no extra rasterize cost). Two figures with Hamming distance ≤ 5 are considered "visually similar" (typical thresholds for pHash duplicate detection).

The bulk-set modal lists the matched group and lets the user set one alt text for all matched figures. User can deselect individual figures from the group before applying.

### 5.4 Edge case — decorative images

Per WCAG 2.1, decorative-only images should have **empty** alt text (`/Alt ()` empty string, NOT absent). The inspector has a "Mark as decorative" toggle that sets `altText: ''` (empty string) on a node. The materializer writes `(empty string)` to `/Alt` for these nodes, which is semantically different from "no `/Alt` entry" (no entry = author hasn't specified).

---

## 6. C6 Accessibility Checker — rules engine (Wave 5d)

### 6.1 UI surface

`docs/ui-spec-phase-7.5.md` §27 specifies. Summary: rule-by-rule pass/fail; per-issue navigation; quick-fix buttons that jump to C3/C4/C5; export report as HTML or JSON.

### 6.2 Engine surface

```
pdf:runAccessibilityCheck → PdfRunAccessibilityCheckValue {
  results: AccessibilityRuleResult[],
  ranAt: number,
  shippedRuleCount: number,
  docHash: string,
}
```

Each rule lives at `src/main/pdf-ops/accessibility-rules/<rule-id>.ts` and exports:

```ts
export interface AccessibilityRule {
  id: string;
  severity: 'error' | 'warning' | 'info';
  /** i18n key for the rule's user-facing label. */
  labelKey: string;
  /** Checks the doc; returns result. */
  check(ctx: AccessibilityCheckContext): AccessibilityRuleResult;
}
```

### 6.3 The shipped rule subset (honest disclosure — P7.5-L-10 obligation #2)

Phase 7.5 ships **12 rules** drawn from WCAG 2.1 AA + PDF/UA-1. This is a SUBSET — neither standard is fully covered. The subset is enumerated below; Nathan's user-guide (Wave 12) and the in-app panel header subtitle both surface the disclosure.

| Rule ID                            | Severity | Standard origin                                           | What it checks                                                                              | How it checks                                         |
| ---------------------------------- | -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `a11y.document.title-present`      | error    | PDF/UA-1 § 7.1; WCAG 2.4.2                                | `/Info`/`Title` is non-empty                                                                | pdf-lib `getTitle()`                                  |
| `a11y.document.language-set`       | error    | PDF/UA-1 § 7.2; WCAG 3.1.1                                | catalog has `/Lang` set                                                                     | low-level `/Lang` lookup                              |
| `a11y.structure-tree-present`      | error    | PDF/UA-1 § 7.1                                            | catalog has `/StructTreeRoot`                                                               | low-level lookup                                      |
| `a11y.figures.all-have-alt-text`   | error    | WCAG 1.1.1                                                | every `/Figure` structure element has `/Alt` (empty string OK for decorative)               | walk struct tree                                      |
| `a11y.figures.alt-not-placeholder` | warning  | WCAG 1.1.1 (quality)                                      | `/Alt` is not a generic placeholder ("image", "figure", "img1.jpg")                         | regex against alt text                                |
| `a11y.tables.headers-identified`   | error    | WCAG 1.3.1                                                | every `/Table` has at least one `/TH` or row-1 marked as header                             | walk struct tree                                      |
| `a11y.tables.scope-set`            | warning  | WCAG 1.3.1                                                | `/TH` elements have `/Scope` attribute set                                                  | walk struct tree                                      |
| `a11y.reading-order.defined`       | error    | WCAG 1.3.2; PDF/UA-1 § 7.5                                | `/StructTreeRoot/K` order matches a reading order (i.e. structure tree exists; non-trivial) | walk struct tree; check non-empty `/K`                |
| `a11y.content.non-text-tagged`     | warning  | WCAG 1.1.1                                                | no untagged image XObject on any page                                                       | pdf.js operator-stream scan + struct tree cross-check |
| `a11y.scanned-pages.searchable`    | warning  | WCAG (general)                                            | no page is image-only without an OCR text layer                                             | pdf.js text-layer extraction count vs page count      |
| `a11y.javascript.no-form-actions`  | error    | by-design (security policy §14.6)                         | no JavaScript actions in form fields                                                        | low-level `/AA` lookup                                |
| `a11y.color-contrast.spot-sample`  | info     | WCAG 1.4.3 (informational only — full check needs raster) | spot-samples 3 random page regions; reports contrast ratio                                  | rasterize sample + contrast math                      |

**Rules explicitly NOT shipped** (transparency for Nathan to mirror in user-guide):

- Heading-level skip detection (H1 → H3 without H2) — auto-tag heuristic warns about this in the UI but the checker does not enforce.
- Tab order matching reading order.
- Form field labels.
- Links have meaningful text.
- Color-only-conveys-information detection.
- Decorative-figure not in reading order.
- ...and many more WCAG criteria.

The `shippedRuleCount: number` in the response is the count of shipped rules (12 at v0.8.0 cut). Nathan documents that the field exists so user-guide claims match what the engine reports.

### 6.4 RuleResult shape

```ts
interface AccessibilityRuleResult {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  passed: boolean;
  /** i18n key — renderer resolves */
  message: string;
  /** Where the failure is — drives the panel's per-issue navigation */
  locations: { pageIndex: number; structNodeId?: string }[];
  /** Quick-fix routing — drives the panel's "Open X" buttons */
  quickFix?: {
    kind:
      | 'open-tag-editor'
      | 'open-reading-order'
      | 'open-alt-text-inspector'
      | 'open-document-properties';
    targetNodeId?: string;
  };
}
```

### 6.5 Honesty disclosure — UI + spec + guide + README (the P7.5 §8 ratchet)

- **Spec** — this section.
- **In-app panel header subtitle** (ui-spec §27.2) — "Subset of WCAG 2.1 + PDF/UA-1 — see Help for the shipped rule set."
- **User-guide (Wave 12)** — "What we check, what we don't" subsection enumerating the 12 shipped rules + the explicit list of common-but-not-shipped rules.
- **README** — feature list footnote.

Julian's Wave 11 review (project-plan.md Wave 11, "Accessibility-rules engine review") re-confirms that the rules engine's claims match the documented subset. Any rule whose `check()` implementation does less than the table above claims is a finding.

---

## 7. Save flow (the critical materialization moment)

This is the single moment that bridges side-table edits to the actual PDF bytes. The Wave 5b/5c/5d engines all converge here.

### 7.1 Trigger

User picks File → Save (Ctrl+S) or Save As (Ctrl+Shift+S).

### 7.2 Pre-save check

```
1. Renderer reads accessibility_edit_session for the current doc_hash.
2. If row exists:
   a. If hasExistingTags === true AND user has not explicitly confirmed Overwrite:
      → Trigger Save-As flow (NOT Save), with default destination = "<base>-tagged.pdf".
      → Show one-time toast: "Saving as a copy by default to protect the original's existing tags."
   b. Else: proceed to materialize.
3. If row does NOT exist: standard Save flow (no accessibility materialization needed).
```

### 7.3 Materialize

David's materializer (`struct-tree-engine.ts`) receives the merged tree + reading order + alt-text overrides and:

1. Loads source PDF with `PDFDocument.load(bytes, { updateMetadata: false })`.
2. Allocates new structure element objects via `context.register(...)`.
3. Writes `/Alt`, `/ActualText`, `/Lang` per node.
4. Writes the new `/StructTreeRoot` to catalog.
5. Sets `/MarkInfo/Marked = true` in catalog.
6. Belt-and-braces `stripDocLevelJavaScript(doc)` (per Julian's Wave 11 standing check).
7. Returns serialized bytes.

### 7.4 Post-save cleanup

After successful write to disk:

```sql
DELETE FROM accessibility_edit_session WHERE doc_hash = ?;
```

If the write fails, the row survives — the user does not lose their edits.

### 7.5 Resume-on-open

On next open of the same `doc_hash`, the startup GC (§2.3) finds the surviving row and offers resume.

---

## 8. Test plan (drives Wave 5b–5d test coverage)

### 8.1 Wave 5b — Tag PDF + struct-tree-engine

| Test                                                                | What it checks                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `getStructTree returns null root for untagged doc`                  | Untagged input ⇒ `root: null, hasExistingTags: false`                |
| `getStructTree round-trips a known-tagged doc`                      | Tagged fixture (authored in Acrobat) loads with all elements + types |
| `setStructTree persists to side-table`                              | After call, side-table row exists with correct JSON                  |
| `autoTagPages on font-cluster-friendly doc returns reasonable tree` | Heuristic produces P/H1/H2/Figure mix; no Document-only output       |
| `autoTagPages on single-font-size doc warns`                        | Warnings array includes "no headings detected"                       |
| `materializer writes /StructTreeRoot that re-reads correctly`       | Save → reopen → getStructTree returns the tree we wrote              |
| `materializer preserves /Lang and /Alt across round-trip`           | Round-trip preserves all metadata fields                             |
| `side-table row size bounded under 100 edits`                       | AR2 mitigation regression                                            |
| `save-as-copy default fires for hasExistingTags === true`           | Renderer state machine test                                          |
| `R12: round-trip known-tagged Acrobat PDF without data loss`        | The R12 regression test from project-plan.md                         |

### 8.2 Wave 5c — Reading Order + Alt Text

| Test                                                               | What it checks                                    |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| `getReadingOrder derives DFS pre-order from struct tree`           | Default ordering is the tree's natural traversal  |
| `setReadingOrder persists to side-table`                           | After call, side-table reading_order_json matches |
| `materializer reorders /StructTreeRoot/K array correctly`          | Reordered → save → reopen yields new order        |
| `listFiguresWithoutAltText finds all /Figure nodes lacking /Alt`   | Returns the right set on a fixture                |
| `setAltText writes to side-table and materializer applies on save` | Round-trip preserves alt text                     |
| `pHash matches visually-similar figures`                           | Bulk-set test on a doc with repeated logo         |
| `empty /Alt for decorative is preserved (not stripped)`            | Decorative case                                   |

### 8.3 Wave 5d — Accessibility Checker

| Test                                                                    | What it checks                                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Per-rule: `<rule-id>.test.ts`                                           | Each rule has a pass-case + fail-case fixture                                                           |
| `runAccessibilityCheck on fully-accessible fixture returns all-pass`    | Positive-case integration                                                                               |
| `runAccessibilityCheck on 1064-page test PDF returns expected failures` | Real-doc regression — expected fails on missing alt + missing lang per project-plan §Wave 5d acceptance |
| `shippedRuleCount === 12`                                               | Honest claim regression                                                                                 |
| `quickFix routes return correct kind for each rule that has one`        | Renderer integration check                                                                              |
| `runs in under 5 seconds on 1064-page doc`                              | Performance gate (no eager raster)                                                                      |

---

## 9. Out-of-scope items for Phase 7.5

Documented honestly so users + Nathan know:

- **Advanced structure types** (Form, Code, Quote, BibEntry) — supported in the schema but no special UI affordance. Users can rename a P to these via the tree editor type picker.
- **Custom role mapping** (`/RoleMap` for non-standard element names) — not exposed in v1.
- **Class maps** (`/ClassMap`) — not exposed.
- **Attribute objects** (`/A` arrays for table cell scope, etc.) — supported in materializer for `/TH/Scope` only (used by the rule `a11y.tables.scope-set`); broader attribute editing deferred.
- **Reading order across pages with article threads** (`/Threads`) — not supported; v1 reading order is doc-linear.
- **Full PDF/UA-1 compliance** — explicitly out of scope per P7.5-L-10. We ship a subset.
- **Full WCAG 2.1 AA validation** — explicitly out of scope per P7.5-L-10.

---

## 10. Risk register (accessibility-authoring specific)

| #    | Risk                                                                                                            | Mitigation                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| AAR1 | Materializer corrupts an existing-tagged doc on save                                                            | Save-as-copy by default (§1.4 + §7.2). R12 regression test.                                                          |
| AAR2 | Side-table grows unboundedly during a long edit session                                                         | 2 MB row cap regression test (§2.5).                                                                                 |
| AAR3 | Auto-tag heuristic produces wildly wrong tags                                                                   | Opt-in only (button click); always editable; honesty disclosure in modal + user-guide (§3.4).                        |
| AAR4 | Rules engine claims compliance with rules it doesn't check                                                      | Wave 11 Julian re-verifies each rule's check() vs the documented subset (§6.5).                                      |
| AAR5 | Reading order materializer breaks an existing /MarkedContent stream                                             | Round-trip test (§8.2). Materializer touches `/K` order only; never modifies content streams.                        |
| AAR6 | pHash false positives in bulk-set alt text                                                                      | Hamming distance ≤5 default; user reviews matched group; can deselect individual figures.                            |
| AAR7 | C6 rule `a11y.color-contrast.spot-sample` is misleading because it's only a spot sample                         | Severity = `info` (not error/warning); message text explicitly says "Spot sample — full check requires raster pass". |
| AAR8 | The Lang rule (`a11y.document.language-set`) flags docs whose content is multi-lingual without a doc-level Lang | Acceptable — PDF/UA-1 strict interpretation is correct here; per-page Lang detection out of scope for v1.            |

---

## 11. Open questions

These complement the architecture §9 open questions; this section is C-bucket specific.

1. **Heading-level skip rule.** Auto-tag warns about H1 → H3 (skipped H2). Should the rules engine ENFORCE this as a separate rule? **Default: no** — too noisy on real-world docs where Acrobat itself accepts skipped levels. Add as opt-in rule in a follow-up phase.
2. **Custom role maps.** Some authors use non-standard structure types (e.g., `/CustomSidebar`) with a `/RoleMap` to remap to standard types. Should we surface `/RoleMap` editing in the tree editor? **Default: no** — niche; user can edit raw PDF if needed.
3. **Bulk alt text for OCR'd scans.** If the user OCRs a scan, every page is a giant `/Figure`. Should the inspector offer "alt text = OCR result text" as a one-click? **Default: yes, but as an opt-in button** rather than auto-applied — the OCR text often is too long for good alt text. Spec defers the implementation to Wave 5c.
4. **Color contrast — should we ship a full raster pass as a v2 rule?** Acrobat's full check rasters every page. Adds ~1 minute on a 1064-page doc. **Default: no for Phase 7.5** — spot sample is honest about its scope.

End of accessibility-authoring spec.
