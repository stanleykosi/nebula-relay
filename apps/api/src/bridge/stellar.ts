import {
  buildPrivatePoolClaimTransaction,
  buildPrivatePoolDepositScVal,
  simulateAndAssembleTransaction,
  submitSignedTransaction,
} from "@nebula/stellar-client";
import * as StellarSdk from "@stellar/stellar-sdk";
import type { Hex } from "viem";
import type { AppConfig } from "../config.js";
import type { BridgeIntentRecord, StellarClaimResult } from "../types.js";
import { ApiError, toErrorMessage } from "../errors.js";

export async function submitPrivatePoolClaim(
  config: Pick<
    AppConfig,
    | "stellarRpcUrl"
    | "stellarNetworkPassphrase"
    | "stellarSourceSecret"
    | "nebulaRelayContractId"
    | "privatePaymentsPoolId"
    | "privatePoolNoteOutputIndex"
  >,
  intent: Pick<BridgeIntentRecord, "privatePoolProof">,
  proof: NonNullable<BridgeIntentRecord["proofArtifact"]>,
  settlement: NonNullable<BridgeIntentRecord["cctpSettlement"]>
): Promise<StellarClaimResult> {
  const privateDeposit = buildPrivatePoolDepositScVal({
    upstream: intent.privatePoolProof,
    expectedPoolId: config.privatePaymentsPoolId,
    expectedSettlementAmount: proof.publicOutputs.settlementAmount,
    expectedNoteCommitment: asHex(proof.publicOutputs.stellarNoteCommitment),
    noteOutputIndex: config.privatePoolNoteOutputIndex,
  });
  const rpc = new StellarSdk.rpc.Server(config.stellarRpcUrl);
  const submitRpc = createSubmitRpcAdapter(rpc);
  const sourceKeypair = StellarSdk.Keypair.fromSecret(config.stellarSourceSecret);
  const sourceAccount = await rpc.getAccount(sourceKeypair.publicKey());
  const tx = buildPrivatePoolClaimTransaction({
    sourceAccount,
    contractId: config.nebulaRelayContractId,
    networkPassphrase: config.stellarNetworkPassphrase,
    claim: {
      seal: asHex(proof.sealHex),
      imageId: asHex(proof.imageIdHex),
      journal: asHex(proof.journalHex),
      cctpMessage: settlement.message,
      cctpAttestation: settlement.attestation,
      privateDeposit,
    },
  });
  const prepared = await simulateAndAssembleTransaction(rpc, tx);
  prepared.transaction.sign(sourceKeypair);
  const result = await submitSignedTransaction(
    submitRpc,
    prepared.transaction.toXDR(),
    config.stellarNetworkPassphrase,
    { pollIntervalMs: 1000, maxPolls: 90 }
  );
  return {
    hash: result.hash,
    status: result.status,
    claimNullifier: asHex(proof.publicOutputs.claimNullifier),
  };
}

export async function verifyReplayFails(
  config: Pick<
    AppConfig,
    | "stellarRpcUrl"
    | "stellarNetworkPassphrase"
    | "stellarSourceSecret"
    | "nebulaRelayContractId"
    | "privatePaymentsPoolId"
    | "privatePoolNoteOutputIndex"
  >,
  intent: Pick<BridgeIntentRecord, "privatePoolProof">,
  proof: NonNullable<BridgeIntentRecord["proofArtifact"]>,
  settlement: NonNullable<BridgeIntentRecord["cctpSettlement"]>
): Promise<void> {
  const privateDeposit = buildPrivatePoolDepositScVal({
    upstream: intent.privatePoolProof,
    expectedPoolId: config.privatePaymentsPoolId,
    expectedSettlementAmount: proof.publicOutputs.settlementAmount,
    expectedNoteCommitment: asHex(proof.publicOutputs.stellarNoteCommitment),
    noteOutputIndex: config.privatePoolNoteOutputIndex,
  });
  const rpc = new StellarSdk.rpc.Server(config.stellarRpcUrl);
  const sourceKeypair = StellarSdk.Keypair.fromSecret(config.stellarSourceSecret);
  const sourceAccount = await rpc.getAccount(sourceKeypair.publicKey());
  const tx = buildPrivatePoolClaimTransaction({
    sourceAccount,
    contractId: config.nebulaRelayContractId,
    networkPassphrase: config.stellarNetworkPassphrase,
    claim: {
      seal: asHex(proof.sealHex),
      imageId: asHex(proof.imageIdHex),
      journal: asHex(proof.journalHex),
      cctpMessage: settlement.message,
      cctpAttestation: settlement.attestation,
      privateDeposit,
    },
  });

  try {
    await simulateAndAssembleTransaction(rpc, tx);
  } catch (error) {
    const message = toErrorMessage(error);
    if (message.includes("#15") || message.includes("NullifierAlreadyClaimed")) {
      return;
    }
    throw new ApiError(
      502,
      "unexpected_replay_error",
      `replay failed with the wrong error: ${message}`
    );
  }
  throw new ApiError(
    502,
    "replay_unexpectedly_succeeded",
    "replay simulation succeeded after claim"
  );
}

function asHex(value: string): Hex {
  return value as Hex;
}

function createSubmitRpcAdapter(rpc: StellarSdk.rpc.Server) {
  return {
    async sendTransaction(transaction: StellarSdk.Transaction) {
      const response = await rpc.sendTransaction(transaction);
      return {
        status: response.status,
        hash: response.hash,
        errorResult:
          "errorResult" in response && response.errorResult
            ? String(response.errorResult)
            : undefined,
      };
    },
    async getTransaction(hash: string) {
      const response = await rpc.getTransaction(hash);
      return {
        status: response.status,
        returnValue:
          "returnValue" in response ? response.returnValue : undefined,
        resultXdr:
          "resultXdr" in response && typeof response.resultXdr === "string"
            ? response.resultXdr
            : undefined,
      };
    },
  };
}
