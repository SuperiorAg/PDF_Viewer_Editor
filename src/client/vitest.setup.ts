// Vitest setup file. Adds testing-library matchers and stubs any browser APIs
// that jsdom doesn't ship.

import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement IntersectionObserver; provide a no-op stub.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// any: minimal shape mock; the components only call .observe / .disconnect.
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
