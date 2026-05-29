# Application Icon — PDF Viewer & Editor (v2, PDF-first)

Produced 2026-05-29 by the SuperiorAg marketing-os brand/design team. **v2**
replaces the v1 SSI-swoosh mark (rejected). New direction: the icon is led by
the fact that this is a **PDF tool** — a document with an unmistakable "PDF"
identity is the hero. **All SSI branding (the "S" swoosh) was dropped.**

## Design rationale

A modern flat/vector **app mark** built on the universally recognized PDF-file
look, designed to read at 16px (taskbar/titlebar) up to 256px (installer).

- **Rounded-square plate** (modern Windows/macOS app-icon convention) in a soft
  cool-neutral gradient (`#f4f6fa → #dfe4ec`) so the white page + red badge pop.
- **White document page with a folded top-right corner** — the classic,
  unambiguous "document" silhouette that holds its shape at any size.
- **Bold red "PDF" ribbon/badge** spanning the lower page — **the focal point.**
  Red (`#F03A33 → #D11F22`) is the universally-established PDF color, so the mark
  reads as "PDF" instantly. The ribbon has a flagged/notched left end so it reads
  as a badge, not a plain bar. The white **"PDF"** wordmark is set in a heavy
  900-weight sans.

This is an **original** mark that evokes the PDF *convention* (red + document +
"PDF" label). It deliberately does **not** copy the Adobe Acrobat logo or any
vendor mark.

### Graceful degradation by size
| Size | What carries the identity |
|---|---|
| 16px | document silhouette + a clear red band (the "PDF" text simplifies away — by design) |
| 24–32px | red ribbon legible; "PDF" begins to resolve |
| 48px+ | full "document + red PDF badge" reads cleanly |
| 256px | crisp hero for the NSIS installer |

### Palette used
| Token | Hex | Use |
|---|---|---|
| PDF red (hero) | `#F03A33` / `#D11F22` | the PDF ribbon/badge — the instant-recognition signal |
| Page white | `#ffffff` → `#eef1f6` | document body |
| Fold shade | `#cfd6e2` → `#aab4c6` | folded-corner triangle |
| Plate neutral | `#f4f6fa` → `#dfe4ec` | rounded-square app plate |

No SSI / brand-specific colors are used — the palette is anchored entirely on the
PDF red convention per the v2 brief.

## Files produced

| File | What | Notes |
|---|---|---|
| `icon.svg` | Master vector source (512×512 viewBox) | Hand-authored; edit this, re-render the rest |
| `icon.png` | 512×512 PNG raster master | Rendered from SVG via `sharp-cli` |
| `icon.ico` | Windows multi-res ICO | 7 PNG-compressed layers: 16, 24, 32, 48, 64, 128, 256 |
| `icon.icns` | macOS icon | Full Retina set (16…1024) via `png2icons` |

## Tooling used

ImageMagick is **not installed** on this host (the `convert` on PATH is Windows'
disk tool, not IM). Used `npx --yes` one-offs — **no npm deps added, no
`npm install`, `package.json` untouched**:

- **SVG → PNG master:** `npx --yes sharp-cli --input icon.svg --output icon.png resize 512 512`
- **PNG → per-size layers:** `sharp-cli ... resize <n> <n>` for 16/24/32/48/64/128/256
- **layers → multi-res ICO:** a **hand-authored Node ICONDIR encoder** (png-to-ico
  collapses layers to BMP, so a small Node script writes a proper 7-layer
  PNG-payload ICO container instead — see "Regenerating" below).
- **PNG → ICNS:** `npx --yes png2icons icon.png icon -icns -i`

## Verification proof — `icon.ico` is valid multi-resolution

ImageMagick `identify` was unavailable, so the ICONDIR was parsed directly in
Node (header + each ICONDIRENTRY + PNG-signature check on each payload):

```
Header: reserved=0 type=1 (1=icon) count=7
  layer 0: 16x16   32bpp    784 bytes  payload=PNG
  layer 1: 24x24   32bpp   1338 bytes  payload=PNG
  layer 2: 32x32   32bpp   2051 bytes  payload=PNG
  layer 3: 48x48   32bpp   3544 bytes  payload=PNG
  layer 4: 64x64   32bpp   4816 bytes  payload=PNG
  layer 5: 128x128 32bpp  10699 bytes  payload=PNG
  layer 6: 256x256 32bpp  23442 bytes  payload=PNG
Sizes present: [16, 24, 32, 48, 64, 128, 256]
Matches required set [16,24,32,48,64,128,256]: YES
256px layer (NSIS hard requirement): PRESENT
```

`icon.icns` verified: magic `icns`, declared length (312097) == file size, embedded
types `ic12 ic07 ic13 ic08 ic14 ic09 ic10 ic11 il32 l8mk is32 s8mk` (16…1024px).

To re-verify on a host with ImageMagick: `magick identify build/icon.ico`.

## Wiring for Diego (electron-builder.yml)

```yaml
win:
  icon: build/icon.ico

nsis:
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico   # optional, same asset

# when a mac: block is added later:
mac:
  icon: build/icon.icns
```

That clears the "default Electron icon is used — application icon is not set"
warning. The asset paths above are correct as written.

## Regenerating after an SVG edit

```bash
cd build
npx --yes sharp-cli --input icon.svg --output icon.png resize 512 512
mkdir -p .iconsrc
for s in 16 24 32 48 64 128 256; do \
  npx --yes sharp-cli --input icon.png --output .iconsrc/icon-$s.png resize $s $s; done
# Hand-authored ICONDIR encoder (Node) over .iconsrc/icon-*.png -> ../icon.ico:
#   reads each PNG, writes a 6-byte ICONDIR (type=1, count=7) + one 16-byte
#   ICONDIRENTRY per layer (width/height 1 byte, 0=256; planes=1; bpp=32;
#   bytesInRes; imageOffset), then concatenates the raw PNG payloads.
npx --yes png2icons icon.png icon -icns -i
rm -rf .iconsrc
```
