import { assertCctpMessageMatchesSettlement } from "@nebula/cctp-client";
import { buildLockWitnessFromReceipt } from "@nebula/evm-client";
import { getAddress, type Hex } from "viem";
import type { AppConfig } from "../config.js";
import { ApiError } from "../errors.js";
import type { BridgeIntentRecord, CctpSettlementArtifact } from "../types.js";
import { asRecord } from "./json.js";

export function buildIntentWitness(
  config: Pick<
    AppConfig,
    | "evmChainId"
    | "escrowAddress"
    | "usdcAddress"
    | "complianceRoot"
    | "complianceMode"
    | "nebulaNetworkDomain"
    | "nebulaExpiresAtLedger"
    | "nebulaMinAmount"
    | "nebulaMaxAmount"
    | "cctpSourceDomain"
    | "cctpDestinationDomain"
  >,
  intent: Pick<
    BridgeIntentRecord,
    "grossAmount" | "receiveAmount" | "noteCommitment"
  >,
  receipt: unknown,
  settlement: CctpSettlementArtifact
) {
  if (settlement.parsed.netAmount !== intent.receiveAmount) {
    throw new ApiError(
      409,
      "cctp_fee_mismatch",
      `CCTP net amount ${settlement.parsed.netAmount} does not match prepared private-pool amount ${intent.receiveAmount}`
    );
  }

  const receiptRecord = asRecord(receipt, "receipt");
  const blockHash = String(receiptRecord.blockHash ?? "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(blockHash)) {
    throw new ApiError(422, "invalid_receipt", "receipt blockHash is missing");
  }

  const witness = buildLockWitnessFromReceipt(receiptRecord as never, {
    sourceChainId: config.evmChainId,
    escrowContract: config.escrowAddress,
    sourceReceiptRoot: blockHash as Hex,
    complianceRoot: config.complianceRoot,
    complianceMode: config.complianceMode,
    complianceWitnessValid: true,
    cctpSettlement: {
      sourceDomain: settlement.sourceDomain,
      destinationDomain: settlement.destinationDomain,
      nonce: settlement.nonce,
      message: settlement.message,
      messageHash: settlement.messageHash,
      attestationHash: settlement.attestationHash,
      mintRecipient: settlement.mintRecipient,
    },
    expected: {
      sourceChainId: config.evmChainId,
      escrowContract: config.escrowAddress,
      tokenAddress: config.usdcAddress,
      minAmount: config.nebulaMinAmount,
      maxAmount: config.nebulaMaxAmount,
      complianceRoot: config.complianceRoot,
      destinationChainId: config.cctpDestinationDomain,
      networkDomain: config.nebulaNetworkDomain,
      expiresAtLedger: config.nebulaExpiresAtLedger,
      cctpSourceDomain: config.cctpSourceDomain,
      cctpDestinationDomain: config.cctpDestinationDomain,
      cctpMintRecipient: settlement.mintRecipient,
    },
  });

  if (witness.amount !== intent.grossAmount) {
    throw new ApiError(
      422,
      "source_amount_mismatch",
      `Locked amount ${witness.amount} does not match quoted gross amount ${intent.grossAmount}`
    );
  }
  if (
    witness.stellarNoteCommitment.toLowerCase() !==
    intent.noteCommitment.toLowerCase()
  ) {
    throw new ApiError(
      422,
      "note_commitment_mismatch",
      "Locked event note commitment does not match the private-pool note"
    );
  }

  assertCctpMessageMatchesSettlement({
    message: settlement.message,
    expectedSourceDomain: config.cctpSourceDomain,
    expectedDestinationDomain: config.cctpDestinationDomain,
    expectedNonce: settlement.nonce,
    expectedBurnToken: getAddress(config.usdcAddress),
    expectedAmount: BigInt(intent.grossAmount),
    expectedMessageSender: getAddress(config.escrowAddress),
    expectedMintRecipient: settlement.mintRecipient,
  });

  return witness;
}
