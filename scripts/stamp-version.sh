#!/usr/bin/env bash
# Regenerates version.json with a fresh build id so the in-page update
# checker (js/update-check.js) can detect a new deploy via ETag polling.
# Run this immediately before `wrangler pages deploy` — see README.
set -euo pipefail
cd "$(dirname "$0")/.."

sha="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
built="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > version.json <<EOF
{
  "buildId": "${built}-${sha}",
  "commit": "${sha}",
  "builtAt": "${built}"
}
EOF

echo "Wrote version.json: $(cat version.json | tr -d '\n ')"
