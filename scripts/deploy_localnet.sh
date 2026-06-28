#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${NEBULA_ARTIFACT_DIR:-$ROOT_DIR/artifacts/demo}"
WASM_PATH="${NEBULA_RELAY_WASM:-$ROOT_DIR/target/wasm32v1-none/release/nebula_relay_contract.wasm}"
NETWORK="${STELLAR_NETWORK:-local}"
SOURCE="${STELLAR_SOURCE:-nebula-local}"
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: scripts/deploy_localnet.sh [--dry-run]

Builds and deploys the NebulaRelay Soroban contract to Stellar localnet.

Required for initialization:
  RISC0_VERIFIER_ROUTER_ID       Verifier router-compatible contract ID
  POOL_ADAPTER_CONTRACT_ID       Nebula pool adapter/handoff contract ID
  STELLAR_ASSET_CONTRACT_ID      Stellar asset contract ID used by claims

Optional:
  STELLAR_SOURCE                 Stellar CLI identity (default: nebula-local)
  STELLAR_NETWORK                Stellar CLI network (default: local)
  NEBULA_ADMIN                   Admin address (default: stellar keys address STELLAR_SOURCE)
  NEBULA_IMAGE_ID                Accepted image ID hex
  NEBULA_NETWORK_DOMAIN          Network domain hex
  NEBULA_REGISTER_FIXTURE_CONFIG Register fixture source/compliance config (default: 1)
  NEBULA_ARTIFACT_DIR            Artifact directory (default: artifacts/demo)
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

mkdir -p "$ARTIFACT_DIR"

IMAGE_ID="${NEBULA_IMAGE_ID:-0x4e4542554c415f4445565f494d4147455f49445f563100000000000000000000}"
NETWORK_DOMAIN="${NEBULA_NETWORK_DOMAIN:-0x4e4542554c415f5354454c4c41525f544553544e45545f563100000000000000}"
REGISTER_FIXTURE_CONFIG="${NEBULA_REGISTER_FIXTURE_CONFIG:-1}"
CONTRACT_ENV_PATH="$ARTIFACT_DIR/localnet-contracts.env"
DEPLOYMENT_JSON_PATH="$ARTIFACT_DIR/localnet-deployment.json"

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would run stellar contract build"
  echo "Dry run: would deploy $WASM_PATH with source=$SOURCE network=$NETWORK"
  echo "Dry run: would write $CONTRACT_ENV_PATH and $DEPLOYMENT_JSON_PATH"
  if [ -z "${RISC0_VERIFIER_ROUTER_ID:-}" ] || [ -z "${POOL_ADAPTER_CONTRACT_ID:-}" ] || [ -z "${STELLAR_ASSET_CONTRACT_ID:-}" ]; then
    echo "Dry run: initialization would be skipped until verifier, pool adapter, and asset IDs are set."
  else
    echo "Dry run: would initialize NebulaRelay with configured verifier, pool adapter, and asset IDs."
  fi
  exit 0
fi

if ! command -v stellar >/dev/null 2>&1; then
  echo "Blocker: Stellar CLI is not installed or not on PATH." >&2
  exit 1
fi

(cd "$ROOT_DIR" && stellar contract build)

if [ ! -f "$WASM_PATH" ]; then
  echo "Blocker: expected WASM not found at $WASM_PATH" >&2
  echo "Run stellar contract build or set NEBULA_RELAY_WASM." >&2
  exit 1
fi

echo "Deploying NebulaRelay to Stellar $NETWORK..."
contract_id="$(
  stellar contract deploy \
    --wasm "$WASM_PATH" \
    --source "$SOURCE" \
    --network "$NETWORK" |
    tail -n 1 |
    tr -d '\r'
)"

if [ -z "$contract_id" ]; then
  echo "Blocker: Stellar CLI did not return a contract ID." >&2
  exit 1
fi

admin="${NEBULA_ADMIN:-}"
if [ -z "$admin" ]; then
  admin="$(stellar keys address "$SOURCE")"
fi

initialized="false"
registered_fixture_config="false"
blocker=""

if [ -z "${RISC0_VERIFIER_ROUTER_ID:-}" ] || [ -z "${POOL_ADAPTER_CONTRACT_ID:-}" ] || [ -z "${STELLAR_ASSET_CONTRACT_ID:-}" ]; then
  blocker="Initialization skipped: set RISC0_VERIFIER_ROUTER_ID, POOL_ADAPTER_CONTRACT_ID, and STELLAR_ASSET_CONTRACT_ID."
  echo "$blocker"
else
  stellar contract invoke \
    --id "$contract_id" \
    --source "$SOURCE" \
    --network "$NETWORK" \
    -- \
    initialize \
    --admin "$admin" \
    --verifier_router "$RISC0_VERIFIER_ROUTER_ID" \
    --pool_adapter "$POOL_ADAPTER_CONTRACT_ID" \
    --accepted_image_id "$IMAGE_ID" \
    --asset "$STELLAR_ASSET_CONTRACT_ID" \
    --network_domain "$NETWORK_DOMAIN"
  initialized="true"

  if [ "$REGISTER_FIXTURE_CONFIG" = "1" ]; then
    stellar contract invoke \
      --id "$contract_id" \
      --source "$SOURCE" \
      --network "$NETWORK" \
      -- \
      register_source \
      --admin "$admin" \
      --source_chain_id 11155111 \
      --escrow_contract 0x1111111111111111111111111111111111111111 \
      --token 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
      --min_amount 1000000 \
      --max_amount 500000000 \
      --active true

    stellar contract invoke \
      --id "$contract_id" \
      --source "$SOURCE" \
      --network "$NETWORK" \
      -- \
      register_compliance_root \
      --admin "$admin" \
      --root 0x9999999999999999999999999999999999999999999999999999999999999999 \
      --mode 1 \
      --expires_at_ledger 999999 \
      --active true
    registered_fixture_config="true"
  fi
fi

cat > "$CONTRACT_ENV_PATH" <<EOF
STELLAR_NETWORK=$NETWORK
STELLAR_SOURCE=$SOURCE
NEBULA_RELAY_CONTRACT_ID=$contract_id
NEBULA_ADMIN=$admin
RISC0_VERIFIER_ROUTER_ID=${RISC0_VERIFIER_ROUTER_ID:-}
POOL_ADAPTER_CONTRACT_ID=${POOL_ADAPTER_CONTRACT_ID:-}
STELLAR_ASSET_CONTRACT_ID=${STELLAR_ASSET_CONTRACT_ID:-}
NEBULA_IMAGE_ID=$IMAGE_ID
NEBULA_NETWORK_DOMAIN=$NETWORK_DOMAIN
EOF

node - "$DEPLOYMENT_JSON_PATH" "$contract_id" "$NETWORK" "$SOURCE" "$admin" "$initialized" "$registered_fixture_config" "$blocker" <<'NODE'
const fs = require("fs");
const [
  path,
  contractId,
  network,
  source,
  admin,
  initialized,
  registeredFixtureConfig,
  blocker,
] = process.argv.slice(2);
fs.writeFileSync(
  path,
  `${JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      network,
      source,
      contracts: {
        nebulaRelay: contractId,
      },
      admin,
      initialized: initialized === "true",
      registeredFixtureConfig: registeredFixtureConfig === "true",
      blocker: blocker || null,
    },
    null,
    2
  )}\n`
);
NODE

echo "NEBULA_RELAY_CONTRACT_ID=$contract_id"
echo "Wrote $CONTRACT_ENV_PATH"
echo "Wrote $DEPLOYMENT_JSON_PATH"
