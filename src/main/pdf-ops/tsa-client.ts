// Phase 4 (Wave 16, David) — RFC 3161 TSA client.
//
// Contract: docs/signature-engine.md §6; docs/architecture-phase-4.md §4.5.
//
// **Default state: DISABLED (P4-L-2).** This module is a primitive — the
// PAdES engine + Settings "Test TSA URL" affordance are the only callers.
// The default `signatures.tsaEnabled` Setting is `false`; nothing in this
// module decides to call a TSA on its own.
//
// Trust model: the TSA's HTTPS cert is validated against the OS trust store
// (Node.js HTTPS default). No custom CA management in Phase 4.
//
// Implementation: builds + parses TimeStampReq / TimeStampResp ASN.1
// structures. Phase 4 ships the WIRE-LEVEL machinery in this file; the
// actual ASN.1 encoding is delegated to a tiny hand-rolled helper rather
// than pulling pkijs/asn1js (which aren't installed at Wave 16). The hand-
// rolled encoder covers ONLY the TSA Request shape we need; the response
// parser walks the DER structure looking for the embedded TST token.
//
// Failure modes per design §6.3 — every failure is fail-loud (no silent
// degradation to no-TSA).

import { createHash, randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

import { fail, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';

// ============================================================================
// Public surface
// ============================================================================

export interface TsaRequestInput {
  /** HTTPS URL. Caller validates shape (no userinfo, no fragment, etc.). */
  tsaUrl: string;
  /** SHA-256 of the bytes to timestamp (32 bytes). */
  hash: Uint8Array;
  /** Default 30000. */
  timeoutMs?: number;
  /** Optional injected request function for testing. Default: node:https. */
  requestFn?: HttpsRequestFn;
}

export interface TsaResponseOk {
  tsrBytes: Uint8Array;
  tsTokenBytes: Uint8Array;
  genTime: number;
  serialNumber: bigint;
}

export type TsaError =
  | 'tsa_http_error'
  | 'tsa_tls_error'
  | 'tsa_timeout'
  | 'tsa_invalid_response'
  | 'tsa_nonce_mismatch'
  | 'tsa_genTime_skew';

export type TsaResult = Result<TsaResponseOk, TsaError>;

/**
 * Injectable transport for testability — production uses `node:https.request`.
 */
export type HttpsRequestFn = (
  url: URL,
  options: { method: 'POST'; headers: Record<string, string>; timeoutMs: number },
  body: Uint8Array,
) => Promise<{
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
}>;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build a TimeStampReq, POST to the TSA, parse the response, and validate
 * against system clock + nonce.
 */
export async function requestTimestamp(input: TsaRequestInput): Promise<TsaResult> {
  if (!input.hash || input.hash.byteLength !== 32) {
    return fail<TsaError>('tsa_invalid_response', 'hash must be 32 bytes (SHA-256)');
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.tsaUrl);
  } catch {
    return fail<TsaError>('tsa_http_error', 'invalid TSA URL');
  }
  if (parsedUrl.protocol !== 'https:') {
    return fail<TsaError>('tsa_tls_error', 'TSA URL must be https://');
  }

  // Generate a 128-bit nonce; track it for response verification.
  const nonceBytes = randomBytes(16);
  const nonceBig = bytesToBigIntBE(nonceBytes);

  // Build the DER-encoded TimeStampReq.
  const reqBody = encodeTimeStampReq(input.hash, nonceBytes);

  // Perform the request (injected fn for tests OR node:https default).
  const transport = input.requestFn ?? defaultHttpsRequest;
  let response: Awaited<ReturnType<HttpsRequestFn>>;
  try {
    response = await transport(
      parsedUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/timestamp-query',
          'Content-Length': String(reqBody.byteLength),
        },
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
      reqBody,
    );
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (/timeout|ETIMEDOUT/i.test(msg)) return fail<TsaError>('tsa_timeout', msg);
    if (/TLS|ssl|cert|self[-_ ]?signed|CERT_/i.test(msg)) {
      return fail<TsaError>('tsa_tls_error', msg);
    }
    return fail<TsaError>('tsa_http_error', msg);
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    return fail<TsaError>('tsa_http_error', `HTTP ${response.statusCode}`);
  }

  // Parse the TimeStampResp + extract the inner TST token + genTime + nonce.
  const parsed = parseTimeStampResp(response.body);
  if (!parsed.ok) return parsed as Result<never, TsaError>;
  const { tstBytes, genTime, serialNumber, responseNonce } = parsed.value;

  if (responseNonce !== null && responseNonce !== nonceBig) {
    return fail<TsaError>('tsa_nonce_mismatch', 'TSA response nonce did not match request');
  }

  // genTime skew check (R-W15-C).
  if (Math.abs(genTime - Date.now()) > MAX_CLOCK_SKEW_MS) {
    return fail<TsaError>(
      'tsa_genTime_skew',
      `TSA genTime drifts ${Math.round((genTime - Date.now()) / 1000)}s from local clock`,
    );
  }

  return ok({
    tsrBytes: response.body,
    tsTokenBytes: tstBytes,
    genTime,
    serialNumber,
  });
}

// ============================================================================
// HTTPS transport (production)
// ============================================================================

const defaultHttpsRequest: HttpsRequestFn = (url, options, body) => {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: options.method,
        headers: options.headers,
        timeout: options.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
};

// ============================================================================
// ASN.1 DER helpers — hand-rolled for the TSA request + response shapes we need.
// Coverage is limited to the TSA Request structure + walking the Response to
// find the inner TST token. Phase 4.1+ may switch to pkijs once installed.
// ============================================================================

/**
 * Encode a TimeStampReq:
 *   TimeStampReq ::= SEQUENCE {
 *     version INTEGER (1),
 *     messageImprint SEQUENCE {
 *       hashAlgorithm AlgorithmIdentifier { sha-256 },
 *       hashedMessage OCTET STRING
 *     },
 *     nonce INTEGER,
 *     certReq BOOLEAN TRUE
 *   }
 */
export function encodeTimeStampReq(hash: Uint8Array, nonce: Uint8Array): Uint8Array {
  // OID 2.16.840.1.101.3.4.2.1 = SHA-256
  const sha256Oid = new Uint8Array([
    0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
  ]);
  const algId = derSeq([sha256Oid]);
  const hashedMessage = derOctetString(hash);
  const messageImprint = derSeq([algId, hashedMessage]);
  const version = derInt(1);
  const nonceInt = derPosIntFromBytes(nonce);
  const certReq = new Uint8Array([0x01, 0x01, 0xff]); // BOOLEAN TRUE
  return derSeq([version, messageImprint, nonceInt, certReq]);
}

interface ParsedTimeStampResp {
  tstBytes: Uint8Array;
  genTime: number;
  serialNumber: bigint;
  responseNonce: bigint | null;
}

/**
 * Walk a TimeStampResp DER blob. Returns:
 *   - tstBytes: the entire ContentInfo of the timeStampToken (used for
 *     embedding into the CMS unsignedAttrs).
 *   - genTime: parsed GeneralizedTime → ms epoch.
 *   - serialNumber: the TSR serial number.
 *   - responseNonce: the nonce echoed back (null if absent).
 *
 * This is a best-effort walk; we look for the TSTInfo by scanning for the
 * id-ct-TSTInfo OID and reading the OCTET STRING that follows, then parse
 * its inner SEQUENCE for serialNumber, genTime, and nonce.
 */
export function parseTimeStampResp(body: Uint8Array): Result<ParsedTimeStampResp, TsaError> {
  // 1) Top SEQUENCE = TimeStampResp { PKIStatusInfo, timeStampToken }
  const cur = readTag(body, 0);
  if (!cur || cur.tag !== 0x30) {
    return fail<TsaError>('tsa_invalid_response', 'expected top SEQUENCE');
  }
  const tsResp = cur.contents;

  // 2) PKIStatusInfo SEQUENCE
  let off = 0;
  const status = readTag(tsResp, off);
  if (!status || status.tag !== 0x30) {
    return fail<TsaError>('tsa_invalid_response', 'expected PKIStatusInfo SEQUENCE');
  }
  // Parse status code (first INTEGER inside PKIStatusInfo)
  const sCode = readTag(status.contents, 0);
  if (!sCode || sCode.tag !== 0x02) {
    return fail<TsaError>('tsa_invalid_response', 'expected status INTEGER');
  }
  const statusCode = derReadInt(sCode.contents);
  if (statusCode !== 0n && statusCode !== 1n) {
    // 0 = granted, 1 = grantedWithMods, both acceptable for our use.
    return fail<TsaError>(
      'tsa_invalid_response',
      `TSA status ${statusCode.toString()} (not granted)`,
    );
  }
  off += status.totalLen;

  // 3) timeStampToken (optional ContentInfo) — when present, it is the next
  //    SEQUENCE in the TimeStampResp body.
  const tstCi = readTag(tsResp, off);
  if (!tstCi || tstCi.tag !== 0x30) {
    return fail<TsaError>('tsa_invalid_response', 'missing timeStampToken');
  }
  // Re-encode this SEQUENCE as the full tstBytes (caller may embed as-is).
  const tstStart = off;
  const tstEnd = off + tstCi.totalLen;
  const tstBytes = tsResp.slice(tstStart, tstEnd);

  // 4) Walk ContentInfo { contentType OID, [0] EXPLICIT SignedData }
  //    SignedData { version, digestAlgorithms, encapContentInfo, ... }
  //    encapContentInfo { eContentType=id-ct-TSTInfo, [0] EXPLICIT OCTET STRING (TSTInfo DER) }
  //
  //    We scan for id-ct-TSTInfo OID 1.2.840.113549.1.9.16.1.4 and then read
  //    the OCTET STRING that follows the [0] EXPLICIT tag.
  const tstInfoBytes = scanForTSTInfo(tstCi.contents);
  if (!tstInfoBytes) {
    return fail<TsaError>('tsa_invalid_response', 'TSTInfo not found');
  }

  // 5) TSTInfo { version, policy, messageImprint, serialNumber, genTime, ... }
  const tstInfoSeq = readTag(tstInfoBytes, 0);
  if (!tstInfoSeq || tstInfoSeq.tag !== 0x30) {
    return fail<TsaError>('tsa_invalid_response', 'TSTInfo not a SEQUENCE');
  }
  const fields = derFlatten(tstInfoSeq.contents);
  // Fields in order: version (INTEGER), policy (OID), messageImprint (SEQUENCE),
  // serialNumber (INTEGER), genTime (GENERALIZED TIME), optional accuracy, ...
  // We need serialNumber + genTime + (optional) nonce (INTEGER tagged later in seq).
  let serialNumber = 0n;
  let genTime = 0;
  let responseNonce: bigint | null = null;
  let intCount = 0;
  let genTimeSeen = false;
  for (const f of fields) {
    if (f.tag === 0x02) {
      // INTEGER — version (1st), serialNumber (2nd), nonce (post-genTime)
      intCount += 1;
      if (intCount === 2) {
        serialNumber = derReadInt(f.contents);
      } else if (genTimeSeen) {
        responseNonce = derReadInt(f.contents);
      }
    } else if (f.tag === 0x18) {
      // GeneralizedTime
      const s = Buffer.from(f.contents).toString('ascii');
      const gt = parseGeneralizedTime(s);
      if (gt !== null) {
        genTime = gt;
        genTimeSeen = true;
      }
    }
  }
  if (genTime === 0) {
    return fail<TsaError>('tsa_invalid_response', 'TSTInfo missing genTime');
  }
  return ok({ tstBytes, genTime, serialNumber, responseNonce });
}

// ----- ASN.1 DER read helpers --------------------------------------------

interface DerTag {
  tag: number;
  /** Length of `contents` (excluding the tag + length bytes). */
  contentLen: number;
  /** Bytes after tag+length, length = contentLen. */
  contents: Uint8Array;
  /** Full length including tag + length-bytes. */
  totalLen: number;
}

function readTag(buf: Uint8Array, offset: number): DerTag | null {
  if (offset >= buf.byteLength) return null;
  const tag = buf[offset]!;
  const lenByte = buf[offset + 1]!;
  let lenSize = 1;
  let contentLen: number;
  if (lenByte < 0x80) {
    contentLen = lenByte;
  } else {
    const nLenBytes = lenByte & 0x7f;
    if (nLenBytes === 0 || nLenBytes > 4) return null;
    lenSize = 1 + nLenBytes;
    contentLen = 0;
    for (let i = 0; i < nLenBytes; i += 1) {
      const b = buf[offset + 2 + i];
      if (b === undefined) return null;
      contentLen = (contentLen << 8) | b;
    }
  }
  const contentStart = offset + 1 + lenSize;
  const contentEnd = contentStart + contentLen;
  if (contentEnd > buf.byteLength) return null;
  return {
    tag,
    contentLen,
    contents: buf.slice(contentStart, contentEnd),
    totalLen: contentEnd - offset,
  };
}

function derReadInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

function derFlatten(seqContents: Uint8Array): DerTag[] {
  const out: DerTag[] = [];
  let off = 0;
  while (off < seqContents.byteLength) {
    const t = readTag(seqContents, off);
    if (!t) break;
    out.push(t);
    off += t.totalLen;
  }
  return out;
}

function parseGeneralizedTime(s: string): number | null {
  // YYYYMMDDHHMMSS[.fff]Z
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z?$/.exec(s);
  if (!m) return null;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
}

const ID_CT_TSTINFO_OID = new Uint8Array([
  0x06, 0x0b, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x10, 0x01, 0x04,
]);

function scanForTSTInfo(buf: Uint8Array): Uint8Array | null {
  // Find the OID, then look for the next OCTET STRING following an [0]
  // EXPLICIT wrapper (tag 0xa0).
  let idx = -1;
  for (let i = 0; i + ID_CT_TSTINFO_OID.byteLength <= buf.byteLength; i += 1) {
    let match = true;
    for (let j = 0; j < ID_CT_TSTINFO_OID.byteLength; j += 1) {
      if (buf[i + j] !== ID_CT_TSTINFO_OID[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      idx = i + ID_CT_TSTINFO_OID.byteLength;
      break;
    }
  }
  if (idx < 0) return null;
  // After the OID, walk forward looking for a [0] EXPLICIT (tag 0xa0).
  while (idx < buf.byteLength) {
    const t = readTag(buf, idx);
    if (!t) return null;
    if (t.tag === 0xa0) {
      // Inside the EXPLICIT [0] we expect an OCTET STRING.
      const inner = readTag(t.contents, 0);
      if (!inner) return null;
      if (inner.tag === 0x04) return inner.contents; // OCTET STRING contents = TSTInfo DER
      return inner.contents;
    }
    idx += t.totalLen;
  }
  return null;
}

// ----- ASN.1 DER write helpers --------------------------------------------

function derSeq(parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  return tlv(0x30, body);
}

function derOctetString(body: Uint8Array): Uint8Array {
  return tlv(0x04, body);
}

function derInt(n: number): Uint8Array {
  if (n === 0) return new Uint8Array([0x02, 0x01, 0x00]);
  const bytes: number[] = [];
  let x = n;
  while (x > 0) {
    bytes.unshift(x & 0xff);
    x >>>= 8;
  }
  // Prepend 0 if high bit set (positive integer encoding).
  if (bytes[0]! & 0x80) bytes.unshift(0);
  return tlv(0x02, new Uint8Array(bytes));
}

function derPosIntFromBytes(bytes: Uint8Array): Uint8Array {
  // Convert raw bytes to a positive INTEGER: prepend 0 if high bit set.
  let arr = bytes;
  if (arr.length > 0 && arr[0]! & 0x80) {
    arr = concat([new Uint8Array([0]), arr]);
  }
  // Strip leading zeros (but keep at least one byte).
  while (arr.length > 1 && arr[0] === 0 && (arr[1]! & 0x80) === 0) {
    arr = arr.slice(1);
  }
  return tlv(0x02, arr);
}

function tlv(tag: number, body: Uint8Array): Uint8Array {
  const len = body.byteLength;
  let lengthBytes: number[];
  if (len < 0x80) {
    lengthBytes = [len];
  } else {
    const bytes: number[] = [];
    let x = len;
    while (x > 0) {
      bytes.unshift(x & 0xff);
      x >>>= 8;
    }
    lengthBytes = [0x80 | bytes.length, ...bytes];
  }
  const out = new Uint8Array(1 + lengthBytes.length + body.byteLength);
  out[0] = tag;
  out.set(lengthBytes, 1);
  out.set(body, 1 + lengthBytes.length);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

/** Re-exported for test convenience (compute the hash a caller would send). */
export function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}
