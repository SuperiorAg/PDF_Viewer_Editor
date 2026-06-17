// Preview pane — Phase 7.5 B4 (Riley Wave 4).
//
// Honest scope: this pane shows a CARTOON of the active page with the
// configured page-design overlay (watermark / header-footer / background)
// approximated in CSS. It is NOT a pdf.js rasterized preview — true
// re-raster on every form change would burn the perf budget (1064-page docs
// must stay snappy). The cartoon validates position, orientation, opacity,
// and color choice; the engine produces the real output.

import { useT } from '../../i18n/use-t';
import { useAppSelector } from '../../state/hooks';
import type { PdfWatermarkPosition } from '../../types/ipc-contract';

import styles from './page-design-modal.module.css';

interface WatermarkFormShape {
  source: 'text' | 'image';
  text: string;
  fontColor: string;
  fontSize: number;
  rotationDegrees: number;
  opacity: number;
  position: PdfWatermarkPosition;
  imageFileName: string | null;
}

interface HeaderFooterFormShape {
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
}

export function PreviewPane(): JSX.Element {
  const { t } = useT();
  const tab = useAppSelector((s) => s.pageDesign.activeTab);
  const wm = useAppSelector((s) => s.pageDesign.watermark);
  const hf = useAppSelector((s) => s.pageDesign.headerFooter);
  const bg = useAppSelector((s) => s.pageDesign.background);

  return (
    <div className={styles.preview} role="img" aria-label={t('modals:pageDesign.preview.noteAria')}>
      <strong>{t('modals:pageDesign.preview.title')}</strong>
      <div className={styles.previewBoxWrap}>
        <div
          className={styles.previewBox}
          // eslint-disable-next-line react/forbid-dom-props
          style={
            tab === 'background' && bg.source === 'color' ? { background: bg.color } : undefined
          }
        >
          {tab === 'header-footer' && <HeaderFooterCartoon hf={hf} />}
          {tab === 'watermark' && <WatermarkCartoon wm={wm} />}
          {tab === 'background' && bg.source === 'image' && bg.imageFileName !== null && (
            // eslint-disable-next-line react/forbid-dom-props
            <div className={styles.hint} style={{ padding: 8 }}>
              {bg.imageFileName}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WatermarkCartoon({ wm }: { wm: WatermarkFormShape }): JSX.Element {
  const align = positionToFlex(wm.position);
  const text = wm.source === 'text' ? wm.text || 'DRAFT' : (wm.imageFileName ?? '[image]');
  return (
    <div
      className={styles.previewWatermark}
      // eslint-disable-next-line react/forbid-dom-props
      style={{
        ...align,
        color: wm.fontColor,
        opacity: wm.opacity,
        fontSize: Math.max(10, Math.min(28, wm.fontSize / 5)),
        transform: `rotate(${wm.rotationDegrees}deg)`,
      }}
    >
      {text}
    </div>
  );
}

function HeaderFooterCartoon({ hf }: { hf: HeaderFooterFormShape }): JSX.Element {
  const tokenize = (s: string): string => s.replace('{page}', '1').replace('{totalPages}', '12');
  return (
    // eslint-disable-next-line react/forbid-dom-props
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        fontSize: 9,
        padding: 6,
        boxSizing: 'border-box',
      }}
    >
      {/* eslint-disable-next-line react/forbid-dom-props */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{tokenize(hf.headerLeft)}</span>
        <span>{tokenize(hf.headerCenter)}</span>
        <span>{tokenize(hf.headerRight)}</span>
      </div>
      {/* eslint-disable-next-line react/forbid-dom-props */}
      <div
        style={{
          position: 'absolute',
          bottom: 6,
          left: 6,
          right: 6,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{tokenize(hf.footerLeft)}</span>
        <span>{tokenize(hf.footerCenter)}</span>
        <span>{tokenize(hf.footerRight)}</span>
      </div>
    </div>
  );
}

function positionToFlex(p: PdfWatermarkPosition): {
  alignItems: string;
  justifyContent: string;
} {
  switch (p) {
    case 'top-left':
      return { alignItems: 'flex-start', justifyContent: 'flex-start' };
    case 'top-right':
      return { alignItems: 'flex-start', justifyContent: 'flex-end' };
    case 'bottom-left':
      return { alignItems: 'flex-end', justifyContent: 'flex-start' };
    case 'bottom-right':
      return { alignItems: 'flex-end', justifyContent: 'flex-end' };
    case 'center':
    default:
      return { alignItems: 'center', justifyContent: 'center' };
  }
}
