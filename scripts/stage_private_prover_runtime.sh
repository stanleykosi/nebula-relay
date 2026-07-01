#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${PRIVATE_PROVER_UPSTREAM_DIST:-$ROOT_DIR/vendor/stellar-private-payments/app/dist}"
DEST_DIR="${PRIVATE_PROVER_RUNTIME_DEST:-$ROOT_DIR/apps/web/public/private-prover-runtime}"

fail() {
  echo "Blocker: $*" >&2
  exit 1
}

require_file() {
  local path="$1"
  [ -f "$SRC_DIR/$path" ] || fail "missing upstream prover asset: $SRC_DIR/$path"
}

require_file "js/wasm-facade.js"
require_file "js/web.js"
require_file "js/web_bg.wasm"
require_file "js/storage-worker.js"
require_file "js/storage-worker_bg.wasm"
require_file "js/prover-worker.js"
require_file "js/prover-worker_bg.wasm"
require_file "circuits/policy_tx_2_2.wasm"
require_file "circuits/policy_tx_2_2.r1cs"
require_file "circuits/selectiveDisclosure_1.wasm"
require_file "circuits/selectiveDisclosure_1.r1cs"

if ! grep -q "prepareDeposit" "$SRC_DIR/js/web.js"; then
  fail "upstream web.js does not expose prepareDeposit; apply patches/stellar-private-payments/browser-prepare-only.patch before building the upstream browser bundle"
fi

mkdir -p "$DEST_DIR/js" "$DEST_DIR/circuits"
cp "$SRC_DIR/js/wasm-facade.js" "$DEST_DIR/js/wasm-facade.js"
cp "$SRC_DIR/js/web.js" "$DEST_DIR/js/web.js"
cp "$SRC_DIR/js/web_bg.wasm" "$DEST_DIR/js/web_bg.wasm"
cp "$SRC_DIR/js/storage-worker.js" "$DEST_DIR/js/storage-worker.js"
cp "$SRC_DIR/js/storage-worker_bg.wasm" "$DEST_DIR/js/storage-worker_bg.wasm"
cp "$SRC_DIR/js/prover-worker.js" "$DEST_DIR/js/prover-worker.js"
cp "$SRC_DIR/js/prover-worker_bg.wasm" "$DEST_DIR/js/prover-worker_bg.wasm"
cp "$SRC_DIR/circuits/policy_tx_2_2.wasm" "$DEST_DIR/circuits/policy_tx_2_2.wasm"
cp "$SRC_DIR/circuits/policy_tx_2_2.r1cs" "$DEST_DIR/circuits/policy_tx_2_2.r1cs"
cp "$SRC_DIR/circuits/selectiveDisclosure_1.wasm" "$DEST_DIR/circuits/selectiveDisclosure_1.wasm"
cp "$SRC_DIR/circuits/selectiveDisclosure_1.r1cs" "$DEST_DIR/circuits/selectiveDisclosure_1.r1cs"

for file in LICENSE.txt NOTICE.txt; do
  if [ -f "$SRC_DIR/$file" ]; then
    cp "$SRC_DIR/$file" "$DEST_DIR/$file"
  fi
done

if [ -d "$SRC_DIR/licenses" ]; then
  rm -rf "$DEST_DIR/licenses"
  cp -R "$SRC_DIR/licenses" "$DEST_DIR/licenses"
fi

for file in NOTICE.txt source-bundle.tar.gz; do
  if [ -f "$SRC_DIR/circuits/$file" ]; then
    cp "$SRC_DIR/circuits/$file" "$DEST_DIR/circuits/$file"
  fi
done

echo "Staged private prover runtime assets in $DEST_DIR"
