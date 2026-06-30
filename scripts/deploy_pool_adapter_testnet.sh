#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${NEBULA_ENV_FILE:-$ROOT_DIR/.env.local}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

ARTIFACT_DIR="${NEBULA_ARTIFACT_DIR:-$ROOT_DIR/artifacts/demo}"
WASM_PATH="${NEBULA_POOL_ADAPTER_WASM:-$ROOT_DIR/target/wasm32v1-none/release/nebula_pool_adapter_contract.wasm}"
NETWORK="${STELLAR_NETWORK:-testnet}"
SOURCE="${STELLAR_SOURCE:-}"

usage() {
  cat <<'USAGE'
Usage: scripts/deploy_pool_adapter_testnet.sh

Builds, deploys, and initializes the Nebula private-note handoff adapter.

Required:
  STELLAR_SOURCE    Funded Stellar CLI identity

Optional:
  STELLAR_NETWORK   Stellar CLI network (default: testnet)
  NEBULA_ADMIN      Admin address (default: stellar keys address STELLAR_SOURCE)
  NEBULA_ARTIFACT_DIR
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if ! command -v stellar >/dev/null 2>&1; then
  echo "Blocker: Stellar CLI is not installed or not on PATH." >&2
  exit 1
fi

if [ -z "$SOURCE" ]; then
  echo "Blocker: STELLAR_SOURCE is required." >&2
  exit 1
fi

mkdir -p "$ARTIFACT_DIR"

(cd "$ROOT_DIR" && stellar contract build)

if [ ! -f "$WASM_PATH" ]; then
  echo "Blocker: expected pool adapter WASM not found at $WASM_PATH" >&2
  exit 1
fi

admin="${NEBULA_ADMIN:-}"
if [ -z "$admin" ]; then
  admin="$(stellar keys address "$SOURCE")"
fi

echo "Deploying NebulaPoolAdapter to Stellar $NETWORK..."
contract_id="$(
  stellar contract deploy \
    --wasm "$WASM_PATH" \
    --source "$SOURCE" \
    --network "$NETWORK" |
    tail -n 1 |
    tr -d '\r'
)"

if [ -z "$contract_id" ]; then
  echo "Blocker: Stellar CLI did not return a pool adapter contract ID." >&2
  exit 1
fi

stellar contract invoke \
  --id "$contract_id" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- \
  initialize \
  --admin "$admin"

cat > "$ARTIFACT_DIR/pool-adapter-testnet.env" <<EOF
STELLAR_NETWORK=$NETWORK
STELLAR_SOURCE=$SOURCE
POOL_ADAPTER_CONTRACT_ID=$contract_id
NEBULA_ADMIN=$admin
EOF

node - "$ARTIFACT_DIR/pool-adapter-testnet.json" "$contract_id" "$NETWORK" "$SOURCE" "$admin" <<'NODE'
const fs = require("fs");
const [path, contractId, network, source, admin] = process.argv.slice(2);
fs.writeFileSync(
  path,
  `${JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      network,
      source,
      contracts: {
        poolAdapter: contractId,
      },
      admin,
      initialized: true,
    },
    null,
    2
  )}\n`
);
NODE

echo "POOL_ADAPTER_CONTRACT_ID=$contract_id"
echo "Wrote $ARTIFACT_DIR/pool-adapter-testnet.env"
echo "Wrote $ARTIFACT_DIR/pool-adapter-testnet.json"
