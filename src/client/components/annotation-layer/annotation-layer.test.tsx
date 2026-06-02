// Annotation Layer component tests.
//
// Phase 3.1 sibling of the Form Designer click-to-place fix (commit 348a225):
// the text/FreeText tool now seeds a default-sized rect on a stray click;
// every other annotation tool (highlight / underline / strikeout / ink)
// keeps its drag-only behavior because they are inherently text-selection
// or stroke annotations and dropping a default rectangle on a stray click
// would produce worse UX than the silent no-op. Per Marcus's brief.

import { describe, expect, it } from 'vitest';

import { type PageViewport } from '../../services/pdf-coords';
import { type PageModel } from '../../types/ipc-contract';

import { CLICK_THRESHOLD_PX, DEFAULT_FREE_TEXT_SIZE_PTS, computeAnnotationCommit } from './index';

// US-Letter test page at 100% zoom (1 pt = 1 px). Convenient because the
// screen→PDF math becomes the identity for width/height, making the assertions
// easy to read.
const PAGE: PageModel = {
  pageIndex: 0,
  sourcePageRef: { kind: 'original', originalIndex: 0 },
  rotation: 0,
  width: 612,
  height: 792,
};

const VIEWPORT_1X: PageViewport = { width: 612, height: 792, scale: 1 };
const VIEWPORT_2X: PageViewport = { width: 1224, height: 1584, scale: 2 };

function clickAt(x: number, y: number) {
  return { startX: x, startY: y, currentX: x, currentY: y };
}

describe('computeAnnotationCommit — click-to-place FreeText (Phase 3.1)', () => {
  it('seeds a 144x32 FreeText rect at the click point when the user does not drag (text tool)', () => {
    const decision = computeAnnotationCommit({
      activeTool: 'text',
      draft: clickAt(100, 200),
      page: PAGE,
      viewport: VIEWPORT_1X,
    });
    expect(decision.kind).toBe('commit');
    if (decision.kind !== 'commit') return; // narrow for TS

    expect(decision.subtype).toBe('FreeText');
    expect(decision.contents).toBe('');
    // At 1× zoom the screen rect dimensions equal the PDF defaults.
    expect(decision.screenRect.width).toBe(DEFAULT_FREE_TEXT_SIZE_PTS.width);
    expect(decision.screenRect.height).toBe(DEFAULT_FREE_TEXT_SIZE_PTS.height);
    expect(decision.screenRect.width).toBe(144);
    expect(decision.screenRect.height).toBe(32);
    // Anchored at the click point.
    expect(decision.screenRect.x).toBe(100);
    expect(decision.screenRect.y).toBe(200);
  });

  it('treats a sub-threshold drag as a click for the text tool', () => {
    const decision = computeAnnotationCommit({
      activeTool: 'text',
      // 3-px nudge — below CLICK_THRESHOLD_PX (4) on both axes.
      draft: { startX: 50, startY: 60, currentX: 53, currentY: 63 },
      page: PAGE,
      viewport: VIEWPORT_1X,
    });
    expect(decision.kind).toBe('commit');
    if (decision.kind !== 'commit') return;
    expect(decision.subtype).toBe('FreeText');
    expect(decision.screenRect.width).toBe(DEFAULT_FREE_TEXT_SIZE_PTS.width);
    expect(decision.screenRect.height).toBe(DEFAULT_FREE_TEXT_SIZE_PTS.height);
  });

  it('scales the seeded screen rect by the current zoom (defaults are in PDF points)', () => {
    const decision = computeAnnotationCommit({
      activeTool: 'text',
      draft: clickAt(100, 200),
      page: PAGE,
      viewport: VIEWPORT_2X,
    });
    expect(decision.kind).toBe('commit');
    if (decision.kind !== 'commit') return;
    // Screen-space rect at 2× zoom is twice the 144×32 PDF default so that
    // screenRectToPdf produces the intended 144×32 PDF rect.
    expect(decision.screenRect.width).toBe(DEFAULT_FREE_TEXT_SIZE_PTS.width * 2);
    expect(decision.screenRect.height).toBe(DEFAULT_FREE_TEXT_SIZE_PTS.height * 2);
  });
});

describe('computeAnnotationCommit — text-selection tools stay drag-only (Phase 3.1 deferred)', () => {
  // This block is the "pin the deferred behavior" guard the brief calls out:
  // a future agent must NOT extend click-to-place to highlight / underline /
  // strikeout without first solving text-aware selection (Phase 8).
  const TEXT_SELECTION_TOOLS = ['highlight', 'underline', 'strikeout'] as const;

  for (const tool of TEXT_SELECTION_TOOLS) {
    it(`returns kind:cancel for a single click with the ${tool} tool`, () => {
      const decision = computeAnnotationCommit({
        activeTool: tool,
        draft: clickAt(100, 200),
        page: PAGE,
        viewport: VIEWPORT_1X,
      });
      expect(decision.kind).toBe('cancel');
    });

    it(`returns kind:cancel for a sub-threshold drag with the ${tool} tool`, () => {
      const decision = computeAnnotationCommit({
        activeTool: tool,
        draft: { startX: 100, startY: 200, currentX: 102, currentY: 202 },
        page: PAGE,
        viewport: VIEWPORT_1X,
      });
      expect(decision.kind).toBe('cancel');
    });
  }

  it('returns kind:cancel for a single click with the ink tool (strokes have no single-point form)', () => {
    const decision = computeAnnotationCommit({
      activeTool: 'ink',
      draft: clickAt(50, 60),
      page: PAGE,
      viewport: VIEWPORT_1X,
    });
    expect(decision.kind).toBe('cancel');
  });
});

describe('computeAnnotationCommit — drag path (happy case unchanged)', () => {
  it('commits a Highlight subtype when dragging with the highlight tool', () => {
    const decision = computeAnnotationCommit({
      activeTool: 'highlight',
      draft: { startX: 100, startY: 200, currentX: 300, currentY: 220 },
      page: PAGE,
      viewport: VIEWPORT_1X,
    });
    expect(decision.kind).toBe('commit');
    if (decision.kind !== 'commit') return;
    expect(decision.subtype).toBe('Highlight');
    expect(decision.screenRect).toEqual({ x: 100, y: 200, width: 200, height: 20 });
    // Drag-committed Highlights don't get a contents string.
    expect(decision.contents).toBeUndefined();
  });

  it('commits a FreeText subtype when dragging with the text tool', () => {
    const decision = computeAnnotationCommit({
      activeTool: 'text',
      draft: { startX: 10, startY: 20, currentX: 110, currentY: 60 },
      page: PAGE,
      viewport: VIEWPORT_1X,
    });
    expect(decision.kind).toBe('commit');
    if (decision.kind !== 'commit') return;
    expect(decision.subtype).toBe('FreeText');
    expect(decision.screenRect).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(decision.contents).toBe('');
  });

  it('uses the drag rect when the drag meets the threshold on both axes', () => {
    const w = CLICK_THRESHOLD_PX + 8;
    const h = CLICK_THRESHOLD_PX + 8;
    const decision = computeAnnotationCommit({
      activeTool: 'text',
      draft: { startX: 0, startY: 0, currentX: w, currentY: h },
      page: PAGE,
      viewport: VIEWPORT_1X,
    });
    expect(decision.kind).toBe('commit');
    if (decision.kind !== 'commit') return;
    expect(decision.screenRect.width).toBe(w);
    expect(decision.screenRect.height).toBe(h);
  });
});
