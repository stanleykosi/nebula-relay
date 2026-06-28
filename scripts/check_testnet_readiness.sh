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

failures=0

fail() {
  echo "Blocker: $*" >&2
  failures=$((failures + 1))
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    fail "$name is required for the live testnet bridge transcript."
  fi
}

expect_env() {
  local name="$1"
  local expected="$2"
  local actual="${!name:-}"
  if [ "$actual" != "$expected" ]; then
    fail "$name must be '$expected' for testnet mode; current value is '${actual:-<unset>}'."
  fi
}

expect_not_env() {
  local name="$1"
  local disallowed="$2"
  local actual="${!name:-}"
  if [ "$actual" = "$disallowed" ]; then
    fail "$name must not be '$disallowed' for testnet mode."
  fi
}

expect_env NEXT_PUBLIC_DEMO_MODE live
expect_not_env NEXT_PUBLIC_PROOF_MODE dev
expect_env NEXT_PUBLIC_VERIFIER_MODE real-router
expect_env NEXT_PUBLIC_CCTP_SETTLEMENT_MODE testnet
expect_env ALLOW_FIXTURE_WITNESS false
expect_env RISC0_DEV_MODE 0

for name in \
  SEPOLIA_RPC_URL \
  NEBULA_CCTP_ESCROW_ADDRESS \
  CCTP_TOKEN_MESSENGER_V2_ADDRESS \
  CCTP_USDC_ADDRESS \
  CCTP_STELLAR_FORWARDER_BYTES32 \
  RISC0_VERIFIER_ROUTER_ID \
  NEBULA_RELAY_CONTRACT_ID \
  STELLAR_ASSET_CONTRACT_ID \
  POOL_ADAPTER_CONTRACT_ID \
  STELLAR_SOURCE
do
  require_env "$name"
done

for command in forge cargo pnpm stellar; do
  if ! command -v "$command" >/dev/null 2>&1; then
    fail "$command is not installed or not on PATH."
  fi
done

if [ "$failures" -ne 0 ]; then
  echo "Testnet readiness failed with $failures blocker(s)." >&2
  exit 1
fi

echo "Testnet readiness checks passed."
echo "Next transcript: EVM CCTP burn -> Iris attestation -> Stellar mint_and_forward -> NebulaRelay claim -> replay failure."
