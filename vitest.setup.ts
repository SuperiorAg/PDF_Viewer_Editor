// Vitest global setup. Loaded by both renderer and main-process specs.
//
// Most of this is renderer (jsdom) shimming. Main-process tests use
// `// @vitest-environment node` per-file and do not exercise these shims.

import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement IntersectionObserver; provide a no-op stub so
// Riley's components that observe scroll containers don't blow up in tests.
class IntersectionObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  root: Element | Document | null = null;
  rootMargin = '';
  thresholds: ReadonlyArray<number> = [];
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  // any: jsdom is missing the global; tests don't exercise its callback path.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).IntersectionObserver = IntersectionObserverMock;
}

// jsdom also lacks ResizeObserver. Stub similarly.
class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = ResizeObserverMock;
}

// jsdom lacks matchMedia. Provide a noop "no match" implementation so any
// CSS-feature-detection code in the renderer doesn't crash.
if (typeof globalThis.matchMedia === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

// jsdom ships a Canvas element but no 2D backend — `getContext('2d')` throws
// "Not implemented: HTMLCanvasElement.prototype.getContext (without installing
// the canvas npm package)". The renderer's pdf.js wrapper (pdf-render.ts)
// creates an OFFSCREEN canvas internally and asks IT for a 2D context, so a
// per-test stub on the visible canvas instance never covers that path. Install
// a minimal no-op CanvasRenderingContext2D on the PROTOTYPE so every canvas —
// visible or offscreen — gets a non-null 2D context. The methods are no-ops;
// the tests assert wrapper behavior (dimensions, job lifecycle), not pixels.
//
// Individual specs that need to assert against canvas calls (e.g.
// use-signature-canvas.test.ts) still override getContext with their own
// spies in beforeEach; that override shadows this default and is unaffected.
if (typeof HTMLCanvasElement !== 'undefined') {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (contextId: string) => unknown;
  };
  // Only install when jsdom hasn't provided a working backend (it never does
  // without the `canvas` npm package). We replace unconditionally because the
  // default jsdom implementation throws rather than returning null.
  proto.getContext = function getContext2dStub(contextId: string) {
    if (contextId !== '2d') return null;
    return {
      canvas: this,
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      globalAlpha: 1,
      font: '10px sans-serif',
      fillRect: () => undefined,
      clearRect: () => undefined,
      strokeRect: () => undefined,
      beginPath: () => undefined,
      closePath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      quadraticCurveTo: () => undefined,
      bezierCurveTo: () => undefined,
      arc: () => undefined,
      rect: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      scale: () => undefined,
      rotate: () => undefined,
      translate: () => undefined,
      transform: () => undefined,
      setTransform: () => undefined,
      resetTransform: () => undefined,
      clip: () => undefined,
      drawImage: () => undefined,
      fillText: () => undefined,
      strokeText: () => undefined,
      measureText: () => ({ width: 0 }),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      createRadialGradient: () => ({ addColorStop: () => undefined }),
      createPattern: () => null,
      getImageData: () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
      putImageData: () => undefined,
      createImageData: () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
      setLineDash: () => undefined,
      getLineDash: () => [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// jsdom's Blob predates the WHATWG Blob.arrayBuffer() / Blob.text() reader
// methods, so `blob.arrayBuffer()` is undefined under jsdom even though it is
// standard in Node 18+ / modern browsers. The signature-canvas hook calls
// `await blob.arrayBuffer()` after `canvas.toBlob(...)`. Polyfill via
// FileReader (which jsdom DOES implement) so the behavioral assertion — the
// exported PNG bytes are non-empty — runs against real bytes.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Blob.prototype as any).arrayBuffer = function arrayBufferPolyfill(): Promise<ArrayBuffer> {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this as unknown as Blob);
    });
  };
}
