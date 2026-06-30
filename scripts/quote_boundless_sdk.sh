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
QUOTE_PATH="${BOUNDLESS_SDK_QUOTE_ARTIFACT:-$ROOT_DIR/artifacts/boundless-sdk-quote.json}"

required_env=(
  BOUNDLESS_RPC_URL
  BOUNDLESS_PRIVATE_KEY
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Blocker: $name is required for Boundless SDK quote generation." >&2
    exit 1
  fi
done

cargo run -p nebula-host -- quote-boundless-sdk \
  --fixture "$FIXTURE_PATH" \
  --out "$QUOTE_PATH"

if [[ -n "${NEBULA_IMAGE_ID:-}" ]]; then
  node - "$QUOTE_PATH" "$NEBULA_IMAGE_ID" <<'NODE'
const fs = require("fs");
const [quotePath, expected] = process.argv.slice(2);
const quote = JSON.parse(fs.readFileSync(quotePath, "utf8"));
const actual = quote.proofRequest?.imageIdHex;
const normalize = (value) => String(value ?? "").replace(/^0x/i, "").toLowerCase();
if (!actual || normalize(actual) !== normalize(expected)) {
  console.error(
    `Blocker: Boundless SDK quote imageIdHex ${actual ?? "<missing>"} does not match NEBULA_IMAGE_ID ${expected}.`
  );
  process.exit(1);
}
NODE
fi

echo "boundless_sdk_quote=$QUOTE_PATH"
