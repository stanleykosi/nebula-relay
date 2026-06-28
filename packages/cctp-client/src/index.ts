import * as StellarSdk from "@stellar/stellar-sdk";
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  sha256,
  type Address,
  type Hex,
} from "viem";

export type Hex32 = `0x${string}`;

export const CCTP_STELLAR_DOMAIN = 27;

export const CCTP_DOMAIN_IDS = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  solana: 5,
  base: 6,
  polygon: 7,
  unichain: 10,
  linea: 11,
  codex: 12,
  sonic: 13,
  worldChain: 14,
  monad: 15,
  sei: 16,
  bnbSmartChain: 17,
  xdc: 18,
  hyperEvm: 19,
  ink: 21,
  plume: 22,
  starknet: 25,
  arc: 26,
  stellar: CCTP_STELLAR_DOMAIN,
  edge: 28,
  injective: 29,
  morph: 30,
  pharos: 31,
  cronos: 32,
} as const;

export const CCTP_FINALITY_THRESHOLDS = {
  fast: 1_000,
  standard: 2_000,
} as const;

export const CIRCLE_IRIS_API = {
  sandbox: "https://iris-api-sandbox.circle.com",
  mainnet: "https://iris-api.circle.com",
} as const;

export const STELLAR_CCTP_CONTRACTS = {
  testnet: {
    messageTransmitter:
      "CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY",
    tokenMessengerMinter:
      "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP",
    cctpForwarder:
      "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ",
  },
  mainnet: {
    messageTransmitter:
      "CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV",
    tokenMessengerMinter:
      "CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL",
    cctpForwarder:
      "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
  },
} as const;

export const cctpTokenMessengerV2Abi = [
  {
    type: "function",
    name: "depositForBurnWithHook",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export interface CctpBurnToStellarParams {
  tokenMessenger: Address;
  burnToken: Address;
  amount: bigint;
  maxFee: bigint;
  cctpForwarder: string;
  stellarRecipient: string;
  sourceDomain: number;
  minFinalityThreshold?: number;
  destinationDomain?: number;
  hookVersion?: number;
  hookPayload?: Hex;
}

export type CctpBurnWithHookArgs = readonly [
  bigint,
  number,
  Hex32,
  Address,
  Hex32,
  bigint,
  number,
  Hex,
];

export interface CctpBurnWithHookCall {
  address: Address;
  abi: typeof cctpTokenMessengerV2Abi;
  functionName: "depositForBurnWithHook";
  args: CctpBurnWithHookArgs;
  sourceDomain: number;
  destinationNetwork: "stellar";
}

export interface CctpMintAndForwardParams {
  cctpForwarderContractId: string;
  message: Hex;
  attestation: Hex;
}

export interface CctpSettlementBindingParams {
  sourceDomain: number;
  destinationDomain?: number;
  nonce: Hex32;
  message: Hex;
  attestation: Hex;
  mintRecipient: string;
}

export interface CctpSettlementBinding {
  sourceDomain: number;
  destinationDomain: number;
  nonce: Hex32;
  messageHash: Hex32;
  attestationHash: Hex32;
  mintRecipient: Hex32;
}

export interface BuildCctpMintAndForwardTransactionParams
  extends CctpMintAndForwardParams {
  sourceAccount: StellarSdk.Account;
  networkPassphrase: string;
  fee?: string;
  timeoutSeconds?: number;
}

export interface IrisMessagesParams {
  irisBaseUrl?: string;
  sourceDomain: number;
  transactionHash: Hex32;
}

export interface HttpResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: "GET"; headers: { Accept: "application/json" } }
) => Promise<HttpResponseLike>;

export interface PollCctpAttestationParams extends IrisMessagesParams {
  fetch: FetchLike;
  maxAttempts?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CompleteCctpAttestation {
  status: "complete";
  message: Hex;
  attestation: Hex;
  eventNonce?: string;
  cctpVersion?: number;
  raw: unknown;
}

export interface PendingCctpAttestation {
  status: "pending";
  raw: unknown;
}

export type CctpAttestation =
  | CompleteCctpAttestation
  | PendingCctpAttestation;

export class CctpClientError extends Error {
  constructor(
    readonly code:
      | "ATTESTATION_HTTP_ERROR"
      | "ATTESTATION_MALFORMED"
      | "ATTESTATION_TIMEOUT"
      | "INVALID_ADDRESS"
      | "INVALID_AMOUNT"
      | "INVALID_DOMAIN"
      | "INVALID_HEX"
      | "INVALID_STELLAR_CONTRACT"
      | "INVALID_STELLAR_RECIPIENT",
    message: string,
    readonly causeValue?: unknown
  ) {
    super(message);
    this.name = "CctpClientError";
  }
}

export function createCctpBurnToStellarCall(
  params: CctpBurnToStellarParams
): CctpBurnWithHookCall {
  const sourceDomain = normalizeDomain(params.sourceDomain, "sourceDomain");
  const destinationDomain = normalizeDomain(
    params.destinationDomain ?? CCTP_STELLAR_DOMAIN,
    "destinationDomain"
  );
  if (destinationDomain !== CCTP_STELLAR_DOMAIN) {
    throw new CctpClientError(
      "INVALID_DOMAIN",
      `destinationDomain must be Stellar CCTP domain ${CCTP_STELLAR_DOMAIN}`
    );
  }

  const cctpForwarder = stellarContractStrkeyToBytes32(params.cctpForwarder);
  const hookData = buildStellarForwarderHookData({
    recipient: params.stellarRecipient,
    version: params.hookVersion,
    payload: params.hookPayload,
  });

  return {
    address: normalizeAddress(params.tokenMessenger, "tokenMessenger"),
    abi: cctpTokenMessengerV2Abi,
    functionName: "depositForBurnWithHook",
    args: [
      normalizeAmount(params.amount, "amount", { allowZero: false }),
      destinationDomain,
      cctpForwarder,
      normalizeAddress(params.burnToken, "burnToken"),
      cctpForwarder,
      normalizeAmount(params.maxFee, "maxFee", { allowZero: true }),
      normalizeDomain(
        params.minFinalityThreshold ?? CCTP_FINALITY_THRESHOLDS.standard,
        "minFinalityThreshold"
      ),
      hookData,
    ],
    sourceDomain,
    destinationNetwork: "stellar",
  };
}

export function encodeCctpBurnWithHookData(
  call: Pick<CctpBurnWithHookCall, "abi" | "functionName" | "args">
): Hex {
  return encodeFunctionData({
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
  });
}

export function buildStellarForwarderHookData(params: {
  recipient: string;
  version?: number;
  payload?: Hex;
}): Hex {
  assertValidStellarRecipient(params.recipient);
  const recipientBytes = asciiBytes(params.recipient);
  const payloadBytes = params.payload
    ? hexToBytes(normalizeHex(params.payload, "hookPayload"))
    : new Uint8Array();
  const version = normalizeDomain(params.version ?? 1, "hookVersion");
  const header = new Uint8Array(32);
  writeU32Be(header, 24, version);
  writeU32Be(header, 28, recipientBytes.length);

  const hook = new Uint8Array(
    header.length + recipientBytes.length + payloadBytes.length
  );
  hook.set(header);
  hook.set(recipientBytes, header.length);
  hook.set(payloadBytes, header.length + recipientBytes.length);
  return bytesToHex(hook);
}

export function createCctpSettlementBinding(
  params: CctpSettlementBindingParams
): CctpSettlementBinding {
  return {
    sourceDomain: normalizeDomain(params.sourceDomain, "sourceDomain"),
    destinationDomain: normalizeDomain(
      params.destinationDomain ?? CCTP_STELLAR_DOMAIN,
      "destinationDomain"
    ),
    nonce: normalizeHex32(params.nonce, "nonce"),
    messageHash: sha256(normalizeHex(params.message, "message")) as Hex32,
    attestationHash: sha256(
      normalizeHex(params.attestation, "attestation")
    ) as Hex32,
    mintRecipient: stellarContractStrkeyToBytes32(params.mintRecipient),
  };
}

export function stellarContractStrkeyToBytes32(contractId: string): Hex32 {
  if (!StellarSdk.StrKey.isValidContract(contractId)) {
    throw new CctpClientError(
      "INVALID_STELLAR_CONTRACT",
      `invalid Stellar contract ID: ${contractId}`
    );
  }
  return bytesToHex(StellarSdk.StrKey.decodeContract(contractId)) as Hex32;
}

export function buildCctpMintAndForwardOperation(
  params: CctpMintAndForwardParams
): StellarSdk.xdr.Operation {
  assertValidStellarContract(params.cctpForwarderContractId);
  return new StellarSdk.Contract(params.cctpForwarderContractId).call(
    "mint_and_forward",
    bytesScVal(params.message),
    bytesScVal(params.attestation)
  );
}

export function buildCctpMintAndForwardTransaction(
  params: BuildCctpMintAndForwardTransactionParams
): StellarSdk.Transaction {
  return new StellarSdk.TransactionBuilder(params.sourceAccount, {
    fee: params.fee ?? StellarSdk.BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(buildCctpMintAndForwardOperation(params))
    .setTimeout(params.timeoutSeconds ?? 180)
    .build();
}

export function getIrisMessagesUrl(params: IrisMessagesParams): string {
  const base = (params.irisBaseUrl ?? CIRCLE_IRIS_API.sandbox).replace(/\/$/, "");
  const sourceDomain = normalizeDomain(params.sourceDomain, "sourceDomain");
  const transactionHash = normalizeHex32(params.transactionHash, "transactionHash");
  return `${base}/v2/messages/${sourceDomain}?transactionHash=${transactionHash}`;
}

export async function fetchCctpAttestationOnce(
  fetcher: FetchLike,
  params: IrisMessagesParams
): Promise<CctpAttestation> {
  const response = await fetcher(getIrisMessagesUrl(params), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (response.status === 404) {
    return { status: "pending", raw: { status: 404 } };
  }
  if (!response.ok) {
    const body = await response.text();
    throw new CctpClientError(
      "ATTESTATION_HTTP_ERROR",
      `Circle Iris attestation request failed with ${response.status}: ${
        response.statusText ?? body
      }`,
      body
    );
  }

  return parseIrisMessagesResponse(await response.json());
}

export async function pollCctpAttestation(
  params: PollCctpAttestationParams
): Promise<CompleteCctpAttestation> {
  const maxAttempts = params.maxAttempts ?? 60;
  const pollIntervalMs = params.pollIntervalMs ?? 2_000;
  const sleep = params.sleep ?? defaultSleep;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const attestation = await fetchCctpAttestationOnce(params.fetch, params);
    if (attestation.status === "complete") {
      return attestation;
    }
    if (attempt + 1 < maxAttempts) {
      await sleep(pollIntervalMs);
    }
  }

  throw new CctpClientError(
    "ATTESTATION_TIMEOUT",
    `Circle Iris attestation was not complete after ${maxAttempts} attempts`
  );
}

export function parseIrisMessagesResponse(raw: unknown): CctpAttestation {
  const messages = getRawMessages(raw);
  if (messages.length === 0) {
    return { status: "pending", raw };
  }

  const message = messages[0];
  const status = stringField(message, "status");
  if (status && status.toLowerCase() !== "complete") {
    return { status: "pending", raw };
  }

  const messageHex = stringField(message, "message");
  const attestationHex = stringField(message, "attestation");
  if (!messageHex || !attestationHex) {
    throw new CctpClientError(
      "ATTESTATION_MALFORMED",
      "Circle Iris response marked complete but omitted message or attestation",
      raw
    );
  }

  return {
    status: "complete",
    message: normalizeHex(messageHex, "message"),
    attestation: normalizeHex(attestationHex, "attestation"),
    eventNonce: stringField(message, "eventNonce"),
    cctpVersion: numberField(message, "cctpVersion"),
    raw,
  };
}

function normalizeAddress(value: Address, field: string): Address {
  if (!isAddress(value)) {
    throw new CctpClientError(
      "INVALID_ADDRESS",
      `invalid EVM address for ${field}: ${value}`
    );
  }
  return getAddress(value);
}

function normalizeDomain(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 4_294_967_295) {
    throw new CctpClientError(
      "INVALID_DOMAIN",
      `${field} must be a uint32-compatible integer`
    );
  }
  return value;
}

function normalizeAmount(
  value: bigint,
  field: string,
  options: { allowZero: boolean }
): bigint {
  if (value < 0n || (!options.allowZero && value === 0n)) {
    throw new CctpClientError(
      "INVALID_AMOUNT",
      `${field} must be ${options.allowZero ? "nonnegative" : "positive"}`
    );
  }
  return value;
}

function assertValidStellarContract(contractId: string): void {
  if (!StellarSdk.StrKey.isValidContract(contractId)) {
    throw new CctpClientError(
      "INVALID_STELLAR_CONTRACT",
      `invalid Stellar contract ID: ${contractId}`
    );
  }
}

function assertValidStellarRecipient(recipient: string): void {
  if (
    !StellarSdk.StrKey.isValidEd25519PublicKey(recipient) &&
    !StellarSdk.StrKey.isValidMed25519PublicKey(recipient) &&
    !StellarSdk.StrKey.isValidContract(recipient)
  ) {
    throw new CctpClientError(
      "INVALID_STELLAR_RECIPIENT",
      `invalid Stellar forward recipient: ${recipient}`
    );
  }
}

function getRawMessages(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!isRecord(raw)) {
    return [];
  }
  const messages = raw.messages;
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.filter(isRecord);
}

function stringField(
  raw: Record<string, unknown>,
  field: string
): string | undefined {
  const value = raw[field];
  return typeof value === "string" ? value : undefined;
}

function numberField(
  raw: Record<string, unknown>,
  field: string
): number | undefined {
  const value = raw[field];
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesScVal(hex: Hex): StellarSdk.xdr.ScVal {
  return StellarSdk.nativeToScVal(hexToBytes(normalizeHex(hex, "bytes")), {
    type: "bytes",
  });
}

function normalizeHex(hex: Hex | string, field: string): Hex {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(hex)) {
    throw new CctpClientError(
      "INVALID_HEX",
      `${field} must be 0x-prefixed even-length hex`
    );
  }
  return `0x${hex.slice(2).toLowerCase()}` as Hex;
}

function normalizeHex32(hex: Hex32, field: string): Hex32 {
  const normalized = normalizeHex(hex, field);
  if (normalized.length !== 66) {
    throw new CctpClientError(
      "INVALID_HEX",
      `${field} must be exactly 32 bytes`
    );
  }
  return normalized as Hex32;
}

function hexToBytes(hex: Hex): Uint8Array {
  const normalized = normalizeHex(hex, "hex");
  const bytes = new Uint8Array(normalized.length / 2 - 1);
  for (let i = 2; i < normalized.length; i += 2) {
    bytes[(i - 2) / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): Hex {
  let hex = "0x";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex as Hex;
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code > 0x7f) {
      throw new CctpClientError(
        "INVALID_STELLAR_RECIPIENT",
        "Stellar recipient StrKey must be ASCII"
      );
    }
    bytes[i] = code;
  }
  return bytes;
}

function writeU32Be(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
