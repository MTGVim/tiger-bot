#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "== Pull latest code =="
git pull --ff-only

echo "== Update images =="
docker compose pull

echo "== Recreate containers =="
docker compose up -d --build --remove-orphans

echo "== Done =="
