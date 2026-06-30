#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_PATH="${NEBULA_LOCK_FIXTURE:-$ROOT_DIR/fixtures/valid-lock.json}"
QUOTE_PATH="${BOUNDLESS_QUOTE_ARTIFACT:-$ROOT_DIR/artifacts/boundless-quote.json}"

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

required_env=(
  BOUNDLESS_RPC_URL
  BOUNDLESS_PRIVATE_KEY
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Blocker: $name is required for Boundless quote generation." >&2
    exit 1
  fi
done

cargo run -p nebula-host -- quote-boundless \
  --fixture "$FIXTURE_PATH" \
  --out "$QUOTE_PATH"

echo "boundless_quote=$QUOTE_PATH"
