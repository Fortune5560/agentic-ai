#!/usr/bin/env python3
"""Generate the Augur social-preview card (og-image.png, 1424x752).

Pillow only — no external fonts fetched, no network. The wordmark is split along
a diagonal: "Aug" in cyan, "ur" in violet, with a soft starfield behind it, which
is the same palette the site uses in styles.css (:root tokens).

    python3 scripts/gen-og-image.py
"""

from __future__ import annotations

import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

BG_TOP = (11, 11, 26)
BG_BOTTOM = (0, 0, 16)
CYAN = (0, 255, 255)
VIOLET = (123, 97, 255)
DIM = (148, 163, 184)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1424, 752
SS = 2  # draw at 2x then downsample

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def vertical_gradient(width: int, height: int) -> Image.Image:
    column = Image.new("RGB", (1, height))
    px = column.load()
    for y in range(height):
        t = y / max(height - 1, 1)
        px[0, y] = (
            round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
            round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
            round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
        )
    return column.resize((width, height), Image.BICUBIC)


def starfield(width: int, height: int, count: int = 420) -> Image.Image:
    """Stars on an RGBA layer; brighter ones get a faint halo."""
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    rng = random.Random(20261101)
    for _ in range(count):
        x = rng.randrange(width)
        y = rng.randrange(height)
        r = rng.choice([1, 1, 1, 2, 2, 3])
        shade = rng.choice([70, 95, 120, 150, 190])
        tint = (int(shade * 0.75), int(shade * 0.9), shade)
        draw.ellipse([x, y, x + r, y + r], fill=tint + (rng.choice([110, 160, 210]),))
        if r >= 3:
            draw.ellipse([x - 3, y - 3, x + 3, y + 3], fill=tint + (28,))
    return layer.filter(ImageFilter.GaussianBlur(0.4))


def glow(word: str, size: int, colour, radius: int = 26) -> Image.Image:
    """Render text on its own layer and blur a copy underneath it."""
    fnt = font(size)
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    box = probe.textbbox((0, 0), word, font=fnt)
    pad = radius * 3
    layer = Image.new("RGBA", (box[2] - box[0] + pad * 2, box[3] - box[1] + pad * 2), (0, 0, 0, 0))

    halo = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    ImageDraw.Draw(halo).text((pad - box[0], pad - box[1]), word, font=fnt, fill=colour + (255,))
    halo = halo.filter(ImageFilter.GaussianBlur(radius))
    layer = Image.alpha_composite(layer, halo)

    core = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    ImageDraw.Draw(core).text((pad - box[0], pad - box[1]), word, font=fnt, fill=(245, 255, 255, 255))
    layer = Image.alpha_composite(layer, core)

    # Keep the cyan/violet identity in the core too, not just the glow.
    tinted = Image.new("RGBA", layer.size, colour + (0,))
    tinted.putalpha(layer.getchannel("A"))
    layer = Image.blend(layer, tinted, 0.45)

    # Crop away the padding so the caller can measure and position exactly.
    bounds = layer.getbbox()
    return layer.crop(bounds) if bounds else layer


def fit_font(text: str, target_w: int, start: int, floor: int = 12) -> ImageFont.FreeTypeFont:
    """Largest font size that keeps `text` within target_w pixels."""
    size = start
    while size > floor:
        fnt = font(size)
        box = ImageDraw.Draw(Image.new("RGB", (8, 8))).textbbox((0, 0), text, font=fnt)
        if box[2] - box[0] <= target_w:
            return fnt
        size -= 4
    return font(floor)


def wrap(text: str, fnt, max_w: int) -> list[str]:
    words = text.split()
    lines, current = [], ""
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    for word in words:
        candidate = (current + " " + word).strip()
        box = probe.textbbox((0, 0), candidate, font=fnt)
        if box[2] - box[0] <= max_w or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def main() -> None:
    width, height = W * SS, H * SS
    canvas = vertical_gradient(width, height).convert("RGBA")

    # Nebula wash: two big soft ellipses, composited once to avoid banding.
    wash = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    wdraw = ImageDraw.Draw(wash)
    wdraw.ellipse(
        [width * 0.52, -height * 0.35, width * 1.25, height * 0.95],
        fill=(60, 40, 130, 70),
    )
    wdraw.ellipse(
        [-width * 0.2, height * 0.35, width * 0.55, height * 1.3],
        fill=(0, 90, 110, 55),
    )
    wash = wash.filter(ImageFilter.GaussianBlur(90))
    canvas = Image.alpha_composite(canvas, wash)
    canvas = Image.alpha_composite(canvas, starfield(width, height))

    # ---- wordmark: "Aug" cyan + "ur" violet, sized to fit the card ----
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    main_size = 1
    for candidate in range(int(height * 0.30), 40, -4):
        fnt = font(candidate)
        box = probe.textbbox((0, 0), "Augur", font=fnt)
        if (box[2] - box[0]) * 1.06 <= width * 0.72:  # glow adds ~6%
            main_size = candidate
            break

    aug = glow("Aug", main_size, CYAN, radius=max(8, int(height * 0.022)))
    ur = glow("ur", main_size, VIOLET, radius=max(8, int(height * 0.022)))
    # Tighten the join: part-crops carry a couple of pixels of bearing each.
    overlap = max(6, int(main_size * 0.10))
    word_w = aug.width + ur.width - overlap
    word_h = max(aug.height, ur.height)

    wx = (width - word_w) // 2
    wy = int(height * 0.20)
    canvas.alpha_composite(aug, (wx, wy))
    canvas.alpha_composite(ur, (wx + aug.width - overlap, wy + (word_h - ur.height)))

    draw = ImageDraw.Draw(canvas)

    # ---- rule, then subtitle, then tagline — all measured, nothing overlaps ----
    rule_y = wy + word_h + int(height * 0.055)
    draw.rounded_rectangle(
        [width * 0.32, rule_y, width * 0.68, rule_y + max(3, 3 * SS)],
        radius=2 * SS,
        fill=(0, 255, 255, 85),
    )

    sub = "Augur Ops · Augur Research · Augur Desk"
    f_sub = fit_font(sub, int(width * 0.72), int(height * 0.062))
    sub_box = probe.textbbox((0, 0), sub, font=f_sub)
    sub_y = rule_y + int(height * 0.055)
    draw.text(
        ((width - (sub_box[2] - sub_box[0])) // 2, sub_y),
        sub,
        font=f_sub,
        fill=(196, 205, 220),
    )

    tag = "Agents that watch the signals, decide, and stop before the irreversible one."
    f_tag = fit_font(tag, int(width * 0.80), int(height * 0.044))
    lines = wrap(tag, f_tag, int(width * 0.80))
    line_h = probe.textbbox((0, 0), "Ag", font=f_tag)[3] * 1.45
    tag_y = sub_y + sub_box[3] + int(height * 0.045)
    for i, line in enumerate(lines):
        box = probe.textbbox((0, 0), line, font=f_tag)
        draw.text(
            ((width - (box[2] - box[0])) // 2, tag_y + i * line_h),
            line,
            font=f_tag,
            fill=(122, 134, 158),
        )

    out = canvas.convert("RGB").resize((W, H), Image.LANCZOS)
    path = os.path.join(ROOT, "og-image.png")
    out.save(path, "PNG", optimize=True)
    print("wrote og-image.png (%dx%d, %d KB)" % (W, H, os.path.getsize(path) // 1024))


if __name__ == "__main__":
    main()
