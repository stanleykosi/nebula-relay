#!/usr/bin/env bash
set -euo pipefail

RISC0_RUST_VERSION="${RISC0_RUST_VERSION:-1.94.1}"

corepack enable
corepack prepare pnpm@9.15.1 --activate
pnpm install --frozen-lockfile
pnpm --filter @nebula/api... build

export PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH"

if ! command -v rzup >/dev/null 2>&1; then
  curl -fsSL https://risczero.com/install | bash
  export PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH"
fi

rzup install rust "$RISC0_RUST_VERSION"
rzup show

cargo build -p nebula-host --release
