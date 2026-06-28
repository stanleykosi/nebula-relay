# Nebula Relay

Compliance-forward proof-gated relay prototype for private Stellar-side claims, built with RISC Zero-style proof artifacts and a Stellar Soroban claim contract.

## What Nebula Relay Is

Nebula Relay is a hackathon MVP that proves an approved EVM stablecoin lock happened, then lets a Stellar contract accept a private-note-compatible claim only after proof verification and policy checks pass.

```text
EVM lock event + CCTP burn/message -> LockWitness -> RISC Zero journal/proof artifact -> Stellar CCTP settlement -> NebulaRelay claim -> private-note-compatible handoff
```

The hosted configuration targets testnet mode. The local vertical slice binds CCTP message, attestation, nonce, and mint-recipient fields into the proof journal and requires the Stellar claim path to settle through the configured CCTP Forwarder before storing the nullifier. Fixture artifacts remain available for local smoke tests until the live testnet contracts, prover, and relayer are attached.

## Why It Matters For Stellar Real-World ZK

Cross-chain funding can expose a sender wallet, recipient wallet, amount, timing, and future transaction graph. Nebula Relay shows how Stellar can host the load-bearing state transition for a privacy-preserving payment claim while still supporting compliance roots and user-authorized disclosure.

## What ZK Proves

The implemented RISC Zero guest/host path validates a structured `LockWitness` and commits a versioned `NebulaJournal`. The proof statement checks:

- The source lock witness matches the configured source chain, escrow, token, amount bounds, compliance root, and destination.
- The Stellar note commitment is nonzero and becomes the public private-note-compatible output.
- The claim nullifier and event commitment are derived into the public journal.
- CCTP source domain, Stellar destination domain, message hash, attestation hash, nonce, and mint recipient are bound into the same journal.
- The witness now carries a Circle CCTP V2 message and the proof-side validator checks source domain, destination domain, nonce, destination caller, burn token, burn amount, mint recipient, message sender, max fee, and non-empty hook data.
- Bad token, wrong escrow, bad compliance, wrong destination, malformed public outputs, wrong image ID, bad seal, wrong journal digest, and replay fixtures fail in tests.

Current proof caveat: the hosted testnet configuration should use `remote` or `local-groth16` proof mode. The old local fixture artifact is still present for smoke tests and must not be used as a live testnet proof.

## What Runs On Stellar

The core state transition is the `NebulaRelay` Soroban contract. It:

- Requires claimant authorization.
- Rejects paused claims.
- Checks the accepted image ID.
- Calls a verifier-router-compatible `verify(seal, image_id, journal_digest)` path.
- Decodes and validates the Nebula journal.
- Checks registered source config and compliance root config.
- Checks CCTP settlement fields and calls the configured `mint_and_forward(message, attestation)` adapter before claim storage.
- Stores the nullifier to prevent replay.
- Calls a Nebula-owned pool-adapter handoff boundary.
- Stores claim and note records readable with `get_claim` and `get_note`.

## Original Vs Reused

Original Nebula work includes:

- EVM `NebulaEscrow`, `NebulaCctpEscrow`, and `MockUSDC`.
- Canonical `Locked` event parsing and TypeScript witness builder.
- Shared schemas for `LockWitness`, `NebulaJournal`, `ProofArtifact`, and `AuditorPacket`.
- RISC Zero guest/host proof-artifact boundary.
- Stellar `NebulaRelay` contract, verifier-router ABI shim, pool-adapter boundary, and tests.
- CCTP client helpers for EVM `depositForBurnWithHook`, Circle Iris attestation polling, Circle CCTP V2 message parsing, Stellar `mint_and_forward` transaction construction, and proof-friendly settlement binding.
- Next.js demo UX, fixture flow, failure lab, auditor export, and scripts.

Reused/reference material is documented in [docs/reused-code.md](docs/reused-code.md). The main references are Nethermind `stellar-risc0-verifier`, Nethermind `stellar-private-payments`, OpenZeppelin Stellar contracts, and Stellar documentation snapshots. No upstream UI was copied.

## What Is Mocked Or Relayed In The MVP

- The bundled local proof artifact is for smoke tests, not the hosted testnet proof path.
- Local Stellar contract tests use a router-compatible harness, not a deployed Groth16 verifier stack.
- The old dev mock verifier remains only behind the `dev-mock-verifier` feature and explicit admin toggle.
- Source-chain receipt trie inclusion and finality are not implemented.
- Private Payments composition is Mode A handoff: Nebula records a private-note-compatible commitment through an adapter boundary. It does not directly credit the upstream pool.
- `NebulaCctpEscrow` implements the atomic source-side lock event plus CCTP burn wrapper, but it has not been deployed from this workspace.
- CCTP settlement is proof-bound and enforced in deterministic local tests, but no live testnet CCTP burn/mint transcript has been submitted from this workspace.

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

Run the CCTP settlement package:

```bash
pnpm --filter @nebula/cctp-client test
pnpm --filter @nebula/cctp-client typecheck
```

Run the pre-Vercel testnet readiness gate:

```bash
bash scripts/check_testnet_readiness.sh
```

Deploy and exercise the source-side CCTP wrapper after configuring Sepolia env vars and funding/approving test USDC:

```bash
bash scripts/deploy_evm_cctp_testnet.sh
bash scripts/run_evm_cctp_lock_testnet.sh
```

Generate the local smoke-test proof artifact:

```bash
cargo run -p nebula-host -- prove --fixture fixtures/valid-lock.json --mode dev --out artifacts/dev-proof.json
```

## Vercel Testnet Environment

For the hosted Vercel deployment, use testnet/live values:

```env
NEXT_PUBLIC_DEMO_MODE=live
NEXT_PUBLIC_PROOF_MODE=remote
NEXT_PUBLIC_VERIFIER_MODE=real-router
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_EVM_NETWORK=sepolia
NEXT_PUBLIC_EVM_CHAIN_ID=11155111
NEXT_PUBLIC_CCTP_SETTLEMENT_MODE=testnet
NEXT_PUBLIC_EVM_ESCROW_ADDRESS=
NEXT_PUBLIC_NEBULA_CCTP_ESCROW_ADDRESS=
NEXT_PUBLIC_EVM_MOCK_USDC_ADDRESS=
NEXT_PUBLIC_NEBULA_RELAY_CONTRACT_ID=
NEXT_PUBLIC_RISC0_VERIFIER_ROUTER_ID=
NEXT_PUBLIC_POOL_ADAPTER_CONTRACT_ID=
NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID=
```

Do not add `EVM_PRIVATE_KEY`, `STELLAR_SOURCE_SECRET`, or prover API keys to browser-exposed `NEXT_PUBLIC_*` variables.

Deployment script dry-runs:

```bash
bash scripts/deploy_localnet.sh --dry-run
bash scripts/deploy_testnet.sh --dry-run
bash scripts/check_testnet_readiness.sh
```

## Testnet Contract IDs And Source Escrow

No live testnet contracts are deployed from this workspace yet. The final demo uses deterministic fixture artifacts in `artifacts/demo/`.

| Network | Artifact | ID or address |
|---|---|---|
| EVM fixture | NebulaEscrow | `0x1111111111111111111111111111111111111111` |
| EVM testnet | NebulaCctpEscrow | Not deployed |
| EVM fixture | Mock USDC token | `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |
| Stellar fixture | NebulaRelay | Not deployed; contract tested locally and WASM builds |
| Stellar fixture | RISC Zero verifier router | Router-compatible harness in tests |
| Stellar fixture | Pool adapter / handoff wrapper | Harness in tests; Mode A adapter ABI in contract |
| Stellar testnet | Circle CCTP Forwarder | `CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ` |
| Stellar testnet | Circle CCTP Message Transmitter | `CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY` |
| Stellar testnet | Circle CCTP Token Messenger Minter | `CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP` |
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

This repository is unaudited and must not be used with real funds. Public observers should not receive unnecessary transaction history, but the MVP is not production privacy infrastructure. Real Groth16 verification, live CCTP testnet/mainnet validation, direct private-pool credit, governance hardening, legal review, regulatory review, and security audits are required before production deployment.

## Production Path

The testnet path replaces local fixture inputs with remote or local-Groth16 proof generation, deployed verifier-router verification, a CCTP-backed USDC claim settlement path, and configured Private Payments handoff contracts. The Stage 17 CCTP work builds the intended burn -> Circle Iris attestation -> Stellar `mint_and_forward` flow and binds that settlement transcript into the proof journal locally; the next milestone is the live public testnet transcript.
