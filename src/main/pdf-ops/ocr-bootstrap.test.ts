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

import { EventEmitter } from 'node:events';
import type * as NodeFs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted stubs the mocks below close over. Each test re-assigns before
// invoking the streamer.
const mocks = vi.hoisted(() => ({
  httpsGet: vi.fn(),
  createWriteStream: vi.fn(),
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
  };
});

// Imported AFTER the mocks so the module captures the stubbed bindings.
const { createNodeHttpsStreamer } = await import('./ocr-bootstrap.js');

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
