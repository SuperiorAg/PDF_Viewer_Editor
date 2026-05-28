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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // any: jsdom is missing the global; tests don't exercise its callback path.
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
