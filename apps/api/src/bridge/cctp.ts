import {
  createCctpSettlementBinding,
  fetchCctpAttestationOnce,
  parseCctpMessageV2,
  parseStellarForwarderHookData,
} from "@nebula/cctp-client";
import { createPublicClient, http, type Hex } from "viem";
import type { AppConfig } from "../config.js";
import { ApiError } from "../errors.js";
import type { CctpSettlementArtifact } from "../types.js";
import { jsonSafe } from "./json.js";

export async function fetchSourceReceipt(
  config: Pick<AppConfig, "sepoliaRpcUrl">,
  txHash: Hex
): Promise<Record<string, unknown>> {
  const client = createPublicClient({
    transport: http(config.sepoliaRpcUrl),
  });
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new ApiError(
      422,
      "source_transaction_reverted",
      `source transaction ${txHash} was mined with status ${receipt.status}`
    );
  }
  return jsonSafe(receipt) as Record<string, unknown>;
}

export async function fetchCompleteCctpSettlementOnce(
  config: Pick<
    AppConfig,
    | "cctpIrisApiUrl"
    | "cctpSourceDomain"
    | "cctpDestinationDomain"
    | "cctpStellarForwarderId"
    | "nebulaRelayContractId"
  >,
  txHash: Hex
): Promise<CctpSettlementArtifact | null> {
  const attestation = await fetchCctpAttestationOnce(fetch, {
    irisBaseUrl: config.cctpIrisApiUrl,
    sourceDomain: config.cctpSourceDomain,
    transactionHash: txHash,
  });
  if (attestation.status !== "complete") {
    return null;
  }
  if (!attestation.eventNonce) {
    throw new ApiError(
      502,
      "iris_missing_nonce",
      "Circle Iris response is complete but omitted eventNonce"
    );
  }

  const binding = createCctpSettlementBinding({
    sourceDomain: config.cctpSourceDomain,
    destinationDomain: config.cctpDestinationDomain,
    nonce: attestation.eventNonce as Hex,
    message: attestation.message,
    attestation: attestation.attestation,
    mintRecipient: config.cctpStellarForwarderId,
  });
  const parsed = parseCctpMessageV2(attestation.message);
  const hook = parseStellarForwarderHookData(parsed.burnMessage.hookData);
  if (hook.recipient !== config.nebulaRelayContractId) {
    throw new ApiError(
      422,
      "wrong_cctp_hook_recipient",
      `CCTP hook recipient ${hook.recipient} does not match NebulaRelay ${config.nebulaRelayContractId}`
    );
  }

  return {
    ...binding,
    attestation: attestation.attestation,
    eventNonce: attestation.eventNonce,
    cctpVersion: attestation.cctpVersion,
    parsed: {
      version: parsed.version,
      sourceDomain: parsed.sourceDomain,
      destinationDomain: parsed.destinationDomain,
      minFinalityThreshold: parsed.minFinalityThreshold,
      finalityThresholdExecuted: parsed.finalityThresholdExecuted,
      burnAmount: parsed.burnMessage.amount.toString(),
      maxFee: parsed.burnMessage.maxFee.toString(),
      feeExecuted: parsed.burnMessage.feeExecuted.toString(),
      netAmount: (
        parsed.burnMessage.amount - parsed.burnMessage.feeExecuted
      ).toString(),
      hookVersion: hook.version,
      hookRecipient: hook.recipient,
      hookPayload: hook.payload,
    },
  };
}
