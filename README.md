# Nebula Relay

Compliance-forward proof-gated relay prototype for private Stellar-side claims, built with RISC Zero-style proof artifacts and a Stellar Soroban claim contract.

## What Nebula Relay Is

Nebula Relay is a hackathon MVP that proves an approved EVM stablecoin lock happened, then lets a Stellar contract accept a private-note-compatible claim only after proof verification and policy checks pass.

```text
EVM lock event + CCTP burn/message -> LockWitness -> RISC Zero journal/proof artifact -> Stellar CCTP settlement -> NebulaRelay private-pool claim -> nullifier + private note
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

Current proof posture: the hosted testnet configuration uses Boundless `remote` proof mode or explicit `local-groth16` proof generation, and the Stellar claim contract always calls the configured verifier router.

## What Runs On Stellar

The core state transition is the `NebulaRelay` Soroban contract. It:

- Rejects paused claims.
- Checks the accepted image ID.
- Calls a verifier-router-compatible `verify(seal, image_id, journal_digest)` path.
- Decodes and validates the Nebula journal.
- Checks registered source config and compliance root config.
- Checks CCTP settlement fields and calls the configured `mint_and_forward(message, attestation)` adapter before claim storage.
- Stores the nullifier to prevent replay.
- Calls an upstream-compatible Stellar Private Payments pool `transact` boundary with the relay as sender.
- Stores nullifier/private-claim metadata only, readable with `get_private_claim` and `get_private_note`; no final recipient account is stored.

## Original Vs Reused

Original Nebula work includes:

- EVM `NebulaEscrow`, `NebulaCctpEscrow`, and `MockUSDC`.
- Canonical `Locked` event parsing and TypeScript witness builder.
- Shared schemas for `LockWitness`, `NebulaJournal`, `ProofArtifact`, and `AuditorPacket`.
- RISC Zero guest/host proof-artifact boundary.
- Stellar `NebulaRelay` contract, verifier-router ABI shim, private-pool claim boundary, and tests.
- CCTP client helpers for EVM `depositForBurnWithHook`, Circle Iris attestation polling, Circle CCTP V2 message parsing, Stellar `mint_and_forward` transaction construction, and proof-friendly settlement binding.
- Next.js demo UX, fixture flow, failure lab, auditor export, and scripts.

Reused/reference material is documented in [docs/reused-code.md](docs/reused-code.md). The main references are Nethermind `stellar-risc0-verifier`, Nethermind `stellar-private-payments`, OpenZeppelin Stellar contracts, and Stellar documentation snapshots. No upstream UI was copied.

## What Is Mocked Or Relayed In The MVP

- UI fixture data is for smoke tests, not the hosted testnet proof path.
- Local Stellar contract tests use a router-compatible harness, not a deployed Groth16 verifier stack.
- Source-chain receipt trie inclusion and finality are not implemented.
- Private Payments composition has one supported pool-deposit boundary: `claim_to_private_pool` accepts a `PrivatePoolDeposit` proof artifact, verifies pool recipient/net amount/output note binding, calls the configured pool, and stores no visible claimant.
- `NebulaCctpEscrow` is deployed on Ethereum Sepolia and implements the atomic source-side lock event plus CCTP burn wrapper.
- CCTP settlement is proof-bound and enforced in deterministic local tests and in the completed Sepolia -> Stellar testnet transcript; see `artifacts/live-transcript-summary.json`, `artifacts/demo/risc0-verifier-deployment.toml`, and `IMPLEMENTATION_STATUS.md`.

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

Prepare the Stellar Private Payments deposit proof in the hosted browser
runtime:

```text
/private-prover
```

The page loads a patched upstream Stellar Private Payments browser build from
`apps/web/public/private-prover-runtime`. It keeps note-key derivation and the
Circom/Groth16 pool proof in the user's browser, exports `PreparedProverTx`
JSON, and returns the first output commitment to Nebula as the private
destination binding. The upstream runtime assets are intentionally separate
from the Next.js bundle; if they are missing, the page reports the exact missing
asset instead of falling back to a fake proof.

After building the patched upstream browser bundle, stage the static assets for
Vercel with:

```bash
bash scripts/stage_private_prover_runtime.sh
```

The staging script expects an already-built upstream bundle at
`vendor/stellar-private-payments/app/dist` unless `PRIVATE_PROVER_UPSTREAM_DIST`
is set. It does not run the heavy Circom/Rust build.

The recommended way to build those assets is GitHub Actions, not a local WSL
compile:

1. Push this repo with `.github/workflows/build-private-prover-assets.yml`.
2. Open GitHub -> Actions -> **Build private prover assets**.
3. Click **Run workflow**.
4. Keep `commit_assets=true` if you want the workflow to commit the generated
   runtime files back to the branch automatically.
5. Wait for the workflow to finish. It applies
   `patches/stellar-private-payments/browser-prepare-only.patch`, runs the
   upstream `make release`, stages `apps/web/public/private-prover-runtime`,
   uploads an artifact, and optionally commits the files.
6. If the workflow committed files, Vercel redeploys from that commit. If you
   used `commit_assets=false`, download the `nebula-private-prover-runtime`
   artifact, copy it into `apps/web/public/private-prover-runtime`, commit, and
   push.
7. Open `/private-prover` on the Vercel deployment, connect Freighter, and run
   **Sign and prepare**. The page checks assets automatically and should
   download `nebula-private-pool-prepared.json` after the browser proof
   completes.

If the upstream Stellar Private Payments testnet deployment does not include a USDC pool, deploy a Nebula-controlled upstream-compatible USDC pool first:

```bash
bash scripts/deploy_private_payments_usdc_pool.sh
```

The wrapper defaults to `PRIVATE_PAYMENTS_DEPLOY_MODE=reuse-upstream-hashes`: it reads the current upstream testnet deployment JSON, deploys fresh Nebula-controlled ASP/verifier/key-registry/pool instances from the already-installed upstream WASM hashes, writes `artifacts/private/private-payments-usdc-deployment.json`, updates ignored `.env.local`, and runs `scripts/check_private_pool_testnet.sh`. `PRIVATE_PAYMENTS_DEPLOY_MODE=full-build` keeps the slower local source-build path available.

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
NEXT_PUBLIC_STELLAR_RPC_URL=
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
NEXT_PUBLIC_EVM_NETWORK=sepolia
NEXT_PUBLIC_EVM_CHAIN_ID=11155111
NEXT_PUBLIC_CCTP_SETTLEMENT_MODE=testnet
NEXT_PUBLIC_EVM_ESCROW_ADDRESS=
NEXT_PUBLIC_NEBULA_CCTP_ESCROW_ADDRESS=
NEXT_PUBLIC_EVM_MOCK_USDC_ADDRESS=
NEXT_PUBLIC_NEBULA_RELAY_CONTRACT_ID=
NEXT_PUBLIC_RISC0_VERIFIER_ROUTER_ID=
NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID=
NEXT_PUBLIC_PRIVATE_PROVER_RUNTIME_URL=/private-prover-runtime/nebula-prover-host.html
NEXT_PUBLIC_PRIVATE_PROVER_ASSET_BASE_URL=/private-prover-runtime
NEXT_PUBLIC_PRIVATE_PROVER_BOOTNODE_URL=
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
| Stellar fixture | Private pool wrapper | Harness in tests; upstream-compatible private-pool ABI |
| Stellar testnet | Circle CCTP Forwarder | `CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ` |
| Stellar testnet | Circle CCTP Message Transmitter | `CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY` |
| Stellar testnet | Circle CCTP Token Messenger Minter | `CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP` |
| Stellar testnet | NebulaRelay | `CDYUCZK5MQQXOL4OZ4YRCKCZXOLUWS6GON3TK7MSIEBKWEF65LXAZWCK` |
| Stellar testnet | RISC Zero verifier router | `CASPL2YTHEUZMBXL7573IIFSK3SXSBIUOKHDKZJVSE6QR6W6S4NRXANE` |
| Stellar testnet | RISC Zero Groth16 verifier | `CBWXXMAGJGYKBBVY4R2YRNY7ULFILO4L52DPXZ6JZ2757AOI6YZ5I6U5` |
| Stellar testnet | RISC Zero verifier emergency stop | `CANRRAIOB2YNP5KTOH5JAOFPURRIFXQJZKN3MEBIZBEHTNLUAXEL6IV2` |
| Stellar testnet | Private Payments USDC pool | `CC4XGYEOY4SLBG4X7YDXGGDJ6C5GLLHPXCNILZYTE5MQGJGJHC75JDES`; deployment JSON: `deployments/stellar-private-payments-usdc-testnet.json` |
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

This repository is unaudited and must not be used with real funds. Public observers should not receive unnecessary transaction history, but the MVP is not production privacy infrastructure. Boundless remote proving, verifier-router validation, CCTP `mint_and_forward` settlement, Nebula claim storage, and replay rejection have been exercised in a live visible-claim testnet transcript. The private-pool claim boundary is implemented and tested, and a Nebula-controlled USDC Private Payments pool is deployed on Stellar testnet. The browser private prover route is implemented as a prepare-only runtime adapter, but it requires patched upstream browser assets staged under `apps/web/public/private-prover-runtime/js` and `apps/web/public/private-prover-runtime/circuits` before it can generate a real `PreparedProverTx` on Vercel. A live private-recipient transcript is still pending until that prepared proof output is generated and submitted through `claim_to_private_pool`. Governance hardening, legal review, regulatory review, privacy analysis, and security audits are required before production deployment.

## Production Path

The testnet path replaces local fixture inputs with Boundless remote or local-Groth16 proof generation, deployed verifier-router verification, a CCTP-backed USDC settlement path, and configured Private Payments pool contracts. The next milestone is a hosted Railway/Vercel transcript through `claim_to_private_pool`, fed by upstream prepared-prover JSON or `PrivatePoolDeposit` XDR, plus monitoring, prebuilt prover workers, receipt/finality improvements, denomination/batching privacy work, and production controls.
