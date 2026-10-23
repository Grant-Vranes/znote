# Markdown document icon

`markdown-document.png` is the transparent artwork generated with the built-in
imagegen tool and approved for ZNote's Windows Markdown file association.
It is distinct from the application's `icon.svg`.

Design prompt: an upright ivory-white document with a folded upper-right corner,
a dark slate outline, a bold M and downward arrow, a muted blue fold, restrained
shading, and a transparent background. No ZNote logo or application tile.

Regenerate `src-tauri/icons/markdown.ico` with:

```powershell
python -m pip install Pillow
python scripts/build-document-icon.py
```

The ICO contains 16, 20, 24, 32, 40, 48, 64, 96, 128 and 256 pixel images.
Normal application builds use the committed ICO and do not require Pillow.
Tauri installs it as `icons/markdown.ico`; the NSIS hook references that path
for `ZNote.Markdown` and refreshes Shell associations after install/uninstall.

To verify on Windows, install over a previous version with ZNote selected as the
default Markdown handler. Check `.md` and `.markdown` icons in Explorer at small
and large sizes, double-click to open them, and confirm the application shortcut
still has its original icon. Also check a fresh install and uninstall: installation
must preserve another chosen default handler, and uninstall must remove the
bundled icon and ZNote's registration.
