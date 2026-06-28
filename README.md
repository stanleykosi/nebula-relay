# Nebula Relay

Compliance-forward proof-gated relay prototype for private Stellar-side claims, designed around RISC Zero proofs and Stellar smart contracts.

## What Nebula Relay Is

Nebula Relay is a hackathon MVP for proving that an approved EVM stablecoin lock happened, then claiming a private-note-compatible Stellar record. The intended production-shaped flow is:

```text
EVM testnet lock -> RISC Zero proof -> Stellar Soroban claim -> private-note-compatible output
```

## Why It Matters For Stellar Real-World ZK

Cross-chain funding can expose source wallet, destination wallet, amount, timing, and future transaction graph. Nebula Relay focuses on real-world Stellar use cases: remittances, stablecoins, privacy with compliance controls, and user-authorized disclosure.

## What ZK Proves

The RISC Zero proof statement is represented by the Stage 4 guest POC. It validates a structured source-chain lock witness for an approved escrow and token, amount bounds, compliance policy, destination, note commitment, and nullifier derivation. The current local artifact is dev-mode only; production Groth16 proof generation is not yet wired into the demo.

## What Runs On Stellar

The core state transition is the Stellar `NebulaRelay` Soroban contract. It verifies proof validity, checks allowed image/source/compliance config, rejects replayed nullifiers, calls a pool-adapter handoff boundary, and records a private-note-compatible commitment that can be read with `get_note`.

## Original Vs Reused

Original Nebula work includes the EVM escrow, proof journal schema, witness/proof artifact adapters, Soroban claim contract, pool adapter layer, auditor packet, scripts, and product UX.

Reference or vendored code is tracked in [docs/reused-code.md](docs/reused-code.md). Nebula includes a Protocol 26-compatible adapter shim for Nethermind's Stellar RISC Zero verifier router ABI, while the vendored verifier contracts remain unmodified. Stage 8 also adds a Nebula-owned Private Payments handoff adapter interface; it does not copy the upstream Private Payments UI or modify upstream pool contracts.

## Mocked Or Relayed In The MVP

The current local demo uses deterministic fixtures and a dev-mode proof artifact. `NebulaRelay` defaults to calling a verifier router-compatible `verify(seal, image_id, journal_digest)` path, but local tests use an upstream-compatible router harness rather than a deployed Groth16 verifier. The old dev mock verifier remains available only with the explicit `dev-mock-verifier` feature and admin toggle.

For Stellar Private Payments, Stage 8 implements Mode A from the composition plan: Nebula Relay verifies the cross-chain proof and records a private-note-compatible commitment after a pool-adapter handoff succeeds. Direct upstream pool credit is not implemented yet because the current upstream pool API is the full `transact(proof, ext_data, sender)` private transaction flow, not a relay-credit entrypoint.

Important caveat: the current MVP is a ZK relay / proof-gated private deposit prototype, not a complete value bridge. If the user funds the Stellar Private Payments deposit from their own Stellar wallet, value has not been bridged from EVM to Stellar. A real bridge path needs Stellar-side liquidity, CCTP-style canonical settlement, a treasury, or a relayer/market-maker model.

## Exact Demo Commands

Install dependencies:

```bash
pnpm install
```

Current local validation commands:

```bash
pnpm test
forge test
cargo test --workspace
cargo test -p nebula-relay-contract --features dev-mock-verifier
stellar contract build
```

Stage 13 end-to-end fixture demo:

```bash
bash scripts/generate_demo_fixture.sh
bash scripts/verify_submission.sh artifacts/demo/demo-submission.json
bash scripts/demo_localnet.sh
```

Deployment script dry-runs:

```bash
bash scripts/deploy_localnet.sh --dry-run
bash scripts/deploy_testnet.sh --dry-run
```

Generate the current dev proof artifact:

```bash
cargo run -p nebula-host -- prove --fixture fixtures/valid-lock.json --mode dev --out artifacts/dev-proof.json
```

## Testnet Contract IDs And Source Escrow

No contracts are deployed yet.

| Network | Artifact | ID or address |
|---|---|---|
| EVM testnet | NebulaEscrow | TBD |
| Stellar testnet | NebulaRelay | TBD |
| Stellar testnet | RISC Zero verifier router | TBD |
| Stellar testnet | Pool adapter / handoff wrapper | TBD |

## Security Limitations

This repository is not audited and must not be used with real funds. Public observers should not receive unnecessary transaction history, but the MVP is not production privacy infrastructure. The current local proof artifact is dev-mode, and real Groth16 verification requires a matching RISC Zero proof plus a deployed Nethermind verifier router. Private Payments composition is a Mode A handoff, not a production pool deposit. The current user-funded Stellar deposit path is not a true bridge. Authorized disclosure is part of the design. ASP roots, denylist or non-membership checks, governance, legal review, regulatory review, and security review are required before production deployment.

## Production Path

The production path replaces fixture and relayed inputs with robust finality/receipt-root infrastructure, uses audited verifier and private-payment dependencies, upgrades Mode A handoff to a reviewed pool adapter or upstream relay-credit API, hardens governance and operations, and integrates a regulated stablecoin settlement path such as Circle CCTP only after the proof-gated Stellar claim flow is reliable.
