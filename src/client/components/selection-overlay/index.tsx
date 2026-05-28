// SelectionOverlay — Phase 1 stub.
// Per ui-spec.md §2 (component tree), the SelectionOverlay sits inside the
// PdfViewer for marquee selection of annotations / pages. Phase 1 doesn't ship
// marquee selection (Phase 4 scope per ui-spec §6.1) — this stub keeps the
// component slot in place so the tree matches the spec exactly. PdfViewer does
// NOT render this in Phase 1; it's available for Phase 4 wiring.

export function SelectionOverlay(): JSX.Element | null {
  return null;
}
