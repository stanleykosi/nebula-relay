# Nebula Relay

Compliance-forward proof-gated relay prototype for private Stellar-side claims, built with RISC Zero-style proof artifacts and a Stellar Soroban claim contract.

## What Nebula Relay Is

Nebula Relay is a hackathon MVP that proves an approved EVM stablecoin lock happened, then lets a Stellar contract accept a private-note-compatible claim only after proof verification and policy checks pass.

```text
EVM lock event -> LockWitness -> RISC Zero journal/proof artifact -> Stellar NebulaRelay claim -> private-note-compatible handoff
```

The current demo is deterministic fixture/dev mode. It is useful for judging the complete vertical slice, but it is not production bridge infrastructure.

## Why It Matters For Stellar Real-World ZK

Cross-chain funding can expose a sender wallet, recipient wallet, amount, timing, and future transaction graph. Nebula Relay shows how Stellar can host the load-bearing state transition for a privacy-preserving payment claim while still supporting compliance roots and user-authorized disclosure.

## What ZK Proves

The implemented RISC Zero guest/host path validates a structured `LockWitness` and commits a versioned `NebulaJournal`. The proof statement checks:

- The source lock witness matches the configured source chain, escrow, token, amount bounds, compliance root, and destination.
- The Stellar note commitment is nonzero and becomes the public private-note-compatible output.
- The claim nullifier and event commitment are derived into the public journal.
- Bad token, wrong escrow, bad compliance, wrong destination, malformed public outputs, wrong image ID, bad seal, wrong journal digest, and replay fixtures fail in tests.

Current proof caveat: the local artifact is `dev` mode. Real Groth16 proof generation and a deployed Nethermind Stellar RISC Zero verifier router are documented production-path work.

## What Runs On Stellar

The core state transition is the `NebulaRelay` Soroban contract. It:

- Requires claimant authorization.
- Rejects paused claims.
- Checks the accepted image ID.
- Calls a verifier-router-compatible `verify(seal, image_id, journal_digest)` path.
- Decodes and validates the Nebula journal.
- Checks registered source config and compliance root config.
- Stores the nullifier to prevent replay.
- Calls a Nebula-owned pool-adapter handoff boundary.
- Stores claim and note records readable with `get_claim` and `get_note`.

## Original Vs Reused

Original Nebula work includes:

- EVM `NebulaEscrow` and `MockUSDC`.
- Canonical `Locked` event parsing and TypeScript witness builder.
- Shared schemas for `LockWitness`, `NebulaJournal`, `ProofArtifact`, and `AuditorPacket`.
- RISC Zero guest/host dev proof path.
- Stellar `NebulaRelay` contract, verifier-router ABI shim, pool-adapter boundary, and tests.
- Next.js demo UX, fixture flow, failure lab, auditor export, and scripts.

Reused/reference material is documented in [docs/reused-code.md](docs/reused-code.md). The main references are Nethermind `stellar-risc0-verifier`, Nethermind `stellar-private-payments`, OpenZeppelin Stellar contracts, and Stellar documentation snapshots. No upstream UI was copied.

## What Is Mocked Or Relayed In The MVP

- The demo proof artifact is dev-mode, not production Groth16.
- Local Stellar contract tests use a router-compatible harness, not a deployed Groth16 verifier stack.
- The old dev mock verifier remains only behind the `dev-mock-verifier` feature and explicit admin toggle.
- Source-chain receipt trie inclusion and finality are not implemented.
- Private Payments composition is Mode A handoff: Nebula records a private-note-compatible commitment through an adapter boundary. It does not directly credit the upstream pool.
- User-funded Stellar deposits are not a complete value bridge. Real bridge settlement needs CCTP-style canonical settlement, liquidity, treasury funding, or a relayer/market-maker model.

## Exact Demo Commands

Install dependencies:

```bash
pnpm install
```

Run the deterministic fixture demo:

```bash
bash scripts/generate_demo_fixture.sh
bash scripts/verify_submission.sh artifacts/demo/demo-submission.json
bash scripts/demo_localnet.sh
```

Run the full validation matrix used for Stage 15:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
forge test
cargo test --workspace
stellar contract build
```

Generate the current dev proof artifact:

```bash
cargo run -p nebula-host -- prove --fixture fixtures/valid-lock.json --mode dev --out artifacts/dev-proof.json
```

Deployment script dry-runs:

```bash
bash scripts/deploy_localnet.sh --dry-run
bash scripts/deploy_testnet.sh --dry-run
```

## Testnet Contract IDs And Source Escrow

No live testnet contracts are deployed from this workspace yet. The final demo uses deterministic fixture artifacts in `artifacts/demo/`.

| Network | Artifact | ID or address |
|---|---|---|
| EVM fixture | NebulaEscrow | `0x1111111111111111111111111111111111111111` |
| EVM fixture | Mock USDC token | `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |
| Stellar fixture | NebulaRelay | Not deployed; contract tested locally and WASM builds |
| Stellar fixture | RISC Zero verifier router | Router-compatible harness in tests |
| Stellar fixture | Pool adapter / handoff wrapper | Harness in tests; Mode A adapter ABI in contract |
| Stellar testnet | NebulaRelay | Not deployed |
| Stellar testnet | RISC Zero verifier router | Not configured |
| Stellar testnet | Pool adapter / handoff wrapper | Not deployed |

## Submission Package

- DoraHacks copy: [docs/dorahacks-submission.md](docs/dorahacks-submission.md)
- Demo/video script: [docs/demo-script.md](docs/demo-script.md)
- Final checklist: [docs/final-submission-checklist.md](docs/final-submission-checklist.md)
- Threat model: [docs/threat-model.md](docs/threat-model.md)
- Production readiness: [docs/production-readiness.md](docs/production-readiness.md)
- Known limitations: [docs/known-limitations.md](docs/known-limitations.md)

Recorded video and screenshots are not checked into this repo from the terminal environment. Use the demo script and checklist above to capture the 2-3 minute video before uploading to DoraHacks.

## Security Limitations

This repository is unaudited and must not be used with real funds. Public observers should not receive unnecessary transaction history, but the MVP is not production privacy infrastructure. Real Groth16 verification, receipt-root/finality infrastructure, direct private-pool credit, governance hardening, legal review, regulatory review, and security audits are required before production deployment.

## Production Path

The production path replaces fixture/dev inputs with audited proof generation, deployed verifier-router verification, robust source-chain finality, audited Private Payments composition, operator governance, monitoring, and a regulated settlement path such as CCTP-backed test USDC first and reviewed production USDC later.
