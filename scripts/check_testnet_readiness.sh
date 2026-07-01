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

normalize_hex() {
  local value="$1"
  value="${value#0x}"
  value="${value#0X}"
  printf "%s" "$value" | tr '[:upper:]' '[:lower:]'
}

is_hex_bytes() {
  local value
  value="$(normalize_hex "$1")"
  local bytes="$2"
  [[ "$value" =~ ^[0-9a-f]+$ ]] && [ "${#value}" -eq $((bytes * 2)) ]
}

expect_hex_bytes() {
  local name="$1"
  local bytes="$2"
  local value="${!name:-}"
  if ! is_hex_bytes "$value" "$bytes"; then
    fail "$name must be a ${bytes}-byte 0x-prefixed hex value."
  fi
}

expect_same_env() {
  local left_name="$1"
  local right_name="$2"
  local left="${!left_name:-}"
  local right="${!right_name:-}"
  if [ -n "$left" ] && [ -n "$right" ] && [ "$left" != "$right" ]; then
    fail "$left_name must match $right_name."
  fi
}

expect_same_hex_env() {
  local left_name="$1"
  local right_name="$2"
  local left="${!left_name:-}"
  local right="${!right_name:-}"
  if [ -n "$left" ] && [ -n "$right" ] && [ "$(normalize_hex "$left")" != "$(normalize_hex "$right")" ]; then
    fail "$left_name must match $right_name."
  fi
}

DEV_IMAGE_ID="4e4542554c415f4445565f494d4147455f49445f563100000000000000000000"

expect_env NEXT_PUBLIC_DEMO_MODE live
expect_env NEXT_PUBLIC_PROOF_MODE remote
expect_env NEXT_PUBLIC_VERIFIER_MODE real-router
expect_env NEXT_PUBLIC_CCTP_SETTLEMENT_MODE testnet
expect_env NEXT_PUBLIC_EVM_NETWORK sepolia
expect_env NEXT_PUBLIC_EVM_CHAIN_ID 11155111
expect_env NEXT_PUBLIC_STELLAR_NETWORK testnet
expect_env STELLAR_NETWORK testnet
expect_env CCTP_ENV sandbox
expect_env CCTP_IRIS_API_URL https://iris-api-sandbox.circle.com
expect_env CCTP_SOURCE_DOMAIN 0
expect_env CCTP_STELLAR_DOMAIN 27
expect_env BOUNDLESS_MARKET_CHAIN_ID 8453
expect_env ALLOW_FIXTURE_WITNESS false
expect_env RISC0_PROVER_MODE remote
expect_not_env RISC0_DEV_MODE 1

for name in \
  SEPOLIA_RPC_URL \
  NEBULA_CCTP_ESCROW_ADDRESS \
  NEXT_PUBLIC_NEBULA_CCTP_ESCROW_ADDRESS \
  CCTP_TOKEN_MESSENGER_V2_ADDRESS \
  CCTP_USDC_ADDRESS \
  CCTP_STELLAR_FORWARDER_ID \
  CCTP_STELLAR_FORWARDER_BYTES32 \
  RISC0_VERIFIER_ROUTER_ID \
  NEXT_PUBLIC_RISC0_VERIFIER_ROUTER_ID \
  NEBULA_RELAY_CONTRACT_ID \
  NEXT_PUBLIC_NEBULA_RELAY_CONTRACT_ID \
  STELLAR_ASSET_CONTRACT_ID \
  PRIVATE_PAYMENTS_POOL_ID \
  NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID \
  STELLAR_SOURCE \
  BOUNDLESS_RPC_URL \
  BOUNDLESS_PRIVATE_KEY \
  NEBULA_IMAGE_ID
do
  require_env "$name"
done

expect_hex_bytes NEBULA_IMAGE_ID 32
expect_hex_bytes CCTP_STELLAR_FORWARDER_BYTES32 32
expect_same_hex_env RISC0_IMAGE_ID NEBULA_IMAGE_ID
expect_same_env NEXT_PUBLIC_NEBULA_CCTP_ESCROW_ADDRESS NEBULA_CCTP_ESCROW_ADDRESS
expect_same_env NEXT_PUBLIC_NEBULA_RELAY_CONTRACT_ID NEBULA_RELAY_CONTRACT_ID
expect_same_env NEXT_PUBLIC_RISC0_VERIFIER_ROUTER_ID RISC0_VERIFIER_ROUTER_ID
expect_same_env NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID PRIVATE_PAYMENTS_POOL_ID

if [ "$(normalize_hex "${NEBULA_IMAGE_ID:-}")" = "$DEV_IMAGE_ID" ]; then
  fail "NEBULA_IMAGE_ID is still the old development placeholder; set the real Nebula guest image ID from artifacts/boundless-sdk-quote.json."
fi

if [ -f "$ROOT_DIR/artifacts/boundless-sdk-quote.json" ]; then
  quote_image_id="$(
    node - "$ROOT_DIR/artifacts/boundless-sdk-quote.json" <<'NODE'
const fs = require("fs");
const quote = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(quote.proofRequest?.imageIdHex ?? "");
NODE
  )"
  if [ -n "$quote_image_id" ] && [ "$(normalize_hex "$quote_image_id")" != "$(normalize_hex "${NEBULA_IMAGE_ID:-}")" ]; then
    fail "NEBULA_IMAGE_ID does not match artifacts/boundless-sdk-quote.json proofRequest.imageIdHex."
  fi
fi

if [ -z "${BOUNDLESS_PROGRAM_URL:-}" ] && [ -z "${PINATA_JWT:-}" ] && [ -z "${S3_BUCKET:-}" ]; then
  fail "BOUNDLESS_PROGRAM_URL, PINATA_JWT, or S3_BUCKET is required so Boundless provers can fetch the Nebula guest ELF."
fi

if [ -n "${CCTP_STELLAR_FORWARDER_HOOK_DATA:-}" ] && [ -n "${NEBULA_RELAY_CONTRACT_ID:-}" ]; then
  if ! node - "$CCTP_STELLAR_FORWARDER_HOOK_DATA" "$NEBULA_RELAY_CONTRACT_ID" <<'NODE'
const [hookHex, expected] = process.argv.slice(2);
const hex = hookHex.replace(/^0x/i, "");
if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 64 || hex.length % 2 !== 0) {
  console.error("invalid hook hex");
  process.exit(1);
}
const bytes = Buffer.from(hex, "hex");
const version = bytes.readUInt32BE(24);
const len = bytes.readUInt32BE(28);
const end = 32 + len;
if (version !== 0 || end > bytes.length) {
  console.error(`invalid hook layout: version=${version} len=${len}`);
  process.exit(1);
}
const recipient = bytes.subarray(32, end).toString("ascii");
if (recipient !== expected) {
  console.error(`hook recipient ${recipient} must be NebulaRelay ${expected}`);
  process.exit(1);
}
NODE
  then
    fail "CCTP_STELLAR_FORWARDER_HOOK_DATA must use hook version 0 and NebulaRelay as the forward recipient."
  fi
fi

for command in forge cargo pnpm stellar node; do
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
