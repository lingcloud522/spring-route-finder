#!/usr/bin/env python3
"""Generate the extension icon as a 256x256 PNG.

Design: dark rounded square with a green route and three nodes, standing for
"follow the API path to its endpoint".

Requires Pillow: pip install Pillow
"""

from pathlib import Path

from PIL import Image, ImageDraw

SUPERSAMPLE = 4
SIZE = 256
CANVAS = SIZE * SUPERSAMPLE
BACKGROUND_TOP = (15, 23, 42)
BACKGROUND_BOTTOM = (31, 41, 55)
ROUTE_COLOR = "#22C55E"
NODE_COLOR = "#FFFFFF"
NODE_HALO = "#0F172A"


def draw_background() -> Image.Image:
    gradient = Image.new("RGB", (CANVAS, CANVAS))
    draw = ImageDraw.Draw(gradient)
    for y in range(CANVAS):
        ratio = y / (CANVAS - 1)
        draw.line(
            [(0, y), (CANVAS, y)],
            fill=tuple(
                round(top + (bottom - top) * ratio)
                for top, bottom in zip(BACKGROUND_TOP, BACKGROUND_BOTTOM)
            ),
        )
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, CANVAS - 1, CANVAS - 1], radius=round(CANVAS * 0.22), fill=255
    )
    rounded = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    rounded.paste(gradient, (0, 0), mask)
    return rounded


def main() -> None:
    icon = draw_background()
    draw = ImageDraw.Draw(icon)

    waypoints = [(0.30, 0.28), (0.68, 0.47), (0.38, 0.73)]
    points = [(x * CANVAS, y * CANVAS) for x, y in waypoints]
    draw.line(points, fill=ROUTE_COLOR, width=round(CANVAS * 0.07), joint="curve")

    for x, y in points:
        halo = CANVAS * 0.105
        dot = CANVAS * 0.072
        draw.ellipse([x - halo, y - halo, x + halo, y + halo], fill=NODE_HALO)
        draw.ellipse([x - dot, y - dot, x + dot, y + dot], fill=NODE_COLOR)

    target = Path(__file__).resolve().parent.parent / "images" / "icon.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    icon.resize((SIZE, SIZE), Image.LANCZOS).convert("RGB").save(target)
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
