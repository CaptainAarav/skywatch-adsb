#!/usr/bin/env python3
"""Generate MapLibre/Mapbox SDF glyph PBFs (the `{fontstack}/{range}.pbf` files) from the self-hosted fonts.

No node / fontnik needed: FreeType (via Pillow) draws each glyph at 4x, a Euclidean distance transform (SciPy)
gives the signed distance, which is sampled down to the 24 px SDF the format uses (3 px border, radius 8,
cutoff 0.25 - the same values fontnik uses).

  python3 scripts/gen-sdf-glyphs.py            # writes html/fonts/glyphs/<Stack>/<from>-<to>.pbf

Inputs are the variable woff2 files in html/fonts (Inter, JetBrains Mono; both SIL OFL 1.1, see THIRD_PARTY.md).
A static SemiBold instance (wght=600) is cut with fontTools' instancer.

Vertical placement: MapLibre puts the text baseline at (ASCENDER - 17) px below the anchor (at 24 px size), where
ASCENDER is what the glyph file stores as `top = bearingY - ASCENDER`. Fonts from other glyph servers all use
their own ascender, so text sits at a different height per font. Here ASCENDER is chosen per font so the CAP
HEIGHT is centred on the anchor: ASCENDER = 17 + capHeight / 2. A label's logo tile and its text then share one
vertical centre (ui/maplibre.js uses `vertical-align: center` for the logo).
"""
import io, os, sys
import numpy as np
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONTS = os.path.join(ROOT, 'html', 'fonts')
OUT = os.path.join(FONTS, 'glyphs')

STACKS = {
    # stack name -> (woff2 files in priority order, wght)
    'Inter SemiBold': (['inter-latin-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2'], 600),
    'JetBrains Mono SemiBold': (['jetbrains-mono-latin-wght-normal.woff2', 'jetbrains-mono-latin-ext-wght-normal.woff2'], 600),
}
SIZE = 24          # px, the size every SDF glyph is generated at
SS = 4             # supersampling factor
BORDER = 3
RADIUS = 8.0
CUTOFF = 0.25
# Calibrated on the live map (4x-zoom screenshots, see PROGRESS.md): MapLibre centres an inline image (vertical-align: center)
# on the line box, which sits 2 units (of 24) above the cap-height centre; +2 puts cap-centre and tile-centre together.
TRIM = 2


def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7f
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def zigzag(n):
    return (n << 1) ^ (n >> 31) if n >= 0 else ((-n) << 1) - 1


def fld(num, wire, payload):
    key = varint((num << 3) | wire)
    if wire == 0:
        return key + varint(payload)
    return key + varint(len(payload)) + payload


def load_instance(files, wght):
    """-> list of (PIL font at SIZE*SS, cmap, units_per_em, capHeight) for each woff2, with wght instanced."""
    res = []
    for f in files:
        tt = TTFont(os.path.join(FONTS, f))
        if 'fvar' in tt:
            tt = instancer.instantiateVariableFont(tt, {'wght': wght}, inplace=False)
        buf = io.BytesIO()
        tt.flavor = None
        tt.save(buf)
        buf.seek(0)
        pil = ImageFont.truetype(io.BytesIO(buf.getvalue()), SIZE * SS, layout_engine=ImageFont.Layout.BASIC)
        os2 = tt['OS/2']
        cap = getattr(os2, 'sCapHeight', 0) or 0.72 * tt['head'].unitsPerEm
        res.append((pil, tt.getBestCmap(), tt['head'].unitsPerEm, cap))
    return res


def render(pil, ch, ascender):
    """Return dict(w,h,left,top,adv,bitmap) for one character, or None if the glyph is empty/absent."""
    adv = pil.getlength(ch) / SS
    # tight ink box: draw on a generous scratch canvas (Pillow's getbbox is only tight vertically)
    pad = SIZE * SS
    sw = int(adv * SS) + 2 * pad
    sh = 3 * pad
    scratch = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(scratch).text((pad, 2 * pad), ch, font=pil, fill=255, anchor='ls')
    arr = np.asarray(scratch) > 127
    ys, xs = np.where(arr)
    if len(xs) == 0:                                         # space etc.
        return dict(w=0, h=0, left=0, top=-ascender, adv=int(round(adv)), bitmap=bytes((2 * BORDER) * (2 * BORDER)))
    x0, x1 = xs.min() - pad, xs.max() + 1 - pad              # relative to the baseline origin
    y0, y1 = ys.min() - 2 * pad, ys.max() + 1 - 2 * pad      # y down
    left = int(np.floor(x0 / SS))
    right = int(np.ceil(x1 / SS))
    up = int(np.ceil(-y0 / SS))                              # rows above the baseline
    down = int(np.ceil(y1 / SS))                             # rows below it (negative if the glyph floats)
    w, h = right - left, up + down
    # hi-res canvas covering the bitmap incl. border; origin (baseline, x=0) at canvas coords
    W, H = (w + 2 * BORDER) * SS, (h + 2 * BORDER) * SS
    ox = (BORDER - left) * SS
    oy = (BORDER + up) * SS
    mask = Image.new('L', (W, H), 0)
    # draw with anchor 'ls' at the origin point
    ImageDraw.Draw(mask).text((ox, oy), ch, font=pil, fill=255, anchor='ls')
    ink = np.asarray(mask) > 127
    din = distance_transform_edt(ink)                       # inside: distance to background
    dout = distance_transform_edt(~ink)                     # outside: distance to ink
    d = np.where(ink, -(din - 0.5), dout - 0.5) / SS         # signed, + outside, in 24 px units
    # sample at low-res pixel centres
    rows = (np.arange(h + 2 * BORDER) * SS + SS // 2)
    cols = (np.arange(w + 2 * BORDER) * SS + SS // 2)
    ds = d[np.ix_(rows, cols)]
    val = np.clip(255 - 255 * (ds / RADIUS + CUTOFF), 0, 255).round().astype(np.uint8)
    return dict(w=w, h=h, left=left, top=up - ascender, adv=int(round(adv)), bitmap=val.tobytes())


def encode_stack(name, rng, glyphs):
    gl = b''
    for cp in sorted(glyphs):
        g = glyphs[cp]
        body = fld(1, 0, cp) + fld(2, 2, g['bitmap']) + fld(3, 0, g['w']) + fld(4, 0, g['h']) \
            + fld(5, 0, zigzag(g['left'])) + fld(6, 0, zigzag(g['top'])) + fld(7, 0, g['adv'])
        gl += fld(3, 2, body)
    stack = fld(1, 2, name.encode()) + fld(2, 2, rng.encode()) + gl
    return fld(1, 2, stack)


def main():
    total = 0
    for name, (files, wght) in STACKS.items():
        fonts = load_instance(files, wght)
        cap_px = fonts[0][3] / fonts[0][2] * SIZE
        ascender = int(round(17 + cap_px / 2)) + TRIM
        print(f'{name}: capHeight {cap_px:.2f} px at {SIZE}px -> ASCENDER {ascender}')
        outdir = os.path.join(OUT, name)
        os.makedirs(outdir, exist_ok=True)
        for start in range(0, 65536, 256):
            glyphs = {}
            for cp in range(start, start + 256):
                if cp < 32 or 127 <= cp < 160:
                    continue
                for pil, cmap, upm, cap in fonts:
                    if cp in cmap:
                        g = render(pil, chr(cp), ascender)
                        if g:
                            glyphs[cp] = g
                        break
            if not glyphs:
                continue
            rng = f'{start}-{start + 255}'
            data = encode_stack(name, rng, glyphs)
            with open(os.path.join(outdir, rng + '.pbf'), 'wb') as f:
                f.write(data)
            total += len(data)
            print(f'  {rng}: {len(glyphs)} glyphs, {len(data)} bytes')
    print('total', total, 'bytes')


if __name__ == '__main__':
    sys.exit(main())
