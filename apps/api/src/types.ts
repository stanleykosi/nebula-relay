import type { LockWitness, ProofArtifact } from "@nebula/core";
import type { PrivatePoolPreparedTxInspection } from "@nebula/stellar-client";
import type { Address, Hex } from "viem";

export const BRIDGE_STATUSES = [
  "waiting_source_tx",
  "source_tx_submitted",
  "source_finalized",
  "cctp_pending",
  "cctp_complete",
  "witness_built",
  "proving",
  "proof_ready",
  "claiming",
  "claimed",
  "replay_verified",
  "fee_mismatch",
  "failed",
] as const;

export type BridgeStatus = (typeof BRIDGE_STATUSES)[number];

export interface BridgeQuote {
  receiveAmount: string;
  expectedCctpFee: string;
  grossAmount: string;
  assetDecimals: number;
  sourceNetwork: "ethereum-sepolia";
  destinationNetwork: "stellar-testnet";
  feePolicy: "configured-cctp-fast-transfer-fee";
}

export interface SourceAction {
  chainId: number;
  token: Address;
  escrow: Address;
  spender: Address;
  receiveAmount: string;
  expectedCctpFee: string;
  grossAmount: string;
  noteCommitment: Hex;
  complianceHint: Hex;
  hookData: Hex;
  approval: {
    to: Address;
    spender: Address;
    amount: string;
    calldata: Hex;
    abi: readonly unknown[];
  };
  lockAndBurn: {
    to: Address;
    functionName: "lockAndBurn";
    args: {
      amount: string;
      stellarNoteCommitment: Hex;
      complianceHint: Hex;
      hookData: Hex;
    };
    calldata: Hex;
    abi: readonly unknown[];
  };
}

export interface CctpSettlementArtifact {
  sourceDomain: number;
  destinationDomain: number;
  nonce: Hex;
  message: Hex;
  attestation: Hex;
  messageHash: Hex;
  attestationHash: Hex;
  mintRecipient: Hex;
  eventNonce?: string;
  cctpVersion?: number;
  parsed: {
    version: number;
    sourceDomain: number;
    destinationDomain: number;
    minFinalityThreshold: number;
    finalityThresholdExecuted: number;
    burnAmount: string;
    maxFee: string;
    feeExecuted: string;
    netAmount: string;
    hookVersion: number;
    hookRecipient: string;
    hookPayload: Hex;
  };
}

export interface StellarClaimResult {
  hash: string;
  status: string;
  claimNullifier: Hex;
}

export interface BridgeIntentRecord {
  id: string;
  status: BridgeStatus;
  stellarAccount: string | null;
  receiveAmount: string;
  grossAmount: string;
  expectedCctpFee: string;
  actualCctpFee: string | null;
  noteCommitment: Hex;
  poolId: string;
  privatePoolProof: unknown;
  privatePoolInspection: PrivatePoolPreparedTxInspection;
  sourceAction: SourceAction;
  sourceTxHash: Hex | null;
  receipt: unknown | null;
  cctpSettlement: CctpSettlementArtifact | null;
  witness: LockWitness | null;
  proofArtifact: ProofArtifact | null;
  stellarClaimTxHash: string | null;
  claimNullifier: Hex | null;
  boundlessRequestId: Hex | null;
  replayChecked: boolean;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
}

export interface BridgeEventRecord {
  id: number;
  intentId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface BridgeNoteBackupRecord {
  intentId: string;
  stellarAccount: string;
  noteCommitment: Hex;
  poolId: string;
  backupFormat: "nebula.note.backup.v1";
  schemaVersion: 1;
  kdfVersion: "freighter-signature-hkdf-sha256-aes-256-gcm-v1";
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIntentInput {
  id: string;
  stellarAccount: string | null;
  quote: BridgeQuote;
  noteCommitment: Hex;
  poolId: string;
  privatePoolProof: unknown;
  privatePoolInspection: PrivatePoolPreparedTxInspection;
  sourceAction: SourceAction;
}

export interface IntentPatch {
  status?: BridgeStatus;
  actualCctpFee?: string | null;
  sourceTxHash?: Hex | null;
  receipt?: unknown | null;
  cctpSettlement?: CctpSettlementArtifact | null;
  witness?: LockWitness | null;
  proofArtifact?: ProofArtifact | null;
  stellarClaimTxHash?: string | null;
  claimNullifier?: Hex | null;
  boundlessRequestId?: Hex | null;
  replayChecked?: boolean;
  lastError?: string | null;
  claimedAt?: string | null;
}

export interface UpsertNoteBackupInput {
  intentId: string;
  stellarAccount: string;
  noteCommitment: Hex;
  poolId: string;
  backupFormat: "nebula.note.backup.v1";
  schemaVersion: 1;
  kdfVersion: "freighter-signature-hkdf-sha256-aes-256-gcm-v1";
  salt: string;
  iv: string;
  ciphertext: string;
}
