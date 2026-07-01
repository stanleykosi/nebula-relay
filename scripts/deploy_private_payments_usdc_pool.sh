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

fail() {
  echo "Blocker: $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "missing '$1'"
}

resolve_repo_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$ROOT_DIR/$1" ;;
  esac
}

need node
need stellar

export CARGO_NET_GIT_FETCH_WITH_CLI="${CARGO_NET_GIT_FETCH_WITH_CLI:-true}"

NETWORK="${STELLAR_NETWORK:-testnet}"
DEPLOY_MODE="${PRIVATE_PAYMENTS_DEPLOY_MODE:-reuse-upstream-hashes}"
DEPLOYER="${PRIVATE_PAYMENTS_DEPLOYER:-${STELLAR_SOURCE:-}}"
TOKEN_CONTRACT_ID="${PRIVATE_PAYMENTS_TOKEN_CONTRACT_ID:-${STELLAR_ASSET_CONTRACT_ID:-}}"
ASP_LEVELS="${PRIVATE_PAYMENTS_ASP_LEVELS:-10}"
POOL_LEVELS="${PRIVATE_PAYMENTS_POOL_LEVELS:-10}"
MAX_DEPOSIT="${PRIVATE_PAYMENTS_MAX_DEPOSIT:-1000000000}"
VK_FILE="$(resolve_repo_path "${PRIVATE_PAYMENTS_VK_FILE:-vendor/stellar-private-payments/deployments/testnet/circuit_keys/policy_tx_2_2_vk.json}")"
DEPLOYMENT_JSON="$(resolve_repo_path "${PRIVATE_PAYMENTS_DEPLOYMENT_JSON:-artifacts/private/private-payments-usdc-deployment.json}")"
DEPLOY_LOG="$(resolve_repo_path "${PRIVATE_PAYMENTS_DEPLOY_LOG:-artifacts/private/private-payments-usdc-deploy.log}")"
UPSTREAM_DEPLOYMENT_JSON="$(resolve_repo_path "${PRIVATE_PAYMENTS_UPSTREAM_DEPLOYMENT_JSON:-artifacts/private/private-payments-upstream-testnet.json}")"
UPSTREAM_DEPLOYMENT_URL="${PRIVATE_PAYMENTS_UPSTREAM_DEPLOYMENT_URL:-https://raw.githubusercontent.com/NethermindEth/stellar-private-payments/main/deployments/testnet/deployments.json}"
VENDOR_DIR="$ROOT_DIR/vendor/stellar-private-payments"
VENDOR_DEPLOYMENT_JSON="$VENDOR_DIR/deployments/$NETWORK/deployments.json"
VENDOR_DEPLOY_SCRIPT="$VENDOR_DIR/deployments/scripts/deploy.sh"

[ "$NETWORK" = "testnet" ] || fail "this USDC pool workaround is guarded for STELLAR_NETWORK=testnet."
[ -n "$DEPLOYER" ] || fail "STELLAR_SOURCE or PRIVATE_PAYMENTS_DEPLOYER is required."
[ -n "$TOKEN_CONTRACT_ID" ] || fail "STELLAR_ASSET_CONTRACT_ID or PRIVATE_PAYMENTS_TOKEN_CONTRACT_ID is required."
case "$DEPLOY_MODE" in
  reuse-upstream-hashes)
    need curl
    ;;
  full-build)
    [ -f "$VK_FILE" ] || fail "Private Payments verification key not found at $VK_FILE."
    [ -x "$VENDOR_DEPLOY_SCRIPT" ] || fail "Private Payments deploy script is not executable at $VENDOR_DEPLOY_SCRIPT."
    ;;
  *)
    fail "PRIVATE_PAYMENTS_DEPLOY_MODE must be reuse-upstream-hashes or full-build."
    ;;
esac

TOKEN_SYMBOL="$(
  stellar contract invoke \
    --id "$TOKEN_CONTRACT_ID" \
    --source "$DEPLOYER" \
    --network "$NETWORK" \
    --send=no \
    -- \
    symbol 2>/dev/null | tr -d '"[:space:]'
)"

TOKEN_DECIMALS="$(
  stellar contract invoke \
    --id "$TOKEN_CONTRACT_ID" \
    --source "$DEPLOYER" \
    --network "$NETWORK" \
    --send=no \
    -- \
    decimals 2>/dev/null | tr -d '"[:space:]'
)"

TOKEN_NAME="$(
  stellar contract invoke \
    --id "$TOKEN_CONTRACT_ID" \
    --source "$DEPLOYER" \
    --network "$NETWORK" \
    --send=no \
    -- \
    name 2>/dev/null | tr -d '"'
)"

[ "$TOKEN_SYMBOL" = "USDC" ] || fail "configured token contract returned symbol '$TOKEN_SYMBOL', expected USDC."
[ "$TOKEN_DECIMALS" = "7" ] || fail "configured USDC contract returned decimals '$TOKEN_DECIMALS', expected 7."

mkdir -p "$(dirname "$DEPLOYMENT_JSON")" "$(dirname "$DEPLOY_LOG")"

deployment_json_env="$DEPLOYMENT_JSON"
case "$deployment_json_env" in
  "$ROOT_DIR"/*) deployment_json_env="${deployment_json_env#"$ROOT_DIR/"}" ;;
esac

update_local_env() {
  local pool_id="$1"
  local deploy_mode="$2"
  node - "$ENV_FILE" "$pool_id" "$deployment_json_env" "$ASP_LEVELS" "$POOL_LEVELS" "$MAX_DEPOSIT" "$deploy_mode" <<'NODE'
const fs = require("fs");
const [path, poolId, deploymentJson, aspLevels, poolLevels, maxDeposit, deployMode] = process.argv.slice(2);
let text = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
const updates = new Map([
  ["PRIVATE_PAYMENTS_POOL_ID", poolId],
  ["NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID", poolId],
  ["PRIVATE_PAYMENTS_DEPLOYMENT_JSON", deploymentJson],
  ["PRIVATE_PAYMENTS_ASP_LEVELS", aspLevels],
  ["PRIVATE_PAYMENTS_POOL_LEVELS", poolLevels],
  ["PRIVATE_PAYMENTS_MAX_DEPOSIT", maxDeposit],
  ["PRIVATE_PAYMENTS_DEPLOY_MODE", deployMode],
]);
for (const [key, value] of updates) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) {
    text = text.replace(re, line);
  } else {
    if (text.length && !text.endsWith("\n")) text += "\n";
    text += `${line}\n`;
  }
}
fs.writeFileSync(path, text);
NODE
}

get_latest_ledger_seq() {
  local out seq
  out="$(stellar ledger latest --network "$NETWORK" 2>&1)" || {
    echo "$out" >&2
    fail "failed to query latest Stellar ledger."
  }
  seq="$(grep -Eo '^Sequence:[[:space:]]*[0-9]+' <<<"$out" | grep -Eo '[0-9]+' | head -1 || true)"
  [ -n "$seq" ] || fail "failed to parse latest Stellar ledger sequence."
  printf '%s\n' "$seq"
}

deploy_hash() {
  local name="$1"
  local wasm_hash="$2"
  shift 2
  local output id
  output="$(stellar contract deploy --wasm-hash "$wasm_hash" --source-account "$DEPLOYER" --network "$NETWORK" -- "$@" 2>&1)" || {
    echo "$output" >&2
    fail "failed to deploy $name from wasm hash $wasm_hash."
  }
  printf '%s\n' "$output" >>"$DEPLOY_LOG"
  id="$(grep -Eo 'C[A-Z0-9]{55}' <<<"$output" | head -1 || true)"
  [ -n "$id" ] || fail "failed to parse deployed contract id for $name."
  printf '%s\n' "$id"
}

if [ "$DEPLOY_MODE" = "reuse-upstream-hashes" ]; then
  mkdir -p "$(dirname "$UPSTREAM_DEPLOYMENT_JSON")"
  curl -fsSL "$UPSTREAM_DEPLOYMENT_URL" -o "$UPSTREAM_DEPLOYMENT_JSON"

  mapfile -t upstream < <(node - "$UPSTREAM_DEPLOYMENT_JSON" "${PRIVATE_PAYMENTS_REFERENCE_POOL_ID:-}" <<'NODE'
const fs = require("fs");
const [path, requestedPool] = process.argv.slice(2);
const deployment = JSON.parse(fs.readFileSync(path, "utf8"));
const pool = requestedPool
  ? (deployment.pools || []).find((entry) => entry.poolContractId === requestedPool)
  : (deployment.pools || []).find((entry) => entry.enabled);
if (!pool) {
  console.error("no enabled reference pool found in upstream deployment JSON");
  process.exit(1);
}
for (const value of [
  deployment.deployer,
  deployment.admin,
  deployment.asp_membership,
  deployment.asp_non_membership,
  deployment.verifier,
  deployment.public_key_registry,
  pool.poolContractId,
]) {
  console.log(value);
}
NODE
  )

  [ "${#upstream[@]}" -eq 7 ] || fail "failed to parse upstream deployment JSON."
  upstream_deployer="${upstream[0]}"
  upstream_admin="${upstream[1]}"
  upstream_asp_membership="${upstream[2]}"
  upstream_asp_non_membership="${upstream[3]}"
  upstream_verifier="${upstream[4]}"
  upstream_public_key_registry="${upstream[5]}"
  upstream_pool="${upstream[6]}"

  deployer_addr="$(stellar keys address "$DEPLOYER")"
  deployment_ledger="$(get_latest_ledger_seq)"

  asp_membership_hash="$(stellar contract info hash --id "$upstream_asp_membership" --network "$NETWORK" | tr -d '[:space:]')"
  asp_non_membership_hash="$(stellar contract info hash --id "$upstream_asp_non_membership" --network "$NETWORK" | tr -d '[:space:]')"
  verifier_hash="$(stellar contract info hash --id "$upstream_verifier" --network "$NETWORK" | tr -d '[:space:]')"
  public_key_registry_hash="$(stellar contract info hash --id "$upstream_public_key_registry" --network "$NETWORK" | tr -d '[:space:]')"
  pool_hash="$(stellar contract info hash --id "$upstream_pool" --network "$NETWORK" | tr -d '[:space:]')"

  : >"$DEPLOY_LOG"
  {
    echo "Deploying USDC pool bundle from upstream-installed Stellar Private Payments hashes"
    echo "mode=$DEPLOY_MODE"
    echo "network=$NETWORK"
    echo "deployer=$DEPLOYER"
    echo "deployer_addr=$deployer_addr"
    echo "upstream_deployer=$upstream_deployer"
    echo "upstream_admin=$upstream_admin"
    echo "reference_pool=$upstream_pool"
    echo "asp_membership_hash=$asp_membership_hash"
    echo "asp_non_membership_hash=$asp_non_membership_hash"
    echo "verifier_hash=$verifier_hash"
    echo "public_key_registry_hash=$public_key_registry_hash"
    echo "pool_hash=$pool_hash"
  } | tee -a "$DEPLOY_LOG"

  echo "Deploying ASP membership..."
  asp_membership_id="$(deploy_hash asp-membership "$asp_membership_hash" --admin "$deployer_addr" --levels "$ASP_LEVELS")"
  echo "Deploying ASP non-membership..."
  asp_non_membership_id="$(deploy_hash asp-non-membership "$asp_non_membership_hash" --admin "$deployer_addr")"
  echo "Deploying verifier..."
  verifier_id="$(deploy_hash verifier "$verifier_hash")"
  echo "Deploying public key registry..."
  public_key_registry_id="$(deploy_hash public-key-registry "$public_key_registry_hash")"
  echo "Deploying USDC pool..."
  pool_id="$(
    deploy_hash pool "$pool_hash" \
      --admin "$deployer_addr" \
      --token "$TOKEN_CONTRACT_ID" \
      --verifier "$verifier_id" \
      --asp-membership "$asp_membership_id" \
      --asp-non-membership "$asp_non_membership_id" \
      --maximum-deposit-amount "$MAX_DEPOSIT" \
      --levels "$POOL_LEVELS"
  )"

  node - "$DEPLOYMENT_JSON" "$NETWORK" "$deployer_addr" "$asp_membership_id" "$asp_non_membership_id" "$verifier_id" "$public_key_registry_id" "$pool_id" "$TOKEN_CONTRACT_ID" "$deployment_ledger" "$TOKEN_NAME" "$TOKEN_SYMBOL" <<'NODE'
const fs = require("fs");
const [
  path,
  network,
  deployer,
  aspMembership,
  aspNonMembership,
  verifier,
  publicKeyRegistry,
  poolId,
  tokenContractId,
  deploymentLedger,
  tokenName,
  tokenSymbol,
] = process.argv.slice(2);
const match = /^([^:]+):([A-Z0-9]{56})$/.exec(tokenName);
const asset = match
  ? { kind: "classic", code: match[1], issuer: match[2] }
  : { kind: "contract", contractId: tokenContractId, symbol: tokenSymbol };
const deployment = {
  network,
  deployer,
  admin: deployer,
  asp_membership: aspMembership,
  asp_non_membership: aspNonMembership,
  verifier,
  public_key_registry: publicKeyRegistry,
  pools: [
    {
      poolContractId: poolId,
      tokenContractId,
      deploymentLedger: Number(deploymentLedger),
      enabled: true,
      asset,
    },
  ],
};
fs.writeFileSync(path, `${JSON.stringify(deployment)}\n`);
NODE

  update_local_env "$pool_id" "$DEPLOY_MODE"
  echo "Updated $ENV_FILE with PRIVATE_PAYMENTS_POOL_ID=$pool_id"
  NEBULA_ENV_FILE="$ENV_FILE" bash "$ROOT_DIR/scripts/check_private_pool_testnet.sh"
  exit 0
fi

backup_file="$(mktemp)"
had_vendor_deployment=0
if [ -f "$VENDOR_DEPLOYMENT_JSON" ]; then
  cp "$VENDOR_DEPLOYMENT_JSON" "$backup_file"
  had_vendor_deployment=1
fi

restore_vendor_deployment() {
  if [ "$had_vendor_deployment" -eq 1 ]; then
    cp "$backup_file" "$VENDOR_DEPLOYMENT_JSON"
  else
    rm -f "$VENDOR_DEPLOYMENT_JSON"
  fi
  rm -f "$backup_file"
}
trap restore_vendor_deployment EXIT

echo "Deploying upstream-compatible Stellar Private Payments USDC pool..."
echo "  network:        $NETWORK"
echo "  mode:           $DEPLOY_MODE"
echo "  deployer:       $DEPLOYER"
echo "  token:          $TOKEN_CONTRACT_ID"
echo "  token symbol:   $TOKEN_SYMBOL"
echo "  token decimals: $TOKEN_DECIMALS"
echo "  token name:     $TOKEN_NAME"
echo "  asp levels:     $ASP_LEVELS"
echo "  pool levels:    $POOL_LEVELS"
echo "  max deposit:    $MAX_DEPOSIT"
echo "  output JSON:    $DEPLOYMENT_JSON"

set +e
deploy_output="$(
  "$VENDOR_DEPLOY_SCRIPT" "$NETWORK" \
    --deployer "$DEPLOYER" \
    --pool "contract:$TOKEN_CONTRACT_ID" \
    --asp-levels "$ASP_LEVELS" \
    --pool-levels "$POOL_LEVELS" \
    --max-deposit "$MAX_DEPOSIT" \
    --vk-file "$VK_FILE" 2>&1
)"
deploy_status=$?
set -e

printf '%s\n' "$deploy_output" | tee "$DEPLOY_LOG"
[ "$deploy_status" -eq 0 ] || fail "upstream Private Payments deploy failed; see $DEPLOY_LOG."
[ -f "$VENDOR_DEPLOYMENT_JSON" ] || fail "upstream deploy did not write $VENDOR_DEPLOYMENT_JSON."

cp "$VENDOR_DEPLOYMENT_JSON" "$DEPLOYMENT_JSON"

pool_id="$(
  node - "$DEPLOYMENT_JSON" "$TOKEN_CONTRACT_ID" <<'NODE'
const fs = require("fs");
const [path, token] = process.argv.slice(2);
const deployment = JSON.parse(fs.readFileSync(path, "utf8"));
const pool = (deployment.pools || []).find((entry) => entry.enabled && entry.tokenContractId === token);
if (!pool) {
  process.exit(1);
}
process.stdout.write(pool.poolContractId);
NODE
)"

[ -n "$pool_id" ] || fail "could not find an enabled USDC pool in $DEPLOYMENT_JSON."

update_local_env "$pool_id" "$DEPLOY_MODE"
echo "Updated $ENV_FILE with PRIVATE_PAYMENTS_POOL_ID=$pool_id"
NEBULA_ENV_FILE="$ENV_FILE" bash "$ROOT_DIR/scripts/check_private_pool_testnet.sh"
