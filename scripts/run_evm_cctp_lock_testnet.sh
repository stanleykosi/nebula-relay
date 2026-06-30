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

usage() {
  cat <<'USAGE'
Usage: scripts/run_evm_cctp_lock_testnet.sh

Runs the source-side Nebula lock + Circle CCTP depositForBurnWithHook transaction.

Required environment:
  SEPOLIA_RPC_URL
  EVM_USER_PRIVATE_KEY
  NEBULA_CCTP_ESCROW_ADDRESS
  CCTP_USDC_ADDRESS
  NEBULA_LOCK_AMOUNT
  NEBULA_NOTE_COMMITMENT
  NEBULA_COMPLIANCE_HINT
  CCTP_STELLAR_FORWARDER_HOOK_DATA

Allowance:
  By default, the script checks the EVM user's testnet USDC allowance and sends
  one max-uint256 approval to NEBULA_CCTP_ESCROW_ADDRESS only if the allowance is
  below NEBULA_LOCK_AMOUNT. Set NEBULA_AUTO_APPROVE_USDC=0 to disable this.
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

missing=0
for name in \
  SEPOLIA_RPC_URL \
  EVM_USER_PRIVATE_KEY \
  NEBULA_CCTP_ESCROW_ADDRESS \
  CCTP_USDC_ADDRESS \
  NEBULA_LOCK_AMOUNT \
  NEBULA_NOTE_COMMITMENT \
  NEBULA_COMPLIANCE_HINT \
  CCTP_STELLAR_FORWARDER_HOOK_DATA
do
  if [ -z "${!name:-}" ]; then
    echo "Blocker: $name is required." >&2
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  usage >&2
  exit 1
fi

if ! command -v forge >/dev/null 2>&1; then
  echo "Blocker: forge is not installed or not on PATH." >&2
  exit 1
fi

if ! command -v cast >/dev/null 2>&1; then
  echo "Blocker: cast is not installed or not on PATH." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Blocker: node is not installed or not on PATH." >&2
  exit 1
fi

MAX_UINT256="115792089237316195423570985008687907853269984665640564039457584007913129639935"
EVM_USER_ADDRESS="$(cast wallet address --private-key "$EVM_USER_PRIVATE_KEY")"
ALLOWANCE_RAW="$(cast call "$CCTP_USDC_ADDRESS" 'allowance(address,address)(uint256)' \
  "$EVM_USER_ADDRESS" "$NEBULA_CCTP_ESCROW_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL")"
ALLOWANCE="${ALLOWANCE_RAW%% *}"
NEEDS_APPROVAL="$(node -e 'const [allowance, amount] = process.argv.slice(1); console.log(BigInt(allowance) < BigInt(amount) ? "1" : "0")' \
  "$ALLOWANCE" "$NEBULA_LOCK_AMOUNT")"

if [ "$NEEDS_APPROVAL" = "1" ]; then
  if [ "${NEBULA_AUTO_APPROVE_USDC:-1}" = "0" ]; then
    echo "Blocker: USDC allowance $ALLOWANCE is below NEBULA_LOCK_AMOUNT $NEBULA_LOCK_AMOUNT." >&2
    echo "Either approve $NEBULA_CCTP_ESCROW_ADDRESS or unset NEBULA_AUTO_APPROVE_USDC=0." >&2
    exit 1
  fi

  echo "Approving max testnet USDC allowance for Nebula CCTP escrow..."
  cast send "$CCTP_USDC_ADDRESS" 'approve(address,uint256)(bool)' \
    "$NEBULA_CCTP_ESCROW_ADDRESS" "$MAX_UINT256" \
    --private-key "$EVM_USER_PRIVATE_KEY" \
    --rpc-url "$SEPOLIA_RPC_URL"

  ALLOWANCE_RAW="$(cast call "$CCTP_USDC_ADDRESS" 'allowance(address,address)(uint256)' \
    "$EVM_USER_ADDRESS" "$NEBULA_CCTP_ESCROW_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL")"
  ALLOWANCE="${ALLOWANCE_RAW%% *}"
  NEEDS_APPROVAL="$(node -e 'const [allowance, amount] = process.argv.slice(1); console.log(BigInt(allowance) < BigInt(amount) ? "1" : "0")' \
    "$ALLOWANCE" "$NEBULA_LOCK_AMOUNT")"
  if [ "$NEEDS_APPROVAL" = "1" ]; then
    echo "Blocker: approval transaction did not raise allowance above NEBULA_LOCK_AMOUNT." >&2
    exit 1
  fi
else
  echo "USDC allowance already covers NEBULA_LOCK_AMOUNT."
fi

(
  cd "$ROOT_DIR/contracts/evm"
  forge script script/LockAndBurnCctp.s.sol:LockAndBurnCctp \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --broadcast
)
