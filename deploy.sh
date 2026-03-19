#!/bin/bash
set -e

echo "=== PFM Deploy ==="

# Pull latest code
git pull origin main

# Build & restart containers
docker compose build --no-cache
docker compose up -d

# Show logs
echo ""
echo "=== Container status ==="
docker compose ps

echo ""
echo "=== Done! ==="
