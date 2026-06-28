#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage: scripts/deploy_evm_cctp_testnet.sh

Deploys the NebulaCctpEscrow source-side wrapper with Foundry.

Required environment:
  SEPOLIA_RPC_URL
  DEPLOYER_PRIVATE_KEY
  NEBULA_EVM_OWNER
  CCTP_TOKEN_MESSENGER_V2_ADDRESS
  CCTP_USDC_ADDRESS
  CCTP_STELLAR_FORWARDER_BYTES32
  CCTP_MAX_FEE
  CCTP_MIN_FINALITY_THRESHOLD
  NEBULA_MIN_AMOUNT
  NEBULA_MAX_AMOUNT

Optional:
  ETHERSCAN_API_KEY        Enables --verify when set.

The deployer key is read by Foundry from the environment and is never written
to git artifacts by this script.
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

missing=0
for name in \
  SEPOLIA_RPC_URL \
  DEPLOYER_PRIVATE_KEY \
  NEBULA_EVM_OWNER \
  CCTP_TOKEN_MESSENGER_V2_ADDRESS \
  CCTP_USDC_ADDRESS \
  CCTP_STELLAR_FORWARDER_BYTES32 \
  CCTP_MAX_FEE \
  CCTP_MIN_FINALITY_THRESHOLD \
  NEBULA_MIN_AMOUNT \
  NEBULA_MAX_AMOUNT
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

verify_args=()
if [ -n "${ETHERSCAN_API_KEY:-}" ]; then
  verify_args+=(--verify)
fi

(
  cd "$ROOT_DIR/contracts/evm"
  forge script script/DeployCctpEscrow.s.sol:DeployCctpEscrow \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --broadcast \
    "${verify_args[@]}"
)
