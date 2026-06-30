#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${NEBULA_ENV_FILE:-$ROOT_DIR/.env.local}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

FIXTURE_PATH="${NEBULA_LOCK_FIXTURE:-$ROOT_DIR/fixtures/valid-lock.json}"
CHAIN_ID="${BOUNDLESS_BASE_MARKET_CHAIN_ID:-8453}"
QUOTE_PATH="${BOUNDLESS_BASE_MARKET_QUOTE_ARTIFACT:-$ROOT_DIR/artifacts/boundless-base-market-quote.json}"

cargo run -p nebula-host -- quote-boundless-market \
  --fixture "$FIXTURE_PATH" \
  --chain-id "$CHAIN_ID" \
  --out "$QUOTE_PATH"

echo "boundless_base_market_quote=$QUOTE_PATH"
