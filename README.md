# Nebula Relay

Compliance-forward proof-gated relay prototype for private Stellar-side claims, built with RISC Zero-style proof artifacts and a Stellar Soroban claim contract.

## What Nebula Relay Is

Nebula Relay is a hackathon MVP that proves an approved EVM stablecoin lock happened, then lets a Stellar contract accept a private-note-compatible claim only after proof verification and policy checks pass.

```text
EVM lock event + CCTP burn/message -> LockWitness -> RISC Zero journal/proof artifact -> Stellar CCTP settlement -> NebulaRelay claim -> private-note-compatible handoff
```

The hosted configuration targets testnet mode. The live testnet transcript binds CCTP message, attestation, nonce, and mint-recipient fields into the proof journal and requires the Stellar claim path to settle through the configured CCTP Forwarder before storing the nullifier. Fixture data remains available for UI smoke tests, but proof artifacts must be `local-groth16` or `remote`.

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

Current proof posture: the hosted testnet configuration uses Boundless `remote` proof mode or `local-groth16` fallback, and the Stellar claim contract always calls the configured verifier router.

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

- UI fixture data is for smoke tests, not the hosted testnet proof path.
- Local Stellar contract tests use a router-compatible harness, not a deployed Groth16 verifier stack.
- Source-chain receipt trie inclusion and finality are not implemented.
- Private Payments composition is Mode A handoff: Nebula records a private-note-compatible commitment through an adapter boundary. It does not directly credit the upstream pool.
- `NebulaCctpEscrow` is deployed on Ethereum Sepolia and implements the atomic source-side lock event plus CCTP burn wrapper.
- CCTP settlement is proof-bound and enforced in deterministic local tests and in the completed Sepolia -> Stellar testnet transcript; see `artifacts/live-transcript-summary.json` and `IMPLEMENTATION_STATUS.md`.

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

Run the full live Sepolia -> Stellar testnet transcript:

```bash
scripts/run_live_testnet_transcript.sh --yes
```

This command burns `NEBULA_LOCK_AMOUNT` of configured Sepolia test USDC, waits for Circle Iris, submits a Boundless remote Groth16 proof request, claims on Stellar testnet, verifies nullifier storage, verifies replay failure, and writes `artifacts/live-transcript-summary.json`.

Generate the local Groth16 proof artifact:

```bash
cargo run -p nebula-host -- prove --fixture fixtures/valid-lock.json --mode local-groth16 --out artifacts/groth16-proof.json
```

Generate a Boundless remote Groth16 proof artifact for the Railway/backend path:

```bash
export RISC0_PROVER_MODE=remote
export BOUNDLESS_RPC_URL="https://..."
export BOUNDLESS_PRIVATE_KEY="0x..."
export BOUNDLESS_MARKET_CHAIN_ID=8453
export PINATA_JWT="..."
cargo run -p nebula-host -- prove --fixture fixtures/valid-lock.json --mode remote --out artifacts/remote-proof.json
```

For production-like Railway runs, prefer a pre-uploaded guest ELF URL with `BOUNDLESS_PROGRAM_URL` or a storage uploader such as Pinata/S3. Boundless is a remote prover market, so do not send user secrets in the witness unless the sensitive-input flow is configured for trusted provers.

The same path is wrapped for hosted jobs:

```bash
bash scripts/prove_boundless_remote.sh
```

## Vercel Testnet Environment

For the hosted Vercel deployment, use testnet/live values:

`.env.example` is intentionally template-only; fill these values in Vercel project settings or ignored local files such as `.env.local`, never in git.

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

For the Railway prover/relayer backend, add server-only values:

```env
RISC0_PROVER_MODE=remote
BOUNDLESS_RPC_URL=
BOUNDLESS_PRIVATE_KEY=
BOUNDLESS_MARKET_CHAIN_ID=8453
BOUNDLESS_PROGRAM_URL=
PINATA_JWT=
BOUNDLESS_MAX_PRICE=
BOUNDLESS_TIMEOUT_SECS=
```

`BOUNDLESS_MARKET_CHAIN_ID=8453` is for the Boundless proving/payment market on Base mainnet. The bridge route itself remains Ethereum Sepolia -> Stellar testnet. `BOUNDLESS_PROGRAM_URL` is optional only when a storage uploader such as Pinata or S3 is configured. `BOUNDLESS_PRIVATE_KEY` must be funded on the selected Boundless request network and must never be exposed to the frontend.

Deployment script dry-runs:

```bash
bash scripts/deploy_localnet.sh --dry-run
bash scripts/deploy_testnet.sh --dry-run
bash scripts/check_testnet_readiness.sh
```

## Testnet Contract IDs And Source Escrow

Live testnet contracts have been deployed for the source wrapper and Stellar claim path. A public Sepolia burn -> Circle Iris attestation -> Boundless Groth16 proof -> Stellar CCTP `mint_and_forward` -> NebulaRelay claim -> nullifier stored -> replay failure transcript completed on June 30, 2026.

| Network | Artifact | ID or address |
|---|---|---|
| EVM fixture | NebulaEscrow | `0x1111111111111111111111111111111111111111` |
| Ethereum Sepolia | NebulaCctpEscrow | `0x5E13760edb2D11F17cFE28507692D4d5F6605419` |
| EVM fixture | Mock USDC token | `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |
| Stellar fixture | NebulaRelay | Contract tested locally and WASM builds |
| Stellar fixture | RISC Zero verifier router | Router-compatible harness in tests |
| Stellar fixture | Pool adapter / handoff wrapper | Harness in tests; Mode A adapter ABI and deployable adapter contract |
| Stellar testnet | Circle CCTP Forwarder | `CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ` |
| Stellar testnet | Circle CCTP Message Transmitter | `CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY` |
| Stellar testnet | Circle CCTP Token Messenger Minter | `CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP` |
| Stellar testnet | NebulaRelay | `CDYUCZK5MQQXOL4OZ4YRCKCZXOLUWS6GON3TK7MSIEBKWEF65LXAZWCK` |
| Stellar testnet | RISC Zero verifier router | `CASPL2YTHEUZMBXL7573IIFSK3SXSBIUOKHDKZJVSE6QR6W6S4NRXANE` |
| Stellar testnet | RISC Zero Groth16 verifier | `CBWXXMAGJGYKBBVY4R2YRNY7ULFILO4L52DPXZ6JZ2757AOI6YZ5I6U5` |
| Stellar testnet | RISC Zero verifier emergency stop | `CANRRAIOB2YNP5KTOH5JAOFPURRIFXQJZKN3MEBIZBEHTNLUAXEL6IV2` |
| Stellar testnet | Pool adapter / handoff wrapper | `CABW53ILEK6T3HPG2CRG5NFT36HCA3QXPKU4HOPY6KCAUPLONPSKD77F` |
| RISC Zero | Nebula guest image ID | `0x79b0ae7f3c792a2a9b2a8c3786cc7be70c1fa81e06e7f7adc33faf4c9273fe4f` |

Latest live transcript:

- Sepolia burn tx: `0xb0f9a428685c5aa32c87041f8973461be061e94d9151c697581daea6e5f7dfca`
- Stellar claim tx: `d527fb92f97eff4bd57898a2577ccee44ba45233c05df76a65a46317e88c739d`
- Claim nullifier: `0x07f35395631a7838deef003975a10e7750b49924d5350b594d9bbc183f302485`
- Circle fee executed: `1000` raw EVM-side USDC units; net CCTP amount in the proof-side parser: `9999000`
- Transcript summary: `artifacts/live-transcript-summary.json`
- Repro command: `scripts/run_live_testnet_transcript.sh --yes`

## Submission Package

- DoraHacks copy: [docs/dorahacks-submission.md](docs/dorahacks-submission.md)
- Demo/video script: [docs/demo-script.md](docs/demo-script.md)
- Final checklist: [docs/final-submission-checklist.md](docs/final-submission-checklist.md)
- Threat model: [docs/threat-model.md](docs/threat-model.md)
- Production readiness: [docs/production-readiness.md](docs/production-readiness.md)
- Known limitations: [docs/known-limitations.md](docs/known-limitations.md)

Recorded video and screenshots are not checked into this repo from the terminal environment. Use the demo script and checklist above to capture the 2-3 minute video before uploading to DoraHacks.

## Security Limitations

This repository is unaudited and must not be used with real funds. Public observers should not receive unnecessary transaction history, but the MVP is not production privacy infrastructure. Boundless remote proving, verifier-router validation, CCTP `mint_and_forward` settlement, Nebula claim storage, and replay rejection have been exercised in a live testnet transcript; direct private-pool credit, governance hardening, legal review, regulatory review, and security audits are required before production deployment.

## Production Path

The testnet path replaces local fixture inputs with Boundless remote or local-Groth16 proof generation, deployed verifier-router verification, a CCTP-backed USDC claim settlement path, and configured Private Payments handoff contracts. The next milestone is hardening this completed testnet transcript into hosted Railway/Vercel orchestration with monitoring, prebuilt prover workers, receipt/finality improvements, and production controls.
