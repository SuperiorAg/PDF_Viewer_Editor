// Tests for pdf:embedImage handler — Phase 2 (Wave 7, David).

import { describe, expect, it } from 'vitest';

import { encodePngRgbaForTest } from '../../main/pdf-ops/tiff-decoder.js';
import type { PdfEmbedImageRequest } from '../contracts.js';

import { handlePdfEmbedImage } from './pdf-embed-image.js';
import { expectErr, expectOk } from './test-support.js';

function makePng(width = 2, height = 2): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 100;
    rgba[i + 1] = 100;
    rgba[i + 2] = 100;
    rgba[i + 3] = 255;
  }
  return encodePngRgbaForTest(rgba, width, height);
}

const PNG_1X1 = makePng(1, 1);

function deps() {
  return { hasHandle: (_h: number) => true };
}

describe('pdf:embedImage handler', () => {
  it('rejects non-integer handle', async () => {
    const r = await handlePdfEmbedImage(
      {
        handle: 'bad' as unknown as number,
        image: { bytes: PNG_1X1, mimeType: 'image/png', width: 1, height: 1 },
        placement: { kind: 'new-page', atIndex: 0 },
      },
      deps(),
    );
    expectErr(r, 'invalid_payload');
  });

  it('rejects unknown handle', async () => {
    const r = await handlePdfEmbedImage(
      {
        handle: 99,
        image: { bytes: PNG_1X1, mimeType: 'image/png', width: 1, height: 1 },
        placement: { kind: 'new-page', atIndex: 0 },
      },
      { hasHandle: () => false },
    );
    expectErr(r, 'handle_not_found');
  });

  it('rejects empty image bytes', async () => {
    const r = await handlePdfEmbedImage(
      {
        handle: 1,
        image: { bytes: new Uint8Array(), mimeType: 'image/png', width: 1, height: 1 },
        placement: { kind: 'new-page', atIndex: 0 },
      },
      deps(),
    );
    expectErr(r, 'invalid_payload');
  });

  it('rejects too-large image bytes', async () => {
    const big = new Uint8Array(60 * 1024 * 1024);
    big[0] = 0x89;
    big[1] = 0x50;
    big[2] = 0x4e;
    big[3] = 0x47;
    const r = await handlePdfEmbedImage(
      {
        handle: 1,
        image: { bytes: big, mimeType: 'image/png', width: 1, height: 1 },
        placement: { kind: 'new-page', atIndex: 0 },
      },
      deps(),
    );
    expectErr(r, 'invalid_payload');
  });

  it('builds an image-insert op for new-page placement', async () => {
    const req: PdfEmbedImageRequest = {
      handle: 1,
      image: { bytes: PNG_1X1, mimeType: 'image/png', width: 1, height: 1 },
      placement: { kind: 'new-page', atIndex: 0 },
    };
    const res = await handlePdfEmbedImage(req, deps());
    const value = expectOk(res);
    expect(value.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(value.op.kind).toBe('image-insert');
    if (value.op.kind === 'image-insert') {
      expect(value.op.atIndex).toBe(0);
      expect(value.op.image.contentHash).toBe(value.contentHash);
    }
  });

  it('builds an image-overlay op for overlay placement', async () => {
    const req: PdfEmbedImageRequest = {
      handle: 1,
      image: { bytes: PNG_1X1, mimeType: 'image/png', width: 1, height: 1 },
      placement: {
        kind: 'overlay',
        pageIndex: 0,
        rect: { x: 100, y: 100, width: 200, height: 100 },
      },
    };
    const res = await handlePdfEmbedImage(req, deps());
    const value = expectOk(res);
    expect(value.op.kind).toBe('image-overlay');
    if (value.op.kind === 'image-overlay') {
      expect(value.op.pageIndex).toBe(0);
      expect(value.op.rect.width).toBe(200);
      expect(value.op.overlayId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('honors a supplied overlayId', async () => {
    const fixed = '11111111-2222-3333-4444-555555555555';
    const req: PdfEmbedImageRequest = {
      handle: 1,
      image: { bytes: PNG_1X1, mimeType: 'image/png', width: 1, height: 1 },
      placement: {
        kind: 'overlay',
        pageIndex: 1,
        rect: { x: 0, y: 0, width: 100, height: 100 },
        overlayId: fixed,
      },
    };
    const res = await handlePdfEmbedImage(req, deps());
    const value = expectOk(res);
    if (value.op.kind === 'image-overlay') {
      expect(value.op.overlayId).toBe(fixed);
    }
  });

  it('rejects invalid placement.rect (negative width)', async () => {
    const r = await handlePdfEmbedImage(
      {
        handle: 1,
        image: { bytes: PNG_1X1, mimeType: 'image/png', width: 1, height: 1 },
        placement: { kind: 'overlay', pageIndex: 0, rect: { x: 0, y: 0, width: -1, height: 100 } },
      },
      deps(),
    );
    expectErr(r, 'invalid_payload');
  });
});
