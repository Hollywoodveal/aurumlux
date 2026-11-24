#!/bin/sh
# Xcode build step: builds the Aurum web app with bun and copies the static
# output (dist/client) into the app bundle's Web folder.
#
# Set AURUM_SKIP_WEB_BUILD=1 in the scheme's environment to reuse the last
# dist/client build instead of rebuilding every time.
set -eu
REPO="${PROJECT_DIR}/.."
DIST="$REPO/dist/client"
DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/Web"
# Xcode doesn't load your shell profile, so add the usual bun locations.
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ "${AURUM_SKIP_WEB_BUILD:-0}" != "1" ]; then
  if command -v bun >/dev/null 2>&1; then
    cd "$REPO"
    [ -d node_modules ] || bun install
    bun run build
  elif [ -f "$DIST/index.html" ]; then
    echo "warning: bun not found, so the existing dist/client build was bundled. It may be out of date."
  else
    echo "error: bun is not installed. Install it with: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
fi

if [ ! -f "$DIST/index.html" ]; then
  echo "error: $DIST/index.html is missing. Run 'bun run build' in the repo."
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
# The service worker and Cloudflare routing files aren't used in the app:
# everything is already offline inside the bundle.
rsync -a --exclude ".DS_Store" --exclude "sw.js" --exclude "workbox-*.js" \
  --exclude "_redirects" --exclude "splash" "$DIST/" "$DEST/"
echo "Bundled Aurum web app into $DEST"
