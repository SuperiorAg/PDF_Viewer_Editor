// Renderer-side mirror of David's `ACTION_SCRIPT_SCHEMA_VERSION` +
// `ALLOWED_OP_KINDS` allowlist for the B9 Action Wizard (Phase 7.5 Wave 6).
//
// CANONICAL SOURCE: `src/main/persistence/actions-store.ts`. The values below
// are intentionally NOT imported from that file because it sits behind the
// renderer/main process boundary (the Vite renderer build does not bundle
// node:crypto, node:fs, etc.). Instead the constants are mirrored verbatim
// and a drift-gate test (`actions.drift.test.ts`) reads David's source as
// text and asserts the literals match. Same pattern as the Wave-5d follow-up
// renderer mirrors for the C6 accessibility-rule severities.
//
// If you bump either value, update David's source AND run the drift-gate
// test — it must remain green.

/** Wire-format version Riley's recorder stamps on every saved script.
 *  MUST match David's `ACTION_SCRIPT_SCHEMA_VERSION` literal. */
export const ACTION_SCRIPT_SCHEMA_VERSION = 1 as const;

/** Allowlist of EditOperation kinds that survive cross-document replay.
 *  MUST match David's `ALLOWED_OP_KINDS` Set membership exactly. The
 *  recorder middleware silently drops ops NOT in this allowlist and emits
 *  the `actionWizard.bannedOpToast` toast with the banned kind so the user
 *  knows the op was not captured. */
export const ALLOWED_OP_KINDS: ReadonlySet<string> = new Set<string>([
  'reorder',
  'insert',
  'delete',
  'rotate',
  'annot-add',
  'annot-add-shape',
  'image-insert',
  'image-overlay',
  'form-design-add',
]);

/** Returns true when the op kind is on the cross-document-replay allowlist. */
export function isAllowedActionOpKind(kind: string): boolean {
  return ALLOWED_OP_KINDS.has(kind);
}
