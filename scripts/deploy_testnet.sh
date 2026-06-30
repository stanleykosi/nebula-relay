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
WASM_PATH="${NEBULA_RELAY_WASM:-$ROOT_DIR/target/wasm32v1-none/release/nebula_relay_contract.wasm}"
NETWORK="${STELLAR_NETWORK:-testnet}"
SOURCE="${STELLAR_SOURCE:-}"
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: scripts/deploy_testnet.sh [--dry-run]

Builds and deploys the NebulaRelay Soroban contract to Stellar testnet.

Required for a complete initialized deployment:
  STELLAR_SOURCE                 Funded Stellar CLI identity
  RISC0_VERIFIER_ROUTER_ID       Deployed Nethermind RISC Zero verifier router ID
  POOL_ADAPTER_CONTRACT_ID       Nebula private-payments handoff adapter ID
  STELLAR_ASSET_CONTRACT_ID      Stellar asset contract ID used by claims
  CCTP_STELLAR_FORWARDER_ID      Circle Stellar CCTP Forwarder contract ID
  CCTP_STELLAR_FORWARDER_BYTES32 Circle Forwarder contract ID encoded as bytes32

Optional:
  STELLAR_NETWORK                Stellar CLI network (default: testnet)
  NEBULA_ADMIN                   Admin address (default: stellar keys address STELLAR_SOURCE)
  NEBULA_IMAGE_ID                Accepted Nebula guest image ID hex (required)
  NEBULA_NETWORK_DOMAIN          Network domain hex
  NEBULA_ARTIFACT_DIR            Artifact directory (default: artifacts/demo)

This script does not claim production finality. It records testnet contract IDs
for demo repeatability when the external verifier/router environment exists.
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

IMAGE_ID="${NEBULA_IMAGE_ID:-}"
NETWORK_DOMAIN="${NEBULA_NETWORK_DOMAIN:-0x4e4542554c415f5354454c4c41525f544553544e45545f563100000000000000}"
CONTRACT_ENV_PATH="$ARTIFACT_DIR/testnet-contracts.env"
DEPLOYMENT_JSON_PATH="$ARTIFACT_DIR/testnet-deployment.json"
DEV_IMAGE_ID="4e4542554c415f4445565f494d4147455f49445f563100000000000000000000"

cli_bytes() {
  local value="$1"
  value="${value#0x}"
  value="${value#0X}"
  printf "%s" "$value"
}

is_hex32() {
  local value
  value="$(cli_bytes "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" =~ ^[0-9a-f]{64}$ ]]
}

validate_image_id() {
  if [ -z "$IMAGE_ID" ]; then
    echo "Blocker: NEBULA_IMAGE_ID is required and must match the current Nebula RISC Zero guest image ID." >&2
    exit 1
  fi
  if ! is_hex32 "$IMAGE_ID"; then
    echo "Blocker: NEBULA_IMAGE_ID must be a 32-byte hex value." >&2
    exit 1
  fi
  if [ "$(cli_bytes "$IMAGE_ID" | tr '[:upper:]' '[:lower:]')" = "$DEV_IMAGE_ID" ]; then
    echo "Blocker: NEBULA_IMAGE_ID is still the old development placeholder." >&2
    exit 1
  fi
}

validate_image_id

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would run stellar contract build"
  echo "Dry run: would deploy $WASM_PATH with source=${SOURCE:-<unset>} network=$NETWORK"
  echo "Dry run: would write $CONTRACT_ENV_PATH and $DEPLOYMENT_JSON_PATH"
  if [ -z "$SOURCE" ] ||
    [ -z "${RISC0_VERIFIER_ROUTER_ID:-}" ] ||
    [ -z "${POOL_ADAPTER_CONTRACT_ID:-}" ] ||
    [ -z "${STELLAR_ASSET_CONTRACT_ID:-}" ] ||
    [ -z "${CCTP_STELLAR_FORWARDER_ID:-}" ] ||
    [ -z "${CCTP_STELLAR_FORWARDER_BYTES32:-}" ]; then
    echo "Dry run: initialized testnet deployment requires source, router, pool adapter, asset, CCTP Forwarder, and CCTP mint-recipient bytes32 values."
  else
    echo "Dry run: would initialize NebulaRelay with configured verifier, pool adapter, asset, and CCTP settlement IDs."
  fi
  exit 0
fi

if ! command -v stellar >/dev/null 2>&1; then
  echo "Blocker: Stellar CLI is not installed or not on PATH." >&2
  exit 1
fi

if [ -z "$SOURCE" ] ||
  [ -z "${RISC0_VERIFIER_ROUTER_ID:-}" ] ||
  [ -z "${POOL_ADAPTER_CONTRACT_ID:-}" ] ||
  [ -z "${STELLAR_ASSET_CONTRACT_ID:-}" ] ||
  [ -z "${CCTP_STELLAR_FORWARDER_ID:-}" ] ||
  [ -z "${CCTP_STELLAR_FORWARDER_BYTES32:-}" ]; then
  echo "Blocker: testnet deploy requires STELLAR_SOURCE, RISC0_VERIFIER_ROUTER_ID, POOL_ADAPTER_CONTRACT_ID, STELLAR_ASSET_CONTRACT_ID, CCTP_STELLAR_FORWARDER_ID, and CCTP_STELLAR_FORWARDER_BYTES32." >&2
  exit 1
fi

(cd "$ROOT_DIR" && stellar contract build)

if [ ! -f "$WASM_PATH" ]; then
  echo "Blocker: expected WASM not found at $WASM_PATH" >&2
  echo "Run stellar contract build or set NEBULA_RELAY_WASM." >&2
  exit 1
fi

admin="${NEBULA_ADMIN:-}"
if [ -z "$admin" ]; then
  admin="$(stellar keys address "$SOURCE")"
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

stellar contract invoke \
  --id "$contract_id" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- \
  initialize \
  --admin "$admin" \
  --verifier_router "$RISC0_VERIFIER_ROUTER_ID" \
  --pool_adapter "$POOL_ADAPTER_CONTRACT_ID" \
  --cctp_forwarder "$CCTP_STELLAR_FORWARDER_ID" \
  --cctp_mint_recipient "$(cli_bytes "$CCTP_STELLAR_FORWARDER_BYTES32")" \
  --accepted_image_id "$(cli_bytes "$IMAGE_ID")" \
  --asset "$STELLAR_ASSET_CONTRACT_ID" \
  --network_domain "$(cli_bytes "$NETWORK_DOMAIN")"

stellar contract invoke \
  --id "$POOL_ADAPTER_CONTRACT_ID" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- \
  set_relay \
  --admin "$admin" \
  --relay "$contract_id"

cat > "$CONTRACT_ENV_PATH" <<EOF
STELLAR_NETWORK=$NETWORK
STELLAR_SOURCE=$SOURCE
NEBULA_RELAY_CONTRACT_ID=$contract_id
NEBULA_ADMIN=$admin
RISC0_VERIFIER_ROUTER_ID=$RISC0_VERIFIER_ROUTER_ID
POOL_ADAPTER_CONTRACT_ID=$POOL_ADAPTER_CONTRACT_ID
STELLAR_ASSET_CONTRACT_ID=$STELLAR_ASSET_CONTRACT_ID
CCTP_STELLAR_FORWARDER_ID=$CCTP_STELLAR_FORWARDER_ID
CCTP_STELLAR_FORWARDER_BYTES32=$CCTP_STELLAR_FORWARDER_BYTES32
NEBULA_IMAGE_ID=$IMAGE_ID
NEBULA_NETWORK_DOMAIN=$NETWORK_DOMAIN
EOF

node - "$DEPLOYMENT_JSON_PATH" "$contract_id" "$NETWORK" "$SOURCE" "$admin" "$RISC0_VERIFIER_ROUTER_ID" "$POOL_ADAPTER_CONTRACT_ID" "$STELLAR_ASSET_CONTRACT_ID" "$CCTP_STELLAR_FORWARDER_ID" "$CCTP_STELLAR_FORWARDER_BYTES32" "$IMAGE_ID" "$NETWORK_DOMAIN" <<'NODE'
const fs = require("fs");
const [
  path,
  contractId,
  network,
  source,
  admin,
  verifierRouter,
  poolAdapter,
  asset,
  cctpForwarder,
  cctpMintRecipient,
  imageId,
  networkDomain,
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
        verifierRouter,
        poolAdapter,
        asset,
        cctpForwarder,
      },
      cctpMintRecipient,
      imageId,
      networkDomain,
      admin,
      initialized: true,
      blocker: null,
    },
    null,
    2
  )}\n`
);
NODE

echo "NEBULA_RELAY_CONTRACT_ID=$contract_id"
echo "Wrote $CONTRACT_ENV_PATH"
echo "Wrote $DEPLOYMENT_JSON_PATH"
