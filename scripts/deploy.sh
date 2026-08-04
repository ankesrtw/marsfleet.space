#!/usr/bin/env bash
# Deploys the game to Cloudflare Pages (marsfleet-space project).
#
# Deploys from a clean staging copy rather than the repo root directly,
# because `wrangler pages deploy` auto-excludes anything matched by
# .gitignore — which is right for .env.marsfleet (a secret) and
# version.json is the opposite case: it's gitignored (regenerated per
# deploy, shouldn't be committed) but MUST reach the deployed bundle, since
# it's what the in-page update checker (js/update-check.js) polls. Staging
# lets us apply different rules for "don't commit" vs "don't ship."
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env.marsfleet ]; then
    set -a; source .env.marsfleet; set +a
else
    echo "error: .env.marsfleet not found (need CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)" >&2
    exit 1
fi

./scripts/stamp-version.sh

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# rsync the deployable surface only: game assets + functions/, not
# dev/planning/secret files or the D1 schema/wrangler config (not meant to
# be publicly servable static assets — the D1 binding itself is set on the
# Pages project, not read from wrangler.toml at deploy time).
rsync -a \
    --exclude='.git' \
    --exclude='.gitignore' \
    --exclude='.env*' \
    --exclude='docs' \
    --exclude='scripts' \
    --exclude='README.md' \
    --exclude='wrangler.toml' \
    --exclude='d1' \
    --exclude='.wrangler' \
    ./ "$STAGE"/

wrangler pages deploy "$STAGE" --project-name marsfleet-space --commit-dirty=true

echo "Deployed. version.json buildId: $(node -pe "require('./version.json').buildId")"
