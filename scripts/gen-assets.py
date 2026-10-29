#!/usr/bin/env python3
"""Generate the site's static image assets with Pillow.

Everything here is drawn from primitives: a monogram, a favicon, app icons and a
social-preview card. No external images, no fonts to fetch — the shapes are
positioned against the same palette as styles.css so the brand stays consistent.

    python3 scripts/gen-assets.py

Palette: #000010 (background), #00ffff (cyan), #7b61ff (violet).
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

BG = (0, 0, 16)
BG_SOFT = (2, 6, 23)
CYAN = (0, 255, 255)
VIOLET = (123, 97, 255)
TEXT = (229, 231, 235)
DIM = (148, 163, 184)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SS = 4  # supersampling factor


def find_font(size):
    """Pick a usable font: DejaVu is almost always present on Linux."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def gradient_layer(width, height, top, bottom):
    """Vertical gradient built as a 1px-wide column, then resized."""
    column = Image.new("RGB", (1, height))
    px = column.load()
    for y in range(height):
        t = y / max(height - 1, 1)
        px[0, y] = (
            round(top[0] + (bottom[0] - top[0]) * t),
            round(top[1] + (bottom[1] - top[1]) * t),
            round(top[2] + (bottom[2] - top[2]) * t),
        )
    return column.resize((width, height), Image.BICUBIC)


def draw_monogram(draw, size, ring=True):
    """A rounded square with an 'F' drawn as rectangles.

    Pillow's y-axis grows downward, so every bar is a rectangle from a top-left
    origin rather than a line between two points.
    """
    if ring:
        margin = size * 0.03
        draw.rounded_rectangle(
            [margin, margin, size - margin, size - margin],
            radius=size * 0.22,
            outline=CYAN,
            width=max(2, int(size * 0.035)),
        )

    stroke = max(2, int(size * 0.085))
    # Vertical stem of the F.
    left = size * 0.33
    top = size * 0.26
    bottom = size * 0.74
    draw.rectangle([left, top, left + stroke, bottom], fill=CYAN)
    # Top bar.
    draw.rectangle([left, top, size * 0.67, top + stroke], fill=CYAN)
    # Middle bar, slightly shorter.
    mid = top + (bottom - top) * 0.42
    draw.rectangle([left, mid, size * 0.60, mid + stroke * 0.85], fill=VIOLET)


def icon(size, rounded=True):
    canvas = Image.new("RGB", (size * SS, size * SS), BG)
    draw = ImageDraw.Draw(canvas)
    if rounded:
        draw.rounded_rectangle(
            [0, 0, size * SS - 1, size * SS - 1],
            radius=size * SS * 0.22,
            fill=BG_SOFT,
        )
    draw_monogram(draw, size * SS)
    return canvas.resize((size, size), Image.LANCZOS)


def write_favicon_svg():
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Fortune Owivri monogram">
  <rect width="64" height="64" rx="14" fill="#020617"/>
  <rect x="2" y="2" width="60" height="60" rx="13" fill="none" stroke="#00ffff" stroke-width="2.2"/>
  <rect x="21" y="17" width="5.5" height="31" fill="#00ffff"/>
  <rect x="21" y="17" width="22" height="5.5" fill="#00ffff"/>
  <rect x="21" y="32" width="17" height="4.8" fill="#7b61ff"/>
</svg>
"""
    path = os.path.join(ROOT, "favicon.svg")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(svg)
    print("wrote favicon.svg")


def og_image(width=1424, height=752):
    """Social preview card: name, role, and the three evidence labels."""
    W, H = width * 2, height * 2  # draw large, then downsample
    canvas = gradient_layer(W, H, (11, 11, 26), (0, 0, 16)).convert("RGB")
    draw = ImageDraw.Draw(canvas)

    # Faint starfield.
    import random

    rng = random.Random(20470)
    for _ in range(320):
        x = rng.randrange(W)
        y = rng.randrange(H)
        r = rng.choice([1, 1, 1, 2])
        shade = rng.choice([40, 60, 90, 120])
        draw.ellipse([x, y, x + r, y + r], fill=(shade // 3, shade // 2, shade))

    # Soft corner glows: an RGBA overlay of stacked circles, composited once so
    # the falloff stays smooth instead of banding into visible discs.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    for cx, cy, colour in ((W * 0.84, H * 0.16, VIOLET), (W * 0.10, H * 0.92, CYAN)):
        steps = 60
        for step in range(steps, 0, -1):
            radius = step * (W * 0.0042)
            gdraw.ellipse(
                [cx - radius, cy - radius, cx + radius, cy + radius],
                fill=(colour[0], colour[1], colour[2], 3),
            )
    canvas = Image.alpha_composite(canvas.convert("RGBA"), glow).convert("RGB")
    draw = ImageDraw.Draw(canvas)

    # Top accent rule.
    draw.rectangle([W * 0.08, H * 0.13, W * 0.08 + W * 0.10, H * 0.13 + 8], fill=CYAN)

    # Monogram inside a plate, top-left area.
    plate = int(H * 0.19)
    px, py = int(W * 0.08), int(H * 0.20)
    draw.rounded_rectangle(
        [px, py, px + plate, py + plate],
        radius=int(plate * 0.22),
        fill=BG_SOFT,
        outline=(0, 90, 100),
        width=3,
    )
    inner = Image.new("RGBA", (plate, plate), (0, 0, 0, 0))
    idraw = ImageDraw.Draw(inner)
    draw_monogram(idraw, plate, ring=False)
    canvas.paste(inner, (px, py), inner)

    title_font = find_font(int(H * 0.115))
    sub_font = find_font(int(H * 0.048))
    small_font = find_font(int(H * 0.036))

    x = int(W * 0.08)
    y = int(H * 0.50)
    draw.text((x, y), "Fortune Owivri", font=title_font, fill=CYAN)
    draw.text(
        (x, y + int(H * 0.145)),
        "IT support · systems · security",
        font=sub_font,
        fill=TEXT,
    )
    draw.text(
        (x, y + int(H * 0.225)),
        "Case studies, a SOC log-triage lab, and every number labelled by source.",
        font=small_font,
        fill=DIM,
    )

    # Evidence chips.
    chips = [("Job result", DIM), ("Lab exercise", VIOLET), ("Tested", (123, 255, 208))]
    cx = x
    cy = int(H * 0.845)
    chip_font = find_font(int(H * 0.032))
    for text, colour in chips:
        bbox = draw.textbbox((0, 0), text, font=chip_font)
        tw = bbox[2] - bbox[0]
        pad_x, pad_y = int(H * 0.022), int(H * 0.013)
        draw.rounded_rectangle(
            [cx, cy, cx + tw + pad_x * 2, cy + bbox[3] + pad_y * 2],
            radius=int(H * 0.03),
            outline=colour,
            width=2,
        )
        draw.text((cx + pad_x, cy + pad_y - bbox[1]), text, font=chip_font, fill=colour)
        cx += tw + pad_x * 2 + int(H * 0.02)

    canvas = canvas.resize((width, height), Image.LANCZOS)
    path = os.path.join(ROOT, "og-image.png")
    canvas.save(path, "PNG", optimize=True)
    print("wrote og-image.png (%dx%d)" % (width, height))


def main():
    write_favicon_svg()

    icon(192).save(os.path.join(ROOT, "icon-192.png"), "PNG", optimize=True)
    print("wrote icon-192.png")

    icon(512).save(os.path.join(ROOT, "icon-512.png"), "PNG", optimize=True)
    print("wrote icon-512.png")

    apple = icon(180)
    # Apple touch icons must be opaque.
    flat = Image.new("RGB", (180, 180), BG)
    flat.paste(apple, (0, 0), apple if apple.mode == "RGBA" else None)
    flat.save(os.path.join(ROOT, "apple-touch-icon.png"), "PNG", optimize=True)
    print("wrote apple-touch-icon.png")

    og_image()


if __name__ == "__main__":
    main()
