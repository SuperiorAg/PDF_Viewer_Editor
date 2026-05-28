// Type shim for `node-signpdf` v3.x. No published @types as of 2026-05-26.
// Authored by David per signature-engine.md §10 (Wave 16 ownership).
//
// The actual library is dynamic-imported in pades-signature.ts so the
// module can compile + test without the dep being installed at Wave 16
// (Diego packages it in Wave 17). When `import('node-signpdf')` succeeds
// the shape below is what we treat the export as.

declare module 'node-signpdf' {
  export interface SignPdfDefault {
    sign(
      pdf: Buffer | Uint8Array,
      p12: Buffer | Uint8Array,
      options?: { passphrase?: string },
    ): Buffer;
    lastSignature: string | null;
    byteRangePlaceholder?: string;
  }
  const signpdf: SignPdfDefault;
  export default signpdf;
  export const plainAddPlaceholder: (input: {
    pdfBuffer: Buffer;
    reason?: string;
    contactInfo?: string;
    name?: string;
    location?: string;
    signatureLength?: number;
  }) => Buffer;
}
