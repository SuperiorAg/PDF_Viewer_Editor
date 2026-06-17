# Conventions — PDF_Viewer_Editor

**Author:** Riley (front-end-architect)
**Date:** 2026-05-21
**Status:** Wave 1, locked. Applied by every agent (David, Ravi, Riley, Diego, Julian, Nathan).

This document is the **only** source of cross-cutting code conventions. Repo-level rules (commit message format, modularization rule) live in `CLAUDE.md` — this file LINKS rather than duplicates.

---

## 0. Inheritance

These conventions apply on top of:

- `d:\Projects\PDF_Viewer_Editor\CLAUDE.md` — project-level commit format, modularization rule, security floor, no-AGPL policy. **Read first.**
- `d:\Projects\CLAUDE.md` — swarm rules (file ownership, wave order).

In any conflict, this file is the resolver for **code style**; CLAUDE.md is the resolver for **policy** (e.g. license, scope).

---

## 1. TypeScript

### 1.1 Compiler options

`tsconfig.json` (root, Diego owns):

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true, // implies all the below
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUncheckedIndexedAccess": true, // mandatory; catches `array[i]` undefined bugs
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "jsx": "react-jsx",
    "useDefineForClassFields": true,
    "verbatimModuleSyntax": true,
    "paths": {
      "@main/*": ["src/main/*"],
      "@preload/*": ["src/preload/*"],
      "@client/*": ["src/client/*"],
      "@ipc/*": ["src/ipc/*"],
      "@db/*": ["src/db/*"],
    },
  },
}
```

`tsconfig.main.json` / `tsconfig.renderer.json` extend this with process-specific `lib` overrides and `outDir` (Diego defines).

### 1.2 `any` policy

**No `any` without a code comment justifying why.** Every `any`:

```ts
// any: pdf-lib's PDFDict.toJSON() returns an opaque cycle-bearing object;
// typing it precisely would require shipping our own subset of PDF spec.
const dump = (dict.toJSON() as any).Annots;
```

ESLint rule `@typescript-eslint/no-explicit-any: ["error"]` with the **inline comment** as the disabling mechanism (`// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason`). Julian audits in Wave 3.

### 1.3 `unknown` over `any` when accepting external data

IPC payloads, JSON.parse results, third-party callbacks: typed as `unknown`, narrowed with type guards or Zod.

### 1.4 No `as` casts without comment

Same rule as `any`. Acceptable casts: `as const` (no risk), `as Type` after a runtime check, `satisfies Type` (preferred over `as` where possible).

### 1.5 Exhaustive switches on discriminated unions

```ts
function applyOp(state: DocumentModel, op: EditOperation): DocumentModel {
  switch (op.kind) {
    case 'reorder':
      return applyReorder(state, op);
    case 'insert':
      return applyInsert(state, op);
    case 'delete':
      return applyDelete(state, op);
    case 'rotate':
      return applyRotate(state, op);
    case 'annot-add':
      return applyAnnotAdd(state, op);
    case 'annot-edit':
      return applyAnnotEdit(state, op);
    case 'annot-delete':
      return applyAnnotDelete(state, op);
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unhandled op: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
```

Compile-time check via the `never` assertion ensures new variants don't silently bypass branches.

---

## 2. ESLint + Prettier

### 2.1 ESLint config

```jsonc
// .eslintrc.cjs (Diego owns)
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module",
    "project": ["./tsconfig.main.json", "./tsconfig.renderer.json"],
    "ecmaFeatures": { "jsx": true },
  },
  "plugins": ["@typescript-eslint", "react", "react-hooks", "import"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended-type-checked",
    "plugin:@typescript-eslint/stylistic-type-checked",
    "plugin:react/recommended",
    "plugin:react/jsx-runtime",
    "plugin:react-hooks/recommended",
    "plugin:import/typescript",
    "prettier",
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/consistent-type-imports": ["error", { "fixStyle": "inline-type-imports" }],
    "@typescript-eslint/switch-exhaustiveness-check": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-restricted-imports": ["error", { "patterns": ["electron"] }], // renderer must NOT import electron directly
    "import/order": [
      "error",
      {
        "groups": [
          "builtin",
          "external",
          "internal",
          "parent",
          "sibling",
          "index",
          "object",
          "type",
        ],
        "newlines-between": "always",
        "alphabetize": { "order": "asc" },
      },
    ],
    "react/prop-types": "off",
    "react/react-in-jsx-scope": "off",
  },
  "overrides": [
    {
      "files": ["src/main/**", "src/preload/**", "src/db/**"],
      "rules": { "no-restricted-imports": "off" },
    },
  ],
}
```

`no-restricted-imports` for the `electron` package prevents the renderer from accidentally importing it (CSP and contextIsolation make it inert, but the type-check passing creates false confidence).

### 2.2 Prettier config

```jsonc
// .prettierrc (Diego owns)
{
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "bracketSpacing": true,
  "bracketSameLine": false,
  "arrowParens": "always",
  "endOfLine": "lf",
}
```

CI fails on `prettier --check`. Pre-commit hook auto-formats (Diego adds via `simple-git-hooks` or `husky` — preference is `simple-git-hooks` for lower footprint).

### 2.3 `.editorconfig`

```ini
root = true
[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
[*.md]
trim_trailing_whitespace = false
```

---

## 3. File naming and structure

### 3.1 File naming

- **Files:** `kebab-case.ts` (e.g. `path-sanitizer.ts`, `pdf-render.ts`, `document-slice.ts`)
- **React components:** the **file** is `kebab-case.tsx`; the **default export** is `PascalCase`. Example: `thumbnail-strip.tsx` exports `ThumbnailStrip`.
- **CSS Modules:** co-located, same kebab name plus `.module.css`. Example: `thumbnail-strip.module.css`.
- **Tests:** co-located, `<name>.test.ts` / `<name>.test.tsx`.
- **Redux slices:** `<name>-slice.ts`. Selectors next to slice: `<name>-selectors.ts`. Inverses (for undoable slices): `<name>-inverses.ts`.

### 3.2 Long, descriptive names beat short ambiguous ones

Per repo `CLAUDE.md`: "Use kebab-case naming with long descriptive names, it's fine if the file name is long because this ensures file names are self-documenting for LLM tools (Grep, Glob, Search)."

Good: `export-engine-selector.ts`, `annotation-coordinate-conversion.ts`
Bad: `selector.ts`, `coords.ts`

### 3.3 Directory layout

```
src/
  main/                    # David
    index.ts
    window-manager.ts
    dialogs.ts
    security/
      path-sanitizer.ts
    pdf-ops/
      file-hash.ts
      combine.ts
      replay.ts            # applies EditOperation list via pdf-lib (Phase 2)
      annotations.ts
    export/                # Phase 2
      engine-selector.ts
      pdf-lib-engine.ts
      chromium-engine.ts
  preload/                 # David
    index.ts
  ipc/                     # David
    contracts.ts           # shared types (Riley reads, never writes)
    handlers/
      dialogs.ts
      fs.ts
      recents.ts
      settings.ts
      bookmarks.ts
      pdf-ops.ts
      app.ts
  db/                      # Ravi
    connection.ts
    migrate.ts
    types.ts
    repositories/
      recent-files-repo.ts
      settings-repo.ts
      bookmarks-repo.ts
  client/                  # Riley
    main.tsx
    app.tsx
    index.html
    state/
      store.ts
      hooks.ts
      slices/
        document-slice.ts
        document-selectors.ts
        document-inverses.ts
        viewport-slice.ts
        viewport-selectors.ts
        annotations-slice.ts
        selection-slice.ts
        export-slice.ts
        ui-slice.ts
        recents-slice.ts
        bookmarks-slice.ts
        history-slice.ts      # skeleton Phase 1; activated Phase 2
      middleware/
        history-middleware.ts
    components/
      menu-bar/
      toolbar/
      sidebar/
      thumbnail-strip/
      bookmarks-panel/
      pdf-viewer/
      pdf-canvas/
      annotation-layer/
      selection-overlay/
      inspector/
      annotation-properties/
      page-metadata/
      status-bar/
      modals/
        combine-modal/
        settings-modal/
        confirm-close-unsaved-modal/
        export-engine-dialog/
      error-boundary/
      empty-state/
    services/
      api.ts                # typed window.pdfApi wrapper
      pdf-render.ts         # pdf.js
      pdf-edit.ts           # pdf-lib (renderer side; Phase 2 may move some to main)
      pdf-coords.ts         # coordinate conversion (single source)
    hooks/
      use-document.ts
      use-thumbnails.ts
      use-annotation-tool.ts
      use-keyboard-shortcut.ts
    shortcuts.ts            # Ctrl+O etc. table
    styles/
      global.css
      tokens.css            # CSS custom properties (colors, spacing, type scale)
  shared/                   # (rare) cross-process pure utilities; no Node, no DOM
    result.ts               # Result<T, E> helpers

migrations/                 # Ravi
  0001_init.sql

tests/
  unit/                     # Vitest
  e2e/                      # Playwright (Electron)
  fixtures/
    sample.pdf

scripts/                    # Diego
  generate-icon.mjs
  dev-launch.mjs

.github/
  workflows/
    ci.yml                  # Diego
```

### 3.4 200-line modularization rule

Per `CLAUDE.md`: "If a code file exceeds 200 lines of code, consider modularizing it."

Applied judgment:

- React component .tsx files: hard limit 200 lines (extract subcomponents or hooks)
- Slice files: soft limit 200 lines; if exceeded, split selectors / inverses into their dedicated files (done by default in 3.3)
- Service files (e.g. `pdf-render.ts`): soft limit 200; split by concern (worker setup vs page rendering vs viewport math) if exceeded

Julian audits in Wave 3 and flags overflows. Justifications must be a comment at the top of the file: `// >200 lines: rationale here.`

---

## 4. Imports

### 4.1 Order

ESLint `import/order` enforces:

1. Node built-ins (`node:fs`, `node:path`) — main only
2. External packages (`react`, `pdfjs-dist`, `@reduxjs/toolkit`)
3. Internal alias paths (`@ipc/contracts`, `@client/state/hooks`)
4. Parent imports (`../foo`)
5. Sibling imports (`./bar`)
6. Index imports (`./`)
7. Object imports
8. Type-only imports (auto-inlined via `import { type X } from 'y'`)

Newlines between groups. Alphabetical within group.

### 4.2 Type-only imports

`@typescript-eslint/consistent-type-imports` enforces `import { type X }` inline syntax. Helps the bundler tree-shake type-only modules.

### 4.3 No deep imports across process boundaries

- Renderer never imports from `@main/*` or `@db/*` — only from `@ipc/contracts` (read-only types). ESLint `no-restricted-imports` enforces.
- Main never imports from `@client/*`.
- Preload imports ONLY from `@ipc/contracts` (and the `electron` package).

---

## 5. Error handling

### 5.1 IPC layer: discriminated `Result`

```ts
// src/shared/result.ts
export type Result<T, E extends string> =
  | { ok: true; value: T }
  | { ok: false; error: E; message: string; details?: Record<string, unknown> };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const fail = <E extends string>(
  error: E,
  message: string,
  details?: Record<string, unknown>,
): Result<never, E> => ({ ok: false, error, message, details });
```

Every IPC handler returns a `Result`. Callers MUST check `ok` before accessing `value` — TS exhaustiveness enforces.

### 5.2 Async boundaries: catch and convert

```ts
async function readPdfHandler(req: FsReadPdfRequest): Promise<FsReadPdfResponse> {
  try {
    const sanitized = sanitizePath(req.droppedPath);
    if (!sanitized) return fail('path_rejected', 'Path failed sanitization');
    // ...
    return ok({ handle, displayName, fileHash, pageCount, pdflibLoadWarnings });
  } catch (e) {
    log.error('fs:readPdf failed', { name: (e as Error).name });
    return fail('fs_read_failed', (e as Error).message);
  }
}
```

Never let an exception escape an IPC handler. `@typescript-eslint/no-floating-promises` catches dangling promises.

### 5.3 React: ErrorBoundary

The renderer wraps `<App>` in a single ErrorBoundary that shows a recovery screen ("Something went wrong. Click here to retry, or reload the app.") and ships the error to the main-process log via a one-shot IPC call.

### 5.4 User-facing error surface

- Inline (within a modal or panel) for recoverable errors that block a specific flow
- Toast (lower-right, dismissible) for transient errors that don't block the document
- Modal (blocking) for unrecoverable errors that require user input

Every error message MUST be actionable. "An error occurred" is rejected at code review.

---

## 6. Redux Toolkit slice conventions (Decision 3)

### 6.1 One slice per concern

Slices listed in `ARCHITECTURE.md` §5.1 are the authoritative set. Adding a new slice requires a Marcus-approved amendment to ARCHITECTURE.md.

### 6.2 File pattern

```ts
// src/client/state/slices/document-slice.ts

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { PDFDocumentModel, EditOperation } from '@ipc/contracts';

interface DocumentState {
  current: PDFDocumentModel | null;
}

const initialState: DocumentState = { current: null };

export const documentSlice = createSlice({
  name: 'document',
  initialState,
  reducers: {
    setDocument: (state, action: PayloadAction<PDFDocumentModel>) => {
      state.current = action.payload;
    },
    applyEdit: {
      reducer: (state, action: PayloadAction<EditOperation>) => {
        if (!state.current) return;
        // mutate via Immer
        state.current.dirtyOps.push(action.payload);
        // ... apply to pages / annotations
      },
      prepare: (op: EditOperation) => ({
        payload: op,
        meta: { undoable: true as const, operationId: op.meta.operationId },
      }),
    },
    // ... more reducers
  },
});

export const { setDocument, applyEdit } = documentSlice.actions;
export default documentSlice.reducer;
```

### 6.3 Selectors

> **Amended 2026-05-21** (Riley, Wave 3.5 — H-2 remediation). The previous version
> of this section endorsed a factory-selector pattern that defeated memoization.
> See `docs/code-review.md` H-2 finding for the bug history; the rule below is
> the correct pattern. Code that still uses the old factory shape must be
> migrated.

In a sibling `<name>-selectors.ts`. Use `createSelector` from `@reduxjs/toolkit`
when the value is derived (filtering, mapping, joining slices). Plain projection
selectors (read one field, no compute) do not need memoization.

**Rule:** When a selector needs a runtime argument (page index, annotation id,
etc.), declare it as a **parameterized memoized selector** at module scope —
never as a factory that returns a fresh `createSelector` per call.

```ts
// src/client/state/slices/document-selectors.ts
import { createSelector } from '@reduxjs/toolkit';

import type { RootState } from '../store';

// 1. Plain projection — no memo needed
export const selectCurrentDocument = (s: RootState) => s.document.current;

// 2. Derived, stateless — memoize with createSelector
export const selectIsDirty = createSelector(
  selectCurrentDocument,
  (doc) => doc !== null && doc.dirtyOps.length > 0,
);

// 3. Derived, takes a runtime arg — parameterized memoized selector
const selectPages = createSelector(selectCurrentDocument, (doc) => doc?.pages ?? []);
const selectPageIndexArg = (_s: RootState, pageIndex: number): number => pageIndex;

export const selectPage = createSelector(
  [selectPages, selectPageIndexArg],
  (pages, pageIndex) => pages[pageIndex] ?? null,
);

// Consumer:
//   const page = useAppSelector((s) => selectPage(s, props.index));
```

**Why this matters.** Reselect 5 (shipped via `@reduxjs/toolkit@2.2`) memoizes
`createSelector` results using `weakMapMemoize` by default, keyed by _argument
identity_. The cache lives on the selector instance. As long as the selector is
declared once at module scope and called with `(state, ...args)`, every unique
arg pair gets its own cached output, and identical arg pairs return the same
reference — so `react-redux`'s `===` equality check stays stable and `useSelector`
does not schedule extra renders.

**Anti-pattern (do not use):**

```ts
// ❌ WRONG — factory-per-call selector
export const selectAnnotationsForPage = (pageIndex: number) =>
  createSelector(selectAnnotations, (anns) => anns.filter((a) => a.pageIndex === pageIndex));

// Consumer (inside render):
const annotations = useAppSelector(selectAnnotationsForPage(props.index));
```

Every render calls the factory, which returns a NEW `createSelector` instance
whose cache is cold. The filter runs from scratch, produces a fresh array
reference, `react-redux` schedules another render, and the cycle repeats.
For a multi-page viewer this is a measurable render storm; in the worst case
(stable inputs but unstable selector identity) it can dominate a frame.

**Right form for the same shape:**

```ts
// ✅ RIGHT — parameterized memoized selector declared once
const selectPageIndexArg = (_s: RootState, pageIndex: number): number => pageIndex;

export const selectAnnotationsForPage = createSelector(
  [selectAnnotations, selectPageIndexArg],
  (annotations, pageIndex) => annotations.filter((a) => a.pageIndex === pageIndex),
);

// Consumer (inside render):
const annotations = useAppSelector((s) => selectAnnotationsForPage(s, props.index));
```

**How to apply.** For Phase 1, all parameterized selectors use the plain
`createSelector` form above — Reselect 5's `weakMapMemoize` keeps one cached
result per `(input-array, arg)` pair without bound, which is correct for any
realistic page count. If profiling later reveals a hot path that benefits from
a bounded LRU (e.g. when input-array identity churns between calls), upgrade
that specific selector via `createSelectorCreator(lruMemoize, { maxSize: N })`;
do not bulk-swap the default.

**Test contract.** Every parameterized selector should have at least one Vitest
case asserting `selector(state, arg) === selector(state, arg)` (reference
equality). The test in `document-selectors.test.ts` for `selectAnnotationsForPage`
is the canonical example; copy it when adding a new parameterized selector.

Enforcement: code review until a custom ESLint rule lands (Phase-2 backlog).
The shape `useSelector(factory(arg))` / `useAppSelector(factory(arg))` is the
forbidden form a future rule will flag.

### 6.4 Async thunks

```ts
// src/client/state/slices/document-slice.ts (continued)
import { createAsyncThunk } from '@reduxjs/toolkit';
import { api } from '@client/services/api';

export const openDocumentThunk = createAsyncThunk(
  'document/open',
  async (_: void, { rejectWithValue }) => {
    const res = await api.dialog.openPdf();
    if (!res.ok) return rejectWithValue(res);
    return res.value;
  },
);
```

One IPC call per thunk; the thunk is the only place the IPC bridge is consumed inside the slice layer.

### 6.5 Undo metadata

Actions that should be undoable carry `meta.undoable: true`. The `historyMiddleware` (`src/client/state/middleware/history-middleware.ts`) intercepts:

```ts
import type { Middleware } from '@reduxjs/toolkit';

export const historyMiddleware: Middleware = (store) => (next) => (action) => {
  const isUndoable =
    typeof action === 'object' &&
    action !== null &&
    'meta' in action &&
    (action as { meta?: { undoable?: boolean } }).meta?.undoable === true;
  if (isUndoable) {
    // compute inverse from prevState before next(action)
    // push { fwd: action, inv } onto historySlice.past
  }
  return next(action);
};
```

Full activation in Phase 2; Phase 1 ships the middleware as a no-op shim so action shapes match what Phase 2 will need.

### 6.6 Typed hooks

```ts
// src/client/state/hooks.ts
import { useDispatch, useSelector } from 'react-redux';
import type { TypedUseSelectorHook } from 'react-redux';
import type { RootState, AppDispatch } from './store';

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
```

Components import these, never the raw `useDispatch` / `useSelector`. ESLint rule (custom in Wave 3) enforces.

---

## 7. Commit messages

Per repo `CLAUDE.md`: `feat(scope): description` / `fix(scope): description` / `refactor(scope): description` / `test(scope): description`.

Repo-specific note (claudekit-engineer CLAUDE.md): do not use `chore` or `docs` for changes inside `.claude/`. This is not a claudekit-engineer repo, so the rule above stands.

Scope examples: `main`, `preload`, `renderer`, `ipc`, `db`, `ui`, `build`, `ci`, `arch`, `docs`.

---

## 8. Testing conventions

- Tests live next to source (`.test.ts` / `.test.tsx`)
- Vitest is the default runner; Playwright drives the Electron smoke test
- One `describe` block per public function or component
- Test names start with "should…" (e.g. `it('should reject paths containing ..', ...)`)
- No mocking the system under test. Mock at process boundaries (IPC, FS) — not internal modules.
- Fixtures live in `tests/fixtures/`. Include at least `sample.pdf` (small, permissively-licensed).

---

## 9. Logging

- Main process: `electron-log` (MIT) — file + console
- Renderer: `console.*` only in dev; production renderer pipes warnings/errors to main via a `log:emit` channel (Phase 2)
- Levels: `error`, `warn`, `info`, `debug`. Default production threshold: `warn`.
- NEVER log payloads that may contain document content (annotation contents, page text, file paths from outside the open dialog flow)
- Log channel + duration + ok/error variant only

---

## 10. Performance discipline

- Renderer main thread must NOT block on pdf-lib for large documents → main-process pdf-ops for combine/export
- Thumbnail rendering throttled (max 4 concurrent renders); use `pdf.js`'s `RenderTask.cancel()` aggressively
- Redux store: do not put `Uint8Array` of PDF bytes in the store. The renderer holds a handle; main holds the bytes.
- `Immer` patches are not stored; on commit, just store the new state. Patches are an option to enable later if performance demands.

---

## 11. Internationalization

Out of scope for Phase 1. All strings hard-coded English. Phase 7 introduces an i18n framework (`react-i18next` or similar). Pattern: every user-visible string today lives in a `<component>.strings.ts` co-located file when convenient; Phase 7 adapter swaps these.

---

## 12. Open conventions questions

1. **CSS Modules vs Tailwind** — locked to CSS Modules in `docs/ui-spec.md` §14. Revisit only with strong Wave 2 evidence.
2. **Test file co-location vs `tests/` mirror** — locked to co-location. `tests/` holds e2e + fixtures only.
3. **Date formatting library** — none in Phase 1 (use `Intl.DateTimeFormat`). Add `date-fns` (MIT) only if Phase 2 needs more.

---

## 13. Main-process edit-ops pattern (Phase 2 addition, 2026-05-21, Riley)

> ### Phase 2 amendment (2026-05-21)
>
> §1-§12 above remain authoritative. This section codifies the cross-process pattern Phase 2 introduces for ANY feature that mutates the PDF (edit-replay engine, image embed, text replace, print, export). It applies to David's main-process work in Wave 7 and to Riley's renderer-side thunk patterns in Wave 7.

### 13.1 The funnel

Every Phase-2 PDF mutation flows through this exact pipeline:

```
1. Renderer UI action
     ↓
2. Renderer thunk fires IPC call (pdf:embedImage / pdf:replaceText / etc.)
     ↓
3. Main-process handler:
   3a. Validates payload (zod)
   3b. Reads original bytes from documentStore.getBytes(handle)
   3c. (For embedImage) hashes bytes for content dedup
   3d. Constructs an EditOperation and returns it WITHOUT mutating anything
     ↓
4. Renderer receives the EditOperation in the IPC response
     ↓
5. Renderer dispatches applyEdit(op) on documentSlice
   - documentSlice-apply.ts updates state (e.g. pushes op onto dirtyOps)
   - historyMiddleware computes the inverse, pushes onto historySlice.past
     ↓
6. Later, on Save (fs:writePdf kind:'ops'):
   6a. Renderer collects dirtyOps + annotations + handle
   6b. IPC call sends all three to main
   6c. Main calls replay({ originalBytes, ops, annotations, jobId })
   6d. Engine returns newBytes
   6e. Main writes newBytes via atomic temp+rename
   6f. Main calls documentStore.setBytes(handle, newBytes) (post-save refresh)
   6g. Returns Result with annotationRefAssignments
     ↓
7. Renderer on save success: clears dirtyOps, updates annotation pdfObjectNumbers
```

**Critical:** steps 3a-3d are PURE — main doesn't mutate the document on the embed/replaceText/identifyTextSpan handler. Mutation happens ONLY in step 6c (replay engine, called from Save / Export / Print).

### 13.2 Pure-function contract for engine ops

Every `applyOp` branch in `replay-engine.ts` is a **pure function over `(PDFDocument, ReplayContext, EditOperation) → void` (mutates the in-flight doc; returns nothing)**. The function:

- MUST NOT do filesystem I/O.
- MUST NOT do DB I/O.
- MUST NOT do network I/O.
- MUST NOT mutate global state (no module-level mutable vars).
- MUST NOT log payloads (per §9 — channel name + duration only).
- MAY mutate the in-flight `PDFDocument` (which is GC'd if the engine errors).
- MAY mutate the `ReplayContext` (image cache, live-overlays map, warnings array) — but that context is per-invocation.

This contract is what makes the engine testable with golden-bytes fixtures (`edit-replay-engine.md` §14) and what makes the partial-failure rollback work (`edit-replay-engine.md` §9).

#### Good pattern

```ts
// src/main/pdf-ops/text-replace.ts
import type { PDFDocument } from 'pdf-lib';
import type { ReplayContext } from './replay-engine';

export function applyTextReplace(doc: PDFDocument, ctx: ReplayContext, op: TextReplaceOp): void {
  const located = resolveObjectId(doc, op.objectId);
  if (!located) throw new ReplayError('text_span_not_found', { objectId: op.objectId });

  const { page, contentStreamIndex, run } = located;

  for (const cp of [...op.newText]) {
    if (!run.font.hasGlyph(cp)) {
      throw new ReplayError('missing_glyph', { codepoint: cp });
    }
  }

  const newWidth = run.font.widthOfTextAtSize(op.newText, run.fontSize);
  if (newWidth > run.boundingRect.width) {
    ctx.warnings.push(
      `Text replace at ${op.objectId} clips: ${newWidth - run.boundingRect.width}pt overflow`,
    );
  }

  mutateContentStream(page, contentStreamIndex, run, op.newText);
  // No FS, no DB, no logging beyond ctx.warnings push.
}
```

#### Anti-pattern (do NOT do this)

```ts
// ❌ WRONG — engine op handler that does FS I/O
export function applyImageInsert(doc: PDFDocument, ctx: ReplayContext, op: ImageInsertOp): void {
  const imageBytes = await fs.readFile(op.image.sourcePath); // ❌ FS read from inside engine
  const embedded = await doc.embedPng(imageBytes);
  // ...
}

// ❌ Reason: the engine is supposed to be a pure fold. FS reads belong upstream in the
// pdf:embedImage handler, which writes bytes into the EditOperation BEFORE the op is replayed.
// FS inside engine ops makes golden-bytes testing impossible (the test would have to mock fs).
```

### 13.3 Uint8Array boundary (renderer vs main)

`§10 Performance discipline` already locks: **renderer never holds `Uint8Array` of document bytes.** Phase 2 strengthens with two corollaries:

1. **Image bytes flow renderer → main, never main → renderer.** The renderer ingests an image file via drag-drop or file picker, immediately ships the bytes to main via `pdf:embedImage`, receives an EditOperation with `image.contentHash` (string) and `image.bytes` (Uint8Array). The EditOperation lives in `dirtyOps` (transient, cleared on save) but is COMPACTED before pushing onto history (the bytes field is zeroed; only contentHash is preserved — see `conventions.md` §13.4 / `data-models.md` §7.1.4).
2. **History entries never hold image bytes.** `historySlice.past` and `.future` entries store ops with `image.bytes = new Uint8Array(0)`. Main's content-hash cache holds the real bytes for the handle's lifetime; redo retrieves by hash.

```ts
// src/client/state/middleware/history-middleware.ts (Phase 2 activation)
import { compactImageOpForHistory } from '../slices/document-inverses';

export const historyMiddleware: Middleware = (store) => (next) => (action) => {
  const isUndoable = ...; // check meta.undoable
  if (isUndoable) {
    const inv = computeInverse(action, prevState);
    // ✅ compact before push
    store.dispatch(historyPush({
      fwd: compactImageOpForHistory(action.payload),
      inv: compactImageOpForHistory(inv),
    }));
  }
  return next(action);
};
```

Failure to compact = renderer memory blow-up after 50+ image ops. Convention-enforced; Julian audits.

### 13.4 Atomic save pattern (file owner pattern)

For any handler that writes a file based on engine output: **temp-in-same-directory + rename, no exceptions.**

```ts
// src/ipc/handlers/fs-write-pdf.ts
async function writeAtomic(
  destPath: string,
  bytes: Uint8Array,
): Promise<Result<void, 'fs_write_failed'>> {
  const dir = path.dirname(destPath);
  const name = path.basename(destPath);
  const tempPath = path.join(dir, `.${name}.tmp-${process.pid}-${Date.now()}`);

  try {
    await fs.writeFile(tempPath, bytes);
    await fs.rename(tempPath, destPath);
    return ok(undefined);
  } catch (e) {
    await fs.unlink(tempPath).catch(() => {}); // best-effort
    return fail('fs_write_failed', (e as Error).message, { tempPath });
  }
}
```

**Anti-pattern:** writing directly to `destPath` without the temp step.

```ts
// ❌ WRONG — direct write
await fs.writeFile(destPath, bytes); // If write fails midway, destination is corrupt.
```

The user-facing contract is "save either fully succeeds or the file is untouched." Direct write breaks that contract.

### 13.5 Document-store bytes lifecycle

`src/main/pdf-ops/document-store.ts` is the single source of truth for "what bytes do we have for this handle." Phase-2 ADDS the bytes-retention slot to OpenDocument; preserves the Phase-1 handle-lifecycle contract.

| Event         | Required action                                                  |
| ------------- | ---------------------------------------------------------------- |
| Open succeeds | `setBytes(handle, freshBytes)`                                   |
| Save succeeds | `setBytes(handle, newBytes)` — refresh source-of-truth           |
| Close         | `releaseHandle(handle)` — frees bytes + metadata                 |
| Export        | **NO bytes update** — exported file is separate from open handle |
| Print         | **NO bytes update** — print is a one-shot output, not a save     |

The lifecycle is enforced by code review; no runtime assertion in Phase 2 (single-document keeps it tractable). Phase 5 multi-document may add invariant checks.

### 13.6 Test convention for replay engine

Every PR that adds an EditOperation variant MUST include:

1. A golden-bytes round-trip test (no edits → byte-stable output across the new variant).
2. A single-op forward test (apply the new variant, parse output, assert the expected mutation).
3. A forward+inverse identity test (apply forward then inverse, assert state and bytes match initial).
4. At least one failure-mode test (force the error variant, assert the correct `ReplayError` code).
5. A fixture under `tests/fixtures/replay-engine/` (NEW pdfs ONLY — never edit existing fixtures; they're golden references for other tests).

CI (Diego Wave 8) runs `npm run test:replay-engine` as a separate matrix entry from the renderer tests, with a longer timeout (5 min) for the perf-regression case.

### 13.7 Convention §13 cross-reference checklist

- [x] Funnel diagram + step contract (§13.1)
- [x] Pure-function engine ops (§13.2) — good + anti-pattern
- [x] Uint8Array boundary corollaries (§13.3) — image bytes, history compaction
- [x] Atomic save pattern (§13.4)
- [x] Document-store lifecycle (§13.5)
- [x] Replay-engine test convention (§13.6)
- [x] L-001 untouched — this section does not weaken or reference `enableDragDropFiles`

---

## 14. Form-state vs document-state separation (Phase 3 addition, 2026-05-22, Riley)

Phase 3 introduces a third state-management pattern alongside the Phase 1 dirtyOps funnel (§13) and the Phase 2 bookmarks-as-SQLite separation (`edit-replay-engine.md §4.7`). The new pattern: **form-fill values are renderer-transient until a deliberate commit boundary; only the commit produces an EditOperation.**

### 14.1 The three patterns side-by-side

| Pattern                                                                     | Phase | Storage                                                                                | Saves through                  | Undo behavior                                                  |
| --------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| Document mutations (page reorder, annotations, text replace, image overlay) | 1 + 2 | `dirtyOps[]` (per-op accumulation)                                                     | `replay()` engine              | Per-op undo via inverse middleware                             |
| Bookmarks                                                                   | 1 + 2 | SQLite (`user_bookmarks` table)                                                        | Direct IPC; engine NOT invoked | Per-op undo via custom inverse on bookmarks slice              |
| Form-fill values                                                            | 3     | `formsSlice.values` (transient) → batched into ONE `form-commit` op at commit boundary | `replay()` engine (step 3.6)   | Whole-form undo via the inverse of the single `form-commit` op |
| Form-design ops (add/remove/edit field)                                     | 3     | `dirtyOps[]` (per-op) — same as Pattern 1                                              | `replay()` engine (step 3.6)   | Per-op undo                                                    |

The Phase 3 split — form-fill is Pattern 3 (commit-batched), form-design is Pattern 1 (per-op) — reflects the semantic difference: filling a form is one editorial act; authoring fields is many. `architecture-phase-3.md §5` documents the rationale in depth.

### 14.2 The commit boundary contract

The renderer's `commitFormThunk` enforces the boundary:

```ts
// src/client/state/thunks.ts (Phase 3 extension)
export const commitFormThunk = createAsyncThunk(
  'forms/commit',
  async (_, { dispatch, getState }) => {
    const state = getState() as RootState;
    const pendingValues = state.forms.values;
    const committedValues = state.forms.committedValues;

    // Compute diff
    const fieldValues: Record<string, FormFieldValue> = {};
    const previousValues: Record<string, FormFieldValue | undefined> = {};
    for (const [name, value] of Object.entries(pendingValues)) {
      if (!deepEqual(value, committedValues[name])) {
        fieldValues[name] = value;
        previousValues[name] = committedValues[name];
      }
    }

    if (Object.keys(fieldValues).length === 0) return;

    // Single EditOperation for the entire batch
    const op: EditOperation = {
      kind: 'form-commit',
      meta: { ts: Date.now(), undoable: true, operationId: crypto.randomUUID() },
      fieldValues,
      previousValues,
    };

    dispatch(applyEdit(op));
    dispatch(formsSlice.actions.markCommitted(fieldValues));
  },
);
```

**Trigger paths:**

1. **Auto on Save** — `saveDocumentThunk` calls `commitFormThunk` BEFORE firing `fs:writePdf`.
2. **Manual** — "Commit form values" button in the Forms sidebar (visible only when uncommitted differences exist).
3. **Auto on close** — `ConfirmCloseUnsavedModal` (ui-spec §9.3) treats uncommitted values as unsaved changes, prompting Save (which commits) or Discard.

**No auto-commit on field-blur.** Field-blur would defeat the batching by producing N tiny commit ops.

### 14.3 Why form-fill is NOT a per-op EditOperation

Considered + rejected for Phase 3. Reasons (see `architecture-phase-3.md §5.1` for full):

1. **History pollution.** Filling a 20-field form produces 20 history entries; Ctrl+Z unwinds field 20 of the form, which is a poor UX surprise.
2. **Mail-merge cost.** Mail-merge runs would push thousands of ops onto history (unworkable).
3. **Semantic mismatch.** "Filling the form" is one editorial act, not 20.

Phase 3 commits the hybrid model. Phase 3.1 may revisit if user testing reveals demand for per-field undo (unlikely — Word and Adobe Acrobat both treat form-fill as bulk).

### 14.4 Mail-merge bypass pattern

The mail-merge runner (`form-engine.md §6`) does NOT go through `applyEdit` or the replay engine's normal `dirtyOps` path. Instead, it calls `fillForm()` directly for each row. This bypass is part of the architecture (per `architecture-phase-3.md §6.2`):

- Per-row fill does not produce EditOperations
- Per-row save uses atomic temp+rename (the same pattern as Phase 2's atomic save, §13.4)
- The renderer dispatches a single thunk (`runMailMergeThunk`) that fires `forms:runMailMerge` and consumes progress events; no EditOperations enter the dirtyOps funnel during the run

This is acceptable because mail-merge is a **batch action** that produces independent output files, not modifications to the open document. The open document's state is unchanged by mail-merge.

**Anti-pattern:**

```ts
// ❌ WRONG — running mail-merge through dirtyOps
async function badMailMergeApproach(rows: Row[]) {
  for (const row of rows) {
    dispatch(applyEdit({ kind: 'form-commit', fieldValues: rowToValues(row), ... }));
    await dispatch(saveDocumentThunk());  // saves over and over to the same destination
    dispatch(undoThunk());                 // try to rollback for next row
  }
}
// Reason: history pollution, save-thrashing, and the saved document keeps the LAST row's values.
// Mail-merge produces N OUTPUT files, not N saves to the same input file.
```

```ts
// ✅ RIGHT — bypass via the runner
async function goodMailMergeApproach(job: MailMergeJob) {
  const result = await window.pdfApi.forms.runMailMerge({ job });
  // Runner produces N output files; open document state untouched.
}
```

### 14.5 Form-engine pure-function contract (extends §13.2)

Every function in `form-engine.ts` (`detectForms`, `fillForm`, `flattenForms`, `createField`, `removeField`, `editField`) follows the SAME pure-function contract as the replay engine's `applyOp` (§13.2):

- MUST NOT do filesystem I/O
- MUST NOT do DB I/O
- MUST NOT mutate `input.bytes`
- MAY mutate the in-flight `PDFDocument` / `PDFForm` (GC'd if the function errors)

The internal helpers (`applyFormCommit`, `applyFormDesignAdd`, etc. — `form-engine.md §2.3`) take a live `PDFForm` instead of bytes and mutate it. The replay engine's step 3.6 calls these helpers within the engine's single load+save shell.

Test convention §13.6 extends: every PR that adds a new `FormFieldType` MUST include:

1. A detection test asserting `extractFieldDefinition` produces the right `FormFieldDefinition` shape
2. A fill test for the new type
3. A create test asserting the resulting PDF can be re-opened and the field is preserved
4. A round-trip identity test (create + fill + flatten → text-extract → expected content)
5. A failure-mode test (e.g. invalid value type → `field_type_mismatch`)

### 14.6 No JavaScript form actions (P3-L-2 enforcement)

Phase 3 STRIPS JavaScript form actions from saved documents. This is a locked decision (P3-L-2 from `wave-11-brief.md`) for security + scope reasons.

**Enforcement in the engine:**

```ts
// src/main/pdf-ops/form-engine.ts
function emitField(form: PDFForm, fd: FormFieldDefinition): void {
  // ...create field...
  // Strip any /AA (additional actions) dict that may have been preserved from load
  const fieldDict = pdfField.acroField.getDict();
  if (fieldDict.has(PDFName.of('AA'))) {
    fieldDict.delete(PDFName.of('AA'));
  }
}

// Also at document level — strip /Names → /JavaScript
function stripDocLevelJavaScript(doc: PDFDocument): { warned: boolean } {
  const namesDict = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (namesDict?.has(PDFName.of('JavaScript'))) {
    namesDict.delete(PDFName.of('JavaScript'));
    return { warned: true };
  }
  return { warned: false };
}
```

When `stripDocLevelJavaScript` returns `warned: true`, the engine appends a warning to `ctx.warnings`: `'JavaScript actions stripped from document (Phase 3 limitation; Phase 3.1 may preserve read-only)'`. The renderer surfaces this in a toast on save.

### 14.7 Convention §14 cross-reference checklist

- [x] Form-state vs document-state pattern table (§14.1)
- [x] Commit boundary contract + thunk (§14.2)
- [x] Why form-fill is not per-op (§14.3)
- [x] Mail-merge bypass pattern + anti-pattern (§14.4)
- [x] Form-engine pure-function contract extending §13.2 (§14.5)
- [x] No JavaScript form actions enforcement (§14.6)
- [x] L-001 untouched — this section does not weaken or reference `enableDragDropFiles`

---

## 15. Cert + password discipline (Phase 4 addition, 2026-05-26, Riley)

> ### Phase 4 amendment (2026-05-26)
>
> §1-§14 above remain authoritative. This section codifies the cross-process discipline Phase 4 requires for ANY handler / module that touches a PFX/P12 cert, its password, or any other secret that must NEVER touch disk and must NEVER survive its single intended use. It applies to David's main-process work in Wave 16 and to Riley's renderer-side modal patterns in Wave 16. Wave 17 Julian audits this section in detail; it is the SINGLE highest-risk discipline in the project.

### 15.1 The non-negotiables

**Five rules, in priority order. NO exceptions without a Marcus-approved locked-instruction.**

1. **No persist.** Cert bytes (PFX/P12), passwords, or parsed private keys MUST NOT touch disk. No log file. No `.env`. No Electron-Store. No SQLite. No swap file we trigger. No temp file. No crash dump we generate.

2. **Renderer-side hygiene.** When a renderer holds a cert password in React state, the state MUST be set to `''` (empty string) BEFORE awaiting the IPC promise that ships the password. The renderer MUST NOT re-read the password from state after dispatch.

3. **Buffer-wrap at the EARLIEST synchronous point.** When a main-process handler receives a password as a JS string from IPC, the handler MUST wrap it in `Buffer.from(password, 'utf-8')` within ≤5 lines of synchronous code from the validated-payload destructuring. The original JS string variable MUST be set to `''` and the parsed-payload field MUST be overwritten. See §15.2.

4. **`Buffer.fill(0)` in a `finally` block.** Any Buffer wrapping a password OR a PFX byte payload MUST be zeroed via `.fill(0)` in a `finally` block of the function that consumes it. Even on failure paths.

5. **Try/finally release on EVERY exit path.** Any function or handler that loads a cert handle MUST guarantee `cert-store.releaseHandle(handle)` fires before the function returns, either explicitly via `try/finally` OR via the `autoRelease: true` contract on `signatures:applyPades`. Modal `useEffect` cleanups in the renderer MUST fire `releaseCertThunk` on every dismiss path (X, Esc, route change, app quit).

### 15.2 The shape of a correct cert-load handler

This is the canonical pattern. Every Wave 16 main-process handler that accepts a password follows this exact shape.

```ts
// src/ipc/handlers/signatures-cert-load.ts (David Wave 16)
import { z } from 'zod';

import { loadCert } from '@main/pdf-ops/cert-store';

const requestSchema = z.object({
  pfxBytes: z.instanceof(Uint8Array),
  password: z.string().min(1).max(256),
});

export async function handleCertLoad(req: unknown): Promise<SignaturesCertLoadResponse> {
  // (1) validate payload
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) return fail('invalid_payload', parsed.error.message);

  // (2) Buffer-wrap at the EARLIEST synchronous point.
  const pfxBuf = Buffer.from(parsed.data.pfxBytes); // copy bytes into mutable Buffer
  const passwordBuf = Buffer.from(parsed.data.password, 'utf-8'); // copy password into mutable Buffer

  // (3) Overwrite renderer-side and parsed-side references.
  //     The JS string was created when zod parsed the IPC payload;
  //     setting it to '' drops the reference. V8 may retain the
  //     interned string in its heap for up to one GC cycle; we
  //     accept this as the security floor (R-W15-A in
  //     architecture-phase-4.md §8.1).
  (parsed.data as { password: string }).password = '';

  // (4) Delegate to cert-store, which consumes both Buffers and
  //     fills(0) them in its own try/finally.
  try {
    return loadCert(pfxBuf, passwordBuf);
  } catch (e) {
    // cert-store handles its own try/finally; this catch is defensive.
    return fail('pfx_decode_failed', (e as Error).message);
  }
}
```

The corresponding `cert-store.loadCert` (the consumer):

```ts
// src/main/pdf-ops/cert-store.ts (David Wave 16) — abridged; full version in signature-engine.md §4
export function loadCert(
  pfxBytes: Buffer,                       // CONSUMED — zeroed before return
  passwordBuffer: Buffer,                 // CONSUMED — zeroed before return
): Result<CertLoadOk, CertLoadError> {
  try {
    // Use the buffers to parse the PFX...
    const p12Asn1 = forge.asn1.fromDer(pfxBytes.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passwordBuffer.toString('utf-8'));
    // ...extract cert + private key, store under fresh handle, return handle.
    return ok({ ... });
  } finally {
    // ALWAYS zero the inputs, even on failure.
    pfxBytes.fill(0);
    passwordBuffer.fill(0);
  }
}
```

### 15.3 Anti-patterns (do NOT do this)

#### ❌ Logging the password

```ts
// ❌ WRONG — any of these log a password
log.info('certLoad', { password: parsed.data.password }); // explicit
log.debug('certLoad', { req }); // includes password
console.log(parsed.data); // includes password
log.error('certLoad failed', { req: parsed.data, error: e.message }); // includes password
log.info(`certLoad with password length ${parsed.data.password.length}`); // length is a side-channel
```

**Right form:** log channel + duration + ok/error variant ONLY (per conventions §9). No payload reflection. The handler may log `{ pfxLength: pfxBytes.length }` as a non-secret metric.

#### ❌ Awaiting before Buffer-wrap

```ts
// ❌ WRONG — the password lives as a JS string across the await,
// during which other handlers can run and process events can swap the page
export async function handleCertLoad(req: unknown): Promise<...> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) return fail('invalid_payload', ...);

  // ❌ Awaiting BEFORE the Buffer-wrap; password sits in V8 heap during await
  const docMeta = await documentStore.getMeta(parsed.data.handle);

  // ...by here the password may have been swapped out / GC'd / observable to debuggers
  const passwordBuf = Buffer.from(parsed.data.password, 'utf-8');
  // ...
}
```

**Right form:** Buffer-wrap is the SECOND statement after schema validation. Any await that consumes other resources happens AFTER the wrap. If the handler MUST await before signing, the cert handle path (separate `certLoad` then `applyPades`) means the await window is inside `applyPades` where the cert is already in the safer Map-keyed-by-handle form.

#### ❌ Writing the PFX to a temp file

```ts
// ❌ WRONG — even temporarily writing the PFX to disk creates an artifact
// the OS may preserve in journaling / page cache / swap
import { writeFile, unlink } from 'node:fs/promises';

const tempPath = path.join(os.tmpdir(), `cert-${randomUUID()}.pfx`);
await writeFile(tempPath, pfxBytes);
try {
  const parsed = forge.pkcs12.parse(tempPath, passwordString); // hypothetical
} finally {
  await unlink(tempPath); // unlink doesn't zero the underlying disk blocks
}
```

**Right form:** keep PFX bytes in memory only. `forge.pkcs12.pkcs12FromAsn1` accepts bytes; no disk needed. If a future library REQUIRES a file path, that's a Marcus-approved exception.

#### ❌ Stuffing the cert into Electron-Store / SQLite / settings

```ts
// ❌ WRONG — any of these persist the cert across app restart
electronStore.set('cert.lastUsed', pfxBytes);
electronStore.set('cert.password', password);
db.prepare('INSERT INTO certs (bytes, pwd) VALUES (?, ?)').run(pfxBytes, password);
settings.set('lastCertPath', '/path/to/cert.pfx'); // even path leaks where the cert lives
```

**Right form:** the audit log (`signature_audit_log`) records the FINGERPRINT (a hash) only; never the cert bytes, never the password, never the private key. Path is intentionally not recorded.

#### ❌ Echoing the password (or PFX bytes) over IPC

```ts
// ❌ WRONG — sending the password back to the renderer
return ok({
  handle: certHandle,
  // ...
  password: parsed.data.password, // ❌ for any debugging reason
});

// ❌ ALSO WRONG — sending the PFX bytes back
return ok({
  handle: certHandle,
  pfxBytes, // ❌ "so the renderer can show a download link"
});
```

**Right form:** IPC responses include the `CertHandle` (opaque UUID), the cert metadata (subject CN, issuer CN, fingerprint, validity), and nothing else. The renderer NEVER sees raw cert bytes or the password after the initial certLoad dispatch.

#### ❌ Permissive cert-store stubs in tests (Wave 13.5 lesson)

```ts
// ❌ WRONG — same anti-pattern as Wave 13.5 B-3.1
test('PAdES sign happy path', () => {
  const result = applyPades({
    bytes,
    certEntry: {
      /* fake cert object */
    }, // ❌ does not exercise loadCert
    placement,
    tsaUrl: null,
    // ...
  });
  expect(result.ok).toBe(true);
});
```

**Right form:** tests load the real test fixture PFX via `loadCert(realPfxBytes, realPasswordBuf)`. The fixture PFX is checked in (signed with a fixture password documented in the fixtures README). Tests for FAILURE paths (wrong password, expired, corrupted) use OTHER fixtures specifically authored for those failure modes. NO permissive stubs of `loadCert`, `applyPades`, or any cert-store function.

### 15.4 Test discipline (extends §13.6)

Every PR that touches the signature engine MUST include:

1. **Real-fixture cert tests.** No stubbed cert objects. Use `tests/fixtures/signature-engine/test-cert.pfx` with the documented password.
2. **Buffer-zeroing assertion.** After every call to `loadCert(pfxBuf, passwordBuf)`, the test asserts both buffers are entirely zero via `expect(pfxBuf.every(b => b === 0)).toBe(true)` and same for password.
3. **No-log assertion.** A spy on `log.info` / `log.debug` / `log.warn` / `log.error` captures all log calls; the test asserts NO call contains the password substring, the PFX bytes, or any `privateKey*` substring. The test runs against a fixture password that is a unique, easily-detected sentinel like `'TEST-PWD-DO-NOT-LOG-2026'` so the assertion is sensitive.
4. **Crash-path cleanup test.** A test forces an error inside `loadCert` (e.g. corrupted PFX) and asserts the buffers are STILL zeroed via the finally block.
5. **Modal cleanup test.** The PadesSignModal's `useEffect` cleanup is exercised — dismiss the modal mid-load, assert `releaseCertThunk` was dispatched with the held handle.

### 15.5 Wave 17 Julian audit checklist (mechanical greps)

```bash
# (1) Every password mention is ≤5 lines from input to Buffer wrap
rg -n "password" src/main/pdf-ops/cert-store.ts src/ipc/handlers/signatures-cert-*.ts

# (2) No log statement contains password / pfx / cert / privateKey substrings
rg -n "log\.(info|debug|warn|error)" src/main/pdf-ops/cert-store.ts src/ipc/handlers/signatures-*.ts | rg -i "password|pfx|privateKey|privateKeyPem"
# Should produce ZERO matches.

# (3) Every Buffer.from(password) is followed by a fill(0) in finally
rg -n -B 2 -A 30 "passwordBuf" src/main/pdf-ops/cert-store.ts | rg "fill\(0\)"

# (4) No PFX or PEM written to disk
rg -n "writeFile|writeFileSync|createWriteStream" src/main/pdf-ops/cert-store.ts src/main/pdf-ops/pades-*.ts src/ipc/handlers/signatures-*.ts
# Should produce ZERO matches.

# (5) app.before-quit releases all certs
rg -n "app\.on\(['\"]before-quit" src/main/
# Should find a match that calls cert-store.releaseAll()

# (6) Tests use REAL passwords + assert REAL zeroing
rg -n "cert-store" src/main/pdf-ops/*.test.ts src/ipc/handlers/signatures-*.test.ts
# Tests should call real loadCert with real PFX bytes + assert buffers are zeroed.

# (7) No Electron-Store / settings persist of cert data
rg -n "settings\.|electronStore\." src/main/pdf-ops/cert-store.ts src/ipc/handlers/signatures-*.ts
# Should produce ZERO matches.

# (8) IPC response for certLoad does NOT include password or pfxBytes
rg -n "return ok" src/ipc/handlers/signatures-cert-*.ts | rg "password|pfxBytes"
# Should produce ZERO matches.
```

### 15.6 What we explicitly do NOT promise

For honesty with downstream users (documented in user-guide §Signing → "About security"):

- We do NOT defend against an attacker with a debugger attached to the running process.
- We do NOT defend against a kernel-level memory dump captured during the modal flow.
- We do NOT defend against the OS swap-pager moving the cert page to disk (we don't call `mlock`).
- We do NOT defend against a malicious extension running in the renderer (contextIsolation prevents most paths but not all).
- We do NOT defend against an interned JS string lingering in V8's heap until the next GC cycle (R-W15-A; ~1-2 second residual window).
- We do NOT manage a trust list of CAs; we trust the OS trust store for TSA verification.

What we DO promise:

- No password / PFX written to any disk file we control.
- No password / PFX echoed over IPC or logged.
- Buffer-wrap discipline within ≤5 lines of input.
- `Buffer.fill(0)` in finally blocks.
- Try/finally cleanup on every code path.
- Cert release on every modal-close path.
- `app.before-quit` releases all cert handles.

### 15.7 TSA URL trust model — see signature-engine.md §6.4

The TSA URL is collected via Settings, validated by attempt (Test connection button), and used at sign time. The model in detail:

- Default state: empty URL + `tsaEnabled = false`.
- User responsibility: pick a TSA URL they trust (RFC 3161 compliant, HTTPS only).
- Validation: zod URL shape + runtime allowlist (no userinfo, no fragment, query allowlist).
- Trust: TSA cert chain validated against system trust store at HTTPS handshake.
- Failure: fail-loud. No silent degradation.

No default TSA URL is shipped — see `architecture-phase-4.md §4.5` for the rationale.

### 15.8 Convention §15 cross-reference checklist

- [x] Five non-negotiable rules (§15.1)
- [x] Canonical correct cert-load handler pattern (§15.2)
- [x] Anti-patterns enumerated (§15.3)
- [x] Test discipline (§15.4)
- [x] Wave 17 Julian audit mechanical greps (§15.5)
- [x] Honest "what we don't promise" disclosure (§15.6)
- [x] TSA URL trust model cross-reference (§15.7)
- [x] L-001 untouched — this section does not weaken or reference `enableDragDropFiles`

End of Phase-4 conventions amendment.

---

## 16. OCR engine discipline (Phase 5 addition, 2026-05-27, Riley)

> ### Phase 5 amendment (2026-05-27)
>
> §1-§15 above remain authoritative. This section codifies the discipline Phase 5 requires for ANY handler / module that touches Tesseract.js workers, language packs, OCR results, or the text-behind-image authoring pipeline. It applies to David's main-process work in Wave 20, Ravi's schema work in Wave 20, and Riley's renderer-side modal patterns in Wave 20. Wave 21 Julian audits this section.

Unlike Phase 4's cert discipline (§15), Phase 5 has **no secret material** — there is no password, no PFX, no private key. The discipline below is about:

1. **Worker lifecycle hygiene** (no orphan worker processes, no spawn-per-page churn).
2. **Bytes-stay-in-main** (raster bytes, language pack paths never echo to renderer).
3. **Anti-stub-shipped-with-TODO** (required-on-interface dependencies; no optional fallbacks with sentinel returns).
4. **Trust-floor confidence threshold convention** (`<60` = "low" by Tesseract convention; surface at three locations).
5. **OCR-on-signed-PDF policy** (non-skippable confirm; audit-log update).

### 16.1 Worker lifecycle non-negotiables

**Five rules, in priority order. NO exceptions without a Marcus-approved locked-instruction.**

1. **One worker per active language, persisted for the app lifetime.** No spawn-per-page churn. Workers are heavy (2-5s init); reusing them across pages is the load-bearing perf optimization. See `ocr-engine.md §3.4`.

2. **`releaseAll()` on `app.before-quit` AND `process.exit`.** Every worker the pool created MUST be terminated before the process exits. Orphan Worker threads are a real defect class — they survive the parent's `quit()` event in some Electron versions and leak until the OS reaps them.

3. **No `createWorker` outside `ocr-worker-pool.ts`.** ESLint `no-restricted-imports` keeps `tesseract.js`'s `createWorker` reachable from one module only. The pool is the single funnel. See `ocr-engine.md §3.1`.

4. **Watchdog per page.** Per-page recognition runs under a `setTimeout(workerWatchdogSec, terminate)` timer. If a page recognition hangs (rare — Tesseract has occasional pathological inputs), the watchdog terminates the worker and the pool re-creates on next acquire. See `ocr-engine.md §3.6`.

5. **LRU eviction at the worker pool cap.** If the user runs OCR in 5+ different languages in a session and `ocr.maxConcurrentLanguages = 4`, the LRU worker is terminated before the 5th is acquired. Prevents unbounded RAM growth.

### 16.2 Bytes-stay-in-main non-negotiables

Phase 5 extends the conventions §10 bytes-discipline (renderer never holds doc bytes) with TWO new corollaries:

1. **Raster bytes (rasterized page images) stay in main.** The renderer NEVER receives a `Uint8Array` of raster bytes from any OCR-related IPC. If the renderer needs to display the page, it goes through the existing pdf.js path (renderer-side rendering). The OCR engine's internal raster is a main-only intermediate.

2. **`LanguagePack.filePath` is stripped at the IPC bridge.** The renderer-facing `LanguagePackDto` has NO `filePath` field. Main holds the resolved path; renderer pattern-matches on `lang` and `source` only. See data-models.md §10.8.

#### The shape of a correct OCR IPC handler

```ts
// src/ipc/handlers/ocr-run-on-document.ts (David Wave 20)
import { z } from 'zod';

const requestSchema = z.object({
  handle: z.number().int().positive(),
  pageRange: z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  }),
  langs: z.array(z.string().regex(/^[a-z]{3}(_[a-z]+)?$/i)).min(1),
  preprocess: z.object({
    deskew: z.boolean(),
    denoise: z.boolean(),
    contrastBoost: z.boolean(),
  }),
  invalidatesSignaturesConfirmed: z.boolean().optional(),
});

export async function handleOcrRunOnDocument(req: unknown): Promise<OcrRunOnDocumentResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) return fail('invalid_payload', parsed.error.message);

  // Look up doc bytes via the trusted handle (NOT path)
  const doc = await documentStore.get(parsed.data.handle);
  if (!doc) return fail('handle_not_found');

  // Range check against the canonical pageCount from main's metadata loader
  if (parsed.data.pageRange.end >= doc.meta.pageCount) {
    return fail('page_range_out_of_range');
  }

  // PAdES pre-flight (§16.5)
  const signedFields = detectPriorPadesSignatures(doc.pdfLibDoc);
  if (signedFields.length > 0 && !parsed.data.invalidatesSignaturesConfirmed) {
    return fail('signed_pdf_requires_confirm');
  }

  // Insert the ocr_jobs row, run the engine, return the result.
  // Engine ALL stays in main. Renderer gets back the Op + summary; no raster bytes.
  return runOcrEngine(parsed.data, doc, signedFields);
}
```

### 16.3 Anti-stub-shipped-with-TODO discipline (encoded structurally)

Per the 2026-05-27 global JSONL lesson (Nathan Wave 18) + the third-strike of the same defect class in PDF_Viewer_Editor (defaultPdfMetadata + pdf-render.ts + PageModel 612×792), Phase 5 STRUCTURALLY bans the pattern. The mechanisms:

#### 16.3.1 Required-on-interface (NOT optional + stub fallback)

```ts
// ✓ Correct (Phase 5 pattern)
export interface RegisterOcrOptions {
  ocrPool: OcrWorkerPool; // REQUIRED — no `?`, no default
  languagePacks: LanguagePackManager;
  jobsRepo: OcrJobsRepo;
  resultsRepo: OcrResultsRepo;
  // ...
}

// ❌ Wrong (the anti-pattern that bit Phase 1-4.1)
export interface RegisterOcrOptions {
  ocrPool?: OcrWorkerPool; // ❌ optional
  // If absent, falls back to a stub that returns OcrPageResult { words: [], confidence: 0 }
  // ...
}
```

If Wave 20 ships without wiring an `ocrPool`, TypeScript fails the build. There is no "stub for the next wave" escape hatch.

#### 16.3.2 Nullable + late-init (NOT sentinel defaults)

```ts
// ✓ Correct (Phase 5 pattern)
interface OcrPageResult {
  pageIndex: number;
  // ... real fields populated when OCR completes ...
}

interface OcrJobSummary {
  pageResults: OcrPageResult[] | null; // NULL until job completes; consumers handle nullable
}

// ❌ Wrong (the anti-pattern)
interface OcrJobSummary {
  pageResults: OcrPageResult[]; // empty array as "not yet OCR'd" sentinel — silently confused with "OCR'd zero words"
}
```

Renderer consumers MUST handle `null`:

```tsx
if (job.pageResults === null) return <Placeholder text="OCR in progress…" />;
return <OcrConfidenceOverlay results={job.pageResults} />;
```

NOT:

```tsx
// ❌ Wrong — empty array silently passes as "OCR'd zero words"
return <OcrConfidenceOverlay results={job.pageResults} />;
```

#### 16.3.3 Word-rect late-init

```ts
interface OcrWord {
  text: string;
  confidence: number;
  imgRect: { x0: number; y0: number; x1: number; y1: number }; // set at recognition time
  pdfRect: PdfRect | null; // set AFTER searchable-pdf-builder transforms
}
```

NOT a sentinel `{ x: 0, y: 0, width: 0, height: 0 }`. The renderer's confidence overlay reads `pdfRect` and short-circuits if null:

```tsx
{
  words
    .filter((w) => w.pdfRect !== null)
    .map((w) => <ConfidenceBox rect={w.pdfRect!} text={w.text} conf={w.confidence} />);
}
```

### 16.4 Confidence threshold convention

**Default: `ocr.lowConfidenceThreshold = 60`.** Words with `confidence < 60` are "low".

**Why 60:** Tesseract's own LSTM `recognize` documentation cites 60 as the "good enough" cutoff for noisy scans. Higher than that (e.g. 70) is too strict for typical user scans (faded, low-DPI, off-axis); lower (e.g. 50) yields false-confidence on garbled output.

**The threshold is applied at RENDER time, not at recognition time.** The raw per-word confidences are preserved in `ocr_results.words_json` regardless of the threshold. Changing the threshold in Settings rerenders the overlay without re-running OCR. This is the durability discipline:

- `ocr_results.words_json` is the ground truth.
- The threshold is a presentation choice.

#### 16.4.1 NOT a binary

Confidence is a CONTINUOUS 0-100 scale. The threshold is a UI cutoff for visual emphasis. The user-guide makes this explicit: a 61-confidence word is "barely above the threshold; review anyway" and a 95-confidence word is "very likely correct, but not guaranteed".

### 16.5 OCR-on-signed-PDF policy

When the doc has prior PAdES signatures (Phase 4):

1. **Pre-flight detection is non-skippable.** The handler runs `detectPriorPadesSignatures(doc)` BEFORE any rasterization. If signed fields exist AND the request did NOT carry `invalidatesSignaturesConfirmed: true`, return `Result<never, 'signed_pdf_requires_confirm'>`.

2. **The renderer-side prompt is non-skippable.** The OcrRunModal step 2 shows the confirm dialog with the affected field names. The user clicks Cancel OR "Continue and invalidate"; there is no third option.

3. **The audit log update is mandatory.** After the OCR job completes successfully, the handler executes:

```sql
UPDATE signature_audit_log
SET invalidated_by_ocr_job_id = ?
WHERE id IN (SELECT id FROM signature_audit_log
             WHERE doc_hash = ?
               AND field_name IN (?, ?, ...));
```

4. **The "Don't ask me again" toggle persists per-session, NOT permanently.** The `ocr.confirmInvalidateSignaturesOnce: true` flag is cleared on app restart. The user cannot permanently disable the prompt; this is a deliberate friction-design choice.

### 16.6 Anti-patterns (do NOT do this)

#### ❌ Renderer-side OCR

```ts
// ❌ WRONG — renderer-side tesseract.js instantiation
import { createWorker } from 'tesseract.js'; // never in src/client/

const worker = await createWorker('eng');
```

**Right form:** the renderer dispatches `window.pdfApi.ocr.runOnDocument(...)`. All Tesseract.js stays in main. ESLint `no-restricted-imports` should ban `tesseract.js` imports under `src/client/`.

#### ❌ Spawn-per-page worker churn

```ts
// ❌ WRONG — recreates the worker for every page
for (const page of pages) {
  const worker = await createWorker(lang);
  const result = await worker.recognize(page);
  await worker.terminate(); // back to zero; next page re-inits
}
```

**Right form:** `pool.acquire(lang)` ONCE per job, used for every page in the loop.

#### ❌ Echoing raster bytes to the renderer

```ts
// ❌ WRONG — sending rasterized bitmap data to the renderer
return ok({
  pageResult,
  rasterPreview: rasterBytes, // ❌ violates bytes-stay-in-main corollary
});
```

**Right form:** IPC responses contain structured data (`words`, `confidence`, `rects`) only. The renderer renders pages via pdf.js using the existing `fs:readBytesByHandle` channel.

#### ❌ Logging language pack file paths

```ts
// ❌ WRONG — logging the absolute filesystem path
log.info('languagePack.loaded', { lang, filePath: pack.filePath });
```

**Right form:** log `{ lang, sizeBytes, sha256.slice(0, 8) }`. The file path is local user info and is never useful in logs.

#### ❌ Sentinel-default OCR result

```ts
// ❌ WRONG — sentinel default
function getOcrResult(handle: DocumentHandle): OcrJobSummary {
  const job = currentJob[handle];
  return job?.summary ?? { jobId: -1, pageResults: [], totalWords: 0, meanConfidence: 0, ... };
  //                       ^^^^^^^^^^^^^^^^^^ — silently wrong; the renderer renders zero-word overlay
}
```

**Right form:** return `OcrJobSummary | null`; the renderer handles `null` as "no OCR job for this doc". Sentinel `jobId: -1` plus empty arrays is the exact defect shape from PageModel 612×792 + pdf-render-stub + defaultPdfMetadata.

#### ❌ Stub-shipped-with-TODO on the engine interface

```ts
// ❌ WRONG — optional dep with stub fallback
export function registerOcrHandlers(opts: { ocrPool?: OcrWorkerPool }) {
  const pool = opts.ocrPool ?? createStubPool(); // ❌ Wave 20 may forget to wire; tests still pass
  // ...
}

function createStubPool(): OcrWorkerPool {
  return {
    acquire: async () => {
      throw new Error('TODO: wire real pool in Wave 20.1');
    },
    releaseAll: async () => {},
    status: () => [],
  };
}
```

**Right form:** `ocrPool: OcrWorkerPool` is REQUIRED. No fallback. TypeScript fails the build if the wiring is missing in Wave 20. This is the structural fix from the 2026-05-27 global JSONL lesson.

#### ❌ Skipping the PAdES pre-flight

```ts
// ❌ WRONG — runs OCR without checking signatures
async function handleOcrRunOnDocument(req) {
  const parsed = validate(req);
  return runOcrEngine(parsed.data, doc); // ❌ no signature pre-flight
}
```

**Right form:** the pre-flight is non-skippable. The handler runs `detectPriorPadesSignatures(doc)` BEFORE any expensive op.

### 16.7 Test discipline (extends §13.6 + §15.4)

Every PR that touches the OCR engine MUST include:

1. **Real-fixture OCR tests.** No stubbed worker objects. Use `tests/fixtures/ocr-corpus/letter-portrait.pdf` (and the Legal + A4 variants) with the bundled `eng.traineddata.gz`. Test runs the REAL tesseract.js worker.

2. **Pool-release assertion.** After every test that calls `pool.acquire(...)`, the test asserts `pool.status().length === 0` after `pool.releaseAll()` (i.e. no orphan workers leak).

3. **Required-on-interface assertion.** A TypeScript-level test in `tests/typecheck/ocr-options.test-d.ts` asserts that `RegisterOcrOptions.ocrPool` is REQUIRED (uses `tsd`'s `expectType` or the equivalent expect-error pattern). Catches accidental future widening to optional.

4. **PAdES pre-flight test.** A fixture `tests/fixtures/ocr-corpus/letter-with-pades-sig.pdf` (created in Wave 20 from the Phase 4 test fixture corpus) is OCR'd; the test asserts the handler returns `Result<never, 'signed_pdf_requires_confirm'>` when `invalidatesSignaturesConfirmed` is omitted.

5. **Audit-log update test.** After a successful OCR-with-confirm on a signed fixture, the test queries `signature_audit_log` and asserts the matching rows have `invalidated_by_ocr_job_id` set to the new job's ID.

6. **Language pack integrity test.** A test fixture serves a tampered `.traineddata.gz` (wrong SHA-256); the test asserts `languagePackDownload` returns `pack_integrity_failed` and does NOT insert into `language_packs`.

7. **No-canvas-bytes-in-renderer test.** A grep-level test (Vitest with a fs-walk) asserts NO file under `src/client/` imports `tesseract.js` OR reads a `LanguagePack.filePath`. Pure mechanical check.

### 16.8 Wave 21 Julian audit checklist (mechanical greps)

(Mirrors `ocr-engine.md §9`; restated here for the conventions audit pattern.)

```bash
# (1) Only one place calls createWorker
rg -n "createWorker\(" src/main/pdf-ops/
# Should produce exactly ONE match — in ocr-worker-pool.ts.

# (2) Workers released on quit
rg -n "app\.on\(['\"]before-quit" src/main/
# Should find a match that calls ocrWorkerPool.releaseAll().

# (3) No tesseract.js in renderer
rg -n "tesseract.js" src/client/
# Should produce ZERO matches.

# (4) Language pack file path never echoed in IPC ok()
rg -n "filePath" src/ipc/handlers/ocr-*.ts
# Should produce ZERO matches (or all matches are in zod validation, not in return ok()).

# (5) No sentinel defaults in result shapes
rg -n "pageResults: \[\]|words: \[\]|confidence: 0," src/main/pdf-ops/
# Should produce ZERO matches.

# (6) PAdES pre-flight wired
rg -n "detectPriorPadesSignatures" src/ipc/handlers/ocr-*.ts
# Should find matches in BOTH ocr-run-on-page.ts AND ocr-run-on-document.ts.

# (7) Required-on-interface (no optional ocrPool)
rg -n "ocrPool\?:" src/ipc/
# Should produce ZERO matches.

# (8) Audit log update on invalidation
rg -n "invalidated_by_ocr_job_id" src/ipc/handlers/ocr-*.ts src/db/repositories/signature-audit-repo.ts
# Should find ≥ 2 matches.

# (9) SHA-256 verify in download
rg -n -B 3 -A 10 "streamDownload" src/main/pdf-ops/language-pack-manager.ts | rg "sha256"
# Should produce a match.

# (10) ESLint no-restricted-imports config bans tesseract.js in renderer
rg -n "tesseract" \.eslintrc.cjs eslint.config.* 2>&1 | head -20
# Should find the no-restricted-imports rule.
```

### 16.9 What we explicitly do NOT promise (mirrors §15.6)

For honesty with downstream users (documented in user-guide §OCR → "About OCR" — Wave 22 Nathan):

- We do NOT claim OCR-recognized text is publication-quality.
- We do NOT defend against an attacker who modifies the local SQLite DB (`ocr_jobs` is tamper-vulnerable, same as `signature_audit_log`).
- We do NOT translate the recognized text.
- We do NOT auto-rotate misaligned scans (deskew handles small rotations only).
- We do NOT embed CJK / Cyrillic / Arabic fonts in the text-behind-image output (Phase 5.1+); the text is searchable but copy-paste may yield garbled glyphs.
- We do NOT auto-detect "this page is already OCR'd" (R-W19-F).
- We do NOT defend against a poisoned tessdata mirror beyond SHA-256 verification against the shipped catalog.
- We do NOT preserve original signed-PDF bytes after OCR (Phase 4 invalidation discipline applies; user is shown the confirm).

What we DO promise:

- Per-word confidence is preserved in `ocr_results.words_json` regardless of the rendering threshold.
- Workers are torn down on `app.before-quit`.
- Language packs are SHA-256-verified at download.
- Cancellation tears down partial output (no half-OCR'd file on disk).
- OCR runs locally; no PDF bytes leave the machine.
- The signed-PDF confirm is non-skippable (per session, per modal).
- Audit-log integrity at the schema level (FK + indexes).

### 16.10 Convention §16 cross-reference checklist

- [x] Five worker-lifecycle non-negotiables (§16.1)
- [x] Bytes-stay-in-main extensions (§16.2)
- [x] Anti-stub-shipped-with-TODO encoded structurally (§16.3) — required-on-interface + nullable+late-init + word-rect
- [x] Confidence threshold convention (§16.4)
- [x] OCR-on-signed-PDF policy (§16.5) — extends Phase 4 invalidate-on-edit
- [x] Anti-patterns enumerated (§16.6)
- [x] Test discipline (§16.7)
- [x] Wave 21 Julian audit mechanical greps (§16.8)
- [x] Honest "what we don't promise" disclosure (§16.9)
- [x] L-001 untouched — this section does not weaken or reference `enableDragDropFiles`

End of Phase-5 conventions amendment.

---

## 17. Export-job discipline (Phase 6 addition, 2026-05-27, Riley)

> ### Phase 6 amendment (2026-05-27, Riley)
>
> §1-§16 above remain authoritative. This section codifies the discipline Phase 6 requires for ANY handler / module that touches the export engine, per-format writers (docx / xlsx / pptx / image), the export queue, or the export-job audit log. It applies to David's main-process work in Wave 24, Ravi's schema work in Wave 24, and Riley's renderer-side modal + sidebar work in Wave 24. Wave 25 Julian audits this section.

Like Phase 5, Phase 6 has **no secret material** — there is no password, no PFX, no private key, no cryptographic state. The discipline below is about:

1. **Read-only-on-source discipline** (export NEVER mutates the source PDF; no Phase 4 PAdES invalidation; no Phase 5 OCR-style confirm prompt).
2. **Export-bytes-stay-in-main** (the renderer never holds docx/xlsx/pptx/image bytes).
3. **Anti-stub-shipped-with-TODO** (writer dependencies required-on-interface; no optional fallbacks).
4. **Trust-floor convention** (five Phase 6 obligations + one cross-cutting reminder; four-location ratchet per the four-times-proven pattern).
5. **No-as-any discipline** (Julian Wave 21 H-21.1 lesson — code-comment-contradiction anti-pattern).
6. **Quality-tier defaults are per-format** (Q-D — layout-preserving for Word + PowerPoint; text-only for Excel; n/a for image formats).

### 17.1 Read-only-on-source non-negotiables

**Three rules, in priority order. NO exceptions without a Marcus-approved locked-instruction.**

1. **Export handlers MUST NOT call any `pdf-lib` write API (`PDFDocument.save`, `embedFont`, `embedImage`, `addPage`, etc.) against the source doc.** Reading only — `pdf-lib.PDFDocument.load` + `getPage(i).getSize()` + `getForm()` is allowed. Writers compose NEW output buffers; they MUST NOT touch the source's bytes.

2. **No `signature_audit_log` updates from export handlers.** Export is not an edit; it does not invalidate signatures. ESLint `no-restricted-imports` keeps `signature-audit-log-repo.ts` (Phase 4) unreachable from `src/main/export/**`. Mechanical-grep audit pattern in §17.8.

3. **No `edit_history` row inserts from export handlers.** Export is not an EditOperation. Same `no-restricted-imports` lock keeps the edit-history repo unreachable from `src/main/export/**`. Phase 5 set the precedent that scoped repos prevent boundary violations; Phase 6 inherits.

### 17.2 Export-bytes-stay-in-main non-negotiables

Phase 6 extends conventions §10 (renderer never holds doc bytes) with TWO new corollaries:

1. **Output bytes (the docx/xlsx/pptx/image buffer the writer composes) stay in main.** The renderer NEVER receives a `Uint8Array` of export output. The IPC handler writes the bytes to the user-chosen output path via `fs.writeFile` + `fs.rename` (atomic; see §8.5 of export-engine.md) and returns `{ jobId, summary, outputPaths }` — paths only, no bytes.

2. **Output `outputPath` is stripped to basename + dirHint at the IPC boundary.** The renderer-facing DTO (`ExportJobRowDto`) has NO `outputPath` field. Instead, the boundary translator produces:
   - `outputBasename: path.basename(outputPath)` — for display in the sidebar row
   - `outputDirHint: path.basename(path.dirname(outputPath))` — for the "in folder ~ Downloads" UX hint
     The full absolute path remains in main; the renderer dispatches `dialog.showItemInFolder` via a new IPC call (or reuses the existing one from Phase 1) by passing the `jobId`, NOT the path. See §17.8 grep.

#### The shape of a correct export IPC handler

```ts
// src/ipc/handlers/export-to-docx.ts (David Wave 24)
import { z } from 'zod';

const requestSchema = z.object({
  handle: z.number().int().positive(),
  pageRange: z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  }),
  qualityTier: z.enum(['text-only', 'layout-preserving']),
  includeAnnotations: z.boolean(),
  pageSize: z.enum(['letter', 'a4', 'auto']),
  outputPath: z.string().min(1),
});

export async function handleExportToDocx(req: unknown): Promise<ExportToDocxResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) return fail('invalid_payload', parsed.error.message);

  // Source-doc resolution via handle (NOT path) — Phase 1 pattern
  const doc = await documentStore.get(parsed.data.handle);
  if (!doc) return fail('handle_not_found');

  if (parsed.data.pageRange.end >= doc.meta.pageCount) {
    return fail('page_range_out_of_range');
  }

  // Output-path writability probe BEFORE inserting the job row
  const parentDir = path.dirname(parsed.data.outputPath);
  try {
    await fs.access(parentDir, fsConstants.W_OK);
  } catch {
    return fail('output_path_unwritable');
  }

  // Enqueue. Engine runs in the queue; this handler returns when the job COMPLETES (long-running).
  // Progress events emitted via the existing event-stream pattern.
  // Read-only on source — NO mutation, NO signature_audit_log update, NO edit_history insert.
  return runExportEngine({ ...parsed.data, format: 'docx' }, doc);
}
```

### 17.3 Trust-floor honesty obligations (fifth instance — proven pattern)

Per the four-times-proven pattern (Phase 1 H-3 + Phase 3 forms + Phase 4 PAdES + Phase 5 OCR), Phase 6 introduces the fifth instance. The five Phase 6 obligations:

1. **Layout-preserving is best-effort.** Complex multi-column layouts, embedded vector graphics, intricate tables, decorative typography may not convert faithfully.
2. **Borderless tables not detected.** Line-grid analysis requires explicit horizontal AND vertical line segments.
3. **XFA forms do not export.** AcroForm values do (via `getFieldObjects()` fallback); XFA values are inaccessible to pdf.js.
4. **Signed-PDF source stays valid; exported file has no signature semantics.** Export is read-only on source; the exported docx/xlsx/etc. has no PAdES surface.
5. **OCR status determines text fidelity.** Image-only non-OCR'd PDFs produce mostly-raster Word/PowerPoint output.

Plus the cross-cutting reminder: **Export duration depends on document complexity** (~5-30 sec/page layout-preserving; ~0.5 sec/page text-only; 100-page magazine = 30+ min).

Required surface placement (four-location ratchet — three docs + UI modal):

- Top-of-guide preamble — Wave 26 Nathan
- Dedicated user-guide trust-floor section — Wave 26 Nathan
- Inline at every export-touching subsection — Wave 26 Nathan
- README front-door Known Limitations — Wave 26 Nathan
- **ExportModal PerFormatLimitationsPanel — Wave 24 Riley (UI surface; per ui-spec §15.3.1)**

The Wave 24 UI surface (`per-format-limitations-panel.tsx`) is the load-bearing point-of-action honesty placement. The user reads it before clicking START EXPORT, not buried in docs.

### 17.4 Anti-stub-shipped-with-TODO discipline (encoded structurally)

Per the 2026-05-27 global JSONL lesson (Nathan Wave 18) + the reaffirmation in Phase 5 P5-L-2 mechanism, Phase 6 STRUCTURALLY bans the pattern.

#### 17.4.1 Required-on-interface (NOT optional + stub fallback)

```ts
// ✓ Correct (Phase 6 pattern)
export interface RegisterExportOptions {
  layoutExtractor: LayoutExtractor; // REQUIRED — no `?`, no default
  tableDetector: TableDetector;
  imageExtractor: ImageExtractor;
  writers: {
    docx: DocxWriter; // all four writers REQUIRED
    xlsx: XlsxWriter;
    pptx: PptxWriter;
    image: ImageWriter;
  };
  queue: ExportQueue;
  jobsRepo: ExportJobsRepo;
}

// ❌ Wrong (the anti-pattern that bit Phase 1-4.1)
export interface RegisterExportOptions {
  writers?: { docx?: DocxWriter /* ... */ }; // optional + stub fallback = silent broken-default
}
```

If Wave 24 ships with any writer un-wired, TypeScript fails the build at registration time. The dispatcher's exhaustive `match` over `request.format` enforces the same property via the `never` branch at the switch's default.

#### 17.4.2 Nullable + late-init (NOT sentinel defaults)

Per the 2026-05-26 sentinel-default lesson (Phase 4.1.1 612×792 callout + Phase 5 OcrWord.pdfRect callout):

- `LayoutRect` is `{ x: number; y: number; w: number; h: number } | null` — NEVER `{0,0,0,0}` for unknown/unmeasured. See `export-engine.md §3.2`.
- `ExportJobSummary.perPageProgress` is `Array<...> | null` — NULL until the export starts, populated incrementally.
- `ExportJobRowDto.imageOptions` is `{...} | null` — null for office formats; non-null for image formats. NEVER `{ dpi: 0, jpegQuality: 0, multiPageTiff: false }` placeholder.
- `ExportJobRowDto.contentStats` is `{...} | null` — null for image formats AND until completion; non-null only when `status === 'completed' && format ∈ {docx, xlsx, pptx}`.

The renderer's selectors pattern-match on null; sentinel-defaults are banned at the type system level.

### 17.5 No-as-any discipline (Julian Wave 21 H-21.1 lesson)

Per the code-comment-contradiction anti-pattern from Julian's Wave 21 H-21.1 finding (global JSONL 2026-05-27 entry), Phase 6 STRUCTURALLY bans the pattern at the writer layer.

**Rule: NO `as any` and NO `@ts-ignore` in `src/main/export/writers/**`.\*\*

Why this matters: `docx`, `exceljs`, `pptxgenjs` all have first-party TypeScript types. If a writer hits a "this option does not exist" TypeScript error, the type system is correctly refusing a non-API path — silencing it with `as any` produces the same silent-drop defect class as the Phase 5 H-21.1 `renderMode: 3 as any` bug.

**Audit pattern (Wave 25 Julian, mechanical):**

```bash
grep -rn 'as any' src/main/export/writers/    # expected: ZERO matches
grep -rn '@ts-ignore' src/main/export/writers/ # expected: ZERO matches
```

If a writer genuinely needs to cast away a type (rare — only when interfacing with an external surface that has an incorrect type def), the cast MUST use a typed wrapper module that imports the library + re-exports a corrected interface; the cast lives in ONE module and is documented inline with a TODO referencing an upstream issue. The library libs themselves are well-typed; no current writer needs this.

**Cross-check with the Phase 5 lesson:** Phase 5's `renderMode: 3 as any` was the bug. The fix was `page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible))` — using the actual library API instead of the cast. Phase 6 writers MUST follow the same discipline.

### 17.6 Quality-tier defaults discipline (Q-D)

The per-format default quality tier is locked per `data-models.md §11.6` settings keys. The discipline:

1. **The renderer never sends a sparse request.** The modal ALWAYS sends `qualityTier` explicitly (no defaulting at the IPC handler boundary). If the user hasn't touched the tier picker, the renderer reads the per-format default from settings AND sends it explicitly in the request.

2. **The handler rejects sparse partial.** `requestSchema.qualityTier = z.enum(['text-only', 'layout-preserving'])` — no `.optional()`. This blocks the renderer from inadvertently sending undefined and falling through to a hardcoded backend default.

3. **For image formats, `qualityTier: 'n/a'` is the request and DB value.** The renderer sends this string literal; the engine ignores the field for image formats; the DB stores it for audit.

4. **Settings keys: NEVER hardcode the defaults in renderer or engine.** Read from the `settings` repo at modal-open + at engine-bootstrap. The Phase 1 pattern for `recents` and Phase 5 pattern for `ocr.lowConfidenceThreshold` apply identically.

### 17.7 Test discipline

Per `conventions.md §13.6` golden-bytes pattern (Phase 5 searchable-pdf-builder + Phase 4 PAdES precedent), Wave 24 ships:

- **Layout-extractor unit tests:** 4 fixture PDFs (simple-text / multi-column / table-with-borders / image-heavy). Tests assert paragraph count, heading detection, column count, table count. Targeting ≥16 unit tests.
- **DOCX writer golden-bytes tests:** 3 fixtures. Capture the docx zip's `word/document.xml` + `word/media/*` and assert via canonical-XML compare (whitespace-insensitive; same approach as Phase 5's pdf-lib output canonicalization). Targeting ≥10 unit tests.
- **XLSX writer golden-bytes tests:** 3 fixtures. Capture `xl/worksheets/sheet1.xml` + `xl/sharedStrings.xml`. Targeting ≥10 unit tests.
- **PPTX writer golden-bytes tests:** 3 fixtures. Capture `ppt/slides/slide1.xml` + `ppt/media/*`. Targeting ≥10 unit tests.
- **Image writer tests:** 4 fixtures (PNG / JPEG-quality-0.5 / TIFF-single / TIFF-multi). File-signature assertions on encoded bytes. Targeting ≥10 unit tests.
- **Queue / lifecycle tests:** enqueue / dequeue / cancel / queue-full / atomic-write. Targeting ≥8 unit tests.
- **IPC handler tests:** 8 channels × ≥3 cases each (happy path + invalid payload + range/format error). Targeting ≥24 tests.
- **Integration smoke:** end-to-end PDF → docx round-trip via a test fixture; PDF → xlsx round-trip; PDF → pptx round-trip; PDF → multi-page TIFF round-trip. Targeting 4 integration smokes.

**Total Phase 6 test addition target: ~95 new unit + integration tests.** Mirrors Phase 5's +101 test count.

### 17.8 Wave 25 Julian audit checklist (mechanical greps)

Per the audit-pattern convention from Phase 5 §16.8, Wave 25 Julian runs these checks. False positives are acceptable; false negatives are not.

| Check                                                     | Grep                                                                              | Expected                                                                           |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| No `as any` in writers                                    | `grep -rn 'as any' src/main/export/writers/`                                      | ZERO matches                                                                       |
| No `@ts-ignore` in writers                                | `grep -rn '@ts-ignore' src/main/export/writers/`                                  | ZERO matches                                                                       |
| Source-doc not mutated by export                          | `grep -rn 'doc\\.save\\                                                           | pdfLibDoc\\.save\\                                                                 | PDFDocument\\.save' src/main/export/` | ZERO matches (writers compose NEW buffers, never resave source) |
| No signature_audit_log writes from export                 | `grep -rn 'signatureAuditLogRepo\\                                                | signature_audit_log' src/main/export/`                                             | ZERO matches                          |
| No edit_history writes from export                        | `grep -rn 'editHistoryRepo\\                                                      | edit_history' src/main/export/`                                                    | ZERO matches                          |
| No outputPath in renderer DTOs                            | `grep -rn 'outputPath:' src/client/types/`                                        | ZERO matches (only `outputBasename` + `outputDirHint`)                             |
| Required-on-interface writer deps                         | `grep -A 8 'interface RegisterExportOptions' src/main/export/export-engine.ts`    | all four writers REQUIRED                                                          |
| Single-funnel — only writer modules import format libs    | `grep -rn "from 'docx'" src/`                                                     | ONE file: `docx-writer.ts`                                                         |
|                                                           | `grep -rn "from 'pptxgenjs'" src/`                                                | ONE file: `pptx-writer.ts`                                                         |
| exceljs WRITE side does not contaminate Phase 3 READ side | `grep -rn "from 'exceljs'" src/`                                                  | TWO files: Phase 3 mail-merge.ts (read) + Phase 6 xlsx-writer.ts (write); no third |
| Atomic write pattern in export-engine                     | `grep -rn '\\.export-temp' src/main/export/`                                      | ONE match in export-engine.ts                                                      |
| LayoutRect is nullable everywhere                         | manual scan: `grep -rn 'LayoutRect' src/main/export/` followed by typecheck       | every consumer pattern-matches on null                                             |
| Per-format limitations panel mounted in modal             | `grep -rn 'PerFormatLimitationsPanel' src/client/components/modals/export-modal/` | NON-ZERO matches                                                                   |
| Trust-floor obligations surface in conventions §17.3      | `grep -n 'trust.floor\\                                                           | honesty' docs/conventions.md`                                                      | NON-ZERO matches                      |
| Settings keys default-seeded via INSERT OR IGNORE         | `grep -A 2 'INSERT OR IGNORE INTO settings' migrations/0006_phase6_export.sql`    | 17 setting keys                                                                    |
| zod validates qualityTier as enum (no optional)           | `grep -B 2 -A 2 'qualityTier:' src/ipc/handlers/export-to-*.ts`                   | every handler uses `z.enum([...])` without `.optional()`                           |

### 17.9 Anti-patterns enumerated

The seven Phase-6 anti-patterns Wave 25 Julian flags as HIGH defects:

1. **`as any` cast in writer module.** Per §17.5. Code-comment-contradiction defect class. **FIX:** read library type defs; use the actual API.
2. **Sentinel-zero `LayoutRect`.** Returning `{x: 0, y: 0, w: 0, h: 0}` from extractor for unknown rect. **FIX:** return `null`; consumer pattern-matches.
3. **Optional writer in RegisterExportOptions interface.** `writers?: Partial<...>` defeats the type-system anti-stub guard. **FIX:** all four writers REQUIRED.
4. **outputPath in renderer DTO.** Breaks the boundary; allows the renderer to construct paths. **FIX:** basename + dirHint only.
5. **Source-doc mutation in writer.** Calling `pdf-lib.save()` against the source. **FIX:** writers compose NEW buffers; the engine writes to `outputPath` atomically.
6. **signature_audit_log update from export handler.** Export is not an edit; updating the audit log is incorrect semantics. **FIX:** export handlers MUST NOT import the audit repo.
7. **Trust-floor obligation buried in docs only.** The PerFormatLimitationsPanel is the load-bearing UI surface; missing it = the user doesn't see the limitation before clicking START. **FIX:** Wave 24 Riley mounts the panel; Wave 25 Julian's grep checks for `PerFormatLimitationsPanel` presence.

### 17.10 Honest "what we don't promise" disclosure

For symmetry with Phase 5's §16.9:

- We do NOT promise faithful conversion of decorative typography, vector graphics, math equations, hyperlinks, bookmark anchors (Phase 6.1 candidates).
- We do NOT promise lossless round-trip (PDF → docx → PDF would not be visually identical).
- We do NOT translate. Output is in the source language(s).
- We do NOT defend against an attacker who modifies the local SQLite DB (`export_jobs` lives in the same DB as `signature_audit_log` + `ocr_jobs`; same tamper-vulnerability disclosure).
- We do NOT auto-OCR before export. Source-mutation-without-consent is rejected per trust-floor obligation #5.
- We do NOT preserve PDF metadata (author/subject/keywords) in the exported file — Phase 6.2 candidate.

What we DO promise:

- Export reads from source without mutation.
- Output writes atomically (.export-temp + rename); cancel cleans up partial output.
- All four output formats are valid per their respective OOXML / image-format specs.
- Per-format defaults are settable in Settings and honored at runtime.
- Trust-floor obligations surface at four locations (preamble + dedicated section + inline + UI modal).

### 17.11 Convention §17 cross-reference checklist

- [x] Read-only-on-source non-negotiables (§17.1) — three rules
- [x] Export-bytes-stay-in-main extensions (§17.2)
- [x] Trust-floor obligations enumerated (§17.3) — five Phase 6 + cross-cutting reminder
- [x] Anti-stub-shipped-with-TODO encoded structurally (§17.4) — required-on-interface + nullable+late-init
- [x] No-as-any discipline (§17.5) — Julian Wave 21 H-21.1 lesson applied proactively
- [x] Quality-tier defaults discipline (§17.6) — Q-D
- [x] Test discipline (§17.7) — ~95 new tests target
- [x] Wave 25 Julian audit mechanical greps (§17.8)
- [x] Anti-patterns enumerated (§17.9)
- [x] Honest "what we don't promise" disclosure (§17.10)
- [x] L-001 untouched — this section does not weaken or reference `enableDragDropFiles`

End of Phase-6 conventions amendment.

---

## 18. Polish-phase discipline (Phase 7 addition, 2026-05-27, Riley)

> ### Phase 7 amendment (2026-05-27, Riley)
>
> §1-§17 above remain authoritative. This section codifies the cross-cutting conventions Phase 7 introduces for **accessibility**, **internationalization**, and **telemetry**. It applies to Riley's renderer work in Wave 28 (a11y fixes + i18n string extraction + telemetry hook), to David/Diego's main-process Wave 28 work (update / telemetry / i18n IPC handlers), and to Wave 29 Julian's final audit. This is the FINAL roadmap phase; these conventions are the last additive amendment to this document.

Unlike Phase 4 (cert secrets) and Phase 5 (OCR workers), Phase 7 has **no secret material and no heavy worker lifecycle**. The disciplines below are about: (1) accessibility correctness, (2) zero hardcoded user-facing strings, (3) telemetry that physically cannot leak PII, and (4) the trust-floor sixth instance.

### 18.1 Trust-floor honesty (SIXTH instance — the project's strongest pattern)

Per the five-times-proven pattern (H-3 + Phase 3 forms + Phase 4 PAdES + Phase 5 OCR + Phase 6 export), Phase 7 is the sixth instance. The six obligations (full text in `architecture-phase-7.md §8`):

1. Telemetry OFF by default; anonymous counts only; nothing leaves the machine in Phase 7.
2. Auto-update publish target is a placeholder; updates won't function until configured.
3. macOS/Linux builds are UNVERIFIED.
4. The proof locale (es-ES) is a sample, not a complete localization.
5. a11y is WCAG 2.1 AA for critical paths, with documented gaps.
6. Code-signing cert is the user's real-world Phase 7.1 step.

Surface at FOUR locations (the proven ratchet): top-of-guide preamble + dedicated section + inline at every Phase-7 subsection + README known-limitations (all Wave 30 Nathan) PLUS the load-bearing UI placements (Wave 28 Riley): Settings telemetry copy, Settings locale-picker subtext, About update-status notice. The UI copy is where the user reads the honesty at the moment of action.

### 18.2 The cardinal rule: never overstate

The single failure mode this section exists to prevent: a downstream agent (especially Wave 30 Nathan) writing "PDF_Viewer_Editor auto-updates from GitHub" or "available on macOS and Linux" or "collects usage analytics" — each of which is FALSE-as-stated. The honest forms:

- ✓ "The auto-update **client** is wired; it checks GitHub releases once a real publish channel is configured (currently a placeholder)."
- ✗ "PDF_Viewer_Editor auto-updates from GitHub." (the channel is a placeholder; it does not)
- ✓ "macOS and Linux build configs are included but **UNVERIFIED** on real hardware."
- ✗ "Cross-platform: Windows, macOS, and Linux." (mac/linux are unverified config)
- ✓ "Optional, off-by-default anonymous feature-usage counts that stay on your machine."
- ✗ "We collect anonymous analytics." (it's off by default and sends nothing in Phase 7)
- ✓ "Spanish is a translation **sample** proving the localization framework; some strings appear in English."
- ✗ "Available in English and Spanish." (es-ES is partial)

### 18.3 Accessibility conventions (WCAG 2.1 AA; Windows Narrator)

Every renderer change in Wave 28+ MUST satisfy:

1. **Every interactive element has an accessible name** — visible `<label>`, `aria-label`, or `aria-labelledby`. Icon-only buttons MUST have `aria-label`. Enforced: `jsx-a11y/aria-proptypes` restored to `error` (from the Phase-1 `warn` workaround) once the tab patterns land.
2. **Focus-visible discipline** — never `outline: none` / `outline: 0` without a replacement `:focus-visible` indicator. Use the `--focus-ring` token (`styles/tokens.css`).
3. **No positive `tabIndex`** — only `0` (natural order) or `-1` (programmatically focusable). Positive tabindex is BANNED (`jsx-a11y/tabindex-no-positive` + this rule).
4. **Logical tab order** — DOM order matches visual order (Toolbar → Sidebar → Viewer → Inspector → Status bar). No CSS `order:` that desyncs.
5. **Proper ARIA tab pattern** — tablists use `role="tablist"`/`role="tab"`/`role="tabpanel"` + `aria-selected` + roving tabindex + arrow-key nav (the `a11y-audit.md §4` pattern). NO ad-hoc tab markup.
6. **Modals use the shared `useFocusTrap` hook** — focus trapped within, Esc escapes, focus returns to the trigger on close, `role="dialog"`/`role="alertdialog"` + `aria-modal`.
7. **Destructive confirms default-focus the SAFE button** — the unsaved-changes + OCR-invalidate `alertdialog`s focus Cancel / the non-destructive option first.
8. **Async state announced via live regions** — `aria-live="polite"` (status), `aria-live="assertive"` / `role="alert"` (errors).
9. **`aria-label` strings go through `t()`** (§18.4) — a Spanish screen reader must hear Spanish.

#### Anti-pattern (the Phase-1 debt being repaid)

```tsx
// ❌ WRONG — the Phase-1 workaround that dropped tab semantics to silence jsx-a11y/aria-proptypes
<div className="tabs">
  <div className={active === 'pages' ? 'tab active' : 'tab'} onClick={() => set('pages')}>
    Pages
  </div>
  <div className={active === 'marks' ? 'tab active' : 'tab'} onClick={() => set('marks')}>
    Bookmarks
  </div>
</div>
```

```tsx
// ✓ RIGHT — the proper ARIA tab pattern (a11y-audit §4)
<div role="tablist" aria-label={t('sidebar.panelsLabel')} aria-orientation="vertical">
  {tabs.map((tab) => (
    <button
      role="tab"
      key={tab.id}
      id={`tab-${tab.id}`}
      aria-selected={tab.id === active}
      aria-controls={`panel-${tab.id}`}
      tabIndex={tab.id === active ? 0 : -1}
      onKeyDown={onTabKeyDown}
    >
      {t(tab.labelKey)}
    </button>
  ))}
</div>
```

### 18.4 Internationalization conventions

1. **NO hardcoded user-facing strings.** Every user-visible literal goes through `t('namespace.key')` (or `<Trans i18nKey="..." />` for embedded markup). This includes JSX text, `aria-label`, `title`, `placeholder`, button labels, toast/error messages, empty states, tooltips.
2. **Key naming = `namespace.dotPath` in camelCase segments.** Examples: `toolbar.open`, `modals.export.startButton`, `errors.fs_read_failed`, `settings.telemetry.optInLabel`. Namespaces are the eight files in `i18n-strategy.md §5`.
3. **Keys are typed.** The `i18next.d.ts` augmentation makes `t()` keys type-checked against `en-US`. A missing key is a COMPILE ERROR, not a runtime raw-key.
4. **NO `as any` / `@ts-ignore` on `t()` calls.** Per the Julian Wave 21 H-21.1 code-comment-contradiction lesson (§17.5): if the type system rejects a `t()` key, the key is missing from `en-US` — ADD it, don't cast. The library types are correct.
5. **`fallbackLng: 'en-US'`** — an untranslated key renders English, never a raw key. The proof locale degrades gracefully.
6. **Strings that do NOT get extracted:** developer-only logs (§9 — never user-facing), IPC channel names, file extensions, the app name "PDF_Viewer_Editor" (proper noun), internal enum values.
7. **Date/number formatting via `Intl` keyed to `i18n.language`** (§12.3 — no new dependency). NO `date-fns` / `moment` / `numeral`.

#### Anti-pattern

```tsx
// ❌ WRONG — hardcoded string + cast to escape key typing
<button aria-label="Open">{'Open' as any}</button>;
toast.error('Failed to read file');

// ✓ RIGHT
<button aria-label={t('toolbar.open')}>{t('toolbar.open')}</button>;
toast.error(t('errors.fs_read_failed'));
```

### 18.5 Telemetry conventions

1. **Opt-in default OFF.** `settings.telemetry.optIn` defaults `false`. The `useTelemetry` hook hard-gates on it; the `telemetry:recordEvent` handler re-checks it.
2. **Explicit event allowlist.** Event names are a closed TS union + a runtime `Set` (`telemetry-events.ts`). Anything not allowlisted is dropped (dev-mode `console.warn`). Adding an event = adding to BOTH the union and the Set.
3. **NO PII, EVER.** The event payload is `{ name, count: 1, dayBucket }` and NOTHING else. The zod schema is `.strict()` — it rejects any extra property. There is physically no field for document content, file paths, field values, error strings, or user identity. This is the STRUCTURAL guarantee, not a discipline that can be forgotten.
4. **Day-bucketed timestamps only.** `dayBucket` is `'YYYY-MM-DD'`. NO sub-day timestamp (defeats session fingerprinting).
5. **NEVER log the event payload** (§9). The handler logs channel + ok/dropped variant only.
6. **The buffer is in-memory only** (`data-models.md §12.4`) — never persisted to SQLite, never written to disk, cleared on opt-out + on quit.
7. **NO third-party phone-home SDK** — no Google Analytics, no Sentry-auto-send, no PostHog/Mixpanel/Amplitude. The transport is the `NoOpRingBufferTransport` (Phase 7) or a future self-hosted transport behind the `TelemetryTransport` interface (Phase 7.1). The interface field is REQUIRED (no optional + stub fallback — anti-stub discipline §16.3 / §17.4).

#### Anti-patterns

```ts
// ❌ WRONG — PII in a telemetry event
telemetry.record({ name: 'doc.open', filePath: doc.path }); // file path = PII
telemetry.record({ name: 'feature.export.docx', docTitle: title }); // doc content
log.info('telemetry', { event }); // logging the payload

// ❌ WRONG — third-party SDK that defaults ON / phones home
import * as Sentry from '@sentry/electron';
Sentry.init({ dsn });

// ❌ WRONG — optional transport with a stub fallback
function useTelemetry(transport?: TelemetryTransport) {
  const t = transport ?? noopThatSilentlyDoesNothing; // stub-shipped-with-TODO defect class
}

// ✓ RIGHT
const record = useTelemetry(); // transport injected, REQUIRED, opt-in gated inside
record('feature.export.docx'); // name only; hook adds count + dayBucket
```

### 18.6 Cross-platform config discipline (Diego Wave 28)

1. **`asarUnpack` globs at the TOP LEVEL of `electron-builder.yml`, not nested under `win:`** — so mac/linux inherit the hard-won Windows unpack fix (`pdfjs-dist/{standard_fonts,cmaps}` + tesseract wasm/tessdata + native `.node` files + the package.json for `require.resolve`). Per the Phase 6.1 renderer-vs-main asset-path lesson.
2. **mac/linux are config-only; CI builds Windows only.** Do NOT enable `dist` packaging for mac/linux in CI without a real host + an L-002-equivalent screenshot. A green CI package step ≠ a working binary (L-002's entire lesson).
3. **Honest placeholders in config** — `publish.owner/repo`, `linux.maintainer`, mac signing identity are documented placeholders, NOT silent fakes. The update controller surfaces `update_not_configured`, not a fake "up to date".
4. **Native-module rebuild is the risk** — `better-sqlite3` (per-platform rebuild) + `@napi-rs/canvas` (universal-mac merge of both arch prebuilds) are the two failure modes most likely to crash an UNVERIFIED mac/linux binary on launch (`architecture-phase-7.md §6`). Document, don't assume.

### 18.7 Wave 29 Julian audit checklist (mechanical greps)

Mirrors the audit-pattern convention from §16.8 / §17.8. Detailed per-domain greps live in `a11y-audit.md §8.1` and `i18n-strategy.md §9`; the cross-cutting ones:

```bash
# a11y
rg -n 'tabIndex=\{[1-9]' src/client/                         # ZERO (no positive tabindex)
rg -n 'aria-proptypes' .eslintrc.cjs eslint.config.*          # 'error', not 'warn'
rg -n 'role="tablist"' src/client/components/sidebar/ src/client/components/modals/settings-modal/  # >= 2
rg -n 'useFocusTrap' src/client/components/modals/            # every modal

# i18n
rg -n 't\(.*\) as any|as any' src/client/i18n/               # ZERO
rg -n 'CustomTypeOptions' src/client/i18n/i18next.d.ts        # >= 1 (typed keys)
rg -n "fallbackLng" src/client/i18n/index.ts                  # 'en-US'

# telemetry
rg -n 'filePath|docTitle|userId|content' src/client/telemetry/   # ZERO (no PII fields)
rg -n "@sentry|google-analytics|posthog|mixpanel|amplitude" src/  # ZERO (no phone-home SDK)
rg -n '\.strict\(\)' src/ipc/handlers/telemetry-record-event.ts   # >= 1 (strict zod = PII guard)
rg -n "log\.(info|debug|warn|error)" src/ipc/handlers/telemetry-*.ts | rg -i "event\b|payload"  # ZERO

# cross-platform
rg -n "asarUnpack" electron-builder.yml                       # present at top level (not under win:)

# L-001 (last verification)
rg -n "enableDragDropFiles" src/main/window-manager.ts        # must NOT be set to false
```

### 18.8 Convention §18 cross-reference checklist

- [x] Trust-floor SIXTH instance — six obligations, four-location ratchet (§18.1)
- [x] Cardinal never-overstate rule with honest/dishonest framing pairs (§18.2)
- [x] Accessibility conventions — 9 rules + the proper-tab-pattern anti-pattern (§18.3)
- [x] i18n conventions — no-hardcoded-strings + typed keys + no-as-any + anti-pattern (§18.4)
- [x] Telemetry conventions — opt-in OFF + allowlist + strict-no-PII + no-SDK + anti-patterns (§18.5)
- [x] Cross-platform config discipline (§18.6)
- [x] Wave 29 Julian audit mechanical greps (§18.7)
- [x] L-001 untouched — this section does not weaken or reference `enableDragDropFiles`; §18.7 INCLUDES the L-001 verification grep (last verification per phase-7-plan acceptance criteria)

End of Phase-7 conventions amendment. This is the final additive amendment to the conventions document for the roadmap.

---

## 19. Well-marked tools (Phase 7.5 addition, 2026-06-17, Riley)

> ### Phase 7.5 amendment (2026-06-17, Riley)
>
> Phase 7's §18 declared itself "the final additive amendment to the conventions document for the roadmap." That declaration anticipated the roadmap ending at Phase 7. The principal's Phase 7.5 "do all" ruling brought 24 new features into scope, with a cross-cutting marking foundation (R1 tool registry + R2 contract tests + R3 conventions update). This §19 IS the R3 update. The original "final amendment" framing is honored in spirit — §19 adds NO new code-style rule, NO new IPC discipline, NO new trust-floor obligation beyond Phase 7. It is one focused section codifying the "well-marked tool" definition that Riley's audit (`docs/acrobat-parity-audit.md` §5.1) demonstrated was a real, recurring failure mode.

### 19.1 The 7-dimension definition (verbatim from audit §5.1)

A tool is **well marked** if and only if all seven items hold:

1. **Icon** in a toolbar button (Lucide or equivalent) OR a menu-only entry with a clear human-readable name. Hidden-only-via-shortcut tools are NOT well marked. (Exception: shortcuts in `INTRINSIC_SHORTCUTS` per `docs/tool-registry-spec.md` §1.1 — page-nav and zoom controls that are inherently mouseless-irrelevant.)
2. **Tooltip** that includes the human name + the keyboard shortcut (if one exists). Tooltip must be a real `title=` AND an `aria-describedby` so screen readers receive it. **No "Coming in Phase N" tooltip for a shipped phase.** (Test 4 in `registry.contract.test.ts` enforces.)
3. **ARIA label** that matches the tooltip's name component (not the whole sentence). `aria-label` MUST NOT contain hardcoded English (§18.3 rule 8's `aria-label="[A-Z]"` grep is the structural enforcement).
4. **Menu entry** under the correct top-level menu (File / Edit / View / Insert & Pages / Comment / Tools / Help). Annotation tools MUST appear under Comment (or Tools→Comment). Page ops MUST appear under Insert & Pages. **Every well-marked tool reaches the user via at least two surfaces (toolbar + menu, OR menu + palette, OR registered shortcut + menu).**
5. **i18n key** in `en-US` AND `es-ES` (per Phase 7 i18n scope) — both label and tooltip and ARIA label. No hardcoded English in `aria-label=`, `title=`, or button text. Caught by §18.3 rule 8.
6. **Keyboard shortcut** registered in `src/client/shortcuts.ts` AND wired in `use-app-shortcuts.ts` — unless the tool is truly mouseless-irrelevant (a sub-menu opener, a context-menu-only entry). Even then, the tool MUST be reachable via the Find-a-tool palette (Phase 7.5 A7).
7. **Discoverable** via the top-level "Find a tool…" palette (Phase 7.5 A7, opened by `Ctrl+/`) AND via the in-app Help modal's shortcuts table.

### 19.2 The mechanism — `src/client/tools/registry.ts`

Every tool MUST be declared in `src/client/tools/registry.ts` as a `ToolDef` per the interface in `docs/tool-registry-spec.md` §1. The four UI surfaces (toolbar, menu-bar, shape sub-toolbar, Find-a-tool palette) are **renderers of the same registry** — no per-surface hand-wiring of a new tool.

**Anti-pattern (what §19 forbids):**

```tsx
// ❌ NOT WELL MARKED — toolbar button without a matching ToolDef
// (toolbar/index.tsx)
<ToolbarButton
  icon="awesome-feature"
  label="Awesome Feature"
  tooltip="Awesome Feature (Ctrl+W)"
  onClick={() => dispatch(awesomeFeature())}
/>
```

**Pattern (what §19 requires):**

```tsx
// ✅ WELL MARKED — registry-declared, toolbar renders it
// (registry.ts)
{
  id: 'tools:awesome-feature',
  nameKey: 'tools.awesomeFeature.name',
  tooltipKey: 'tools.awesomeFeature.tooltip',
  ariaLabelKey: 'tools.awesomeFeature.aria',
  icon: 'awesome-feature',
  shortcutId: 'awesome-feature',
  menu: { top: 'tools' },
  surfaces: { toolbar: 'forms', menu: true, palette: true },
  enabledWhen: (s) => s.document.handle !== null,
  dispatch: (d) => d(awesomeFeature()),
  searchKeywords: ['awesome', 'feature', 'cool'],
}

// (toolbar/index.tsx — generic, no per-tool change)
const tools = TOOLS.filter((t) => t.surfaces.toolbar !== undefined);
// ...
```

### 19.3 The four enforcement tests (R2)

File: `src/client/tools/registry.contract.test.ts`. Test bodies in `docs/tool-registry-spec.md` §3:

1. **Every tool is well marked** — all 7 dimensions present; i18n keys resolve in both locales; `searchKeywords` non-empty.
2. **Tooltips advertise their shortcut** — every tool with a `shortcutId` has its formatted shortcut text in the en-US tooltip.
3. **Every shortcut surfaces in the registry** — no orphan shortcut in `shortcuts.ts` that isn't either an `IntrinsicShortcut` (page-nav/zoom) or referenced by a `ToolDef`.
4. **No stale "Coming in Phase N" tooltips** — for all shipped phases, the en-US tooltip must not contain "Coming in Phase N".

These four tests run in CI on every PR (Phase 7.5 Wave 2 onward).

### 19.4 The CI ratchet (L-007, Wave 11)

`scripts/ratchet-tool-registry-coverage.mjs` (Diego, Wave 11) parses `src/client/components/{toolbar,menu-bar,shape-tools,tool-search-palette}/` JSX, computes the set of `ToolId` values rendered, computes the set declared in `registry.ts`, fails the build if the two sets diverge. L-007 lock entry in `.learnings/locked-instructions.md` references the ratchet as enforcement.

### 19.5 Cutover — registry-additive then UI-cutover

Wave 2 Riley splits the registry rollout into TWO commits per `docs/tool-registry-spec.md` §4:

1. Registry-additive — declare all tools, land contract tests; UI unchanged.
2. UI cutover — rewrite four UI surface files to render from the registry; land the Find-a-tool palette.

The two-commit pattern matches the proven Phase 7 i18n migration cutover. Risk mitigation R4 from `docs/project-plan.md`.

### 19.6 Anti-pattern — strip-post-hoc on sanitize-class ops

Adjacent convention, related to the marking foundation only by being a Phase 7.5 cross-cutting discipline: every new sanitize-class op (B6 Compress, B8 Encryption round-trip, B20 Sanitize) MUST use **rebuild-from-scratch** (`PDFDocument.create() + copyPages()`), NOT `catalog.delete()` + `save()`. The latter leaves orphan dicts in the output xref because pdf-lib emits every object in `context.indirectObjects` regardless of reachability. Phase 7.4 B1 R1 Redaction proved the rebuild pattern is strictly stronger (David, 2026-06-15, `commit:1078669`). Julian's Wave 11 review re-checks every new sanitize-class op for the rebuild pattern.

### 19.7 Convention §19 cross-reference checklist

- [x] 7-dimension "well marked" definition (§19.1) — sourced from audit §5.1 verbatim.
- [x] Tool registry mechanism (§19.2) — sourced from `docs/tool-registry-spec.md` §1.
- [x] Four contract tests (§19.3) — sourced from `docs/tool-registry-spec.md` §3.
- [x] L-007 CI ratchet pointer (§19.4) — sourced from `docs/tool-registry-spec.md` §6.
- [x] Cutover discipline (§19.5) — sourced from `docs/tool-registry-spec.md` §4.
- [x] Rebuild-from-scratch sanitize discipline (§19.6) — sourced from `.learnings/learnings.jsonl` 2026-06-15 (David Phase 7.4 B1 entry).
- [x] L-001 untouched — this section does not weaken or reference `enableDragDropFiles`. The §18.7 verification grep continues to hold.

End of Phase-7.5 conventions amendment. §19 is the marking-foundation addition; no other code-style or discipline rules are introduced this wave.
