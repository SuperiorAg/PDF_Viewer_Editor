// use-signature-canvas — Phase 4 drawn-signature capture.
// Per docs/ui-spec.md §13.3 and architecture-phase-4.md §2.3.
//
// Wires pointer events on a canvas into a stroke buffer and exports a PNG
// blob via canvas.toBlob. Uses a simple quadratic-smoothing pass for natural
// strokes; pressure handling falls back to a constant when PointerEvent
// doesn't expose `pressure` (mouse / synthesized events).
//
// The hook is intentionally framework-light — no Redux interaction; the
// component that uses it owns the captured PNG bytes and dispatches them.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface SignatureCanvasController {
  /** Attach this ref to the <canvas> element. */
  canvasRef: React.RefObject<HTMLCanvasElement>;
  /** True when the user has drawn at least one stroke. */
  hasContent: boolean;
  /** Clear the canvas. */
  clear: () => void;
  /** Export current canvas as a PNG Uint8Array + dimensions. */
  exportPng: () => Promise<{ pngBytes: Uint8Array; widthPx: number; heightPx: number } | null>;
}

interface Point {
  x: number;
  y: number;
  pressure: number;
}

export function useSignatureCanvas(opts?: {
  strokeColor?: string;
  baseLineWidth?: number;
  smoothing?: 'low' | 'medium' | 'high';
}): SignatureCanvasController {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<boolean>(false);
  const strokeRef = useRef<Point[]>([]);
  const [hasContent, setHasContent] = useState(false);

  const strokeColor = opts?.strokeColor ?? '#111111';
  const baseLineWidth = opts?.baseLineWidth ?? 2;
  const smoothing = opts?.smoothing ?? 'medium';

  const getCtx = (): CanvasRenderingContext2D | null => {
    const c = canvasRef.current;
    if (!c) return null;
    return c.getContext('2d');
  };

  const clear = useCallback(() => {
    const ctx = getCtx();
    const c = canvasRef.current;
    if (!ctx || !c) return;
    ctx.clearRect(0, 0, c.width, c.height);
    strokeRef.current = [];
    setHasContent(false);
  }, []);

  // Quadratic-curve smoothing: each segment uses the previous point as
  // a control between current and next-current.
  const drawStrokeSegment = useCallback(
    (a: Point, b: Point): void => {
      const ctx = getCtx();
      if (!ctx) return;
      const pressure = (a.pressure + b.pressure) / 2;
      const width = baseLineWidth * (0.5 + pressure);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (smoothing === 'low') {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      } else {
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(a.x, a.y, midX, midY);
      }
      ctx.stroke();
    },
    [baseLineWidth, smoothing, strokeColor],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const localCoords = (e: PointerEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        // PointerEvent.pressure default is 0.5 for mouse; 0..1 for pen.
        pressure: e.pressure || 0.5,
      };
    };

    const onPointerDown = (e: PointerEvent): void => {
      // Only react to primary button / touch / pen.
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      drawingRef.current = true;
      const pt = localCoords(e);
      strokeRef.current = [pt];
      if (!hasContent) setHasContent(true);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // jsdom may not implement pointer capture; safe to ignore.
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (!drawingRef.current) return;
      const pt = localCoords(e);
      const last = strokeRef.current[strokeRef.current.length - 1];
      strokeRef.current.push(pt);
      if (last) drawStrokeSegment(last, pt);
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, [drawStrokeSegment, hasContent]);

  const exportPng = useCallback(async (): Promise<{
    pngBytes: Uint8Array;
    widthPx: number;
    heightPx: number;
  } | null> => {
    const c = canvasRef.current;
    if (!c) return null;
    // Use toBlob for efficient binary encoding; fall back to toDataURL when
    // the test environment lacks toBlob.
    if (typeof c.toBlob === 'function') {
      const blob: Blob | null = await new Promise((resolve) => {
        c.toBlob((b) => resolve(b), 'image/png');
      });
      if (!blob) return null;
      const ab = await blob.arrayBuffer();
      return {
        pngBytes: new Uint8Array(ab),
        widthPx: c.width,
        heightPx: c.height,
      };
    }
    // Fallback: data URL -> bytes
    const dataUrl = c.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1] ?? '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { pngBytes: bytes, widthPx: c.width, heightPx: c.height };
  }, []);

  return { canvasRef, hasContent, clear, exportPng };
}
