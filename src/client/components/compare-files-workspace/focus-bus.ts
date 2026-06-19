// Tiny pub/sub used by the badge column to tell the main panes to scroll
// to a specific pair index. Avoids threading a callback through every
// virtualized row — and keeps the Redux store free of transient UI state.

type Listener = (pairIndex: number) => void;

class FocusBus {
  private listeners: Set<Listener> = new Set();
  publish(pairIndex: number): void {
    for (const l of this.listeners) l(pairIndex);
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
}

export const focusedPairIndexAtomBus = new FocusBus();
