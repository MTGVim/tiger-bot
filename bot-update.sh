#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

WATCHTOWER_IMAGE="${WATCHTOWER_IMAGE:-containrrr/watchtower:latest}"

echo "== Trigger watchtower one-time update =="
docker run --rm \
  --name tiger-bot-watchtower-once \
  -v /var/run/docker.sock:/var/run/docker.sock \
  "$WATCHTOWER_IMAGE" \
  --run-once \
  --label-enable \
  --cleanup

echo "== Done =="
