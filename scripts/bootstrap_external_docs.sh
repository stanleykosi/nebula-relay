#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT_DIR/vendor" "$ROOT_DIR/docs/external" "$HOME/.codex/skills"

clone_or_pull() {
  local repo="$1"
  local dest="$2"
  if [ -d "$dest/.git" ]; then
    echo "Updating $dest"
    git -C "$dest" pull --ff-only || true
  else
    echo "Cloning $repo -> $dest"
    git clone --depth 1 "$repo" "$dest"
  fi
}

clone_or_pull https://github.com/stellar/stellar-dev-skill "$HOME/.codex/skills/stellar-dev-skill"
clone_or_pull https://github.com/NethermindEth/stellar-risc0-verifier "$ROOT_DIR/vendor/stellar-risc0-verifier"
clone_or_pull https://github.com/NethermindEth/stellar-private-payments "$ROOT_DIR/vendor/stellar-private-payments"
clone_or_pull https://github.com/OpenZeppelin/stellar-contracts "$ROOT_DIR/vendor/openzeppelin-stellar-contracts"
clone_or_pull https://github.com/OpenZeppelin/soroban-security-detectors-sdk "$ROOT_DIR/vendor/soroban-security-detectors-sdk"

# Fetch agent-readable docs snapshots when curl is available.
if command -v curl >/dev/null 2>&1; then
  curl -L https://developers.stellar.org/llms.txt -o "$ROOT_DIR/docs/external/stellar-llms.txt" || true
  curl -L https://skills.stellar.org/skills/zk-proofs/SKILL.md -o "$ROOT_DIR/docs/external/stellar-zk-proofs-skill.md" || true
fi

echo "External docs bootstrap complete. Now read docs/EXTERNAL_DOCS_INDEX.md and vendor READMEs."
