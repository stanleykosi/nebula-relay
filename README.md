# Nebula Relay

Compliance-forward private cross-chain remittance into Stellar, powered by RISC Zero proofs and Stellar smart contracts.

## What Nebula Relay Is

Nebula Relay is a hackathon MVP for proving that an approved EVM stablecoin lock happened, then privately claiming a Stellar payment note. The intended flow is:

```text
EVM testnet lock -> RISC Zero proof -> Stellar Soroban claim -> private-note-compatible output
```

## Why It Matters For Stellar Real-World ZK

Cross-chain funding can expose source wallet, destination wallet, amount, timing, and future transaction graph. Nebula Relay focuses on real-world Stellar use cases: remittances, stablecoins, privacy with compliance controls, and user-authorized disclosure.

## What ZK Proves

The RISC Zero proof statement is represented by the Stage 4 guest POC. It validates a structured source-chain lock witness for an approved escrow and token, amount bounds, compliance policy, destination, note commitment, and nullifier derivation. The current local artifact is dev-mode only; production Groth16 proof generation is not yet wired into the demo.

## What Runs On Stellar

The core state transition is the Stellar `NebulaRelay` Soroban contract. It must verify proof validity, check allowed image/source/compliance config, reject replayed nullifiers, and record or credit a private-note-compatible commitment.

## Original Vs Reused

Original Nebula work will include the EVM escrow, proof journal schema, witness/proof artifact adapters, Soroban claim contract, pool adapter layer, auditor packet, and product UX.

Reference or vendored code is tracked in [docs/reused-code.md](docs/reused-code.md). Nebula now includes a Protocol 26-compatible adapter shim for Nethermind's Stellar RISC Zero verifier router ABI, while the vendored verifier contracts remain unmodified.

## Mocked Or Relayed In The MVP

The current local demo uses deterministic fixtures and a dev-mode proof artifact. `NebulaRelay` now defaults to calling a verifier router-compatible `verify(seal, image_id, journal_digest)` path, but local tests use an upstream-compatible router harness rather than a deployed Groth16 verifier. The old dev mock verifier remains available only with the explicit `dev-mock-verifier` feature and admin toggle.

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
| Stellar testnet | Pool adapter | TBD |

## Security Limitations

This repository is not audited and must not be used with real funds. Public observers should not receive unnecessary transaction history, but the MVP is not production privacy infrastructure. The current local proof artifact is dev-mode, and real Groth16 verification requires a matching RISC Zero proof plus a deployed Nethermind verifier router. Authorized disclosure is part of the design. ASP roots, denylist or non-membership checks, governance, legal review, regulatory review, and security review are required before production deployment.

## Production Path

The production path replaces fixture and relayed inputs with robust finality/receipt-root infrastructure, uses audited verifier and private-payment dependencies, hardens governance and operations, and integrates a regulated stablecoin settlement path such as Circle CCTP only after the proof-gated Stellar claim flow is reliable.
