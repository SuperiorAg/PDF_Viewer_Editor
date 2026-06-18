// Reading-order honesty-warning constant — Phase 7.5 Wave 5d follow-up (Riley).
//
// MUST stay in sync with the named export of the same name in
//   src/main/pdf-ops/reading-order-engine.ts
// where David's `getReadingOrder` engine pushes this exact string into the
// response `warnings: string[]` when `recompute: true` is requested but no
// production layout/text extractor is wired into the engine.
//
// David promoted the literal to a named export in commit c014d08
// (Wave 5d backend follow-ups). Riley's Wave 5d follow-up landed this
// renderer-side mirror in parallel — concurrent commits closing the same
// honesty-token coordination scar from the two sides at once.
//
// Why a renderer-side mirror (and NOT a direct import of David's constant):
//   - The main-process engine module is not reachable from the renderer bundle
//     across the Electron main/renderer boundary. An `import { … } from '../../main/...'`
//     from `src/client/` would either break the renderer's tsconfig project
//     boundary or pull main-only dependencies (pdf-lib, fs, …) into the
//     renderer graph.
//   - The natural future promotion point is `src/shared/` (the existing
//     main+renderer boundary directory holding `result.ts`). When the next
//     wave touches both files we can hoist the constant there and have
//     BOTH David's engine and this renderer mirror import from one canonical
//     `src/shared/reading-order-constants.ts`. Until then the renderer-side
//     mirror + drift-detection test keeps the two sides honest.
//
// Equality discipline: the renderer compares the engine's warnings[] entry
// to this constant via strict equality (===) in the slice / banner. A
// future re-wording of the warning string on EITHER side trips the
// integration test (constants/reading-order.test.ts) and David's
// reading-order-engine.test.ts at the same time, surfacing the drift in
// CI before it lands.

/** The exact warning string David's `getReadingOrder` engine emits when
 *  `recompute: true` is requested but no production text/layout extractor
 *  is wired. The overlay banner reads this constant verbatim. */
export const READING_ORDER_RECOMPUTE_NO_EXTRACTOR_WARNING =
  'reading-order.recompute.no-extractor-wired';
