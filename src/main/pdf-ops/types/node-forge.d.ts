// Type shim for `node-forge` v1.3.x. The real `@types/node-forge` exists
// but isn't installed at Wave 16 — Diego adds the dep in Wave 17 packaging.
// This shim covers only the surface area the manual PAdES engine uses.
//
// When `@types/node-forge` lands in Wave 17, this shim can be removed.

declare module 'node-forge' {
  namespace pki {
    interface Certificate {
      subject: {
        getField(name: string): { value: string } | undefined;
      };
      issuer: {
        getField(name: string): { value: string } | undefined;
      };
      validity: {
        notBefore: Date;
        notAfter: Date;
      };
    }
    type PrivateKey = unknown;
    function privateKeyToPem(key: PrivateKey): string;
    function certificateToAsn1(cert: Certificate): { getBytes(): string };
    const oids: Record<string, string>;
  }

  namespace pkcs12 {
    interface Pkcs12Pfx {
      getBags(filter: {
        bagType: string;
      }): Record<string, Array<{ key?: pki.PrivateKey; cert?: pki.Certificate }>>;
    }
    function pkcs12FromAsn1(asn1: unknown, password: string): Pkcs12Pfx;
  }

  namespace asn1 {
    function fromDer(input: string): unknown;
    function toDer(input: unknown): { getBytes(): string };
  }

  namespace md {
    namespace sha256 {
      interface Hasher {
        update(data: string): Hasher;
        digest(): { toHex(): string };
      }
      function create(): Hasher;
    }
  }

  const forge: {
    pki: typeof pki;
    pkcs12: typeof pkcs12;
    asn1: typeof asn1;
    md: typeof md;
  };
  export default forge;
}
