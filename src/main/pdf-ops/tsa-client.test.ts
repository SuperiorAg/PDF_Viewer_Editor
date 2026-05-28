// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  encodeTimeStampReq,
  parseTimeStampResp,
  requestTimestamp,
  sha256,
  type HttpsRequestFn,
} from './tsa-client.js';

describe('encodeTimeStampReq', () => {
  it('produces a SEQUENCE starting with 0x30', () => {
    const hash = sha256(new Uint8Array([1, 2, 3]));
    const nonce = new Uint8Array(16);
    const enc = encodeTimeStampReq(hash, nonce);
    expect(enc.byteLength).toBeGreaterThan(0);
    expect(enc[0]).toBe(0x30); // SEQUENCE
    // certReq BOOLEAN TRUE — last 3 bytes should be 0x01 0x01 0xff
    expect(enc[enc.byteLength - 3]).toBe(0x01);
    expect(enc[enc.byteLength - 2]).toBe(0x01);
    expect(enc[enc.byteLength - 1]).toBe(0xff);
  });
});

describe('requestTimestamp — failure paths fail loud', () => {
  it('http_error: 500 returns tsa_http_error', async () => {
    const stub: HttpsRequestFn = async () => ({
      statusCode: 500,
      headers: {},
      body: new Uint8Array(0),
    });
    const r = await requestTimestamp({
      tsaUrl: 'https://tsa.example.com',
      hash: sha256(new Uint8Array([1])),
      requestFn: stub,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('tsa_http_error');
  });

  it('timeout: stub throws timeout → tsa_timeout', async () => {
    const stub: HttpsRequestFn = async () => {
      throw new Error('timeout');
    };
    const r = await requestTimestamp({
      tsaUrl: 'https://tsa.example.com',
      hash: sha256(new Uint8Array([1])),
      requestFn: stub,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('tsa_timeout');
  });

  it('tls_error: stub throws TLS-flavored error → tsa_tls_error', async () => {
    const stub: HttpsRequestFn = async () => {
      throw new Error('CERT_HAS_EXPIRED');
    };
    const r = await requestTimestamp({
      tsaUrl: 'https://tsa.example.com',
      hash: sha256(new Uint8Array([1])),
      requestFn: stub,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('tsa_tls_error');
  });

  it('rejects non-https URL', async () => {
    const r = await requestTimestamp({
      tsaUrl: 'http://insecure.example.com',
      hash: sha256(new Uint8Array([1])),
      requestFn: async () => {
        throw new Error('should not be called');
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('tsa_tls_error');
  });

  it('rejects invalid hash length', async () => {
    const r = await requestTimestamp({
      tsaUrl: 'https://tsa.example.com',
      hash: new Uint8Array(8),
      requestFn: async () => {
        throw new Error('not called');
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('tsa_invalid_response');
  });

  it('invalid_response: body is garbage', async () => {
    const stub: HttpsRequestFn = async () => ({
      statusCode: 200,
      headers: {},
      body: new Uint8Array([0xff, 0xff, 0xff, 0xff]),
    });
    const r = await requestTimestamp({
      tsaUrl: 'https://tsa.example.com',
      hash: sha256(new Uint8Array([1])),
      requestFn: stub,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('tsa_invalid_response');
  });
});

describe('parseTimeStampResp — minimal-valid synthetic response', () => {
  it('extracts genTime + serial from a hand-built TSR', () => {
    // Build a minimal TimeStampResp:
    //   SEQ {
    //     PKIStatusInfo SEQ { INTEGER 0 }
    //     ContentInfo SEQ { OID, [0] EXPLICIT { SEQ { ... } } }   ← timeStampToken
    //   }
    // Inside the ContentInfo we put: OID id-ct-TSTInfo + [0] EXPLICIT OCTET STRING (TSTInfo DER)
    // TSTInfo: SEQ { version=1, policy OID, messageImprint SEQ, serialNumber=42,
    //                genTime GENERALIZED TIME }

    // Helpers ------------------------------------------
    const tlv = (tag: number, body: number[]): number[] => {
      const len = body.length;
      if (len < 0x80) return [tag, len, ...body];
      const lenBytes: number[] = [];
      let x = len;
      while (x > 0) {
        lenBytes.unshift(x & 0xff);
        x >>>= 8;
      }
      return [tag, 0x80 | lenBytes.length, ...lenBytes, ...body];
    };
    const seq = (parts: number[][]): number[] => tlv(0x30, parts.flat());
    const int = (n: number): number[] => {
      if (n === 0) return tlv(0x02, [0]);
      const arr: number[] = [];
      let x = n;
      while (x > 0) {
        arr.unshift(x & 0xff);
        x >>>= 8;
      }
      if (arr[0]! & 0x80) arr.unshift(0);
      return tlv(0x02, arr);
    };
    const oid = (bytes: number[]): number[] => tlv(0x06, bytes);
    const octetString = (body: number[]): number[] => tlv(0x04, body);
    const tag0 = (body: number[]): number[] => tlv(0xa0, body); // [0] EXPLICIT
    const generalizedTime = (s: string): number[] => {
      const bytes = Array.from(Buffer.from(s, 'ascii'));
      return tlv(0x18, bytes);
    };

    // id-ct-TSTInfo OID 1.2.840.113549.1.9.16.1.4
    const idCtTSTInfo = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x10, 0x01, 0x04];

    // sha-256 OID 2.16.840.1.101.3.4.2.1
    const sha256Oid = [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01];

    // Pick a known genTime: 2026-05-26 12:00:00 UTC = 20260526120000Z
    const now = Date.UTC(2026, 4, 26, 12, 0, 0); // (note this might be off from system clock)
    const _useNow = now;
    // Use a time within the 5-minute skew window of the test clock:
    const wallNow = new Date(Date.now());
    const gtString =
      `${wallNow.getUTCFullYear()}` +
      `${String(wallNow.getUTCMonth() + 1).padStart(2, '0')}` +
      `${String(wallNow.getUTCDate()).padStart(2, '0')}` +
      `${String(wallNow.getUTCHours()).padStart(2, '0')}` +
      `${String(wallNow.getUTCMinutes()).padStart(2, '0')}` +
      `${String(wallNow.getUTCSeconds()).padStart(2, '0')}Z`;

    // messageImprint: SEQ { AlgId SEQ { OID sha-256 }, OCTET STRING 32-bytes }
    const algId = seq([oid(sha256Oid)]);
    const dummyHash = octetString(new Array(32).fill(0x42));
    const messageImprint = seq([algId, dummyHash]);

    const tstInfo = seq([
      int(1), // version
      oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x10, 0x01, 0x04]), // policy OID (recycled for brevity)
      messageImprint,
      int(42), // serialNumber
      generalizedTime(gtString),
    ]);

    // ContentInfo: SEQ { OID id-ct-TSTInfo, [0] EXPLICIT OCTET STRING(tstInfo) }
    const contentInfo = seq([oid(idCtTSTInfo), tag0(octetString(tstInfo))]);

    // PKIStatusInfo: SEQ { INTEGER 0 }
    const statusInfo = seq([int(0)]);

    // TimeStampResp = SEQ { statusInfo, contentInfo }
    const tsResp = seq([statusInfo, contentInfo]);

    const r = parseTimeStampResp(new Uint8Array(tsResp));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.serialNumber).toBe(42n);
    expect(r.value.genTime).toBeGreaterThan(0);
    // Within 60s of the wall clock we used.
    expect(Math.abs(r.value.genTime - Date.now())).toBeLessThan(60_000);
  });

  it('rejects status=2 (rejected) as tsa_invalid_response', () => {
    // SEQ { SEQ { INTEGER 2 } } — incomplete but enough for the status check
    const buf = new Uint8Array([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x02]);
    const r = parseTimeStampResp(buf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('tsa_invalid_response');
  });
});
