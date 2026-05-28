// Signatures slice tests — Phase 4.
// Per docs/architecture-phase-4.md §2.3.

import { describe, expect, it } from 'vitest';

import signaturesReducer, {
  buildPadesAppearanceSpec,
  buildVisualAppearanceSpec,
  clearCert,
  closeSignatureModal,
  enterPlacement,
  exitPlacement,
  openCaptureModal,
  openPadesModal,
  setCaptured,
  setCert,
  setPadesOptions,
  setPadesStep,
  setSigning,
} from './signatures-slice';

const INITIAL = signaturesReducer(undefined, { type: '@@INIT' });

describe('signaturesSlice', () => {
  it('opens the capture modal and resets capture state', () => {
    const s = signaturesReducer(INITIAL, openCaptureModal());
    expect(s.openModal).toBe('capture');
    expect(s.captured).toBeNull();
    expect(s.captureTab).toBe('typed');
  });

  it('opens the pades modal and resets options', () => {
    const s = signaturesReducer(INITIAL, openPadesModal());
    expect(s.openModal).toBe('pades');
    expect(s.padesStep).toBe('cert');
    expect(s.cert).toBeNull();
    expect(s.padesOptions.showSubjectCN).toBe(true);
  });

  it('setCert advances padesStep to options', () => {
    const s = signaturesReducer(
      INITIAL,
      setCert({
        handle: 'h1',
        subjectCN: 'CN=Test',
        issuerCN: 'CN=CA',
        notBefore: 0,
        notAfter: 1,
        fingerprint: 'aa',
        isExpired: false,
      }),
    );
    expect(s.cert?.handle).toBe('h1');
    expect(s.padesStep).toBe('options');
  });

  it('clearCert resets to step cert', () => {
    let s = signaturesReducer(
      INITIAL,
      setCert({
        handle: 'h1',
        subjectCN: 'CN=Test',
        issuerCN: 'CN=CA',
        notBefore: 0,
        notAfter: 1,
        fingerprint: 'aa',
        isExpired: false,
      }),
    );
    s = signaturesReducer(s, clearCert());
    expect(s.cert).toBeNull();
    expect(s.padesStep).toBe('cert');
  });

  it('setPadesOptions merges partial updates', () => {
    const s = signaturesReducer(
      INITIAL,
      setPadesOptions({ reason: 'Quarterly review', useTsa: true }),
    );
    expect(s.padesOptions.reason).toBe('Quarterly review');
    expect(s.padesOptions.useTsa).toBe(true);
    expect(s.padesOptions.showSubjectCN).toBe(true); // unchanged
  });

  it('setSigning toggles signing flag', () => {
    const s = signaturesReducer(INITIAL, setSigning(true));
    expect(s.signing).toBe(true);
  });

  it('setPadesStep changes step', () => {
    const s = signaturesReducer(INITIAL, setPadesStep('sign'));
    expect(s.padesStep).toBe('sign');
  });

  it('enterPlacement activates the placement overlay state', () => {
    const s = signaturesReducer(
      INITIAL,
      enterPlacement({
        flow: 'visual',
        placement: { mode: 'freeform' },
        certHandle: null,
      }),
    );
    expect(s.placement.active).toBe(true);
    expect(s.placement.flow).toBe('visual');
    expect(s.openModal).toBe('none');
  });

  it('exitPlacement clears placement state', () => {
    let s = signaturesReducer(
      INITIAL,
      enterPlacement({
        flow: 'visual',
        placement: { mode: 'freeform' },
        certHandle: null,
      }),
    );
    s = signaturesReducer(s, exitPlacement());
    expect(s.placement.active).toBe(false);
    expect(s.placement.flow).toBeNull();
  });

  it('closeSignatureModal resets cert + step', () => {
    let s = signaturesReducer(
      INITIAL,
      setCert({
        handle: 'h1',
        subjectCN: 'CN=Test',
        issuerCN: 'CN=CA',
        notBefore: 0,
        notAfter: 1,
        fingerprint: 'aa',
        isExpired: false,
      }),
    );
    s = signaturesReducer(s, closeSignatureModal());
    expect(s.cert).toBeNull();
    expect(s.padesStep).toBe('cert');
    expect(s.openModal).toBe('none');
  });

  it('setCaptured stores the source + appearance toggles', () => {
    const s = signaturesReducer(
      INITIAL,
      setCaptured({
        source: {
          kind: 'drawn',
          pngBytes: new Uint8Array([1, 2, 3]),
          widthPx: 200,
          heightPx: 100,
        },
        reason: 'r',
        showName: true,
        showDate: true,
        showReason: false,
      }),
    );
    expect(s.captured?.source.kind).toBe('drawn');
    expect(s.captured?.reason).toBe('r');
  });
});

describe('buildVisualAppearanceSpec', () => {
  it('builds a visual spec with cert toggles forced to false', () => {
    const spec = buildVisualAppearanceSpec({
      source: {
        kind: 'drawn',
        pngBytes: new Uint8Array(0),
        widthPx: 0,
        heightPx: 0,
      },
      reason: '',
      showName: true,
      showDate: true,
      showReason: true,
    });
    // Empty reason means showReason resolves to false even if requested.
    expect(spec.showReason).toBe(false);
    expect(spec.showSubjectCN).toBe(false);
    expect(spec.showIssuerCN).toBe(false);
    expect(spec.showTsaInfo).toBe(false);
  });
});

describe('buildPadesAppearanceSpec', () => {
  it('threads sign options into the PAdES spec', () => {
    const spec = buildPadesAppearanceSpec(
      {
        source: {
          kind: 'typed',
          name: 'John',
          pngBytes: new Uint8Array(0),
          widthPx: 0,
          heightPx: 0,
        },
        reason: '',
        showName: true,
        showDate: false,
        showReason: false,
      },
      {
        reason: 'approval',
        location: 'remote',
        showSubjectCN: true,
        showIssuerCN: true,
        showDate: true,
        showReason: true,
        showTsaInfo: false,
        useTsa: false,
      },
    );
    expect(spec.showSubjectCN).toBe(true);
    expect(spec.showIssuerCN).toBe(true);
    expect(spec.showDate).toBe(true);
    expect(spec.showReason).toBe(true);
    expect(spec.reason).toBe('approval');
  });
});
