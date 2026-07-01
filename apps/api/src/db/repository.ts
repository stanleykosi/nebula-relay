import type { Pool, QueryResultRow } from "pg";
import type {
  BridgeEventRecord,
  BridgeIntentRecord,
  BridgeStatus,
  CreateIntentInput,
  IntentPatch,
} from "../types.js";

const PROCESSABLE_STATUSES: BridgeStatus[] = [
  "source_tx_submitted",
  "source_finalized",
  "cctp_pending",
  "cctp_complete",
  "witness_built",
  "proving",
  "proof_ready",
  "claiming",
  "claimed",
];

export class BridgeRepository {
  constructor(private readonly pg: Pool) {}

  async createIntent(input: CreateIntentInput): Promise<BridgeIntentRecord> {
    const result = await this.pg.query(
      `
      INSERT INTO bridge_intents (
        id,
        status,
        stellar_account,
        receive_amount,
        gross_amount,
        expected_cctp_fee,
        note_commitment,
        pool_id,
        private_pool_proof,
        private_pool_inspection,
        source_action
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
      RETURNING *
      `,
      [
        input.id,
        "waiting_source_tx",
        input.stellarAccount,
        input.quote.receiveAmount,
        input.quote.grossAmount,
        input.quote.expectedCctpFee,
        input.noteCommitment,
        input.poolId,
        JSON.stringify(input.privatePoolProof),
        JSON.stringify(input.privatePoolInspection),
        JSON.stringify(input.sourceAction),
      ]
    );
    const intent = mapIntent(result.rows[0]);
    await this.appendEvent(intent.id, "intent_created", {
      receiveAmount: intent.receiveAmount,
      grossAmount: intent.grossAmount,
      noteCommitment: intent.noteCommitment,
    });
    return intent;
  }

  async getIntent(id: string): Promise<BridgeIntentRecord | null> {
    const result = await this.pg.query(
      "SELECT * FROM bridge_intents WHERE id = $1",
      [id]
    );
    return result.rows[0] ? mapIntent(result.rows[0]) : null;
  }

  async attachSourceTx(id: string, txHash: string): Promise<BridgeIntentRecord> {
    const result = await this.pg.query(
      `
      UPDATE bridge_intents
      SET status = 'source_tx_submitted',
          source_tx_hash = $2,
          last_error = NULL,
          updated_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [id, txHash.toLowerCase()]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`intent not found: ${id}`);
    }
    await this.appendEvent(id, "source_tx_submitted", { txHash });
    return mapIntent(row);
  }

  async claimNextProcessableIntent(
    lockToken: string,
    lockMs: number
  ): Promise<BridgeIntentRecord | null> {
    const result = await this.pg.query(
      `
      UPDATE bridge_intents
      SET worker_lock_token = $1,
          worker_locked_until = now() + ($2::text || ' milliseconds')::interval,
          updated_at = updated_at
      WHERE id = (
        SELECT id
        FROM bridge_intents
        WHERE status = ANY($3::text[])
          AND source_tx_hash IS NOT NULL
          AND (worker_locked_until IS NULL OR worker_locked_until < now())
        ORDER BY updated_at ASC
        LIMIT 1
      )
      RETURNING *
      `,
      [lockToken, lockMs, PROCESSABLE_STATUSES]
    );
    return result.rows[0] ? mapIntent(result.rows[0]) : null;
  }

  async releaseIntentLock(id: string, lockToken: string): Promise<void> {
    await this.pg.query(
      `
      UPDATE bridge_intents
      SET worker_lock_token = NULL,
          worker_locked_until = NULL
      WHERE id = $1 AND worker_lock_token = $2
      `,
      [id, lockToken]
    );
  }

  async patchIntent(
    id: string,
    patch: IntentPatch,
    eventType?: string,
    eventPayload: Record<string, unknown> = {}
  ): Promise<BridgeIntentRecord> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown, json = false) => {
      values.push(json ? JSON.stringify(value) : value);
      assignments.push(`${column} = $${values.length}${json ? "::jsonb" : ""}`);
    };

    if (patch.status !== undefined) add("status", patch.status);
    if (patch.actualCctpFee !== undefined) add("actual_cctp_fee", patch.actualCctpFee);
    if (patch.sourceTxHash !== undefined) add("source_tx_hash", patch.sourceTxHash);
    if (patch.receipt !== undefined) add("receipt", patch.receipt, true);
    if (patch.cctpSettlement !== undefined) add("cctp_settlement", patch.cctpSettlement, true);
    if (patch.witness !== undefined) add("witness", patch.witness, true);
    if (patch.proofArtifact !== undefined) add("proof_artifact", patch.proofArtifact, true);
    if (patch.stellarClaimTxHash !== undefined) add("stellar_claim_tx_hash", patch.stellarClaimTxHash);
    if (patch.claimNullifier !== undefined) add("claim_nullifier", patch.claimNullifier);
    if (patch.boundlessRequestId !== undefined) add("boundless_request_id", patch.boundlessRequestId);
    if (patch.replayChecked !== undefined) add("replay_checked", patch.replayChecked);
    if (patch.lastError !== undefined) add("last_error", patch.lastError);
    if (patch.claimedAt !== undefined) add("claimed_at", patch.claimedAt);

    if (assignments.length === 0) {
      const existing = await this.getIntent(id);
      if (!existing) {
        throw new Error(`intent not found: ${id}`);
      }
      return existing;
    }

    values.push(id);
    const result = await this.pg.query(
      `
      UPDATE bridge_intents
      SET ${assignments.join(", ")},
          updated_at = now()
      WHERE id = $${values.length}
      RETURNING *
      `,
      values
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`intent not found: ${id}`);
    }
    const intent = mapIntent(row);
    if (eventType) {
      await this.appendEvent(id, eventType, eventPayload);
    }
    return intent;
  }

  async appendEvent(
    intentId: string,
    eventType: string,
    payload: Record<string, unknown> = {}
  ): Promise<void> {
    await this.pg.query(
      `
      INSERT INTO bridge_events (intent_id, event_type, payload)
      VALUES ($1, $2, $3::jsonb)
      `,
      [intentId, eventType, JSON.stringify(payload)]
    );
  }

  async listEvents(
    intentId: string,
    afterId = 0
  ): Promise<BridgeEventRecord[]> {
    const result = await this.pg.query(
      `
      SELECT *
      FROM bridge_events
      WHERE intent_id = $1 AND id > $2
      ORDER BY id ASC
      LIMIT 200
      `,
      [intentId, afterId]
    );
    return result.rows.map(mapEvent);
  }
}

function mapIntent(row: QueryResultRow): BridgeIntentRecord {
  return {
    id: String(row.id),
    status: row.status as BridgeStatus,
    stellarAccount: row.stellar_account,
    receiveAmount: String(row.receive_amount),
    grossAmount: String(row.gross_amount),
    expectedCctpFee: String(row.expected_cctp_fee),
    actualCctpFee: row.actual_cctp_fee,
    noteCommitment: row.note_commitment,
    poolId: row.pool_id,
    privatePoolProof: row.private_pool_proof,
    privatePoolInspection: row.private_pool_inspection,
    sourceAction: row.source_action,
    sourceTxHash: row.source_tx_hash,
    receipt: row.receipt,
    cctpSettlement: row.cctp_settlement,
    witness: row.witness,
    proofArtifact: row.proof_artifact,
    stellarClaimTxHash: row.stellar_claim_tx_hash,
    claimNullifier: row.claim_nullifier,
    boundlessRequestId: row.boundless_request_id,
    replayChecked: Boolean(row.replay_checked),
    lastError: row.last_error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    claimedAt: row.claimed_at ? toIso(row.claimed_at) : null,
  };
}

function mapEvent(row: QueryResultRow): BridgeEventRecord {
  return {
    id: Number(row.id),
    intentId: String(row.intent_id),
    eventType: String(row.event_type),
    payload: row.payload ?? {},
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(String(value)).toISOString();
}
