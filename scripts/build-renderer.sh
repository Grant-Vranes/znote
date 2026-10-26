#!/usr/bin/env bash
# Linux/macOS counterpart of scripts/build-renderer.ps1: build the bundled
# Python renderer sidecar with PyInstaller.
set -euo pipefail
cd "$(dirname "$0")/.."

OUTPUT_DIRECTORY="${1:-build/renderer-dist}"

if [ ! -x .venv/bin/python ]; then
    uv venv .venv
fi
uv --cache-dir .uv-cache pip install --python .venv/bin/python -r python/requirements.txt

SITE_PACKAGES="$(.venv/bin/python -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"

hidden_args=()
for file in "$SITE_PACKAGES"/*__mypyc*; do
    [ -e "$file" ] || continue
    name="$(basename "$file")"
    hidden_args+=(--hidden-import "${name%%.*}")
done

mkdir -p "$OUTPUT_DIRECTORY"
.venv/bin/python -m PyInstaller \
    --noconfirm --onedir --name znote-renderer \
    --distpath "$OUTPUT_DIRECTORY" --workpath build/renderer --specpath build \
    --collect-all pymdownx --collect-all markdown --collect-all pygments --collect-all yaml \
    --add-data "$(pwd)/config/render-capabilities.json:config" \
    --add-data "$SITE_PACKAGES/zensical/templates/.icons:zensical/templates/.icons" \
    --copy-metadata zensical --copy-metadata Markdown --copy-metadata pymdown-extensions --copy-metadata Pygments \
    "${hidden_args[@]}" \
    python/znote_renderer.py
