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

The planned RISC Zero proof shows that a source-chain lock witness is valid for an approved escrow and token, satisfies amount and compliance policy, derives the public note commitment and claim nullifier correctly, and does not publicly reveal the sender address or final Stellar recipient.

## What Runs On Stellar

The core state transition is the Stellar `NebulaRelay` Soroban contract. It must verify proof validity, check allowed image/source/compliance config, reject replayed nullifiers, and record or credit a private-note-compatible commitment.

## Original Vs Reused

Original Nebula work will include the EVM escrow, proof journal schema, witness/proof artifact adapters, Soroban claim contract, pool adapter layer, auditor packet, and product UX.

Reference or vendored code is tracked in [docs/reused-code.md](docs/reused-code.md). Stage 0 does not integrate those upstream projects yet.

## Mocked Or Relayed In The MVP

Stage 0 is repository setup only. The planned MVP may use deterministic fixtures, RISC Zero dev mode, a mock verifier for local Stellar contract tests, admin-relayed receipt roots, mock tokens, and unaudited reference code. Any such path must remain explicitly documented before demo or submission.

## Exact Demo Commands

No end-to-end demo exists at Stage 0. The current setup command is:

```bash
pnpm install
```

Planned validation commands are:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
forge test
cargo test --workspace
stellar contract build
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

This repository is not audited and must not be used with real funds. Public observers should not receive unnecessary transaction history, but the MVP will not be production privacy infrastructure. Authorized disclosure is part of the design. ASP roots, denylist or non-membership checks, governance, legal review, regulatory review, and security review are required before production deployment.

## Production Path

The production path replaces fixture and relayed inputs with robust finality/receipt-root infrastructure, uses audited verifier and private-payment dependencies, hardens governance and operations, and integrates a regulated stablecoin settlement path such as Circle CCTP only after the proof-gated Stellar claim flow is reliable.
