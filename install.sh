#!/usr/bin/env bash
# Installs claude-code-glance: images, screenshots and HTML pages inline in the Claude Code chat.
set -euo pipefail
REPO="https://github.com/Rocha101/claude-code-glance"
DIR="$HOME/.claude/mods/claude-code-glance"

missing=0
for bin in git jq magick; do command -v "$bin" >/dev/null || { echo "✗ missing: $bin"; missing=1; }; done
command -v chromium >/dev/null || command -v google-chrome-stable >/dev/null || command -v google-chrome >/dev/null \
  || { echo "✗ missing: chromium or google-chrome (needed for HTML pages)"; missing=1; }
[ "$missing" = 0 ] || { echo "install the missing tools and run again"; exit 1; }

if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only --quiet; else git clone --depth 1 --quiet "$REPO" "$DIR"; fi

# load it in every Claude Code session: append to CLAUDE_CODE_PLUGIN_DIRS, keep what is there
S="$HOME/.claude/settings.json"; mkdir -p "$(dirname "$S")"; [ -f "$S" ] || echo '{}' > "$S"
jq --arg d "$DIR" '.env.CLAUDE_CODE_PLUGIN_DIRS = ([(.env.CLAUDE_CODE_PLUGIN_DIRS // "" | split(":") | map(select(. != "" and . != $d))), [$d]] | add | join(":"))' "$S" > "$S.tmp" && mv "$S.tmp" "$S"

# multiplexers hide the real terminal from Claude Code: force its image support on
if [ -n "${HERDR_ENV:-}${ZELLIJ:-}" ]; then
  jq '.env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES = "1"' "$S" > "$S.tmp" && mv "$S.tmp" "$S"
fi

echo "✓ glance installed in $DIR"
echo "  open a new Claude Code session and try:  /glance <image.png | page.html> [more files...]"
