#!/bin/bash
set -e

echo "=== PFM Deploy ==="

# 1) Pull latest config files (docker-compose.yml, deploy.sh, .env example).
#    Build artifacts no longer live in git — images come from GHCR.
git pull origin main

# 2) Log in to GHCR so `docker compose pull` can fetch the published images.
#    Uses GHCR_TOKEN (classic PAT with read:packages) from /srv/pfm/.env.
if [ -z "${GHCR_TOKEN:-}" ]; then
  # shellcheck disable=SC1091
  [ -f .env ] && set -a && . ./.env && set +a
fi

if [ -n "${GHCR_TOKEN:-}" ] && [ -n "${GHCR_USER:-}" ]; then
  echo "--- Logging in to ghcr.io as $GHCR_USER ---"
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
else
  echo "!! GHCR_TOKEN / GHCR_USER not set in .env — skipping docker login."
  echo "   If the GHCR packages are private, the next pull WILL fail."
  echo "   Create a classic PAT with read:packages and add:"
  echo "     GHCR_USER=brsvdmtr"
  echo "     GHCR_TOKEN=ghp_xxxxx"
  echo "   to /srv/pfm/.env"
fi

# 3) Pull the images pushed by GitHub Actions for this commit.
echo "--- Pulling images ---"
docker compose pull api bot web

# 4) Recreate containers that have new images. Postgres stays untouched.
echo "--- Restarting containers ---"
docker compose up -d

# 5) Show final status.
echo ""
echo "=== Container status ==="
docker compose ps

echo ""
echo "=== Done! ==="
