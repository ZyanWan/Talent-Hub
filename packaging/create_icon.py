from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "references" / "ico_refer" / "图标3-极简主义.png"
OUTPUT = ROOT / "assets" / "app-icon.ico"
WEB_OUTPUT = ROOT / "app" / "static" / "app-icon.png"
ICON_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
MASTER_SIZE = 1024
FOREGROUND_PADDING_RATIO = 0.08
CORNER_RADIUS_RATIO = 0.22


def _foreground_bounds(image: Image.Image) -> tuple[int, int, int, int]:
    red, green, blue = image.convert("RGB").split()
    blue_over_red = ImageChops.subtract(blue, red).point(
        lambda value: 255 if value >= 18 else 0
    )
    blue_over_green = ImageChops.subtract(blue, green).point(
        lambda value: 255 if value >= 5 else 0
    )
    bounds = ImageChops.multiply(blue_over_red, blue_over_green).getbbox()
    if bounds is None:
        raise ValueError(f"Icon foreground was not found in {SOURCE}")
    return bounds


def _prepare_icon(source: Image.Image) -> Image.Image:
    image = source.convert("RGB")
    left, top, right, bottom = _foreground_bounds(image)
    foreground_size = max(right - left, bottom - top)
    crop_size = round(foreground_size * (1 + 2 * FOREGROUND_PADDING_RATIO))
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    crop_left = round(center_x - crop_size / 2)
    crop_top = round(center_y - crop_size / 2)
    crop_box = (crop_left, crop_top, crop_left + crop_size, crop_top + crop_size)

    icon = image.crop(crop_box).resize(
        (MASTER_SIZE, MASTER_SIZE),
        Image.Resampling.LANCZOS,
    ).convert("RGBA")
    alpha = Image.new("L", icon.size, 0)
    ImageDraw.Draw(alpha).rounded_rectangle(
        (0, 0, MASTER_SIZE - 1, MASTER_SIZE - 1),
        radius=round(MASTER_SIZE * CORNER_RADIUS_RATIO),
        fill=255,
    )
    icon.putalpha(alpha)
    return icon


def build_icon() -> Path:
    with Image.open(SOURCE) as source:
        image = _prepare_icon(source)

    web_image = image.resize((256, 256), Image.Resampling.LANCZOS)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    WEB_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT, format="ICO", sizes=ICON_SIZES)
    web_image.save(WEB_OUTPUT, format="PNG", optimize=True)
    return OUTPUT


if __name__ == "__main__":
    print(build_icon())
