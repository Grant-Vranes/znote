"""Export the approved Markdown artwork to a multi-resolution Windows icon.

Requires Pillow (only for regenerating the committed ICO, not normal builds).
Run from any directory: python scripts/build-document-icon.py
"""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "markdown-document.png"
DESTINATION = ROOT / "src-tauri" / "icons" / "markdown.ico"
SIZES = (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)


def main():
    with Image.open(SOURCE) as source:
        image = source.convert("RGBA")
        # Preserve the approved artwork, padding and transparent background.
        image.save(
            DESTINATION,
            format="ICO",
            sizes=[(size, size) for size in SIZES],
        )
    print(DESTINATION)


if __name__ == "__main__":
    main()
