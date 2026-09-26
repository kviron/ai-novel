"""Normalize generated sprite cutouts to Sprite Contract v1.

Run from apps/api with `uv run python scripts/normalize_sprite_assets.py`.
"""

import sys
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SIZE = (1024, 1536)
EMOTIONS = ("neutral", "happy", "sad", "angry", "surprised", "determined")


def remove_connected_checkerboard(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    queue = deque((x, y) for x in range(width) for y in (0, height - 1))
    queue.extend((x, y) for y in range(height) for x in (0, width - 1))
    visited = set(queue)
    while queue:
        x, y = queue.popleft()
        red, green, blue, _ = pixels[x, y]
        if max(red, green, blue) - min(red, green, blue) > 22:
            continue
        pixels[x, y] = (red, green, blue, 0)
        for point in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= point[0] < width and 0 <= point[1] < height and point not in visited:
                visited.add(point)
                queue.append(point)
    return rgba


def normalize(path: Path) -> None:
    with Image.open(path) as source:
        image = source.convert("RGBA")
        if "A" not in source.getbands() or image.getpixel((0, 0))[3] > 0:
            image = remove_connected_checkerboard(image)
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError(f"empty sprite: {path}")
    subject = image.crop(bbox)
    scale = min(976 / subject.width, 1456 / subject.height)
    subject = subject.resize((round(subject.width * scale), round(subject.height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    x = (SIZE[0] - subject.width) // 2
    y = 1504 - subject.height
    canvas.alpha_composite(subject, (x, y))
    canvas.save(path, format="PNG", optimize=True)


def largest_component(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    width, height = rgba.size
    foreground = bytearray(1 if value > 8 else 0 for value in alpha.get_flattened_data())
    largest: list[int] = []
    for start, value in enumerate(foreground):
        if not value:
            continue
        component = []
        foreground[start] = 0
        queue = [start]
        while queue:
            index = queue.pop()
            component.append(index)
            x, y = index % width, index // width
            for neighbor in (index - 1, index + 1, index - width, index + width):
                if neighbor < 0 or neighbor >= len(foreground) or not foreground[neighbor]:
                    continue
                nx, ny = neighbor % width, neighbor // width
                if abs(nx - x) + abs(ny - y) != 1:
                    continue
                foreground[neighbor] = 0
                queue.append(neighbor)
        if len(component) > len(largest):
            largest = component
    mask = Image.new("L", rgba.size, 0)
    mask_data = bytearray(len(foreground))
    original_alpha = alpha.tobytes()
    for index in largest:
        mask_data[index] = original_alpha[index]
    mask.frombytes(bytes(mask_data))
    rgba.putalpha(mask)
    return rgba


def extract_sheet(character: str, sheet: Path) -> None:
    with Image.open(sheet) as source:
        image = source.convert("RGBA")
    width, height = image.size
    destination = ROOT / "assets" / "characters" / character / "sprites"
    destination.mkdir(parents=True, exist_ok=True)
    for index, emotion in enumerate(EMOTIONS):
        left = round(index * width / len(EMOTIONS))
        right = round((index + 1) * width / len(EMOTIONS))
        frame = largest_component(image.crop((left, 0, right, height)))
        path = destination / f"{character}--{emotion}--default.png"
        frame.save(path, format="PNG")


if "--extract-legacy-sheets" in sys.argv:
    extract_sheet("akane", ROOT / "assets/characters/akane/akane-sprite-sheet-v1.png")
    extract_sheet("ashley", ROOT / "assets/characters/ashley/ashley-sprite-sheet-v2.png")
    (ROOT / "assets/characters/akane/sprites/akane--fan--default.png").write_bytes(
        (ROOT / "assets/characters/akane/sprites/akane--determined--default.png").read_bytes()
    )


for sprite in ROOT.glob("assets/characters/*/sprites/*.png"):
    normalize(sprite)
