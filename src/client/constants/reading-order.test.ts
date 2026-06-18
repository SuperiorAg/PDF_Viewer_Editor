// Reading-order honesty-warning constant — drift-detection test.
// Phase 7.5 Wave 5d follow-up (Riley).
//
// The renderer's READING_ORDER_RECOMPUTE_NO_EXTRACTOR_WARNING must equal the
// raw warning string David's reading-order engine emits. This test reads the
// engine source FILE TEXT (NOT the module — main-process modules are not
// importable from a renderer-targeted vitest config) and greps for the
// exact literal. If David rewords the warning on his side, this test fails
// and Riley updates the mirror — that is exactly the coordination signal
// the brief asked for.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { READING_ORDER_RECOMPUTE_NO_EXTRACTOR_WARNING } from './reading-order';

describe('READING_ORDER_RECOMPUTE_NO_EXTRACTOR_WARNING (Riley ↔ David drift gate)', () => {
  it('has the verbatim no-extractor-wired token', () => {
    // Static contract — protects against an accidental string-edit on the
    // renderer side that would silently break the overlay banner.
    expect(READING_ORDER_RECOMPUTE_NO_EXTRACTOR_WARNING).toBe(
      'reading-order.recompute.no-extractor-wired',
    );
  });

  it("matches David's engine source literal verbatim", () => {
    // Resolve from this test file's directory up to repo root, then into
    // src/main. Avoids hard-coding an absolute path.
    const enginePath = join(__dirname, '..', '..', 'main', 'pdf-ops', 'reading-order-engine.ts');
    const engineSrc = readFileSync(enginePath, 'utf8');
    expect(
      engineSrc,
      `engine source ${enginePath} must contain the renderer mirror constant verbatim`,
    ).toContain(READING_ORDER_RECOMPUTE_NO_EXTRACTOR_WARNING);
  });
});
