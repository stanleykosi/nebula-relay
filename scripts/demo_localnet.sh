#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${NEBULA_ARTIFACT_DIR:-$ROOT_DIR/artifacts/demo}"
SUBMISSION_PATH="${NEBULA_DEMO_SUBMISSION:-$ARTIFACT_DIR/demo-submission.json}"
CONTRACT_ENV_PATH="${NEBULA_LOCALNET_CONTRACTS:-$ARTIFACT_DIR/localnet-contracts.env}"
REPORT_PATH="${NEBULA_LOCALNET_DEMO_REPORT:-$ARTIFACT_DIR/localnet-demo-report.json}"
RUN_LIVE="${RUN_LIVE:-0}"

mkdir -p "$ARTIFACT_DIR"

"$ROOT_DIR/scripts/generate_demo_fixture.sh"
"$ROOT_DIR/scripts/verify_submission.sh" "$SUBMISSION_PATH"

live_status="skipped"
live_blocker="Set RUN_LIVE=1 after scripts/deploy_localnet.sh writes artifacts/demo/localnet-contracts.env."

if [ -f "$CONTRACT_ENV_PATH" ]; then
  # shellcheck disable=SC1090
  source "$CONTRACT_ENV_PATH"
  live_blocker=""
  echo "Found localnet contract metadata: $CONTRACT_ENV_PATH"
  echo "NEBULA_RELAY_CONTRACT_ID=${NEBULA_RELAY_CONTRACT_ID:-unset}"

  if [ "$RUN_LIVE" = "1" ]; then
    if ! command -v stellar >/dev/null 2>&1; then
      live_status="blocked"
      live_blocker="Stellar CLI is not installed."
    elif [ -z "${NEBULA_RELAY_CONTRACT_ID:-}" ]; then
      live_status="blocked"
      live_blocker="NEBULA_RELAY_CONTRACT_ID is missing in $CONTRACT_ENV_PATH."
    else
      nullifier="$(node -e "const s=require('$SUBMISSION_PATH'); console.log(s.proofArtifact.publicOutputs.claimNullifier)")"
      source_account="${STELLAR_SOURCE:-nebula-local}"
      network="${STELLAR_NETWORK:-local}"
      echo "Querying localnet nullifier state with Stellar CLI..."
      stellar contract invoke \
        --id "$NEBULA_RELAY_CONTRACT_ID" \
        --source "$source_account" \
        --network "$network" \
        -- \
        is_claimed \
        --nullifier "$nullifier"
      live_status="queried"
    fi
  fi
else
  echo "Live localnet metadata not found: $CONTRACT_ENV_PATH"
  echo "Fixture demo is still valid. Run scripts/deploy_localnet.sh for live localnet metadata."
fi

node - "$REPORT_PATH" "$SUBMISSION_PATH" "$live_status" "$live_blocker" <<'NODE'
const fs = require("fs");
const [reportPath, submissionPath, liveStatus, liveBlocker] = process.argv.slice(2);
const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
fs.writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      fixtureSubmission: submissionPath,
      proofMode: submission.proofArtifact.proofMode,
      journalDigest: submission.proofArtifact.journalDigestHex,
      claimNullifier: submission.proofArtifact.publicOutputs.claimNullifier,
      liveLocalnet: {
        status: liveStatus,
        blocker: liveBlocker || null,
      },
    },
    null,
    2
  )}\n`
);
console.log(`localnet_demo_report=${reportPath}`);
NODE

echo "Stage 13 local demo complete in fixture mode."
if [ "$live_status" != "queried" ]; then
  echo "Live localnet path: $live_status"
  [ -n "$live_blocker" ] && echo "Blocker: $live_blocker"
fi
