// use-signature-canvas tests.
// Per docs/ui-spec.md §13.3 — drawn signature capture.
//
// jsdom does NOT implement canvas 2d context out-of-the-box; we install a
// minimal stub so the hook's strokes can be recorded. The hook's contract is:
//   (1) pointer events accumulate into a stroke buffer;
//   (2) clear() resets to empty + hasContent goes back to false;
//   (3) exportPng() returns non-empty bytes after at least one stroke.

import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSignatureCanvas } from './use-signature-canvas';

// Stub a minimal CanvasRenderingContext2D for jsdom.
function installCanvasContextStub(): void {
  // Track stroke segments per canvas for assertions if needed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = function () {
    return {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      stroke: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      set strokeStyle(_v: string) {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      set lineWidth(_v: number) {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      set lineCap(_v: string) {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      set lineJoin(_v: string) {},
    };
  };
  // toBlob — return a small synthetic PNG header (8 bytes) for the
  // "non-empty bytes" assertion.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).toBlob = function (cb: (b: Blob) => void) {
    // Synthetic 12-byte payload (PNG-ish; content irrelevant — we just want bytes).
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const blob = new Blob([bytes], { type: 'image/png' });
    setTimeout(() => cb(blob), 0);
  };
  // bounding rect — fixed 200x100 canvas at origin.
  HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect;
  };
  // setPointerCapture / releasePointerCapture stubs (jsdom lacks these).
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  HTMLCanvasElement.prototype.setPointerCapture = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  HTMLCanvasElement.prototype.releasePointerCapture = () => {};
}

function firePointer(
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
): void {
  // PointerEvent doesn't exist by default in jsdom; emulate via MouseEvent
  // with the relevant fields and dispatch under the 'pointer*' type. The hook
  // reads clientX/clientY/pressure/button/pointerType/pointerId.
  const ev = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
  });
  // Attach pointer-y fields.
  Object.assign(ev, {
    pressure: 0.5,
    pointerId: 1,
    pointerType: 'mouse',
  });
  canvas.dispatchEvent(ev);
}

describe('useSignatureCanvas', () => {
  beforeEach(() => {
    installCanvasContextStub();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('initializes with no content and a canvas ref', () => {
    const { result } = renderHook(() => useSignatureCanvas());
    expect(result.current.hasContent).toBe(false);
    expect(result.current.canvasRef.current).toBeNull();
  });

  // The actual pointer-event listening is attached in useEffect to whatever
  // canvas the ref points to at first render. To exercise it, we make a
  // wrapper hook that uses an INITIAL canvas ref so listeners attach.
  it('records pointer events into a stroke buffer; exports non-empty PNG bytes', async () => {
    // Wrap so we can hand the ref a pre-existing canvas.
    function useWith() {
      const ctl = useSignatureCanvas();
      const initialized = useRef(false);
      if (!initialized.current) {
        const c = document.createElement('canvas');
        c.width = 200;
        c.height = 100;
        document.body.appendChild(c);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ctl.canvasRef as React.MutableRefObject<HTMLCanvasElement>).current = c;
        initialized.current = true;
      }
      return ctl;
    }
    const { result, rerender } = renderHook(() => useWith());
    rerender(); // trigger useEffect with the now-populated ref

    const canvas = result.current.canvasRef.current as HTMLCanvasElement;
    expect(canvas).not.toBeNull();

    // Simulate a stroke.
    act(() => {
      firePointer(canvas, 'pointerdown', 20, 30);
      firePointer(canvas, 'pointermove', 40, 40);
      firePointer(canvas, 'pointermove', 60, 50);
      firePointer(canvas, 'pointerup', 60, 50);
    });

    expect(result.current.hasContent).toBe(true);

    const png = await result.current.exportPng();
    expect(png).not.toBeNull();
    expect(png!.pngBytes.length).toBeGreaterThan(0);
    expect(png!.widthPx).toBe(200);
    expect(png!.heightPx).toBe(100);
  });

  it('clear() resets hasContent to false', () => {
    function useWith() {
      const ctl = useSignatureCanvas();
      const initialized = useRef(false);
      if (!initialized.current) {
        const c = document.createElement('canvas');
        c.width = 200;
        c.height = 100;
        document.body.appendChild(c);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ctl.canvasRef as React.MutableRefObject<HTMLCanvasElement>).current = c;
        initialized.current = true;
      }
      return ctl;
    }
    const { result, rerender } = renderHook(() => useWith());
    rerender();
    const canvas = result.current.canvasRef.current as HTMLCanvasElement;

    act(() => {
      firePointer(canvas, 'pointerdown', 10, 20);
      firePointer(canvas, 'pointerup', 10, 20);
    });
    expect(result.current.hasContent).toBe(true);

    act(() => {
      result.current.clear();
    });
    expect(result.current.hasContent).toBe(false);
  });
});
