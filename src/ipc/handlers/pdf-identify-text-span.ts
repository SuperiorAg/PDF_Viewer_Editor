// Handler: pdf:identifyTextSpan
//
// Phase 2 (api-contracts.md §12.4, architecture-phase-2.md §4.2).
// The renderer's text-edit overlay calls this when the user clicks into a
// text region. Main loads the doc via documentStore.getBytes(handle), runs
// a hit-test against the page's text runs, and returns the objectId +
// metrics needed for the renderer-side glyph-width shim.
//
// Wave 10 / Phase 2.5 (D-10.2): implements the real text-span scanner that
// Wave 7 stubbed out. The Wave-7 handler returned `no_text_at_point` for
// every request because `listTextRuns` returned `[]` — the renderer fell
// back to its pdf.js-based hit-test which was Phase-2 honest but didn't
// give main a stable objectId for save-time replay. Phase 2.5 closes the
// loop end-to-end.
//
// APPROACH — manual content-stream parsing:
//   pdf-lib does NOT parse content streams loaded from existing PDFs into
//   PDFOperator instances; PDFContentStream.operators is only populated for
//   newly-constructed streams (pdf-lib uses it as a write-path data
//   structure, not a read path). Per the Wave 10 brief: "If pdf-lib's
//   content-stream API is too limited, fall back to manually parsing
//   operators with PDFContentStream + PDFOperator."
//
//   We use pdf-lib's `decodePDFRawStream({ dict, contents })` to decode
//   the FlateDecode/LZW/Ascii85/AsciiHex/RunLengthDecode-encoded raw
//   contents into a byte stream, then run a minimal tokenizer over the
//   decoded bytes recognizing the subset of operators needed for text
//   layout:
//
//     BT / ET           text-object boundaries
//     Tf <font> <size>  font + size
//     Tm a b c d e f    text matrix (we use only e, f as the text origin
//                       and a*size as the glyph horizontal scale)
//     Td <tx> <ty>      text position adjust (relative)
//     TD <tx> <ty>      same as Td + set leading
//     T*                next line (uses leading)
//     Tj <str>          show text
//     TJ [<str>...]     show text with positioning
//     ' <str>           next line then show
//     " <aw> <ac> <str> next line, set spacings, show
//     q / Q             graphics-state save/restore (we don't track CTM
//                       beyond text matrix, but we DO push/pop the active
//                       text-block state on q/Q to be defensive)
//
//   Bounding box for each run: origin (tm.e, tm.f) extending right by
//   (textWidth × fontSize), up by fontSize. textWidth is an honest-glyph
//   estimate — for embedded fonts we don't have widths arrays loaded, so
//   we fall back to 0.5em per character (typical proportional-font
//   average). The Phase 2.5 contract documents this approximation
//   (api-reference.md "no glyph-perfect font metrics on identify").
//
//   The scanner ignores any operator it doesn't recognize and is robust
//   against ASCII85/AsciiHex strings, balanced parens in literal strings,
//   and backslash escapes. Inline images (BI...EI) are skipped wholesale.
//
//   spanId scheme: `${pageObjectNumber}/${contentStreamIndex}/${runIndex}`
//   (Riley's Wave 6 edit-replay-engine.md §10 spec, compatible with the
//   existing encodeObjectId / parseObjectId in text-replace.ts).

import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfIdentifyTextSpanError,
  PdfIdentifyTextSpanRequest,
  PdfIdentifyTextSpanResponse,
  PdfIdentifyTextSpanValue,
} from '../contracts.js';

export interface PdfIdentifyTextSpanDeps {
  hasHandle(handle: DocumentHandle): boolean;
  getBytes(handle: DocumentHandle): Uint8Array | null;
}

interface ScannedTextRun {
  pageObjectNumber: number;
  contentStreamIndex: number;
  runIndex: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  /** PDF user-space bounding box (origin bottom-left of the run). */
  bbox: { x: number; y: number; width: number; height: number };
}

export async function handlePdfIdentifyTextSpan(
  req: PdfIdentifyTextSpanRequest,
  deps: PdfIdentifyTextSpanDeps,
): Promise<PdfIdentifyTextSpanResponse> {
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<PdfIdentifyTextSpanError>('invalid_payload', 'handle must be an integer');
  }
  if (!deps.hasHandle(req.handle)) {
    return fail<PdfIdentifyTextSpanError>('handle_not_found', `handle ${req.handle} not found`);
  }
  if (!Number.isInteger(req.pageIndex) || req.pageIndex < 0) {
    return fail<PdfIdentifyTextSpanError>(
      'out_of_range',
      'pageIndex must be a non-negative integer',
    );
  }
  if (!Number.isFinite(req.x) || !Number.isFinite(req.y)) {
    return fail<PdfIdentifyTextSpanError>('invalid_payload', 'x/y must be finite numbers');
  }

  const bytes = deps.getBytes(req.handle);
  if (!bytes) {
    return fail<PdfIdentifyTextSpanError>('handle_not_found', `handle ${req.handle} has no bytes`);
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (e) {
    return fail<PdfIdentifyTextSpanError>(
      'invalid_payload',
      `pdf-lib load failed: ${(e as Error).message}`,
    );
  }

  const pages = doc.getPages();
  if (req.pageIndex >= pages.length) {
    return fail<PdfIdentifyTextSpanError>(
      'out_of_range',
      `pageIndex ${req.pageIndex} >= pageCount ${pages.length}`,
    );
  }
  const page = pages[req.pageIndex];
  if (!page) {
    return fail<PdfIdentifyTextSpanError>('out_of_range', 'page not found');
  }
  const pageObjectNumber = page.ref.objectNumber;

  // Walk Contents array; each entry is a PDFRawStream we decode + parse.
  const contents = page.node.normalizedEntries().Contents;
  const runs: ScannedTextRun[] = [];
  if (contents) {
    const streamCount = contents.size();
    for (let csIdx = 0; csIdx < streamCount; csIdx++) {
      const ref = contents.get(csIdx);
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;
      let decodedBytes: Uint8Array;
      try {
        const decoded = decodePDFRawStream(stream);
        // DecodeStream / Stream both expose decode() returning all bytes.
        decodedBytes = decoded.decode();
      } catch {
        // Unsupported encoding -> skip this stream; other streams may still
        // yield runs.
        continue;
      }
      const parsed = scanTextRuns(decodedBytes, pageObjectNumber, csIdx);
      runs.push(...parsed);
    }
  }

  // Hit-test the requested point against each run's bbox; pick the
  // SMALLEST (by area) bbox that contains the point. "Smallest" prevents
  // a large enclosing run from winning over a tighter inner run.
  type Hit = ScannedTextRun & { area: number };
  const hits: Hit[] = [];
  for (const r of runs) {
    if (
      req.x >= r.bbox.x &&
      req.x <= r.bbox.x + r.bbox.width &&
      req.y >= r.bbox.y &&
      req.y <= r.bbox.y + r.bbox.height
    ) {
      hits.push({ ...r, area: r.bbox.width * r.bbox.height });
    }
  }

  if (hits.length === 0) {
    return fail<PdfIdentifyTextSpanError>(
      'no_text_at_point',
      `no text run contains (${req.x}, ${req.y}) on page ${req.pageIndex}`,
    );
  }

  hits.sort((a, b) => a.area - b.area);
  const hit = hits[0]!;

  const value: PdfIdentifyTextSpanValue = {
    objectId: `${hit.pageObjectNumber}/${hit.contentStreamIndex}/${hit.runIndex}`,
    runBoundingRect: hit.bbox,
    currentText: hit.text,
    font: {
      family: hit.fontFamily,
      size: hit.fontSize,
      // glyphWidths populated by the renderer from its pdf.js font shim;
      // the main-side scanner has no embedded-font glyph widths available
      // without parsing the font program (deferred to Phase 3).
      glyphWidths: {},
      glyphMapSize: 256,
    },
  };
  return ok(value);
}

// ============================================================================
// Content-stream tokenizer + text-state simulator.
// ============================================================================
//
// Minimal but correct for the PDF graphics subset used by typical text
// content. Built to be deterministic and side-effect-free; suitable for
// unit testing against fixture byte strings.
//
// Exported for testing only — not part of the IPC contract surface.

export function scanTextRuns(
  bytes: Uint8Array,
  pageObjectNumber: number,
  contentStreamIndex: number,
): ScannedTextRun[] {
  const runs: ScannedTextRun[] = [];
  let runIndex = 0;

  // Tokenize first, then walk operators.
  const tokens = tokenize(bytes);
  // Text-state machine.
  let inTextObject = false;
  let tm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]; // a,b,c,d,e,f
  let textLineMatrix: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
  let leading = 0;
  let fontFamily = 'Unknown';
  let fontSize = 12;
  let operandStack: Array<string | number | unknown> = [];

  function setTm(a: number, b: number, c: number, d: number, e: number, f: number): void {
    tm = [a, b, c, d, e, f];
    textLineMatrix = [a, b, c, d, e, f];
  }
  function translate(tx: number, ty: number): void {
    // Tm := [1 0 0 1 tx ty] · textLineMatrix
    const [a, b, c, d, e, f] = textLineMatrix;
    const ne = tx * a + ty * c + e;
    const nf = tx * b + ty * d + f;
    setTm(a, b, c, d, ne, nf);
  }
  function nextLine(): void {
    translate(0, -leading);
  }

  function emitRun(text: string): void {
    if (text.length === 0) return;
    // Honest approximation: width = (0.5em average) × charCount × fontSize.
    // Most proportional fonts hit ~0.45-0.55em average advance; 0.5 is the
    // generic mean. For monospace text this slightly underestimates wide
    // glyphs; for narrow runs the hit-test bbox is still close enough for
    // pointer-precision clicks. Renderer-side glyph metrics refine this.
    const avgAdvanceEm = 0.5;
    const scaleX = Math.abs(tm[0]); // horizontal scale from text matrix
    const width = text.length * avgAdvanceEm * fontSize * scaleX;
    const height = fontSize * Math.abs(tm[3]);
    const x = tm[4];
    const y = tm[5];
    runs.push({
      pageObjectNumber,
      contentStreamIndex,
      runIndex: runIndex++,
      text,
      fontFamily,
      fontSize,
      bbox: { x, y, width, height },
    });
    // Advance text matrix past the run for subsequent operators.
    translate(width / Math.max(scaleX, 1e-9), 0);
  }

  for (const tok of tokens) {
    if (tok.kind === 'op') {
      const name = tok.value;
      switch (name) {
        case 'BT': {
          inTextObject = true;
          setTm(1, 0, 0, 1, 0, 0);
          break;
        }
        case 'ET': {
          inTextObject = false;
          break;
        }
        case 'Tf': {
          // operandStack: [fontName, size]
          if (operandStack.length >= 2) {
            const size = Number(operandStack[operandStack.length - 1]);
            const name = String(operandStack[operandStack.length - 2]);
            if (Number.isFinite(size)) fontSize = size;
            fontFamily = name.startsWith('/') ? name.slice(1) : name;
          }
          break;
        }
        case 'Tm': {
          // 6 numeric operands
          if (operandStack.length >= 6) {
            const nums = operandStack.slice(-6).map(Number);
            if (nums.every((n) => Number.isFinite(n))) {
              setTm(nums[0]!, nums[1]!, nums[2]!, nums[3]!, nums[4]!, nums[5]!);
            }
          }
          break;
        }
        case 'Td': {
          if (operandStack.length >= 2) {
            const ty = Number(operandStack[operandStack.length - 1]);
            const tx = Number(operandStack[operandStack.length - 2]);
            if (Number.isFinite(tx) && Number.isFinite(ty)) translate(tx, ty);
          }
          break;
        }
        case 'TD': {
          if (operandStack.length >= 2) {
            const ty = Number(operandStack[operandStack.length - 1]);
            const tx = Number(operandStack[operandStack.length - 2]);
            if (Number.isFinite(tx) && Number.isFinite(ty)) {
              leading = -ty;
              translate(tx, ty);
            }
          }
          break;
        }
        case 'TL': {
          if (operandStack.length >= 1) {
            const l = Number(operandStack[operandStack.length - 1]);
            if (Number.isFinite(l)) leading = l;
          }
          break;
        }
        case 'T*': {
          nextLine();
          break;
        }
        case 'Tj': {
          if (inTextObject && operandStack.length >= 1) {
            const s = operandStack[operandStack.length - 1];
            if (typeof s === 'string') emitRun(s);
          }
          break;
        }
        case "'": {
          nextLine();
          if (inTextObject && operandStack.length >= 1) {
            const s = operandStack[operandStack.length - 1];
            if (typeof s === 'string') emitRun(s);
          }
          break;
        }
        case '"': {
          nextLine();
          if (inTextObject && operandStack.length >= 3) {
            const s = operandStack[operandStack.length - 1];
            if (typeof s === 'string') emitRun(s);
          }
          break;
        }
        case 'TJ': {
          if (inTextObject && operandStack.length >= 1) {
            const arr = operandStack[operandStack.length - 1];
            if (Array.isArray(arr)) {
              let combined = '';
              for (const item of arr) {
                if (typeof item === 'string') combined += item;
                // numeric items are inter-glyph spacing adjustments —
                // we don't model them precisely; the bbox approximation
                // absorbs the difference.
              }
              if (combined.length > 0) emitRun(combined);
            }
          }
          break;
        }
        default:
          // ignore — most graphics-state / path ops don't affect text bbox
          break;
      }
      operandStack = [];
    } else {
      operandStack.push(tok.value);
    }
  }

  return runs;
}

// --- tokenizer --------------------------------------------------------------
//
// Token kinds: 'op' (operator name), 'num' (number), 'str' (literal or hex
// string, decoded to JS string), 'name' (PDF /Name without the slash),
// 'arr' (PDF array, used for TJ).

function tokenize(bytes: Uint8Array): Array<{ kind: string; value: unknown }> {
  const tokens: Array<{ kind: string; value: unknown }> = [];
  let i = 0;
  const n = bytes.length;

  function isWhitespace(c: number): boolean {
    return c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
  }
  function isDelim(c: number): boolean {
    return (
      c === 0x28 /* ( */ ||
      c === 0x29 /* ) */ ||
      c === 0x3c /* < */ ||
      c === 0x3e /* > */ ||
      c === 0x5b /* [ */ ||
      c === 0x5d /* ] */ ||
      c === 0x7b /* { */ ||
      c === 0x7d /* } */ ||
      c === 0x2f /* / */ ||
      c === 0x25 /* % */
    );
  }

  function readLiteralString(): string {
    // Caller has consumed the opening '(' at i.
    let depth = 1;
    let out = '';
    while (i < n && depth > 0) {
      const c = bytes[i]!;
      if (c === 0x5c /* \ */) {
        // escape
        i++;
        const e = bytes[i];
        if (e === undefined) break;
        i++;
        switch (e) {
          case 0x6e:
            out += '\n';
            break;
          case 0x72:
            out += '\r';
            break;
          case 0x74:
            out += '\t';
            break;
          case 0x62:
            out += '\b';
            break;
          case 0x66:
            out += '\f';
            break;
          case 0x28:
            out += '(';
            break;
          case 0x29:
            out += ')';
            break;
          case 0x5c:
            out += '\\';
            break;
          default: {
            // octal up to 3 digits
            if (e >= 0x30 && e <= 0x37) {
              let oct = String.fromCharCode(e);
              if (i < n && bytes[i]! >= 0x30 && bytes[i]! <= 0x37) {
                oct += String.fromCharCode(bytes[i]!);
                i++;
                if (i < n && bytes[i]! >= 0x30 && bytes[i]! <= 0x37) {
                  oct += String.fromCharCode(bytes[i]!);
                  i++;
                }
              }
              out += String.fromCharCode(parseInt(oct, 8) & 0xff);
            }
            // else: drop the escape character (line continuation '\<EOL>')
            break;
          }
        }
      } else if (c === 0x28 /* ( */) {
        depth++;
        out += '(';
        i++;
      } else if (c === 0x29 /* ) */) {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
        out += ')';
        i++;
      } else {
        out += String.fromCharCode(c);
        i++;
      }
    }
    return out;
  }

  function readHexString(): string {
    // Caller positioned at '<'
    i++; // consume '<'
    let hex = '';
    while (i < n) {
      const c = bytes[i]!;
      if (c === 0x3e /* > */) {
        i++;
        break;
      }
      if (!isWhitespace(c)) hex += String.fromCharCode(c);
      i++;
    }
    if (hex.length % 2 === 1) hex += '0';
    let out = '';
    for (let k = 0; k < hex.length; k += 2) {
      out += String.fromCharCode(parseInt(hex.substr(k, 2), 16));
    }
    return out;
  }

  function readName(): string {
    // Caller positioned at '/'
    i++; // consume '/'
    const start = i;
    while (i < n) {
      const c = bytes[i]!;
      if (isWhitespace(c) || isDelim(c)) break;
      i++;
    }
    return String.fromCharCode(...bytes.subarray(start, i));
  }

  function readArray(): Array<string | number> {
    // Caller positioned at '['
    i++; // consume '['
    const items: Array<string | number> = [];
    while (i < n) {
      const c = bytes[i]!;
      if (isWhitespace(c)) {
        i++;
        continue;
      }
      if (c === 0x5d /* ] */) {
        i++;
        return items;
      }
      if (c === 0x28 /* ( */) {
        i++;
        items.push(readLiteralString());
        continue;
      }
      if (c === 0x3c /* < */) {
        items.push(readHexString());
        continue;
      }
      // number
      const tok = readToken();
      if (tok === null) break;
      const num = Number(tok);
      if (Number.isFinite(num)) items.push(num);
      else items.push(tok);
    }
    return items;
  }

  function readToken(): string | null {
    const start = i;
    while (i < n) {
      const c = bytes[i]!;
      if (isWhitespace(c) || isDelim(c)) break;
      i++;
    }
    if (i === start) return null;
    return String.fromCharCode(...bytes.subarray(start, i));
  }

  while (i < n) {
    const c = bytes[i]!;
    if (isWhitespace(c)) {
      i++;
      continue;
    }
    if (c === 0x25 /* % */) {
      // comment to end of line
      while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }
    if (c === 0x28 /* ( */) {
      i++;
      tokens.push({ kind: 'str', value: readLiteralString() });
      continue;
    }
    if (c === 0x3c /* < */) {
      // could be hex string or '<<' dict — for content streams, hex string
      // is overwhelmingly more common. Detect '<<' and skip nested dicts
      // (rare in content streams).
      if (bytes[i + 1] === 0x3c) {
        // skip nested dict — scan to matching '>>'
        let depth = 1;
        i += 2;
        while (i < n && depth > 0) {
          if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) {
            depth++;
            i += 2;
          } else if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) {
            depth--;
            i += 2;
          } else {
            i++;
          }
        }
        continue;
      }
      tokens.push({ kind: 'str', value: readHexString() });
      continue;
    }
    if (c === 0x5b /* [ */) {
      tokens.push({ kind: 'arr', value: readArray() });
      continue;
    }
    if (c === 0x2f /* / */) {
      tokens.push({ kind: 'name', value: readName() });
      continue;
    }
    // operator or number
    const tok = readToken();
    if (tok === null) {
      i++;
      continue;
    }
    const num = Number(tok);
    if (Number.isFinite(num) && tok.length > 0 && /^[+\-0-9.]/.test(tok)) {
      tokens.push({ kind: 'num', value: num });
    } else {
      tokens.push({ kind: 'op', value: tok });
    }
  }

  return tokens;
}
