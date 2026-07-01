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

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Blocker: $name is required." >&2
    exit 1
  fi
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Blocker: $name is not installed or not on PATH." >&2
    exit 1
  fi
}

for command in cargo node stellar; do
  require_command "$command"
done

require_env STELLAR_RPC_URL
require_env STELLAR_NETWORK
require_env STELLAR_SOURCE
require_env PRIVATE_PAYMENTS_DEPLOYMENT_JSON
require_env PRIVATE_PAYMENTS_POOL_ID

AMOUNT="${NEBULA_SETTLEMENT_AMOUNT:-${NEBULA_EXPECTED_SETTLEMENT_AMOUNT:-}}"
if [ -z "$AMOUNT" ]; then
  echo "Blocker: NEBULA_SETTLEMENT_AMOUNT or NEBULA_EXPECTED_SETTLEMENT_AMOUNT is required." >&2
  exit 1
fi

if [ -z "${STELLAR_SOURCE_SECRET:-}" ]; then
  STELLAR_SOURCE_SECRET="$(stellar keys secret "$STELLAR_SOURCE" 2>/dev/null || true)"
  if [ -z "$STELLAR_SOURCE_SECRET" ]; then
    echo "Blocker: STELLAR_SOURCE_SECRET is not set and stellar keys secret $STELLAR_SOURCE failed." >&2
    exit 1
  fi
  export STELLAR_SOURCE_SECRET
fi

RECIPIENT_SECRET="${PRIVATE_PAYMENTS_RECIPIENT_SECRET:-$STELLAR_SOURCE_SECRET}"
DEPLOYMENT_JSON="$ROOT_DIR/$PRIVATE_PAYMENTS_DEPLOYMENT_JSON"
OUT_PATH="${NEBULA_UPSTREAM_PRIVATE_POOL_PROOF_JSON_PATH:-$ROOT_DIR/artifacts/private-pool-prepared.json}"
MEMBER_PATH="${NEBULA_PRIVATE_POOL_MEMBER_JSON_PATH:-$ROOT_DIR/artifacts/private-pool-member.json}"
VENDOR_DIR="$ROOT_DIR/vendor/stellar-private-payments"
HELPER_MANIFEST="$ROOT_DIR/tools/nebula-private-pool-prepare/Cargo.toml"
CIRCUIT_PROFILE="${PRIVATE_PAYMENTS_CIRCUIT_PROFILE:-debug}"
CIRCUIT_DIR="$VENDOR_DIR/target/circuits-artifacts/$CIRCUIT_PROFILE"

if [ ! -f "$CIRCUIT_DIR/policy_tx_2_2.wasm" ] || [ ! -f "$CIRCUIT_DIR/policy_tx_2_2.r1cs" ]; then
  echo "Building upstream private-payments circuit artifacts ($CIRCUIT_PROFILE)..."
  (
    cd "$VENDOR_DIR"
    if [ "$CIRCUIT_PROFILE" = "release" ]; then
      cargo build -p circuits --release
    else
      cargo build -p circuits
    fi
  )
fi

run_helper() {
  cargo run --manifest-path "$HELPER_MANIFEST" -- "$@"
}

echo "Inspecting Nebula private-pool recipient membership..."
run_helper inspect \
  --rpc-url "$STELLAR_RPC_URL" \
  --deployment-json "$DEPLOYMENT_JSON" \
  --pool-id "$PRIVATE_PAYMENTS_POOL_ID" \
  --source-secret "$STELLAR_SOURCE_SECRET" \
  --recipient-secret "$RECIPIENT_SECRET" \
  --out "$MEMBER_PATH"

ASP_MEMBERSHIP_ID="$(node -e "const d=require(process.argv[1]); console.log(d.asp_membership)" "$DEPLOYMENT_JSON")"
MEMBERSHIP_REGISTERED="$(node -e "const d=require(process.argv[1]); console.log(d.membershipRegistered ? '1' : '0')" "$MEMBER_PATH")"
if [ "$MEMBERSHIP_REGISTERED" != "1" ]; then
  LEAF_DECIMAL="$(node -e "const d=require(process.argv[1]); console.log(d.membershipLeafDecimal)" "$MEMBER_PATH")"
  echo "Registering recipient ASP membership leaf..."
  stellar contract invoke \
    --id "$ASP_MEMBERSHIP_ID" \
    --source "$STELLAR_SOURCE" \
    --network "$STELLAR_NETWORK" \
    --send=yes \
    --auto-sign \
    -- \
    insert_leaf \
    --leaf "$LEAF_DECIMAL" >/dev/null

  for attempt in $(seq 1 18); do
    sleep 5
    run_helper inspect \
      --rpc-url "$STELLAR_RPC_URL" \
      --deployment-json "$DEPLOYMENT_JSON" \
      --pool-id "$PRIVATE_PAYMENTS_POOL_ID" \
      --source-secret "$STELLAR_SOURCE_SECRET" \
      --recipient-secret "$RECIPIENT_SECRET" \
      --out "$MEMBER_PATH"
    MEMBERSHIP_REGISTERED="$(node -e "const d=require(process.argv[1]); console.log(d.membershipRegistered ? '1' : '0')" "$MEMBER_PATH")"
    if [ "$MEMBERSHIP_REGISTERED" = "1" ]; then
      break
    fi
    echo "Waiting for ASP membership event indexing... attempt=$attempt"
  done
fi

MEMBERSHIP_REGISTERED="$(node -e "const d=require(process.argv[1]); console.log(d.membershipRegistered ? '1' : '0')" "$MEMBER_PATH")"
if [ "$MEMBERSHIP_REGISTERED" != "1" ]; then
  echo "Blocker: ASP membership leaf was not visible in Stellar RPC events after registration." >&2
  exit 1
fi

echo "Generating upstream-compatible PreparedProverTx..."
run_helper prepare \
  --rpc-url "$STELLAR_RPC_URL" \
  --deployment-json "$DEPLOYMENT_JSON" \
  --pool-id "$PRIVATE_PAYMENTS_POOL_ID" \
  --source-secret "$STELLAR_SOURCE_SECRET" \
  --recipient-secret "$RECIPIENT_SECRET" \
  --out "$OUT_PATH" \
  --amount "$AMOUNT" \
  --repo-root "$VENDOR_DIR" \
  --circuit-profile "$CIRCUIT_PROFILE"

echo "Prepared private-pool prover artifact: $OUT_PATH"
