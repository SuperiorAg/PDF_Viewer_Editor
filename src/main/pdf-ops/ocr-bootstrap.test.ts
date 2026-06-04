// @vitest-environment node
//
// createNodeHttpsStreamer regression tests (David, 2026-06-02 — audit fold-in).
//
// Guards two CRITICAL main-process-crash bugs identified by the bug-pattern audit:
//
//   1. Missing `res.on('error', reject)` inside the response callback. TLS
//      truncation / mid-stream ECONNRESET emits 'error' on the response stream;
//      without a listener Node crashes the main process.
//   2. `writeStream.on('error', ...)` and `writeStream.on('finish', ...)` were
//      attached inside the response callback (AFTER `nodeHttps.get` returned).
//      If `createWriteStream` synchronously emits 'error' (read-only path,
//      EACCES, ENOSPC) before the response arrives, the unhandled emit crashes
//      main.
//
// Both bugs are now fixed by (a) hoisting `writeStream` listeners ahead of
// `nodeHttps.get` and (b) wiring `res.on('error', reject)` first inside the
// response callback. These tests prove the fixes via tiny EventEmitter stubs.
//
// 2026-06-04 (David, v0.7.13): rasterize-failure diagnostic-log tests appended
// below. They drive the diagnostic capture seams (`__test`) exposed by
// ocr-bootstrap and prove (a) a failure writes a JSON file under userData/logs/,
// (b) the rethrown message contains the log path, (c) a writeFileSync throw is
// swallowed so the original error still surfaces.

import { EventEmitter } from 'node:events';
import type * as NodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted stubs the mocks below close over. Each test re-assigns before
// invoking the streamer.
const mocks = vi.hoisted(() => ({
  httpsGet: vi.fn(),
  createWriteStream: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  appGetPath: vi.fn(() => nodePath.join(nodeOs.tmpdir(), 'pdfve-test-userdata')),
}));

vi.mock('node:https', () => ({
  default: { get: mocks.httpsGet },
  get: mocks.httpsGet,
}));

vi.mock('node:fs', async () => {
  const real = await vi.importActual<typeof NodeFs>('node:fs');
  return {
    ...real,
    createWriteStream: mocks.createWriteStream,
    // The diagnostic-log tests below spy on these. Real fs is used by other
    // call sites in the module under test (none of them hit during these
    // specs), so defaulting the spies to a real-passthrough keeps things
    // simple.
    mkdirSync: mocks.mkdirSync,
    writeFileSync: mocks.writeFileSync,
  };
});

// Mock `electron` so `app.getPath('userData')` returns a temp dir — the
// real electron binding is a path string under raw node and would throw
// when destructured for `app.getPath`. The streamer tests above never
// touched electron, so this mock is additive and safe.
vi.mock('electron', () => ({
  app: {
    getPath: mocks.appGetPath,
  },
}));

// Imported AFTER the mocks so the module captures the stubbed bindings.
const { createNodeHttpsStreamer, __test } = await import('./ocr-bootstrap.js');

interface FakeWriteStream extends EventEmitter {
  close: ReturnType<typeof vi.fn>;
}
interface FakeResponse extends EventEmitter {
  headers: Record<string, string>;
  pipe: ReturnType<typeof vi.fn>;
}
interface FakeRequest extends EventEmitter {
  destroy: ReturnType<typeof vi.fn>;
}

function makeWriteStream(): FakeWriteStream {
  const ws = new EventEmitter() as FakeWriteStream;
  ws.close = vi.fn();
  return ws;
}
function makeResponse(headers: Record<string, string> = {}): FakeResponse {
  const res = new EventEmitter() as FakeResponse;
  res.headers = headers;
  res.pipe = vi.fn();
  return res;
}
function makeRequest(): FakeRequest {
  const req = new EventEmitter() as FakeRequest;
  req.destroy = vi.fn();
  return req;
}

describe('createNodeHttpsStreamer — main-process-crash regressions', () => {
  beforeEach(() => {
    mocks.httpsGet.mockReset();
    mocks.createWriteStream.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects (does not crash) when `res` emits "error" mid-stream — TLS truncation / ECONNRESET', async () => {
    const ws = makeWriteStream();
    const res = makeResponse({ 'content-length': '100' });
    const req = makeRequest();
    mocks.createWriteStream.mockReturnValue(ws);
    mocks.httpsGet.mockImplementation((_url, _opts, cb: (r: FakeResponse) => void) => {
      // Defer the callback to a microtask so the streamer has time to wire
      // listeners before we emit.
      queueMicrotask(() => {
        cb(res);
        // Emit AFTER the streamer's res handler ran, simulating a TLS truncation.
        queueMicrotask(() => res.emit('error', new Error('ECONNRESET')));
      });
      return req;
    });

    const streamer = createNodeHttpsStreamer();
    const ctrl = new AbortController();
    await expect(
      streamer.download(
        'https://example.test/pack.bin',
        '/tmp/pack.bin',
        () => undefined,
        ctrl.signal,
      ),
    ).rejects.toThrow(/ECONNRESET/);
  });

  it('rejects (does not crash) when `writeStream` synchronously emits "error" BEFORE the response arrives — EACCES on dest path', async () => {
    const ws = makeWriteStream();
    const req = makeRequest();
    mocks.createWriteStream.mockReturnValue(ws);
    // Simulate `nodeHttps.get` returning a request that never fires its
    // response callback — only `writeStream` emits, and it emits before any
    // response would have been delivered.
    mocks.httpsGet.mockImplementation(() => {
      // The streamer wires writeStream listeners BEFORE calling httpsGet (after
      // the fix); the synchronous emit below must therefore be captured.
      queueMicrotask(() => ws.emit('error', new Error('EACCES: read-only filesystem')));
      return req;
    });

    const streamer = createNodeHttpsStreamer();
    const ctrl = new AbortController();
    await expect(
      streamer.download(
        'https://example.test/pack.bin',
        '/readonly/pack.bin',
        () => undefined,
        ctrl.signal,
      ),
    ).rejects.toThrow(/EACCES/);
  });

  it('resolves with bytesDownloaded when the happy path completes (writeStream finish event)', async () => {
    const ws = makeWriteStream();
    const res = makeResponse({ 'content-length': '6' });
    const req = makeRequest();
    mocks.createWriteStream.mockReturnValue(ws);
    mocks.httpsGet.mockImplementation((_url, _opts, cb: (r: FakeResponse) => void) => {
      queueMicrotask(() => {
        cb(res);
        queueMicrotask(() => {
          res.emit('data', Buffer.from('abc'));
          res.emit('data', Buffer.from('def'));
          // Real fs writeStream emits 'finish' when end() is called; here we
          // emit it directly to short-circuit the test.
          ws.emit('finish');
        });
      });
      return req;
    });

    const streamer = createNodeHttpsStreamer();
    const ctrl = new AbortController();
    await expect(
      streamer.download(
        'https://example.test/pack.bin',
        '/tmp/pack.bin',
        () => undefined,
        ctrl.signal,
      ),
    ).resolves.toBe(6);
  });

  it('rejects fast when AbortSignal is already aborted', async () => {
    const streamer = createNodeHttpsStreamer();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      streamer.download(
        'https://example.test/pack.bin',
        '/tmp/pack.bin',
        () => undefined,
        ctrl.signal,
      ),
    ).rejects.toThrow(/Abort/);
    expect(mocks.httpsGet).not.toHaveBeenCalled();
    expect(mocks.createWriteStream).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Rasterize-failure diagnostic capture (David, 2026-06-04 — v0.7.13)
//
// We exercise the diagnostic capture via the `__test` seam exposed by
// ocr-bootstrap. Driving the full rasterizePageProd path would require
// mocking pdfjs (dynamic-imported via a runtime-concatenated specifier vi.mock
// can't intercept) AND the native @napi-rs/canvas binding (often ABI-mismatched
// in the test runner). The seam lets us prove the diagnostic record builder +
// log writer behave correctly in isolation; the full happy-path render is
// covered by `ocr-bootstrap.prod-render.test.ts`.
// ============================================================================

describe('writeDiagnosticLog — rasterize-failure capture', () => {
  beforeEach(() => {
    mocks.mkdirSync.mockReset();
    mocks.writeFileSync.mockReset();
    mocks.appGetPath.mockReset();
    mocks.appGetPath.mockImplementation(() =>
      nodePath.join(nodeOs.tmpdir(), 'pdfve-test-userdata'),
    );
    __test.resetCanvasLoadSnapshotGuard();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('writes a JSON file under userData/logs/ when render fails AND returns the absolute log path', () => {
    mocks.mkdirSync.mockImplementation(() => undefined);
    mocks.writeFileSync.mockImplementation(() => undefined);

    const record = __test.buildDiagnosticRecord({
      kind: 'rasterize-failure',
      error: new Error('Value is none of these types `String`, `Path`'),
      pdfBytesLength: 12345,
      pageIndex: 0,
      dpi: 300,
      scale: 300 / 72,
      canvasWidth: 800,
      canvasHeight: 1100,
    });

    const logPath = __test.writeDiagnosticLog('ocr-rasterize-9999.json', record);

    expect(logPath).not.toBeNull();
    const expectedDir = nodePath.join(nodeOs.tmpdir(), 'pdfve-test-userdata', 'logs');
    expect(logPath).toBe(nodePath.join(expectedDir, 'ocr-rasterize-9999.json'));

    // mkdirSync was called with the logs dir + recursive option BEFORE the write.
    expect(mocks.mkdirSync).toHaveBeenCalledTimes(1);
    expect(mocks.mkdirSync).toHaveBeenCalledWith(expectedDir, { recursive: true });

    // writeFileSync got the absolute path + JSON-stringified record.
    expect(mocks.writeFileSync).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenBody, encoding] = mocks.writeFileSync.mock.calls[0]!;
    expect(writtenPath).toBe(logPath);
    expect(encoding).toBe('utf8');
    const parsed = JSON.parse(writtenBody as string) as Record<string, unknown>;
    expect(parsed['kind']).toBe('rasterize-failure');
    expect(parsed['pdfBytes_length']).toBe(12345);
    expect(parsed['pageIndex']).toBe(0);
    expect(parsed['dpi']).toBe(300);
    expect(parsed['canvasWidth']).toBe(800);
    expect(parsed['canvasHeight']).toBe(1100);
    // Error fields carry the original message, name, stack.
    const err = parsed['error'] as Record<string, unknown>;
    expect(err['name']).toBe('Error');
    expect(err['message']).toContain('Value is none of these types');
    // Runtime fields are present (smoke check — no fixed values to assert).
    expect(typeof parsed['node_version']).toBe('string');
    expect(typeof parsed['platform']).toBe('string');
    expect(typeof parsed['arch']).toBe('string');
  });

  it('returns null (not throws) when writeFileSync throws — logging failure must never mask the real bug', () => {
    mocks.mkdirSync.mockImplementation(() => undefined);
    mocks.writeFileSync.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    // Silence the console.error the helper emits on log-write failure so the
    // test output stays clean.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const record = __test.buildDiagnosticRecord({
      kind: 'rasterize-failure',
      error: new Error('original render failure'),
      pdfBytesLength: 1,
      pageIndex: 0,
      dpi: 300,
      scale: 4,
      canvasWidth: 10,
      canvasHeight: 10,
    });

    const logPath = __test.writeDiagnosticLog('ocr-rasterize-1.json', record);
    expect(logPath).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('returns null when electron.app.getPath throws (test/non-Electron context safety)', () => {
    mocks.appGetPath.mockImplementation(() => {
      throw new Error('app not initialized');
    });
    mocks.mkdirSync.mockImplementation(() => undefined);
    mocks.writeFileSync.mockImplementation(() => undefined);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const record = __test.buildDiagnosticRecord({
      kind: 'rasterize-failure',
      error: new Error('x'),
      pdfBytesLength: 1,
      pageIndex: 0,
      dpi: 72,
      scale: 1,
      canvasWidth: 1,
      canvasHeight: 1,
    });

    expect(__test.writeDiagnosticLog('foo.json', record)).toBeNull();
    expect(mocks.mkdirSync).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('captures Error.cause + .code + .stack into the diagnostic record', () => {
    const inner = new Error('inner native binding rejected');
    const outer = new Error('Value is none of these types `String`, `Path`') as Error & {
      code?: string;
      cause?: unknown;
    };
    outer.code = 'ERR_NAPI_VALUE_REJECTED';
    outer.cause = inner;

    const record = __test.buildDiagnosticRecord({
      kind: 'rasterize-failure',
      error: outer,
      pdfBytesLength: 2048,
      pageIndex: 3,
      dpi: 300,
      scale: 300 / 72,
      canvasWidth: 612,
      canvasHeight: 792,
    });

    expect(record.error).not.toBeNull();
    expect(record.error!.name).toBe('Error');
    expect(record.error!.message).toContain('String');
    expect(record.error!.stack).toMatch(/Error/); // stack is non-empty
    expect(record.error!.code).toBe('ERR_NAPI_VALUE_REJECTED');
    expect(record.error!.cause).toBe('Error: inner native binding rejected');
  });
});

describe('writeCanvasLoadSnapshot — one-time canvas-load fingerprint', () => {
  beforeEach(() => {
    mocks.mkdirSync.mockReset();
    mocks.writeFileSync.mockReset();
    mocks.appGetPath.mockReset();
    mocks.appGetPath.mockImplementation(() =>
      nodePath.join(nodeOs.tmpdir(), 'pdfve-test-userdata'),
    );
    mocks.mkdirSync.mockImplementation(() => undefined);
    mocks.writeFileSync.mockImplementation(() => undefined);
    __test.resetCanvasLoadSnapshotGuard();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('writes canvas-load.json exactly once per process (guarded by module-scope flag)', () => {
    expect(__test.isCanvasLoadSnapshotWritten()).toBe(false);
    __test.writeCanvasLoadSnapshot('@napi-rs/canvas');
    expect(__test.isCanvasLoadSnapshotWritten()).toBe(true);
    expect(mocks.writeFileSync).toHaveBeenCalledTimes(1);

    const [writtenPath, writtenBody] = mocks.writeFileSync.mock.calls[0]!;
    expect(writtenPath).toBe(
      nodePath.join(nodeOs.tmpdir(), 'pdfve-test-userdata', 'logs', 'canvas-load.json'),
    );
    const parsed = JSON.parse(writtenBody as string) as Record<string, unknown>;
    expect(parsed['kind']).toBe('canvas-load');
    expect(parsed['canvas_module']).toBe('@napi-rs/canvas');
    expect(parsed['error']).toBeNull();

    // Second call is a no-op — write count stays at 1.
    __test.writeCanvasLoadSnapshot('@napi-rs/canvas');
    expect(mocks.writeFileSync).toHaveBeenCalledTimes(1);
  });
});

describe('readPngDimensions — IHDR header parsing', () => {
  // tesseract.js v7 dropped imageWidth/imageHeight from the result. We read
  // PNG dimensions from the rasterizer output bytes ourselves; the OCR
  // composer needs both to map recognized-word pixel rects back to PDF user
  // space. This test pins the parser against the PNG spec's IHDR layout.

  function makePngBytes(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(24);
    // 8-byte PNG signature.
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    // 4-byte IHDR length (always 13). We don't care about the value for the
    // reader test, but populate it to mirror real bytes.
    bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
    // 4-byte IHDR type "IHDR".
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    // 4-byte big-endian width at [16..19].
    bytes[16] = (width >>> 24) & 0xff;
    bytes[17] = (width >>> 16) & 0xff;
    bytes[18] = (width >>> 8) & 0xff;
    bytes[19] = width & 0xff;
    // 4-byte big-endian height at [20..23].
    bytes[20] = (height >>> 24) & 0xff;
    bytes[21] = (height >>> 16) & 0xff;
    bytes[22] = (height >>> 8) & 0xff;
    bytes[23] = height & 0xff;
    return bytes;
  }

  it('reads width/height for a typical OCR raster (3301×2550 at 300dpi)', () => {
    const png = makePngBytes(3301, 2550);
    const dims = __test.readPngDimensions(png);
    expect(dims).toEqual({ widthPx: 3301, heightPx: 2550 });
  });

  it('reads width/height for a small page (200×200 at 72dpi)', () => {
    const png = makePngBytes(200, 200);
    expect(__test.readPngDimensions(png)).toEqual({ widthPx: 200, heightPx: 200 });
  });

  it('returns null for bytes shorter than 24 bytes', () => {
    expect(__test.readPngDimensions(new Uint8Array(8))).toBeNull();
    expect(__test.readPngDimensions(new Uint8Array(0))).toBeNull();
  });

  it('returns null for bytes without the PNG magic prefix', () => {
    const notPng = new Uint8Array(32);
    notPng.set([0xff, 0xd8, 0xff, 0xe0], 0); // JPEG magic
    expect(__test.readPngDimensions(notPng)).toBeNull();
  });
});
