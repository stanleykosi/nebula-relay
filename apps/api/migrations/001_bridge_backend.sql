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

CREATE INDEX IF NOT EXISTS bridge_intents_stellar_account_updated_idx
  ON bridge_intents(stellar_account, updated_at DESC)
  WHERE stellar_account IS NOT NULL;

CREATE TABLE IF NOT EXISTS bridge_events (
  id bigserial PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES bridge_intents(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bridge_events_intent_created_idx
  ON bridge_events(intent_id, created_at, id);

CREATE TABLE IF NOT EXISTS bridge_note_backups (
  intent_id uuid PRIMARY KEY REFERENCES bridge_intents(id) ON DELETE CASCADE,
  stellar_account text NOT NULL,
  note_commitment text NOT NULL,
  pool_id text NOT NULL,
  backup_format text NOT NULL,
  schema_version integer NOT NULL,
  kdf_version text NOT NULL,
  salt text NOT NULL,
  iv text NOT NULL,
  ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bridge_note_backups_format_check
    CHECK (backup_format = 'nebula.note.backup.v1'),
  CONSTRAINT bridge_note_backups_schema_check
    CHECK (schema_version = 1),
  CONSTRAINT bridge_note_backups_kdf_check
    CHECK (kdf_version = 'freighter-signature-hkdf-sha256-aes-256-gcm-v1')
);

CREATE INDEX IF NOT EXISTS bridge_note_backups_stellar_account_idx
  ON bridge_note_backups(stellar_account, updated_at DESC);

CREATE INDEX IF NOT EXISTS bridge_note_backups_note_commitment_idx
  ON bridge_note_backups(note_commitment);
