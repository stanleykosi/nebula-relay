import { LockWitnessSchema, type LockWitness } from "@nebula/core";
import { getAddress, isAddressEqual, parseEventLogs } from "viem";
import type { Account, Address, Chain, Hex, Log, PublicClient } from "viem";

export const nebulaEscrowAbi = [
  {
    type: "function",
    name: "lock",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "stellarNoteCommitment", type: "bytes32" },
      { name: "complianceHint", type: "bytes32" },
      { name: "destinationChainId", type: "uint256" },
    ],
    outputs: [{ name: "lockId", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Locked",
    inputs: [
      { name: "lockId", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "stellarNoteCommitment", type: "bytes32", indexed: false },
      { name: "complianceHint", type: "bytes32", indexed: false },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "destinationChainId", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

export type ComplianceMode = LockWitness["complianceMode"];

export interface EvmLogLike {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  logIndex?: number | bigint | string | null;
}

export interface EvmReceiptLike {
  transactionHash: Hex;
  blockNumber: number | bigint | string;
  logs: readonly EvmLogLike[];
}

export interface ParsedLockedEvent {
  transactionHash: Hex;
  blockNumber: number;
  logIndex: number;
  escrowContract: Address;
  lockId: Hex;
  senderAddress: Address;
  tokenAddress: Address;
  amount: bigint;
  stellarNoteCommitment: Hex;
  complianceHint: Hex;
  nonce: bigint;
  destinationChainId: bigint;
}

export interface LockWitnessExpectedConfig {
  sourceChainId: number;
  escrowContract: Address;
  tokenAddress: Address;
  minAmount: string;
  maxAmount: string;
  complianceRoot: Hex;
  destinationChainId: number;
  networkDomain: Hex;
  expiresAtLedger: number;
  cctpSourceDomain: number;
  cctpDestinationDomain: number;
  cctpMintRecipient: Hex;
}

export interface BuildLockWitnessConfig {
  sourceChainId: number;
  escrowContract: Address;
  sourceReceiptRoot: Hex;
  complianceRoot: Hex;
  complianceMode: ComplianceMode;
  expected: LockWitnessExpectedConfig;
  cctpSettlement: LockWitness["cctpSettlement"];
  complianceWitnessValid?: boolean;
}

export interface LockCallParams {
  escrowContract: Address;
  token: Address;
  amount: bigint;
  stellarNoteCommitment: Hex;
  complianceHint: Hex;
  destinationChainId: bigint;
}

export interface SubmitLockOptions {
  account?: Account | Address;
  chain?: Chain | null;
}

export type LockContractCall = {
  address: Address;
  abi: typeof nebulaEscrowAbi;
  functionName: "lock";
  args: readonly [Address, bigint, Hex, Hex, bigint];
};

export interface NebulaWalletClient {
  writeContract(
    parameters: LockContractCall & SubmitLockOptions
  ): Promise<Hex>;
}

export interface NebulaPublicClient {
  getTransactionReceipt: PublicClient["getTransactionReceipt"];
}

export class EvmClientError extends Error {
  constructor(
    readonly code:
      | "LOCKED_EVENT_NOT_FOUND"
      | "LOCKED_EVENT_AMBIGUOUS"
      | "UNSAFE_INTEGER",
    message: string
  ) {
    super(message);
    this.name = "EvmClientError";
  }
}

export function createLockCall(params: LockCallParams): LockContractCall {
  return {
    address: normalizeAddress(params.escrowContract),
    abi: nebulaEscrowAbi,
    functionName: "lock",
    args: [
      normalizeAddress(params.token),
      params.amount,
      normalizeHex32(params.stellarNoteCommitment),
      normalizeHex32(params.complianceHint),
      params.destinationChainId,
    ],
  };
}

export async function submitLock(
  walletClient: NebulaWalletClient,
  params: LockCallParams,
  options: SubmitLockOptions = {}
): Promise<Hex> {
  return walletClient.writeContract({
    ...createLockCall(params),
    ...options,
  });
}

export async function fetchTransactionReceipt(
  publicClient: NebulaPublicClient,
  txHash: Hex
): Promise<EvmReceiptLike> {
  return publicClient.getTransactionReceipt({ hash: txHash });
}

export function parseLockedEventFromReceipt(
  receipt: EvmReceiptLike,
  escrowContract: Address
): ParsedLockedEvent {
  const escrow = normalizeAddress(escrowContract);
  const matchingAddressLogs = receipt.logs.filter((log) =>
    isAddressEqual(normalizeAddress(log.address), escrow)
  );
  const parsed = parseEventLogs({
    abi: nebulaEscrowAbi,
    eventName: "Locked",
    logs: matchingAddressLogs.map(normalizeLog),
    strict: true,
  });

  if (parsed.length === 0) {
    throw new EvmClientError(
      "LOCKED_EVENT_NOT_FOUND",
      "receipt does not contain a NebulaEscrow Locked event from the configured escrow"
    );
  }
  if (parsed.length > 1) {
    throw new EvmClientError(
      "LOCKED_EVENT_AMBIGUOUS",
      "receipt contains multiple NebulaEscrow Locked events"
    );
  }

  const log = parsed[0];
  const args = log.args;
  return {
    transactionHash: normalizeHex32(receipt.transactionHash),
    blockNumber: toSafeNumber(receipt.blockNumber, "blockNumber"),
    logIndex: toSafeNumber(log.logIndex ?? 0, "logIndex"),
    escrowContract: escrow,
    lockId: normalizeHex32(args.lockId),
    senderAddress: normalizeAddress(args.sender),
    tokenAddress: normalizeAddress(args.token),
    amount: args.amount,
    stellarNoteCommitment: normalizeHex32(args.stellarNoteCommitment),
    complianceHint: normalizeHex32(args.complianceHint),
    nonce: args.nonce,
    destinationChainId: args.destinationChainId,
  };
}

export function buildLockWitnessFromReceipt(
  receipt: EvmReceiptLike,
  config: BuildLockWitnessConfig
): LockWitness {
  const locked = parseLockedEventFromReceipt(receipt, config.escrowContract);
  const witness = {
    version: 1,
    sourceChainId: config.sourceChainId,
    sourceBlockNumber: locked.blockNumber,
    sourceReceiptRoot: normalizeHex32(config.sourceReceiptRoot),
    txHash: locked.transactionHash,
    logIndex: locked.logIndex,
    lockId: locked.lockId,
    escrowContract: locked.escrowContract,
    senderAddress: locked.senderAddress,
    tokenAddress: locked.tokenAddress,
    amount: locked.amount.toString(),
    stellarNoteCommitment: locked.stellarNoteCommitment,
    complianceHint: locked.complianceHint,
    complianceRoot: normalizeHex32(config.complianceRoot),
    complianceMode: config.complianceMode,
    destinationChainId: toSafeNumber(
      locked.destinationChainId,
      "destinationChainId"
    ),
    cctpSettlement: normalizeCctpSettlement(config.cctpSettlement),
    expected: normalizeExpected(config.expected),
    complianceWitness: {
      valid: config.complianceWitnessValid ?? true,
      mode: config.complianceMode,
    },
  } satisfies LockWitness;

  return LockWitnessSchema.parse(witness);
}

function normalizeExpected(
  expected: LockWitnessExpectedConfig
): LockWitness["expected"] {
  return {
    sourceChainId: expected.sourceChainId,
    escrowContract: normalizeAddress(expected.escrowContract),
    tokenAddress: normalizeAddress(expected.tokenAddress),
    minAmount: expected.minAmount,
    maxAmount: expected.maxAmount,
    complianceRoot: normalizeHex32(expected.complianceRoot),
    destinationChainId: expected.destinationChainId,
    networkDomain: normalizeHex32(expected.networkDomain),
    expiresAtLedger: expected.expiresAtLedger,
    cctpSourceDomain: expected.cctpSourceDomain,
    cctpDestinationDomain: expected.cctpDestinationDomain,
    cctpMintRecipient: normalizeHex32(expected.cctpMintRecipient),
  };
}

function normalizeCctpSettlement(
  settlement: LockWitness["cctpSettlement"]
): LockWitness["cctpSettlement"] {
  return {
    sourceDomain: settlement.sourceDomain,
    destinationDomain: settlement.destinationDomain,
    nonce: normalizeHex32(settlement.nonce),
    messageHash: normalizeHex32(settlement.messageHash),
    attestationHash: normalizeHex32(settlement.attestationHash),
    mintRecipient: normalizeHex32(settlement.mintRecipient),
  };
}

function normalizeLog(log: EvmLogLike): Log {
  return {
    address: normalizeAddress(log.address),
    topics: [...log.topics] as Log["topics"],
    data: log.data,
    logIndex:
      log.logIndex === undefined || log.logIndex === null
        ? null
        : toSafeNumber(log.logIndex, "logIndex"),
  } as Log;
}

function normalizeAddress(address: Address): Address {
  return getAddress(address).toLowerCase() as Address;
}

function normalizeHex32(value: string): Hex {
  return value.toLowerCase() as Hex;
}

function toSafeNumber(value: number | bigint | string, label: string): number {
  let asBigInt: bigint;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new EvmClientError("UNSAFE_INTEGER", `${label} is not safe`);
    }
    return value;
  }
  if (typeof value === "bigint") {
    asBigInt = value;
  } else {
    asBigInt = BigInt(value);
  }
  if (asBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new EvmClientError("UNSAFE_INTEGER", `${label} is not safe`);
  }
  return Number(asBigInt);
}
