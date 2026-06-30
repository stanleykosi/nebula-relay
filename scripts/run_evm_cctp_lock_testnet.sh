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
  NEBULA_LOCK_AMOUNT
  NEBULA_NOTE_COMMITMENT
  NEBULA_COMPLIANCE_HINT
  CCTP_STELLAR_FORWARDER_HOOK_DATA

Prerequisite:
  The EVM user has approved NEBULA_CCTP_ESCROW_ADDRESS to spend at least
  NEBULA_LOCK_AMOUNT of testnet USDC. The approval can be a separate standard
  ERC-20 transaction; the Nebula lock event and CCTP burn happen atomically in
  the transaction run by this script.
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

(
  cd "$ROOT_DIR/contracts/evm"
  forge script script/LockAndBurnCctp.s.sol:LockAndBurnCctp \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --broadcast
)
