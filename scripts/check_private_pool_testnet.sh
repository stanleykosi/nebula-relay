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

resolve_repo_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$ROOT_DIR/$1" ;;
  esac
}

ARTIFACT_DIR="$(resolve_repo_path "${NEBULA_LIVE_ARTIFACT_DIR:-artifacts}")"
DEPLOYMENT_JSON="$(resolve_repo_path "${PRIVATE_PAYMENTS_DEPLOYMENT_JSON:-vendor/stellar-private-payments/deployments/testnet/deployments.json}")"
REPORT_PATH="$(resolve_repo_path "${NEBULA_PRIVATE_POOL_READINESS_REPORT:-$ARTIFACT_DIR/private-pool-readiness.json}")"
META_PATH="$ARTIFACT_DIR/private-pool-deployment-match.json"

failures=0

fail() {
  echo "Blocker: $*" >&2
  failures=$((failures + 1))
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    fail "$name is required for private-pool readiness."
  fi
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    fail "$name is not installed or not on PATH."
  fi
}

invoke_read() {
  local contract_id="$1"
  local function_name="$2"
  shift 2
  stellar contract invoke \
    --id "$contract_id" \
    --source "$STELLAR_SOURCE" \
    --network "$STELLAR_NETWORK" \
    --send=no \
    -- \
    "$function_name" "$@"
}

for command in node stellar; do
  require_command "$command"
done

for name in \
  STELLAR_NETWORK \
  STELLAR_SOURCE \
  STELLAR_ASSET_CONTRACT_ID \
  PRIVATE_PAYMENTS_POOL_ID
do
  require_env "$name"
done

if [ "${STELLAR_NETWORK:-}" != "testnet" ]; then
  fail "STELLAR_NETWORK must be testnet for this readiness check."
fi

if [ -n "${NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID:-}" ] &&
  [ "$NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID" != "${PRIVATE_PAYMENTS_POOL_ID:-}" ]; then
  fail "NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID must match PRIVATE_PAYMENTS_POOL_ID."
fi

if [ ! -f "$DEPLOYMENT_JSON" ]; then
  fail "Private Payments deployment JSON not found at $DEPLOYMENT_JSON."
fi

mkdir -p "$ARTIFACT_DIR"

if [ "$failures" -eq 0 ]; then
  if ! node - "$DEPLOYMENT_JSON" "$PRIVATE_PAYMENTS_POOL_ID" "$STELLAR_ASSET_CONTRACT_ID" "$META_PATH" <<'NODE'
const fs = require("fs");
const [deploymentPath, poolId, expectedToken, outPath] = process.argv.slice(2);
const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
const pool = (deployment.pools || []).find((item) => item.poolContractId === poolId);
if (!pool) {
  console.error(`pool ${poolId} is not listed in ${deploymentPath}`);
  process.exit(1);
}
if (!pool.enabled) {
  console.error(`pool ${poolId} is listed but not enabled`);
  process.exit(1);
}
if (pool.tokenContractId !== expectedToken) {
  console.error(`pool token ${pool.tokenContractId} does not match STELLAR_ASSET_CONTRACT_ID ${expectedToken}`);
  process.exit(1);
}
fs.writeFileSync(
  outPath,
  `${JSON.stringify({ deploymentPath, deploymentNetwork: deployment.network, pool }, null, 2)}\n`,
);
NODE
  then
    fail "Configured private pool is not a matching enabled pool in the upstream deployment JSON. Set PRIVATE_PAYMENTS_DEPLOYMENT_JSON to the deployment that contains your USDC pool."
  fi
fi

POOL_ROOT=""
ASP_MEMBERSHIP_ROOT=""
ASP_NON_MEMBERSHIP_ROOT=""
ASSET_SYMBOL=""
ASSET_DECIMALS=""

if [ "$failures" -eq 0 ]; then
  if ! POOL_ROOT="$(invoke_read "$PRIVATE_PAYMENTS_POOL_ID" get_root 2>&1)"; then
    fail "PRIVATE_PAYMENTS_POOL_ID did not respond to get_root: $POOL_ROOT"
  fi
  if ! ASP_MEMBERSHIP_ROOT="$(invoke_read "$PRIVATE_PAYMENTS_POOL_ID" get_asp_membership_root 2>&1)"; then
    fail "PRIVATE_PAYMENTS_POOL_ID did not respond to get_asp_membership_root: $ASP_MEMBERSHIP_ROOT"
  fi
  if ! ASP_NON_MEMBERSHIP_ROOT="$(invoke_read "$PRIVATE_PAYMENTS_POOL_ID" get_asp_non_membership_root 2>&1)"; then
    fail "PRIVATE_PAYMENTS_POOL_ID did not respond to get_asp_non_membership_root: $ASP_NON_MEMBERSHIP_ROOT"
  fi
  if ! ASSET_SYMBOL="$(invoke_read "$STELLAR_ASSET_CONTRACT_ID" symbol 2>&1)"; then
    fail "STELLAR_ASSET_CONTRACT_ID did not respond to symbol: $ASSET_SYMBOL"
  fi
  if ! ASSET_DECIMALS="$(invoke_read "$STELLAR_ASSET_CONTRACT_ID" decimals 2>&1)"; then
    fail "STELLAR_ASSET_CONTRACT_ID did not respond to decimals: $ASSET_DECIMALS"
  fi
fi

if [ "$failures" -ne 0 ]; then
  echo "Private-pool readiness failed with $failures blocker(s)." >&2
  exit 1
fi

node - "$META_PATH" "$REPORT_PATH" "$POOL_ROOT" "$ASP_MEMBERSHIP_ROOT" "$ASP_NON_MEMBERSHIP_ROOT" "$ASSET_SYMBOL" "$ASSET_DECIMALS" <<'NODE'
const fs = require("fs");
const [
  metaPath,
  reportPath,
  poolRoot,
  aspMembershipRoot,
  aspNonMembershipRoot,
  assetSymbol,
  assetDecimals,
] = process.argv.slice(2);
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
const report = {
  ok: true,
  checkedAt: new Date().toISOString(),
  deploymentPath: meta.deploymentPath,
  deploymentNetwork: meta.deploymentNetwork,
  pool: meta.pool,
  onchain: {
    poolRoot: poolRoot.trim(),
    aspMembershipRoot: aspMembershipRoot.trim(),
    aspNonMembershipRoot: aspNonMembershipRoot.trim(),
    assetSymbol: assetSymbol.trim(),
    assetDecimals: assetDecimals.trim(),
  },
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
NODE

echo "Private-pool readiness checks passed."
