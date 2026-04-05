"""Toolbar icons: sage + red stacked dots on UI cream square (needs Pillow)."""
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    raise SystemExit("Install Pillow: pip install pillow")

# Matches overlay card / dashboard surfaces (#fffef9)
SURFACE = (255, 254, 249, 255)
SAGE = (138, 158, 140, 255)  # #8a9e8c
RED = (226, 75, 74, 255)  # #e24b4a
ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"


def make_icon(size: int, path: Path) -> None:
    img = Image.new("RGBA", (size, size), SURFACE)
    draw = ImageDraw.Draw(img)
    cx = size // 2
    r_dot = max(2, int(size * 0.14))
    # Space between dot edges (slightly more than half a diameter)
    gap = max(2, int(r_dot * 0.95))
    y_top = cx - r_dot - gap // 2
    y_bot = cx + r_dot + gap // 2
    draw.ellipse(
        [cx - r_dot, y_top - r_dot, cx + r_dot, y_top + r_dot], fill=SAGE
    )
    draw.ellipse(
        [cx - r_dot, y_bot - r_dot, cx + r_dot, y_bot + r_dot], fill=RED
    )
    img.save(path, "PNG")


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    for s in (16, 48, 128):
        make_icon(s, ICONS / f"icon{s}.png")
    print("Wrote", ICONS / "icon16.png", ICONS / "icon48.png", ICONS / "icon128.png")


if __name__ == "__main__":
    main()
