#!/usr/bin/env bash
set -euo pipefail

mkdir -p apps/web apps/prover-api contracts/evm/src contracts/evm/test contracts/evm/script
mkdir -p contracts/stellar/nebula-relay/src contracts/stellar/adapters
mkdir -p risc0/nebula-guest risc0/nebula-host risc0/shared
mkdir -p packages/core/src packages/evm-client/src packages/stellar-client/src packages/proof-client/src
mkdir -p artifacts/demo fixtures docs/build vendor

touch IMPLEMENTATION_STATUS.md docs/reused-code.md docs/decision-log.md docs/known-limitations.md

echo "Nebula Relay monorepo skeleton created."
