# Nebula API Backend

Railway service for the live testnet bridge path.

## Runtime Flow

1. Frontend asks `POST /v1/quotes` for a net Stellar private-pool receive amount.
2. Frontend connects the Stellar wallet and generates upstream Stellar Private Payments `PreparedProverTx` JSON for that exact net amount.
3. Frontend sends that JSON to `POST /v1/intents`.
4. Backend validates the pool ID, settlement amount, public amount, proof byte shape, and selected output commitment.
5. Backend returns the exact EVM wallet action:
   - approve Sepolia USDC spend to `NebulaCctpEscrow` if allowance is low;
   - call `NebulaCctpEscrow.lockAndBurn(grossAmount, selectedNoteCommitment, complianceHint, hookData)`.
6. Frontend submits the user-signed EVM transaction hash to `POST /v1/intents/:id/source-tx`.
7. Railway worker resumes from Postgres and processes:
   - Sepolia receipt fetch;
   - Circle Iris CCTP attestation polling;
   - CCTP net amount check against the prepared private-pool amount;
   - `LockWitness` construction;
   - Boundless-backed RISC Zero remote proof generation;
   - Stellar `NebulaRelay.claim_to_private_pool`;
   - replay-failure verification.

Per-order proof JSON, source transaction hash, CCTP message, witness, proof artifact, nullifier, and claim hash are stored in Postgres. They are not environment variables.

## Railway Settings

Create the Railway service from the repo root.

- Root directory: `/`
- Config file path: `/apps/api/railway.toml`
- Health check path: `/health`
- Start command comes from `apps/api/railway.toml`.

Add Railway Postgres and Redis, then attach their variables to this API service.

## Required Environment

Persistent API secrets/config:

- `DATABASE_URL`
- `REDIS_URL`
- `FRONTEND_ORIGIN`
- `SEPOLIA_RPC_URL`
- `NEBULA_CCTP_ESCROW_ADDRESS`
- `CCTP_TOKEN_MESSENGER_V2_ADDRESS`
- `CCTP_USDC_ADDRESS`
- `CCTP_MAX_FEE`
- `CCTP_MIN_FINALITY_THRESHOLD`
- `CCTP_SOURCE_DOMAIN`
- `CCTP_STELLAR_DOMAIN`
- `CCTP_STELLAR_FORWARDER_ID`
- `CCTP_STELLAR_FORWARDER_BYTES32`
- `CCTP_STELLAR_FORWARDER_HOOK_DATA`
- `CCTP_FEE_QUOTE_BASE_UNITS`
- `NEXT_PUBLIC_EVM_CHAIN_ID`
- `NEBULA_COMPLIANCE_HINT`
- `NEBULA_COMPLIANCE_ROOT`
- `NEBULA_COMPLIANCE_MODE`
- `NEBULA_NETWORK_DOMAIN`
- `NEBULA_EXPIRES_AT_LEDGER`
- `NEBULA_MIN_AMOUNT`
- `NEBULA_MAX_AMOUNT`
- `PRIVATE_PAYMENTS_POOL_ID`
- `NEBULA_PRIVATE_POOL_NOTE_OUTPUT_INDEX`
- `STELLAR_NETWORK`
- `STELLAR_RPC_URL`
- `STELLAR_NETWORK_PASSPHRASE`
- `STELLAR_SOURCE_SECRET`
- `STELLAR_ASSET_CONTRACT_ID`
- `NEBULA_RELAY_CONTRACT_ID`
- `RISC0_VERIFIER_ROUTER_ID`
- `NEBULA_IMAGE_ID`
- `NEBULA_HOST_BIN`
- `BOUNDLESS_RPC_URL`
- `BOUNDLESS_PRIVATE_KEY`
- `BOUNDLESS_PROGRAM_URL` or `PINATA_JWT`

Do not set `EVM_USER_PRIVATE_KEY` in Railway for this product path. The source wallet belongs in the frontend wallet only.
