#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${NEBULA_ENV_FILE:-$ROOT_DIR/.env.local}"
ARTIFACT_DIR="${NEBULA_LIVE_ARTIFACT_DIR:-$ROOT_DIR/artifacts}"

CONFIRM="${NEBULA_LIVE_RUN_CONFIRM:-0}"
SKIP_PACKAGE_BUILD="${NEBULA_SKIP_TS_BUILD:-0}"

usage() {
  cat <<'USAGE'
Usage: scripts/run_live_testnet_transcript.sh --yes [--skip-package-build]

Runs the full live Ethereum Sepolia -> Stellar testnet Nebula transcript:

  1. Check testnet readiness, private-pool readiness, CCTP route, and hook data.
  2. Build or load an upstream Stellar Private Payments PreparedProverTx JSON.
  3. Convert it to Nebula PrivatePoolDeposit XDR and use its selected output
     commitment as NEBULA_NOTE_COMMITMENT for the EVM lock.
  4. Submit one Sepolia NebulaCctpEscrow.lockAndBurn transaction.
  5. Fetch the Sepolia receipt.
  6. Poll Circle Iris for the CCTP V2 message and attestation.
  7. Verify Circle's actual net amount matches the prepared private-pool amount.
  8. Build a LockWitness from the receipt and CCTP message.
  9. Submit a Boundless remote Groth16 proof request.
  10. Simulate and submit NebulaRelay.claim_to_private_pool on Stellar testnet.
  11. Verify nullifier storage, private claim record, and replay failure.
  12. Write artifacts/live-transcript-summary.json.

This is a live testnet script. Every successful run burns NEBULA_LOCK_AMOUNT of
configured Sepolia test USDC and submits a Stellar testnet claim.

Options:
  --yes                 Required unless NEBULA_LIVE_RUN_CONFIRM=1 is set.
  --skip-package-build  Use existing packages/*/dist outputs.
  -h, --help            Show this help.

Useful env:
  NEBULA_ENV_FILE                  Env file to load, default .env.local.
  NEBULA_LIVE_ARTIFACT_DIR         Artifact dir, default artifacts.
  NEBULA_RISC0_RECURSION_ZKR_PATH  Optional predownloaded RISC Zero recursion zip.
  NEBULA_EXPECTED_SETTLEMENT_AMOUNT Expected net CCTP amount after feeExecuted.
  NEBULA_EXPECTED_CCTP_FEE_EXECUTED Optional; used to derive expected settlement
                                  as NEBULA_LOCK_AMOUNT - feeExecuted.
  NEBULA_UPSTREAM_PRIVATE_POOL_PROOF_JSON_PATH
                                  Path where upstream writes PreparedProverTx JSON.
  NEBULA_PRIVATE_POOL_PREPARE_COMMAND
                                  Optional command run before the EVM burn; it
                                  must write NEBULA_UPSTREAM_PRIVATE_POOL_PROOF_JSON_PATH.
  NEBULA_PRIVATE_POOL_NOTE_OUTPUT_INDEX
                                  Output commitment index to bind into the EVM
                                  lock event, default 0.
  CCTP_IRIS_MAX_ATTEMPTS           Default 120.
  CCTP_IRIS_POLL_INTERVAL_MS       Default 5000.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --yes)
      CONFIRM=1
      ;;
    --skip-package-build)
      SKIP_PACKAGE_BUILD=1
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

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [ "$CONFIRM" != "1" ]; then
  echo "Blocker: this live script burns configured Sepolia test USDC." >&2
  echo "Rerun with --yes or set NEBULA_LIVE_RUN_CONFIRM=1." >&2
  exit 1
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

normalize_hex() {
  local value="$1"
  value="${value#0x}"
  value="${value#0X}"
  printf "%s" "$value" | tr '[:upper:]' '[:lower:]'
}

require_bigint_at_least() {
  local label="$1"
  local actual="$2"
  local minimum="$3"
  node -e 'const [label, actual, minimum] = process.argv.slice(1); if (BigInt(actual) < BigInt(minimum)) { console.error(`Blocker: ${label} ${actual} is below required ${minimum}.`); process.exit(1); }' \
    "$label" "$actual" "$minimum"
}

extract_first_word() {
  local value="$1"
  printf "%s" "${value%% *}"
}

for command in bash cast curl forge node pnpm sha256sum stellar; do
  require_command "$command"
done

for name in \
  SEPOLIA_RPC_URL \
  EVM_USER_PRIVATE_KEY \
  NEBULA_CCTP_ESCROW_ADDRESS \
  CCTP_TOKEN_MESSENGER_V2_ADDRESS \
  CCTP_USDC_ADDRESS \
  CCTP_MAX_FEE \
  CCTP_MIN_FINALITY_THRESHOLD \
  CCTP_SOURCE_DOMAIN \
  CCTP_STELLAR_DOMAIN \
  CCTP_STELLAR_FORWARDER_ID \
  CCTP_STELLAR_FORWARDER_BYTES32 \
  CCTP_STELLAR_FORWARDER_HOOK_DATA \
  NEXT_PUBLIC_EVM_CHAIN_ID \
  NEBULA_LOCK_AMOUNT \
  NEBULA_COMPLIANCE_HINT \
  NEBULA_COMPLIANCE_ROOT \
  NEBULA_COMPLIANCE_MODE \
  NEBULA_NETWORK_DOMAIN \
  NEBULA_EXPIRES_AT_LEDGER \
  NEBULA_MIN_AMOUNT \
  NEBULA_MAX_AMOUNT \
  BOUNDLESS_RPC_URL \
  BOUNDLESS_PRIVATE_KEY \
  NEBULA_IMAGE_ID \
  STELLAR_NETWORK \
  STELLAR_RPC_URL \
  STELLAR_SOURCE \
  STELLAR_ASSET_CONTRACT_ID \
  NEBULA_RELAY_CONTRACT_ID \
  RISC0_VERIFIER_ROUTER_ID \
  PRIVATE_PAYMENTS_POOL_ID
do
  require_env "$name"
done

if [ -z "${STELLAR_SOURCE_SECRET:-}" ]; then
  STELLAR_SOURCE_SECRET="$(stellar keys secret "$STELLAR_SOURCE" 2>/dev/null || true)"
  if [ -z "$STELLAR_SOURCE_SECRET" ]; then
    echo "Blocker: STELLAR_SOURCE_SECRET is not set and stellar keys secret $STELLAR_SOURCE failed." >&2
    exit 1
  fi
  export STELLAR_SOURCE_SECRET
fi

mkdir -p "$ARTIFACT_DIR"

RECEIPT_PATH="$ARTIFACT_DIR/live-lock-receipt.json"
IRIS_LATEST_PATH="$ARTIFACT_DIR/live-iris-latest.json"
IRIS_RESPONSE_PATH="$ARTIFACT_DIR/live-iris-response.json"
SETTLEMENT_PATH="$ARTIFACT_DIR/live-cctp-settlement.json"
WITNESS_PATH="$ARTIFACT_DIR/live-lock-witness.json"
PROOF_PATH="$ARTIFACT_DIR/live-remote-proof.json"
BOUNDLESS_LOG_PATH="$ARTIFACT_DIR/live-boundless-prove.log"
CLAIM_ARGS_ENV_PATH="$ARTIFACT_DIR/live-claim-args.env"
PRIVATE_POOL_DEPOSIT_XDR_PATH="${NEBULA_PRIVATE_POOL_DEPOSIT_XDR_PATH:-$ARTIFACT_DIR/private-pool-deposit.scval.xdr}"
UPSTREAM_PRIVATE_POOL_PROOF_JSON_PATH="${NEBULA_UPSTREAM_PRIVATE_POOL_PROOF_JSON_PATH:-$ARTIFACT_DIR/private-pool-prepared.json}"
PRIVATE_POOL_DEPOSIT_METADATA_PATH="${NEBULA_PRIVATE_POOL_DEPOSIT_METADATA_PATH:-$ARTIFACT_DIR/private-pool-deposit.metadata.json}"
CLAIM_SIM_OUTPUT_PATH="$ARTIFACT_DIR/live-stellar-claim-simulation.txt"
CLAIM_OUTPUT_PATH="$ARTIFACT_DIR/live-stellar-claim.txt"
REPLAY_OUTPUT_PATH="$ARTIFACT_DIR/live-replay-failure.txt"
CLAIM_RECORD_PATH="$ARTIFACT_DIR/live-claim-record.json"
SUMMARY_PATH="$ARTIFACT_DIR/live-transcript-summary.json"

echo "Running testnet readiness gate..."
bash "$ROOT_DIR/scripts/check_testnet_readiness.sh"

if [ "$SKIP_PACKAGE_BUILD" != "1" ]; then
  echo "Building TypeScript client packages..."
  (
    cd "$ROOT_DIR"
    pnpm --filter @nebula/core build
    pnpm --filter @nebula/evm-client build
    pnpm --filter @nebula/cctp-client build
    pnpm --filter @nebula/stellar-client build
  )
else
  echo "Skipping TypeScript package build."
fi

echo "Checking Stellar Private Payments pool readiness..."
bash "$ROOT_DIR/scripts/check_private_pool_testnet.sh"

EXPECTED_SETTLEMENT_AMOUNT="$(
  node <<'NODE'
const lockAmount = BigInt(process.env.NEBULA_LOCK_AMOUNT);
const explicit = (process.env.NEBULA_EXPECTED_SETTLEMENT_AMOUNT || "").trim();
const expectedFee = (process.env.NEBULA_EXPECTED_CCTP_FEE_EXECUTED || "").trim();
let expected;
if (explicit) {
  expected = BigInt(explicit);
} else if (expectedFee) {
  const fee = BigInt(expectedFee);
  if (fee < 0n || fee >= lockAmount) {
    console.error("Blocker: NEBULA_EXPECTED_CCTP_FEE_EXECUTED must be >= 0 and below NEBULA_LOCK_AMOUNT.");
    process.exit(1);
  }
  expected = lockAmount - fee;
} else {
  console.error("Blocker: set NEBULA_EXPECTED_SETTLEMENT_AMOUNT or NEBULA_EXPECTED_CCTP_FEE_EXECUTED before the privacy run.");
  process.exit(1);
}
if (expected <= 0n || expected > lockAmount) {
  console.error("Blocker: expected settlement amount must be > 0 and <= NEBULA_LOCK_AMOUNT.");
  process.exit(1);
}
process.stdout.write(expected.toString());
NODE
)"
export NEBULA_SETTLEMENT_AMOUNT="$EXPECTED_SETTLEMENT_AMOUNT"

echo "Preparing upstream Stellar Private Payments proof before EVM burn..."
if [ -n "${NEBULA_PRIVATE_POOL_PREPARE_COMMAND:-}" ]; then
  rm -f "$UPSTREAM_PRIVATE_POOL_PROOF_JSON_PATH" "$PRIVATE_POOL_DEPOSIT_XDR_PATH" "$PRIVATE_POOL_DEPOSIT_METADATA_PATH"
  NEBULA_SETTLEMENT_AMOUNT="$EXPECTED_SETTLEMENT_AMOUNT" \
    PRIVATE_PAYMENTS_POOL_ID="$PRIVATE_PAYMENTS_POOL_ID" \
    NEBULA_PRIVATE_POOL_DEPOSIT_XDR_PATH="$PRIVATE_POOL_DEPOSIT_XDR_PATH" \
    NEBULA_PRIVATE_POOL_DEPOSIT_METADATA_PATH="$PRIVATE_POOL_DEPOSIT_METADATA_PATH" \
    NEBULA_UPSTREAM_PRIVATE_POOL_PROOF_JSON_PATH="$UPSTREAM_PRIVATE_POOL_PROOF_JSON_PATH" \
    bash -lc "$NEBULA_PRIVATE_POOL_PREPARE_COMMAND"
fi
if [ ! -f "$UPSTREAM_PRIVATE_POOL_PROOF_JSON_PATH" ]; then
  echo "Blocker: upstream PreparedProverTx JSON is required before the EVM burn." >&2
  echo "Set NEBULA_PRIVATE_POOL_PREPARE_COMMAND or write $UPSTREAM_PRIVATE_POOL_PROOF_JSON_PATH." >&2
  exit 1
fi
node scripts/private_pool_deposit_from_upstream.mjs \
  --input "$UPSTREAM_PRIVATE_POOL_PROOF_JSON_PATH" \
  --out "$PRIVATE_POOL_DEPOSIT_XDR_PATH" \
  --metadata-out "$PRIVATE_POOL_DEPOSIT_METADATA_PATH" \
  --expected-pool "$PRIVATE_PAYMENTS_POOL_ID" \
  --expected-settlement "$EXPECTED_SETTLEMENT_AMOUNT" \
  --note-output-index "${NEBULA_PRIVATE_POOL_NOTE_OUTPUT_INDEX:-0}"
NEBULA_NOTE_COMMITMENT="$(
  node - "$PRIVATE_POOL_DEPOSIT_METADATA_PATH" <<'NODE'
const fs = require("fs");
const metadata = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(metadata.selectedNoteCommitment);
NODE
)"
export NEBULA_NOTE_COMMITMENT

cat <<EOF
Private pool proof prepared:
  expected_settlement_amount=$EXPECTED_SETTLEMENT_AMOUNT
  note_output_index=${NEBULA_PRIVATE_POOL_NOTE_OUTPUT_INDEX:-0}
  nebula_note_commitment=$NEBULA_NOTE_COMMITMENT
  upstream_prepared=$UPSTREAM_PRIVATE_POOL_PROOF_JSON_PATH
  private_deposit_xdr=$PRIVATE_POOL_DEPOSIT_XDR_PATH
EOF

echo "Validating Stellar Forwarder hook data..."
node --input-type=module - "$CCTP_STELLAR_FORWARDER_HOOK_DATA" "$NEBULA_RELAY_CONTRACT_ID" <<'NODE'
import { parseStellarForwarderHookData } from "./packages/cctp-client/dist/index.js";

const [hookHex, expectedRecipient] = process.argv.slice(2);
const parsed = parseStellarForwarderHookData(hookHex);
if (parsed.version !== 0) {
  console.error(`Blocker: CCTP hook version must be 0, got ${parsed.version}.`);
  process.exit(1);
}
if (parsed.recipient !== expectedRecipient) {
  console.error(`Blocker: CCTP hook recipient ${parsed.recipient} must be NebulaRelay ${expectedRecipient}.`);
  process.exit(1);
}
console.log(JSON.stringify({ hookVersion: parsed.version, hookRecipient: parsed.recipient }));
NODE

echo "Checking EVM balances, allowance, and CCTP route..."
EVM_USER_ADDRESS="$(cast wallet address --private-key "$EVM_USER_PRIVATE_KEY")"
BOUNDLESS_REQUESTOR="$(cast wallet address --private-key "$BOUNDLESS_PRIVATE_KEY")"
USER_SEPOLIA_ETH_WEI="$(cast balance "$EVM_USER_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL")"
USER_USDC_RAW="$(extract_first_word "$(cast call "$CCTP_USDC_ADDRESS" 'balanceOf(address)(uint256)' "$EVM_USER_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL")")"
USER_ALLOWANCE_RAW="$(extract_first_word "$(cast call "$CCTP_USDC_ADDRESS" 'allowance(address,address)(uint256)' "$EVM_USER_ADDRESS" "$NEBULA_CCTP_ESCROW_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL")")"
BOUNDLESS_BASE_ETH_WEI="$(cast balance "$BOUNDLESS_REQUESTOR" --rpc-url "$BOUNDLESS_RPC_URL")"
require_bigint_at_least "EVM user USDC balance" "$USER_USDC_RAW" "$NEBULA_LOCK_AMOUNT"
ALLOWANCE_COVERS="$(
  node -e 'const [allowance, amount] = process.argv.slice(1); console.log(BigInt(allowance) >= BigInt(amount) ? "1" : "0")' \
    "$USER_ALLOWANCE_RAW" "$NEBULA_LOCK_AMOUNT"
)"
if [ "$ALLOWANCE_COVERS" != "1" ]; then
  if [ "${NEBULA_AUTO_APPROVE_USDC:-1}" = "0" ]; then
    echo "Blocker: EVM user USDC allowance $USER_ALLOWANCE_RAW is below NEBULA_LOCK_AMOUNT $NEBULA_LOCK_AMOUNT." >&2
    exit 1
  fi
  echo "USDC allowance is below NEBULA_LOCK_AMOUNT; the source burn helper will submit one max approval before lockAndBurn."
fi

mapfile -t ROUTE < <(cast call "$NEBULA_CCTP_ESCROW_ADDRESS" 'cctpRoute()(address,address,bytes32,uint256,uint32)' --rpc-url "$SEPOLIA_RPC_URL")
ROUTE_TOKEN_MESSENGER="${ROUTE[0]:-}"
ROUTE_BURN_TOKEN="${ROUTE[1]:-}"
ROUTE_FORWARDER="${ROUTE[2]:-}"
ROUTE_MAX_FEE="$(extract_first_word "${ROUTE[3]:-}")"
ROUTE_FINALITY="$(extract_first_word "${ROUTE[4]:-}")"
if [ "$(normalize_hex "$ROUTE_TOKEN_MESSENGER")" != "$(normalize_hex "$CCTP_TOKEN_MESSENGER_V2_ADDRESS")" ] ||
  [ "$(normalize_hex "$ROUTE_BURN_TOKEN")" != "$(normalize_hex "$CCTP_USDC_ADDRESS")" ] ||
  [ "$(normalize_hex "$ROUTE_FORWARDER")" != "$(normalize_hex "$CCTP_STELLAR_FORWARDER_BYTES32")" ] ||
  [ "$ROUTE_MAX_FEE" != "$CCTP_MAX_FEE" ] ||
  [ "$ROUTE_FINALITY" != "$CCTP_MIN_FINALITY_THRESHOLD" ]; then
  echo "Blocker: on-chain CCTP route does not match env." >&2
  printf 'route tokenMessenger=%s burnToken=%s forwarder=%s maxFee=%s finality=%s\n' \
    "$ROUTE_TOKEN_MESSENGER" "$ROUTE_BURN_TOKEN" "$ROUTE_FORWARDER" "$ROUTE_MAX_FEE" "$ROUTE_FINALITY" >&2
  exit 1
fi

cat <<EOF
Preflight ok:
  evm_user=$EVM_USER_ADDRESS
  evm_user_sepolia_eth_wei=$USER_SEPOLIA_ETH_WEI
  evm_user_usdc_raw=$USER_USDC_RAW
  evm_user_allowance_raw=$USER_ALLOWANCE_RAW
  boundless_requestor=$BOUNDLESS_REQUESTOR
  boundless_base_eth_wei=$BOUNDLESS_BASE_ETH_WEI
  lock_amount=$NEBULA_LOCK_AMOUNT
  cctp_max_fee=$CCTP_MAX_FEE
  cctp_min_finality=$CCTP_MIN_FINALITY_THRESHOLD
EOF

echo "Submitting Sepolia lockAndBurn..."
NEBULA_ENV_FILE=/dev/null \
  NEBULA_NOTE_COMMITMENT="$NEBULA_NOTE_COMMITMENT" \
  bash "$ROOT_DIR/scripts/run_evm_cctp_lock_testnet.sh"
TX_HASH="$(
  node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync('$ROOT_DIR/contracts/evm/broadcast/LockAndBurnCctp.s.sol/11155111/run-latest.json','utf8')); console.log(j.transactions[0].hash)"
)"
echo "source_tx=$TX_HASH"

echo "Fetching Sepolia receipt..."
cast receipt "$TX_HASH" --json --rpc-url "$SEPOLIA_RPC_URL" > "$RECEIPT_PATH"

echo "Polling Circle Iris..."
node --input-type=module - "$TX_HASH" "$IRIS_LATEST_PATH" "$IRIS_RESPONSE_PATH" "$SETTLEMENT_PATH" <<'NODE'
import fs from "node:fs";
import {
  createCctpSettlementBinding,
  fetchCctpAttestationOnce,
  parseCctpMessageV2,
  parseStellarForwarderHookData,
} from "./packages/cctp-client/dist/index.js";

const [txHash, latestPath, responsePath, settlementPath] = process.argv.slice(2);
const irisBaseUrl = process.env.CCTP_IRIS_API_URL;
const sourceDomain = Number(process.env.CCTP_SOURCE_DOMAIN);
const destinationDomain = Number(process.env.CCTP_STELLAR_DOMAIN);
const mintRecipient = process.env.CCTP_STELLAR_FORWARDER_ID;
const maxAttempts = Number(process.env.CCTP_IRIS_MAX_ATTEMPTS ?? 120);
const pollIntervalMs = Number(process.env.CCTP_IRIS_POLL_INTERVAL_MS ?? 5000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const attestation = await fetchCctpAttestationOnce(fetch, {
    irisBaseUrl,
    sourceDomain,
    transactionHash: txHash,
  });
  fs.writeFileSync(
    latestPath,
    JSON.stringify({ ...attestation, sourceTxHash: txHash, attempt }, null, 2),
  );
  if (attestation.status === "complete") {
    if (!attestation.eventNonce) {
      throw new Error("Circle Iris response omitted eventNonce.");
    }
    fs.writeFileSync(
      responsePath,
      JSON.stringify({ ...attestation.raw, sourceTxHash: txHash }, null, 2),
    );
    const binding = createCctpSettlementBinding({
      sourceDomain,
      destinationDomain,
      nonce: attestation.eventNonce,
      message: attestation.message,
      attestation: attestation.attestation,
      mintRecipient,
    });
    const parsed = parseCctpMessageV2(attestation.message);
    const hook = parseStellarForwarderHookData(parsed.burnMessage.hookData);
    const settlement = {
      ...binding,
      attestation: attestation.attestation,
      eventNonce: attestation.eventNonce,
      cctpVersion: attestation.cctpVersion,
      parsed: {
        version: parsed.version,
        sourceDomain: parsed.sourceDomain,
        destinationDomain: parsed.destinationDomain,
        minFinalityThreshold: parsed.minFinalityThreshold,
        finalityThresholdExecuted: parsed.finalityThresholdExecuted,
        burnAmount: parsed.burnMessage.amount.toString(),
        maxFee: parsed.burnMessage.maxFee.toString(),
        feeExecuted: parsed.burnMessage.feeExecuted.toString(),
        netAmount: (parsed.burnMessage.amount - parsed.burnMessage.feeExecuted).toString(),
        hookVersion: hook.version,
        hookRecipient: hook.recipient,
        hookPayload: hook.payload,
      },
    };
    fs.writeFileSync(settlementPath, JSON.stringify(settlement, null, 2));
    console.log(JSON.stringify({
      status: "complete",
      attempt,
      nonce: binding.nonce,
      messageHash: binding.messageHash,
      attestationHash: binding.attestationHash,
      feeExecuted: settlement.parsed.feeExecuted,
      netAmount: settlement.parsed.netAmount,
      hookVersion: hook.version,
    }, null, 2));
    process.exit(0);
  }
  console.log(`iris_pending attempt=${attempt}/${maxAttempts}`);
  await sleep(pollIntervalMs);
}

throw new Error(`Circle Iris attestation was not complete after ${maxAttempts} attempts.`);
NODE

ACTUAL_SETTLEMENT_AMOUNT="$(
  node - "$SETTLEMENT_PATH" <<'NODE'
const fs = require("fs");
const settlement = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(String(settlement.parsed?.netAmount ?? ""));
NODE
)"
if [ "$ACTUAL_SETTLEMENT_AMOUNT" != "$EXPECTED_SETTLEMENT_AMOUNT" ]; then
  echo "Blocker: Circle net amount $ACTUAL_SETTLEMENT_AMOUNT does not match prepared private-pool amount $EXPECTED_SETTLEMENT_AMOUNT." >&2
  echo "The EVM burn has completed, but Nebula will not submit a mismatched private claim." >&2
  echo "Prepare a new upstream proof for the actual net amount and rerun the claim step manually after review." >&2
  exit 1
fi

echo "Building LockWitness..."
node --input-type=module - "$RECEIPT_PATH" "$SETTLEMENT_PATH" "$WITNESS_PATH" <<'NODE'
import fs from "node:fs";
import { buildLockWitnessFromReceipt } from "./packages/evm-client/dist/index.js";
import { assertCctpMessageMatchesSettlement } from "./packages/cctp-client/dist/index.js";

const [receiptPath, settlementPath, witnessPath] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const settlementArtifact = JSON.parse(fs.readFileSync(settlementPath, "utf8"));
const complianceMode = process.env.NEBULA_COMPLIANCE_MODE === "0"
  ? "disabled-demo"
  : process.env.NEBULA_COMPLIANCE_MODE === "2"
    ? "denylist-non-membership"
    : "allowlist-membership";
const settlement = {
  sourceDomain: Number(process.env.CCTP_SOURCE_DOMAIN),
  destinationDomain: Number(process.env.CCTP_STELLAR_DOMAIN),
  nonce: settlementArtifact.nonce,
  message: settlementArtifact.message,
  messageHash: settlementArtifact.messageHash,
  attestationHash: settlementArtifact.attestationHash,
  mintRecipient: settlementArtifact.mintRecipient,
};
const witness = buildLockWitnessFromReceipt(receipt, {
  sourceChainId: Number(process.env.NEXT_PUBLIC_EVM_CHAIN_ID),
  escrowContract: process.env.NEBULA_CCTP_ESCROW_ADDRESS,
  sourceReceiptRoot: receipt.blockHash,
  complianceRoot: process.env.NEBULA_COMPLIANCE_ROOT,
  complianceMode,
  cctpSettlement: settlement,
  expected: {
    sourceChainId: Number(process.env.NEXT_PUBLIC_EVM_CHAIN_ID),
    escrowContract: process.env.NEBULA_CCTP_ESCROW_ADDRESS,
    tokenAddress: process.env.CCTP_USDC_ADDRESS,
    minAmount: process.env.NEBULA_MIN_AMOUNT,
    maxAmount: process.env.NEBULA_MAX_AMOUNT,
    complianceRoot: process.env.NEBULA_COMPLIANCE_ROOT,
    destinationChainId: Number(process.env.CCTP_STELLAR_DOMAIN),
    networkDomain: process.env.NEBULA_NETWORK_DOMAIN,
    expiresAtLedger: Number(process.env.NEBULA_EXPIRES_AT_LEDGER),
    cctpSourceDomain: Number(process.env.CCTP_SOURCE_DOMAIN),
    cctpDestinationDomain: Number(process.env.CCTP_STELLAR_DOMAIN),
    cctpMintRecipient: settlementArtifact.mintRecipient,
  },
});
const parsed = assertCctpMessageMatchesSettlement({
  message: settlement.message,
  expectedSourceDomain: Number(process.env.CCTP_SOURCE_DOMAIN),
  expectedDestinationDomain: Number(process.env.CCTP_STELLAR_DOMAIN),
  expectedNonce: settlement.nonce,
  expectedBurnToken: process.env.CCTP_USDC_ADDRESS,
  expectedAmount: BigInt(witness.amount),
  expectedMessageSender: process.env.NEBULA_CCTP_ESCROW_ADDRESS,
  expectedMintRecipient: settlement.mintRecipient,
});
fs.writeFileSync(witnessPath, JSON.stringify(witness, null, 2));
console.log(JSON.stringify({
  txHash: witness.txHash,
  blockNumber: witness.sourceBlockNumber,
  logIndex: witness.logIndex,
  lockId: witness.lockId,
  amount: witness.amount,
  messageHash: witness.cctpSettlement.messageHash,
  feeExecuted: parsed.burnMessage.feeExecuted.toString(),
}, null, 2));
NODE

ensure_risc0_recursion_zip() {
  local zkr_hash="744b999f0a35b3c86753311c7efb2a0054be21727095cf105af6ee7d3f4d8849"
  if [ -n "${RECURSION_SRC_PATH:-}" ]; then
    return
  fi
  local zkr_path="${NEBULA_RISC0_RECURSION_ZKR_PATH:-/tmp/recursion_zkr_${zkr_hash}.zip}"
  if [ ! -f "$zkr_path" ]; then
    echo "Downloading RISC Zero recursion artifact..."
    curl -L --fail --retry 3 --retry-delay 2 \
      --output "$zkr_path" \
      "https://risc0-artifacts.s3.us-west-2.amazonaws.com/zkr/${zkr_hash}.zip"
  fi
  local actual
  actual="$(sha256sum "$zkr_path" | awk '{print $1}')"
  if [ "$actual" != "$zkr_hash" ]; then
    echo "Blocker: RISC Zero recursion artifact checksum mismatch at $zkr_path." >&2
    exit 1
  fi
  export RECURSION_SRC_PATH="$zkr_path"
}

ensure_risc0_recursion_zip

echo "Requesting Boundless remote Groth16 proof..."
(
  cd "$ROOT_DIR"
  NEBULA_WITNESS_FIXTURE="$WITNESS_PATH" \
    NEBULA_PROOF_ARTIFACT="$PROOF_PATH" \
    RECURSION_SRC_PATH="$RECURSION_SRC_PATH" \
    bash "$ROOT_DIR/scripts/prove_boundless_remote.sh" 2>&1 | tee "$BOUNDLESS_LOG_PATH"
)
BOUNDLESS_REQUEST_ID="$(
  node - "$BOUNDLESS_LOG_PATH" <<'NODE'
const fs = require("fs");
const log = fs.readFileSync(process.argv[2], "utf8");
const match = /Boundless request submitted:\s*(0x[0-9a-fA-F]+)/.exec(log);
process.stdout.write(match?.[1] ?? "");
NODE
)"

echo "Preparing Stellar claim arguments..."
node - "$PROOF_PATH" "$SETTLEMENT_PATH" "$CLAIM_ARGS_ENV_PATH" <<'NODE'
const fs = require("fs");
const [proofPath, settlementPath, outPath] = process.argv.slice(2);
const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
const settlement = JSON.parse(fs.readFileSync(settlementPath, "utf8"));
const strip = (value) => String(value).replace(/^0x/i, "");
const pairs = {
  SEAL: strip(proof.sealHex),
  IMAGE_ID: strip(proof.imageIdHex),
  JOURNAL: strip(proof.journalHex),
  CCTP_MESSAGE: strip(settlement.message),
  CCTP_ATTESTATION: strip(settlement.attestation),
  NULLIFIER: strip(proof.publicOutputs.claimNullifier),
  NOTE_COMMITMENT: strip(proof.publicOutputs.stellarNoteCommitment),
  SETTLEMENT_AMOUNT: proof.publicOutputs.settlementAmount,
  SETTLEMENT_AMOUNT_BUCKET: String(proof.publicOutputs.settlementAmountBucket),
};
fs.writeFileSync(
  outPath,
  Object.entries(pairs).map(([key, value]) => `${key}='${value}'`).join("\n") + "\n",
);
NODE

set -a
# shellcheck disable=SC1090
. "$CLAIM_ARGS_ENV_PATH"
set +a

if [ "$(normalize_hex "$NEBULA_NOTE_COMMITMENT")" != "$(normalize_hex "$NOTE_COMMITMENT")" ]; then
  echo "Blocker: RISC Zero journal note 0x$NOTE_COMMITMENT does not match prepared private-pool note $NEBULA_NOTE_COMMITMENT." >&2
  exit 1
fi
if [ "$SETTLEMENT_AMOUNT" != "$EXPECTED_SETTLEMENT_AMOUNT" ]; then
  echo "Blocker: proof settlement amount $SETTLEMENT_AMOUNT does not match prepared private-pool amount $EXPECTED_SETTLEMENT_AMOUNT." >&2
  exit 1
fi

echo "Re-validating prepared private-pool deposit against proof journal..."
node scripts/private_pool_deposit_from_upstream.mjs \
  --input "$UPSTREAM_PRIVATE_POOL_PROOF_JSON_PATH" \
  --out "$PRIVATE_POOL_DEPOSIT_XDR_PATH" \
  --metadata-out "$PRIVATE_POOL_DEPOSIT_METADATA_PATH" \
  --expected-pool "$PRIVATE_PAYMENTS_POOL_ID" \
  --expected-settlement "$SETTLEMENT_AMOUNT" \
  --expected-note "0x$NOTE_COMMITMENT" \
  --note-output-index "${NEBULA_PRIVATE_POOL_NOTE_OUTPUT_INDEX:-0}"
PRIVATE_POOL_DEPOSIT_XDR="$(tr -d '\r\n ' < "$PRIVATE_POOL_DEPOSIT_XDR_PATH")"

echo "Simulating and submitting Stellar private-pool claim..."
CLAIM_TX_HASH="$(
  PRIVATE_POOL_DEPOSIT_XDR="$PRIVATE_POOL_DEPOSIT_XDR" \
    node --input-type=module - "$CLAIM_SIM_OUTPUT_PATH" "$CLAIM_OUTPUT_PATH" <<'NODE'
import fs from "node:fs";
import { createRequire } from "node:module";
import {
  buildPrivatePoolClaimTransaction,
  simulateAndAssembleTransaction,
  submitSignedTransaction,
} from "./packages/stellar-client/dist/index.js";

const requireFromStellarClient = createRequire(new URL("./packages/stellar-client/package.json", import.meta.url));
const StellarSdk = await import(requireFromStellarClient.resolve("@stellar/stellar-sdk"));
const [simPath, outPath] = process.argv.slice(2);
const rpc = new StellarSdk.rpc.Server(process.env.STELLAR_RPC_URL);
const sourceKeypair = StellarSdk.Keypair.fromSecret(process.env.STELLAR_SOURCE_SECRET);
const sourceAccount = await rpc.getAccount(sourceKeypair.publicKey());
const privateDeposit = StellarSdk.xdr.ScVal.fromXDR(process.env.PRIVATE_POOL_DEPOSIT_XDR, "base64");
const hex = (value) => `0x${String(value).replace(/^0x/i, "")}`;
const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || StellarSdk.Networks.TESTNET;
const tx = buildPrivatePoolClaimTransaction({
  sourceAccount,
  contractId: process.env.NEBULA_RELAY_CONTRACT_ID,
  networkPassphrase,
  claim: {
    seal: hex(process.env.SEAL),
    imageId: hex(process.env.IMAGE_ID),
    journal: hex(process.env.JOURNAL),
    cctpMessage: hex(process.env.CCTP_MESSAGE),
    cctpAttestation: hex(process.env.CCTP_ATTESTATION),
    privateDeposit,
  },
});
const prepared = await simulateAndAssembleTransaction(rpc, tx);
fs.writeFileSync(simPath, JSON.stringify({ ok: true }, null, 2));
prepared.transaction.sign(sourceKeypair);
const result = await submitSignedTransaction(
  rpc,
  prepared.transaction.toXDR(),
  networkPassphrase,
  { pollIntervalMs: 1000, maxPolls: 60 },
);
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
process.stdout.write(result.hash);
NODE
)"

echo "Verifying private claim storage..."
CLAIMED_RESULT="$(
  stellar contract invoke \
    --id "$NEBULA_RELAY_CONTRACT_ID" \
    --source "$STELLAR_SOURCE" \
    --network "$STELLAR_NETWORK" \
    --send=no \
    -- \
    is_claimed \
    --nullifier "$NULLIFIER"
)"
if [ "$CLAIMED_RESULT" != "true" ]; then
  echo "Blocker: is_claimed returned $CLAIMED_RESULT." >&2
  exit 1
fi
stellar contract invoke \
  --id "$NEBULA_RELAY_CONTRACT_ID" \
  --source "$STELLAR_SOURCE" \
  --network "$STELLAR_NETWORK" \
  --send=no \
  -- \
  get_private_claim \
  --nullifier "$NULLIFIER" > "$CLAIM_RECORD_PATH"

echo "Checking replay rejection..."
PRIVATE_POOL_DEPOSIT_XDR="$PRIVATE_POOL_DEPOSIT_XDR" \
  node --input-type=module - "$REPLAY_OUTPUT_PATH" <<'NODE'
import fs from "node:fs";
import { createRequire } from "node:module";
import {
  buildPrivatePoolClaimTransaction,
  simulateAndAssembleTransaction,
} from "./packages/stellar-client/dist/index.js";

const requireFromStellarClient = createRequire(new URL("./packages/stellar-client/package.json", import.meta.url));
const StellarSdk = await import(requireFromStellarClient.resolve("@stellar/stellar-sdk"));
const [outPath] = process.argv.slice(2);
const rpc = new StellarSdk.rpc.Server(process.env.STELLAR_RPC_URL);
const sourceKeypair = StellarSdk.Keypair.fromSecret(process.env.STELLAR_SOURCE_SECRET);
const sourceAccount = await rpc.getAccount(sourceKeypair.publicKey());
const privateDeposit = StellarSdk.xdr.ScVal.fromXDR(process.env.PRIVATE_POOL_DEPOSIT_XDR, "base64");
const hex = (value) => `0x${String(value).replace(/^0x/i, "")}`;
const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || StellarSdk.Networks.TESTNET;
const tx = buildPrivatePoolClaimTransaction({
  sourceAccount,
  contractId: process.env.NEBULA_RELAY_CONTRACT_ID,
  networkPassphrase,
  claim: {
    seal: hex(process.env.SEAL),
    imageId: hex(process.env.IMAGE_ID),
    journal: hex(process.env.JOURNAL),
    cctpMessage: hex(process.env.CCTP_MESSAGE),
    cctpAttestation: hex(process.env.CCTP_ATTESTATION),
    privateDeposit,
  },
});
try {
  await simulateAndAssembleTransaction(rpc, tx);
  fs.writeFileSync(outPath, "replay unexpectedly simulated successfully\n");
  process.exit(1);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fs.writeFileSync(outPath, `${message}\n`);
  if (!message.includes("#15") && !message.includes("NullifierAlreadyClaimed")) {
    console.error(`Blocker: replay failed, but not with NullifierAlreadyClaimed (#15): ${message}`);
    process.exit(1);
  }
}
NODE

echo "Writing live transcript summary..."
BOUNDLESS_REQUEST_ID="$BOUNDLESS_REQUEST_ID" \
  CLAIM_TX_HASH="$CLAIM_TX_HASH" \
  PRIVATE_PAYMENTS_POOL_ID="$PRIVATE_PAYMENTS_POOL_ID" \
  PRIVATE_POOL_DEPOSIT_METADATA_PATH="$PRIVATE_POOL_DEPOSIT_METADATA_PATH" \
  node - "$RECEIPT_PATH" "$WITNESS_PATH" "$SETTLEMENT_PATH" "$PROOF_PATH" "$SUMMARY_PATH" <<'NODE'
const fs = require("fs");
const [receiptPath, witnessPath, settlementPath, proofPath, summaryPath] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const witness = JSON.parse(fs.readFileSync(witnessPath, "utf8"));
const settlement = JSON.parse(fs.readFileSync(settlementPath, "utf8"));
const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
const privatePoolMetadataPath = process.env.PRIVATE_POOL_DEPOSIT_METADATA_PATH;
const privatePoolMetadata = privatePoolMetadataPath && fs.existsSync(privatePoolMetadataPath)
  ? JSON.parse(fs.readFileSync(privatePoolMetadataPath, "utf8"))
  : null;
const blockNumber = typeof receipt.blockNumber === "string" && receipt.blockNumber.startsWith("0x")
  ? Number.parseInt(receipt.blockNumber, 16)
  : Number(receipt.blockNumber);
const summary = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: {
    network: "ethereum-sepolia",
    txHash: receipt.transactionHash,
    blockNumber,
    lockId: witness.lockId,
    amountRaw: witness.amount,
    escrow: witness.escrowContract,
    token: witness.tokenAddress,
  },
  cctp: {
    sourceDomain: settlement.sourceDomain,
    destinationDomain: settlement.destinationDomain,
    nonce: settlement.nonce,
    messageHash: settlement.messageHash,
    attestationHash: settlement.attestationHash,
    minFinalityThreshold: settlement.parsed?.minFinalityThreshold,
    finalityThresholdExecuted: settlement.parsed?.finalityThresholdExecuted,
    feeExecutedRaw: settlement.parsed?.feeExecuted,
    netAmountRaw: settlement.parsed?.netAmount,
    hookVersion: settlement.parsed?.hookVersion,
    hookRecipient: settlement.parsed?.hookRecipient,
  },
  proof: {
    mode: proof.proofMode,
    imageId: proof.imageIdHex,
    journalDigest: proof.journalDigestHex,
    witnessHash: proof.witnessHash,
    boundlessRequestId: process.env.BOUNDLESS_REQUEST_ID || null,
  },
  stellar: {
    network: "stellar-testnet",
    claimTxHash: process.env.CLAIM_TX_HASH,
    visibleClaimant: null,
    privatePool: process.env.PRIVATE_PAYMENTS_POOL_ID,
    privatePoolPreparedTxPath: privatePoolMetadata?.upstreamPreparedTxPath ?? null,
    privatePoolNoteOutputIndex: privatePoolMetadata?.selectedOutputIndex ?? null,
    privatePoolOutputCommitments: privatePoolMetadata?.outputCommitments ?? null,
    claimNullifier: proof.publicOutputs.claimNullifier,
    noteCommitment: proof.publicOutputs.stellarNoteCommitment,
    settlementAmountRaw: proof.publicOutputs.settlementAmount,
    settlementAmountBucket: proof.publicOutputs.settlementAmountBucket,
    relay: process.env.NEBULA_RELAY_CONTRACT_ID,
    verifierRouter: process.env.RISC0_VERIFIER_ROUTER_ID,
    asset: process.env.STELLAR_ASSET_CONTRACT_ID,
  },
  replay: {
    failed: true,
    error: "NebulaRelay NullifierAlreadyClaimed (#15)",
  },
};
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
NODE

cat <<EOF
Live transcript complete.
summary=$SUMMARY_PATH
source_tx=$TX_HASH
stellar_claim_tx=$CLAIM_TX_HASH
claim_nullifier=0x$NULLIFIER
EOF
