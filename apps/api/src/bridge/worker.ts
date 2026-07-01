import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { BridgeRepository } from "../db/repository.js";
import { ApiError, toErrorMessage } from "../errors.js";
import type { BridgeIntentRecord } from "../types.js";
import { fetchCompleteCctpSettlementOnce, fetchSourceReceipt } from "./cctp.js";
import { proveWitnessRemotely } from "./prover.js";
import { submitPrivatePoolClaim, verifyReplayFails } from "./stellar.js";
import { buildIntentWitness } from "./witness.js";

export class BridgeWorker {
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly repo: BridgeRepository
  ) {}

  start(): void {
    if (!this.config.workerEnabled) {
      return;
    }
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  async runOnce(): Promise<boolean> {
    const lockToken = randomUUID();
    const intent = await this.repo.claimNextProcessableIntent(
      lockToken,
      this.config.workerLockMs
    );
    if (!intent) {
      return false;
    }

    try {
      await this.processIntent(intent);
    } catch (error) {
      await this.failIntent(intent, error);
    } finally {
      await this.repo.releaseIntentLock(intent.id, lockToken);
    }
    return true;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        const processed = await this.runOnce();
        if (!this.stopped) {
          await this.sleep(this.config.workerPollMs);
        }
      } catch (error) {
        console.error("bridge worker loop error", error);
        await this.sleep(this.config.workerPollMs);
      }
    }
  }

  private async processIntent(intent: BridgeIntentRecord): Promise<void> {
    let current = intent;

    if (current.status === "source_tx_submitted") {
      if (!current.sourceTxHash) {
        throw new ApiError(409, "missing_source_tx", "intent has no source tx hash");
      }
      const receipt = await fetchSourceReceipt(this.config, current.sourceTxHash);
      current = await this.repo.patchIntent(
        current.id,
        { status: "source_finalized", receipt, lastError: null },
        "source_finalized",
        {
          sourceTxHash: current.sourceTxHash,
          blockNumber: receipt.blockNumber,
        }
      );
    }

    if (current.status === "source_finalized" || current.status === "cctp_pending") {
      if (!current.sourceTxHash) {
        throw new ApiError(409, "missing_source_tx", "intent has no source tx hash");
      }
      const settlement = await fetchCompleteCctpSettlementOnce(
        this.config,
        current.sourceTxHash
      );
      if (!settlement) {
        await this.repo.patchIntent(
          current.id,
          { status: "cctp_pending", lastError: null },
          "cctp_pending",
          { sourceTxHash: current.sourceTxHash }
        );
        return;
      }

      if (settlement.parsed.netAmount !== current.receiveAmount) {
        await this.repo.patchIntent(
          current.id,
          {
            status: "fee_mismatch",
            cctpSettlement: settlement,
            actualCctpFee: settlement.parsed.feeExecuted,
            lastError: `CCTP net amount ${settlement.parsed.netAmount} does not match prepared private-pool amount ${current.receiveAmount}`,
          },
          "fee_mismatch",
          {
            expectedReceiveAmount: current.receiveAmount,
            actualNetAmount: settlement.parsed.netAmount,
            feeExecuted: settlement.parsed.feeExecuted,
          }
        );
        return;
      }

      current = await this.repo.patchIntent(
        current.id,
        {
          status: "cctp_complete",
          cctpSettlement: settlement,
          actualCctpFee: settlement.parsed.feeExecuted,
          lastError: null,
        },
        "cctp_complete",
        {
          nonce: settlement.nonce,
          messageHash: settlement.messageHash,
          feeExecuted: settlement.parsed.feeExecuted,
          netAmount: settlement.parsed.netAmount,
        }
      );
    }

    if (current.status === "cctp_complete") {
      if (!current.receipt || !current.cctpSettlement) {
        throw new ApiError(
          409,
          "missing_cctp_inputs",
          "receipt and CCTP settlement are required to build witness"
        );
      }
      const witness = buildIntentWitness(
        this.config,
        current,
        current.receipt,
        current.cctpSettlement
      );
      current = await this.repo.patchIntent(
        current.id,
        { status: "witness_built", witness, lastError: null },
        "witness_built",
        {
          lockId: witness.lockId,
          amount: witness.amount,
          noteCommitment: witness.stellarNoteCommitment,
        }
      );
    }

    if (current.status === "witness_built" || current.status === "proving") {
      if (!current.witness) {
        throw new ApiError(409, "missing_witness", "witness is required");
      }
      await this.repo.patchIntent(
        current.id,
        { status: "proving", lastError: null },
        "proving",
        {}
      );
      const proof = await proveWitnessRemotely(
        this.config,
        current.id,
        current.witness
      );
      current = await this.repo.patchIntent(
        current.id,
        {
          status: "proof_ready",
          proofArtifact: proof.proof,
          boundlessRequestId: proof.boundlessRequestId,
          lastError: null,
        },
        "proof_ready",
        {
          imageId: proof.proof.imageIdHex,
          journalDigest: proof.proof.journalDigestHex,
          boundlessRequestId: proof.boundlessRequestId,
        }
      );
    }

    if (current.status === "proof_ready" || current.status === "claiming") {
      if (!current.proofArtifact || !current.cctpSettlement) {
        throw new ApiError(
          409,
          "missing_claim_inputs",
          "proof artifact and CCTP settlement are required to claim"
        );
      }
      if (
        current.proofArtifact.publicOutputs.stellarNoteCommitment.toLowerCase() !==
        current.noteCommitment.toLowerCase()
      ) {
        throw new ApiError(
          422,
          "proof_note_mismatch",
          "RISC0 journal note commitment does not match private-pool proof"
        );
      }
      if (
        current.proofArtifact.publicOutputs.settlementAmount !==
        current.receiveAmount
      ) {
        throw new ApiError(
          422,
          "proof_settlement_mismatch",
          "RISC0 journal settlement amount does not match private-pool proof"
        );
      }

      await this.repo.patchIntent(
        current.id,
        { status: "claiming", lastError: null },
        "claiming",
        {}
      );
      const claim = await submitPrivatePoolClaim(
        this.config,
        current,
        current.proofArtifact,
        current.cctpSettlement
      );
      current = await this.repo.patchIntent(
        current.id,
        {
          status: "claimed",
          stellarClaimTxHash: claim.hash,
          claimNullifier: claim.claimNullifier,
          lastError: null,
          claimedAt: new Date().toISOString(),
        },
        "claimed",
        { stellarClaimTxHash: claim.hash, claimNullifier: claim.claimNullifier }
      );
    }

    if (current.status === "claimed" && !current.replayChecked) {
      if (!current.proofArtifact || !current.cctpSettlement) {
        throw new ApiError(
          409,
          "missing_replay_inputs",
          "proof artifact and CCTP settlement are required to verify replay failure"
        );
      }
      await verifyReplayFails(
        this.config,
        current,
        current.proofArtifact,
        current.cctpSettlement
      );
      await this.repo.patchIntent(
        current.id,
        { status: "replay_verified", replayChecked: true, lastError: null },
        "replay_verified",
        { claimNullifier: current.claimNullifier }
      );
    }
  }

  private async failIntent(
    intent: BridgeIntentRecord,
    error: unknown
  ): Promise<void> {
    const message = toErrorMessage(error);
    const status = isRetryable(error) ? intent.status : "failed";
    await this.repo.patchIntent(
      intent.id,
      { status, lastError: message },
      status === "failed" ? "failed" : "worker_retryable_error",
      { message }
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timer = setTimeout(resolve, ms);
    });
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.statusCode >= 500 || error.code === "iris_missing_nonce";
  }
  return true;
}
