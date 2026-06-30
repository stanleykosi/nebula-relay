#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${NEBULA_ENV_FILE:-$ROOT_DIR/.env.local}"
WITNESS_PATH="${NEBULA_WITNESS_FIXTURE:-$ROOT_DIR/fixtures/valid-lock.json}"
PROOF_PATH="${NEBULA_PROOF_ARTIFACT:-$ROOT_DIR/artifacts/remote-proof.json}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Blocker: $name is required for Boundless remote proving." >&2
    exit 1
  fi
}

require_env BOUNDLESS_RPC_URL
require_env BOUNDLESS_PRIVATE_KEY

if [ -z "${BOUNDLESS_PROGRAM_URL:-}" ] && [ -z "${PINATA_JWT:-}" ] && [ -z "${S3_BUCKET:-}" ]; then
  echo "Blocker: set BOUNDLESS_PROGRAM_URL, PINATA_JWT, or S3_BUCKET so Boundless provers can fetch the guest ELF." >&2
  exit 1
fi

mkdir -p "$(dirname "$PROOF_PATH")"

cd "$ROOT_DIR"
cargo run -p nebula-host -- prove \
  --fixture "$WITNESS_PATH" \
  --mode remote \
  --out "$PROOF_PATH"

echo "remote_proof=$PROOF_PATH"
