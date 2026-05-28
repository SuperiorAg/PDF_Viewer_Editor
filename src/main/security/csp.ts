// Content Security Policy installed at session.defaultSession.webRequest.
// Mirrors ARCHITECTURE §2.2 exactly. The renderer also sets a <meta> CSP;
// this header is the authoritative one.

import { session } from 'electron';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // blob: is required for pdf.js embedded-font rendering — it loads font faces
  // via blob: URLs; without it the browser refuses the font and pdf.js falls
  // back to canvas path-rendering (visibly "not smooth" / irregular glyph
  // spacing vs Acrobat). data: covers the inline-font path. (2026-05-28)
  "font-src 'self' data: blob:",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export function installCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });
}
