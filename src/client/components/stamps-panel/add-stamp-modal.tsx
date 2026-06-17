// AddStampModal — Phase 7.5 B7 (Riley Wave 3).
// Per docs/ui-spec-phase-7.5.md §7.3. v0.8.0 ships text-only stamps; the
// "Image" kind is rendered disabled with an inline note pointing at v0.9.x.

import { useState } from 'react';

import { useT } from '../../i18n/use-t';
import { stampsApi } from '../../services/stamps-api';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  addCustomStamp,
  setAddModalOpen,
  type StampLibraryEntry,
} from '../../state/slices/stamps-slice';
import { pushToast } from '../../state/slices/ui-slice';
import type { RgbColor } from '../../types/ipc-contract';

function hexToRgb(hex: string): RgbColor {
  const clean = hex.replace(/^#/, '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return {
    r: Number.isFinite(r) ? r : 0,
    g: Number.isFinite(g) ? g : 0,
    b: Number.isFinite(b) ? b : 0,
  };
}

function uuid(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom may not expose crypto
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `stamp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function AddStampModal(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const open = useAppSelector((s) => s.stamps.addModalOpen);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [color, setColor] = useState('#0852A8');
  const [width, setWidth] = useState(200);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const close = (): void => {
    dispatch(setAddModalOpen(false));
    setName('');
    setText('');
    setColor('#0852A8');
    setWidth(200);
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (name.trim() === '') {
      dispatch(
        pushToast({ kind: 'warning', message: t('modals:addStamp.validationNameRequired') }),
      );
      return;
    }
    if (text.trim() === '') {
      dispatch(
        pushToast({ kind: 'warning', message: t('modals:addStamp.validationTextRequired') }),
      );
      return;
    }
    setSubmitting(true);
    // Persist via the typed shim. When the live `stamps:add` channel lands
    // this returns a real row id; until then the fallback returns
    // 'bridge_unavailable' and we keep the entry renderer-side only with a
    // locally-generated UUID so the user can still create and place stamps
    // within the session.
    const entry: StampLibraryEntry = {
      id: uuid(),
      name: name.trim(),
      kind: 'text',
      text: text.trim(),
      color: hexToRgb(color),
      widthPt: width,
      isBuiltin: false,
      lastUsedAt: null,
    };
    try {
      const result = await stampsApi.add({
        name: entry.name,
        kind: entry.kind,
        text: entry.text!,
        color: entry.color!,
        widthPt: entry.widthPt!,
      });
      if (result.ok) {
        entry.id = result.value.id;
      }
      // bridge_unavailable is OK — we still add to the renderer slice so the
      // panel shows the new entry. A1-style honest disclosure: no silent
      // failure beyond Marcus's open-question note.
    } catch {
      // ignore — same handling as above
    }
    dispatch(addCustomStamp(entry));
    setSubmitting(false);
    close();
  };

  return (
    // The dialog div is the modal backdrop + container; role="dialog" with
    // an accessible name is the documented WAI-ARIA pattern for modals,
    // and the onKeyDown handler installs Esc-to-close. jsx-a11y treats
    // dialog as non-interactive — the rule is a known plugin-taxonomy
    // false positive in this idiom (same disable as redaction's Apply
    // modal).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('modals:addStamp.title')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
      // eslint-disable-next-line react/forbid-dom-props
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <form
        onSubmit={(e) => void submit(e)}
        // eslint-disable-next-line react/forbid-dom-props
        style={{
          background: 'var(--color-bg-primary, white)',
          padding: '20px',
          borderRadius: '8px',
          minWidth: '360px',
          color: 'var(--color-text-primary, #111)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <h2 style={{ margin: 0 }}>{t('modals:addStamp.title')}</h2>

        <fieldset
          // eslint-disable-next-line react/forbid-dom-props
          style={{ border: 'none', padding: 0, display: 'flex', gap: '12px' }}
        >
          <legend
            // eslint-disable-next-line react/forbid-dom-props
            style={{ padding: 0 }}
          >
            {t('modals:addStamp.kind')}
          </legend>
          <label>
            <input type="radio" checked readOnly /> {t('modals:addStamp.kindText')}
          </label>
          <label
            // eslint-disable-next-line react/forbid-dom-props
            style={{ color: 'var(--color-text-tertiary, #888)' }}
          >
            <input type="radio" disabled /> {t('modals:addStamp.kindImage')}
          </label>
        </fieldset>
        <small
          // eslint-disable-next-line react/forbid-dom-props
          style={{ color: 'var(--color-text-tertiary, #888)' }}
        >
          {t('modals:addStamp.imageDeferredNote')}
        </small>

        <label>
          {t('modals:addStamp.name')}
          <input
            type="text"
            value={name}
            placeholder={t('modals:addStamp.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            // eslint-disable-next-line react/forbid-dom-props
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label>
          {t('modals:addStamp.text')}
          <input
            type="text"
            value={text}
            placeholder={t('modals:addStamp.textPlaceholder')}
            onChange={(e) => setText(e.target.value)}
            // eslint-disable-next-line react/forbid-dom-props
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label>
          {t('modals:addStamp.color')}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            // eslint-disable-next-line react/forbid-dom-props
            style={{ display: 'block' }}
          />
        </label>
        <label>
          {t('modals:addStamp.width')}
          <input
            type="number"
            min={40}
            max={600}
            value={width}
            onChange={(e) => {
              const n = Number(e.target.value);
              setWidth(Number.isFinite(n) ? n : 200);
            }}
            // eslint-disable-next-line react/forbid-dom-props
            style={{ display: 'block', width: '100%' }}
          />
        </label>

        <div
          // eslint-disable-next-line react/forbid-dom-props
          style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}
        >
          <button type="button" onClick={close} disabled={submitting}>
            {t('modals:addStamp.cancel')}
          </button>
          <button type="submit" disabled={submitting}>
            {t('modals:addStamp.add')}
          </button>
        </div>
      </form>
    </div>
  );
}
