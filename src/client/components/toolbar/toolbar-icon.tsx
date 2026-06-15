// Hand-built inline SVG icon set. Permissive license = our own. Sized 18x18.
// Per ui-spec §3, Phase 1 picks any permissive-licensed icons; we hand-draw to
// avoid bringing a dep in before Diego's package.json wave.

export type ToolbarIconName =
  | 'folder-open'
  | 'save'
  | 'save-as'
  | 'undo'
  | 'redo'
  | 'highlight'
  | 'sticky'
  | 'text'
  | 'underline'
  | 'strikethrough'
  | 'freehand'
  | 'shapes'
  | 'page-plus'
  | 'page-import'
  | 'page-minus'
  | 'rotate-cw'
  | 'rotate-ccw'
  | 'combine'
  | 'gear'
  | 'chevron-down'
  | 'chevron-right'
  | 'check'
  | 'close'
  | 'plus'
  // Phase 2 additions:
  | 'image-plus'
  | 'type-cursor'
  | 'printer'
  | 'file-export'
  | 'bookmark-edit'
  // Phase 3 additions:
  | 'form-edit'
  | 'mail-merge'
  // Phase 5 additions:
  | 'scan-text'
  | 'eye-low'
  | 'scanner'
  // Phase 7.4 A6 — Fill & Sign top-level toolbar entry. Acrobat convention:
  // a pen-on-paper glyph next to the forms tools.
  | 'pen-signature';

interface IconProps {
  name: ToolbarIconName;
  size?: number;
}

export function ToolbarIcon({ name, size = 18 }: IconProps): JSX.Element {
  const sw = 1.6;
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: sw,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
  switch (name) {
    case 'folder-open':
      return (
        <svg {...common}>
          <path d="M3 7 a2 2 0 0 1 2-2 h4 l2 2 h8 a2 2 0 0 1 2 2 v1" />
          <path d="M3 9 h18 l-2 9 a2 2 0 0 1-2 2 H5 a2 2 0 0 1-2-2 z" />
        </svg>
      );
    case 'save':
      return (
        <svg {...common}>
          <path d="M5 3 h11 l4 4 v13 a1 1 0 0 1-1 1 H5 a1 1 0 0 1-1-1 V4 a1 1 0 0 1 1-1 z" />
          <path d="M8 3 v5 h8 V3" />
          <path d="M7 21 v-7 h10 v7" />
        </svg>
      );
    case 'save-as':
      return (
        <svg {...common}>
          <path d="M5 3 h11 l4 4 v9" />
          <path d="M4 3 v13" />
          <path d="M8 3 v5 h8 V3" />
          <path d="M16 17 l4 4 m0-4 l-4 4" />
        </svg>
      );
    case 'undo':
      return (
        <svg {...common}>
          <path d="M3 12 a8 8 0 1 1 2 5.6" />
          <path d="M3 7 v5 h5" />
        </svg>
      );
    case 'redo':
      return (
        <svg {...common}>
          <path d="M21 12 a8 8 0 1 0-2 5.6" />
          <path d="M21 7 v5 h-5" />
        </svg>
      );
    case 'highlight':
      return (
        <svg {...common}>
          <path d="M4 19 h16" />
          <path d="M9 16 l-3 1 1-3 8-8 a2 2 0 0 1 3 3 z" />
        </svg>
      );
    case 'sticky':
      return (
        <svg {...common}>
          <path d="M5 4 h11 l4 4 v9 a2 2 0 0 1-2 2 H5 a2 2 0 0 1-2-2 V6 a2 2 0 0 1 2-2 z" />
          <path d="M16 4 v6 h6" />
        </svg>
      );
    case 'text':
      return (
        <svg {...common}>
          <path d="M5 5 v-1 h14 v1" />
          <path d="M12 4 v16" />
          <path d="M9 20 h6" />
        </svg>
      );
    case 'underline':
      return (
        <svg {...common}>
          <path d="M7 4 v8 a5 5 0 0 0 10 0 V4" />
          <path d="M5 20 h14" />
        </svg>
      );
    case 'strikethrough':
      return (
        <svg {...common}>
          <path d="M5 12 h14" />
          <path d="M16 7 a4 3 0 0 0-4-3 a4 3 0 0 0-4 3" />
          <path d="M8 17 a4 3 0 0 0 4 3 a4 3 0 0 0 4-3" />
        </svg>
      );
    case 'freehand':
      return (
        <svg {...common}>
          <path d="M4 19 C8 17 10 8 14 7 c4-1 4 6 6 6" />
        </svg>
      );
    case 'shapes':
      return (
        <svg {...common}>
          <rect x="3" y="13" width="8" height="8" />
          <circle cx="17" cy="17" r="4" />
          <path d="M9 3 l5 8 H4 z" />
        </svg>
      );
    case 'page-plus':
      return (
        <svg {...common}>
          <path d="M6 3 h9 l4 4 v14 H6 z" />
          <path d="M15 3 v5 h4" />
          <path d="M12 12 v6 m-3-3 h6" />
        </svg>
      );
    case 'page-import':
      return (
        <svg {...common}>
          <path d="M6 3 h9 l4 4 v14 H6 z" />
          <path d="M15 3 v5 h4" />
          <path d="M9 14 l3-3 3 3" />
          <path d="M12 11 v7" />
        </svg>
      );
    case 'page-minus':
      return (
        <svg {...common}>
          <path d="M6 3 h9 l4 4 v14 H6 z" />
          <path d="M15 3 v5 h4" />
          <path d="M9 15 h6" />
        </svg>
      );
    case 'rotate-cw':
      return (
        <svg {...common}>
          <path d="M20 12 a8 8 0 1 1-2.5-5.7" />
          <path d="M20 4 v5 h-5" />
        </svg>
      );
    case 'rotate-ccw':
      return (
        <svg {...common}>
          <path d="M4 12 a8 8 0 1 0 2.5-5.7" />
          <path d="M4 4 v5 h5" />
        </svg>
      );
    case 'combine':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="11" height="9" />
          <rect x="10" y="11" width="11" height="9" />
        </svg>
      );
    case 'gear':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15 a1.7 1.7 0 0 0 .4 1.9 l.1.1 a2 2 0 1 1-2.8 2.8 l-.1-.1 a1.7 1.7 0 0 0-1.9-.4 a1.7 1.7 0 0 0-1 1.5 V21 a2 2 0 0 1-4 0 v-.1 a1.7 1.7 0 0 0-1-1.5 a1.7 1.7 0 0 0-1.9.4 l-.1.1 a2 2 0 1 1-2.8-2.8 l.1-.1 a1.7 1.7 0 0 0 .4-1.9 a1.7 1.7 0 0 0-1.5-1 H3 a2 2 0 0 1 0-4 h.1 a1.7 1.7 0 0 0 1.5-1 a1.7 1.7 0 0 0-.4-1.9 l-.1-.1 a2 2 0 1 1 2.8-2.8 l.1.1 a1.7 1.7 0 0 0 1.9.4 a1.7 1.7 0 0 0 1-1.5 V3 a2 2 0 0 1 4 0 v.1 a1.7 1.7 0 0 0 1 1.5 a1.7 1.7 0 0 0 1.9-.4 l.1-.1 a2 2 0 1 1 2.8 2.8 l-.1.1 a1.7 1.7 0 0 0-.4 1.9 a1.7 1.7 0 0 0 1.5 1 H21 a2 2 0 0 1 0 4 h-.1 a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case 'chevron-down':
      return (
        <svg {...common}>
          <path d="M6 9 l6 6 6-6" />
        </svg>
      );
    case 'chevron-right':
      return (
        <svg {...common}>
          <path d="M9 6 l6 6-6 6" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M5 12 l5 5 9-11" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <path d="M6 6 l12 12 M6 18 L18 6" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5 v14 M5 12 h14" />
        </svg>
      );
    case 'image-plus':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="14" height="14" rx="1" />
          <circle cx="8" cy="9" r="1.5" />
          <path d="M3 15 l4-4 4 4 3-3 3 3" />
          <path d="M19 4 v6 M16 7 h6" />
        </svg>
      );
    case 'type-cursor':
      return (
        <svg {...common}>
          <path d="M9 4 h6 M9 20 h6 M12 4 v16" />
          <path d="M6 8 v8" />
        </svg>
      );
    case 'printer':
      return (
        <svg {...common}>
          <path d="M6 9 V4 h12 v5" />
          <rect x="3" y="9" width="18" height="9" rx="1" />
          <rect x="6" y="14" width="12" height="6" />
          <circle cx="17.5" cy="12.5" r="0.6" />
        </svg>
      );
    case 'file-export':
      return (
        <svg {...common}>
          <path d="M6 3 h9 l4 4 v14 H6 z" />
          <path d="M15 3 v5 h4" />
          <path d="M10 16 l4-4 m0 4 l-4-4" />
          <path d="M9 19 h6" />
        </svg>
      );
    case 'bookmark-edit':
      return (
        <svg {...common}>
          <path d="M6 3 h12 v18 l-6-4-6 4 z" />
          <path d="M12 9 l3 3-5 5 H8 v-2 z" />
        </svg>
      );
    case 'form-edit':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="6" rx="1" />
          <rect x="3" y="14" width="11" height="6" rx="1" />
          <path d="M15 17 l5-5 2 2-5 5h-2z" />
        </svg>
      );
    case 'mail-merge':
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="1" />
          <path d="M3 7 l9 7 9-7" />
          <path d="M8 18 v3 M12 18 v3 M16 18 v3" />
        </svg>
      );
    // Phase 5 — Run OCR: a scan-frame around text rows.
    case 'scan-text':
      return (
        <svg {...common}>
          <path d="M4 7 V5 a1 1 0 0 1 1-1 h2 M17 4 h2 a1 1 0 0 1 1 1 v2 M20 17 v2 a1 1 0 0 1-1 1 h-2 M7 20 H5 a1 1 0 0 1-1-1 v-2" />
          <path d="M7 10 h10 M7 13 h10 M7 16 h6" />
        </svg>
      );
    // Phase 5 — Confidence overlay: eye with a small marker for low conf.
    case 'eye-low':
      return (
        <svg {...common}>
          <path d="M2 12 s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    // Phase 5 — Scanner device.
    case 'scanner':
      return (
        <svg {...common}>
          <rect x="3" y="10" width="18" height="7" rx="1" />
          <path d="M5 10 V7 a1 1 0 0 1 1-1 h12 a1 1 0 0 1 1 1 v3" />
          <path d="M7 14 h10" />
        </svg>
      );
    // Phase 7.4 A6 — Fill & Sign: pen-on-paper glyph (a fountain-pen nib
    // tracing a signature stroke over a document corner). The Acrobat-style
    // visual hint distinguishes this from the freehand-ink tool (which is a
    // simple wavy stroke) and from the form-edit tool (which shows form
    // boxes). Drawn at the same 24-unit canvas as the rest of the set.
    case 'pen-signature':
      return (
        <svg {...common}>
          {/* Page corner */}
          <path d="M4 4 h10 l4 4 v6" />
          <path d="M14 4 v4 h4" />
          {/* Signature scribble underline */}
          <path d="M4 19 c2-1 4 1 6 0 c2-1 4 1 6 0 c2-1 4 1 6 0" />
          {/* Pen nib + barrel pointing down-right onto the scribble */}
          <path d="M16 11 l4 4 -3 3 -4-4 z" />
          <path d="M14 13 l-3 3" />
        </svg>
      );
  }
}
