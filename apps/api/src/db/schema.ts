export const bridgeBackendSchemaSql = `
CREATE TABLE IF NOT EXISTS bridge_intents (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  stellar_account text,
  receive_amount text NOT NULL,
  gross_amount text NOT NULL,
  expected_cctp_fee text NOT NULL,
  actual_cctp_fee text,
  note_commitment text NOT NULL,
  pool_id text NOT NULL,
  private_pool_proof jsonb NOT NULL,
  private_pool_inspection jsonb NOT NULL,
  source_action jsonb NOT NULL,
  source_tx_hash text UNIQUE,
  receipt jsonb,
  cctp_settlement jsonb,
  witness jsonb,
  proof_artifact jsonb,
  stellar_claim_tx_hash text,
  claim_nullifier text,
  boundless_request_id text,
  replay_checked boolean NOT NULL DEFAULT false,
  worker_lock_token text,
  worker_locked_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz
);

CREATE INDEX IF NOT EXISTS bridge_intents_status_updated_idx
  ON bridge_intents(status, updated_at);

CREATE INDEX IF NOT EXISTS bridge_intents_source_tx_hash_idx
  ON bridge_intents(source_tx_hash);

CREATE TABLE IF NOT EXISTS bridge_events (
  id bigserial PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES bridge_intents(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bridge_events_intent_created_idx
  ON bridge_events(intent_id, created_at, id);
`;
