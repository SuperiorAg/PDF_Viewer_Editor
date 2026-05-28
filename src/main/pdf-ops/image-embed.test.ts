// Tests for image-embed.ts — Phase 2 (Wave 7, David).

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { ImageEmbedPayload } from '../../ipc/contracts.js';

import {
  ImageCache,
  embedImage,
  computeImageContentHash,
  computeNewPageSize,
  detectImageMimeType,
} from './image-embed.js';
import { encodePngRgbaForTest } from './tiff-decoder.js';

function makePng(width = 2, height = 2): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 200;
    rgba[i + 1] = 100;
    rgba[i + 2] = 50;
    rgba[i + 3] = 255;
  }
  return encodePngRgbaForTest(rgba, width, height);
}

const PNG_1X1 = makePng(1, 1);

describe('image-embed — content hash', () => {
  it('computes a 64-char hex sha256', () => {
    const h = computeImageContentHash(PNG_1X1);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('same bytes -> same hash', () => {
    const h1 = computeImageContentHash(PNG_1X1);
    const h2 = computeImageContentHash(PNG_1X1);
    expect(h1).toBe(h2);
  });

  it('different bytes -> different hash', () => {
    const h1 = computeImageContentHash(PNG_1X1);
    const h2 = computeImageContentHash(new Uint8Array([1, 2, 3]));
    expect(h1).not.toBe(h2);
  });
});

describe('image-embed — embedImage + cache', () => {
  it('embeds a PNG via pdf-lib and caches the result', async () => {
    const doc = await PDFDocument.create();
    const cache = new ImageCache();
    const payload: ImageEmbedPayload = {
      bytes: PNG_1X1,
      mimeType: 'image/png',
      width: 1,
      height: 1,
      contentHash: computeImageContentHash(PNG_1X1),
    };
    const r1 = await embedImage(doc, cache, payload);
    expect(r1.ok).toBe(true);
    expect(cache.size()).toBe(1);

    // Second call with same hash should hit the cache.
    const r2 = await embedImage(doc, cache, payload);
    expect(r2.ok).toBe(true);
    expect(cache.size()).toBe(1);
    if (r1.ok && r2.ok) {
      expect(r1.value.image).toBe(r2.value.image);
    }
  });

  it('rejects an empty image buffer', async () => {
    const doc = await PDFDocument.create();
    const cache = new ImageCache();
    const r = await embedImage(doc, cache, {
      bytes: new Uint8Array(),
      mimeType: 'image/png',
      width: 0,
      height: 0,
      contentHash: 'h',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('invalid_image');
    }
  });

  it('returns image_decode_failed for corrupt PNG bytes', async () => {
    const doc = await PDFDocument.create();
    const cache = new ImageCache();
    const corrupt = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const r = await embedImage(doc, cache, {
      bytes: corrupt,
      mimeType: 'image/png',
      width: 1,
      height: 1,
      contentHash: 'h',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('image_decode_failed');
    }
  });
});

describe('image-embed — computeNewPageSize', () => {
  it('fits a landscape image inside A4 landscape', () => {
    const size = computeNewPageSize(1600, 900);
    // Auto-detected landscape; cap at A4 long edge.
    expect(size.width).toBeLessThanOrEqual(842);
    expect(size.height).toBeLessThanOrEqual(842);
    // Aspect approximately preserved.
    expect(size.width / size.height).toBeCloseTo(1600 / 900, 1);
  });

  it('fits a portrait image inside A4 portrait', () => {
    const size = computeNewPageSize(600, 800);
    expect(size.width).toBeLessThanOrEqual(595);
    expect(size.height).toBeLessThanOrEqual(842);
  });

  it('does not upscale small images', () => {
    const size = computeNewPageSize(100, 100);
    expect(size.width).toBe(100);
    expect(size.height).toBe(100);
  });
});

describe('image-embed — detectImageMimeType', () => {
  it('detects PNG', () => {
    expect(detectImageMimeType(PNG_1X1)).toBe('image/png');
  });
  it('detects JPEG', () => {
    expect(detectImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });
  it('detects TIFF (little-endian)', () => {
    expect(detectImageMimeType(new Uint8Array([0x49, 0x49, 0x2a, 0x00]))).toBe('image/tiff');
  });
  it('returns null for unknown', () => {
    expect(detectImageMimeType(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
