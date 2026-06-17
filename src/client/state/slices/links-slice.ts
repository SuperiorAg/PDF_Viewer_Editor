// Links slice — Phase 7.5 B13 (Riley Wave 4).
//
// Holds the active hyperlink-annotation set (per-document, keyed by
// file-handle) plus transient UI state for the Add Link tool and the
// per-link context menu. The persistent round-trip through `pdf:editLinks`
// is deferred until David lands the engine channel — see
// `services/links-api.ts` + `types/links-contract-stub.ts` for the open
// question. Until then the slice is the source of truth within the session.
//
// Cross-check vs the four-times-bitten sentinel-default lesson:
// - `tool` defaults to `'cursor'` (the visible idle tool; not a sentinel)
// - `pendingDraft` is `null` when nothing is in flight (not a sentinel)
// - `contextMenu` is `null` until right-click opens it (not a sentinel)

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { LinkTarget, PdfLinkAnnotation } from '../../types/links-contract-stub';

export type LinkTool = 'cursor' | 'add-link';

export interface LinksDraft {
  pageIndex: number;
  /** Pointer-down position in PDF user-space. */
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface LinkContextMenu {
  linkId: string;
  /** CSS viewport-px position for the menu. */
  x: number;
  y: number;
}

export interface LinksState {
  /** Active tool — when `add-link`, marquee dragging on a page collects a draft. */
  tool: LinkTool;
  /** Links by document handle. Cleared on document close (handled elsewhere). */
  byHandle: Record<number, PdfLinkAnnotation[]>;
  /** Pending marquee while the user drags. */
  pendingDraft: LinksDraft | null;
  /** Active context menu. */
  contextMenu: LinkContextMenu | null;
  /** When non-null the Add Link modal is open with this provisional draft
   *  payload (rect, page index). The modal Apply commits it. */
  addModal: { rect: PdfLinkAnnotation['rect']; pageIndex: number } | null;
  /** When non-null the Edit Link modal is open against this link id. */
  editModalLinkId: string | null;
}

const initialState: LinksState = {
  tool: 'cursor',
  byHandle: {},
  pendingDraft: null,
  contextMenu: null,
  addModal: null,
  editModalLinkId: null,
};

export const linksSlice = createSlice({
  name: 'links',
  initialState,
  reducers: {
    setLinkTool(state, action: PayloadAction<LinkTool>) {
      state.tool = action.payload;
      state.pendingDraft = null;
      state.contextMenu = null;
    },
    beginLinkDraft(state, action: PayloadAction<{ pageIndex: number; x: number; y: number }>) {
      state.pendingDraft = {
        pageIndex: action.payload.pageIndex,
        startX: action.payload.x,
        startY: action.payload.y,
        currentX: action.payload.x,
        currentY: action.payload.y,
      };
    },
    updateLinkDraft(state, action: PayloadAction<{ x: number; y: number }>) {
      if (state.pendingDraft !== null) {
        state.pendingDraft.currentX = action.payload.x;
        state.pendingDraft.currentY = action.payload.y;
      }
    },
    cancelLinkDraft(state) {
      state.pendingDraft = null;
    },
    /** Open the Add Link modal with the marquee rect captured. */
    openAddLinkModal(
      state,
      action: PayloadAction<{ pageIndex: number; rect: PdfLinkAnnotation['rect'] }>,
    ) {
      state.addModal = { rect: action.payload.rect, pageIndex: action.payload.pageIndex };
      state.pendingDraft = null;
    },
    closeAddLinkModal(state) {
      state.addModal = null;
    },
    openEditLinkModal(state, action: PayloadAction<string>) {
      state.editModalLinkId = action.payload;
      state.contextMenu = null;
    },
    closeEditLinkModal(state) {
      state.editModalLinkId = null;
    },
    setLinkContextMenu(state, action: PayloadAction<LinkContextMenu | null>) {
      state.contextMenu = action.payload;
    },
    addLink(state, action: PayloadAction<{ handle: number; link: PdfLinkAnnotation }>) {
      const list = state.byHandle[action.payload.handle] ?? [];
      list.push(action.payload.link);
      state.byHandle[action.payload.handle] = list;
    },
    updateLink(
      state,
      action: PayloadAction<{
        handle: number;
        linkId: string;
        rect?: PdfLinkAnnotation['rect'];
        target?: LinkTarget;
      }>,
    ) {
      const list = state.byHandle[action.payload.handle];
      if (list === undefined) return;
      const idx = list.findIndex((l) => l.id === action.payload.linkId);
      if (idx < 0) return;
      const prev = list[idx];
      if (prev === undefined) return;
      const next: PdfLinkAnnotation = {
        ...prev,
        rect: action.payload.rect ?? prev.rect,
        target: action.payload.target ?? prev.target,
        modifiedAt: Date.now(),
      };
      list[idx] = next;
    },
    removeLink(state, action: PayloadAction<{ handle: number; linkId: string }>) {
      const list = state.byHandle[action.payload.handle];
      if (list === undefined) return;
      state.byHandle[action.payload.handle] = list.filter((l) => l.id !== action.payload.linkId);
    },
    clearLinksForHandle(state, action: PayloadAction<number>) {
      delete state.byHandle[action.payload];
    },
  },
});

export const {
  setLinkTool,
  beginLinkDraft,
  updateLinkDraft,
  cancelLinkDraft,
  openAddLinkModal,
  closeAddLinkModal,
  openEditLinkModal,
  closeEditLinkModal,
  setLinkContextMenu,
  addLink,
  updateLink,
  removeLink,
  clearLinksForHandle,
} = linksSlice.actions;

export default linksSlice.reducer;
