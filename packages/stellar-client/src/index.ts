import * as StellarSdk from "@stellar/stellar-sdk";

export const nebulaRelayErrorNames = {
  1: "AlreadyInitialized",
  2: "NotInitialized",
  3: "Unauthorized",
  4: "Paused",
  5: "InvalidImageId",
  6: "InvalidProof",
  7: "InvalidJournal",
  8: "InvalidDomain",
  9: "SourceNotRegistered",
  10: "SourceInactive",
  11: "AmountOutOfBounds",
  12: "ComplianceRootInvalid",
  13: "ReceiptRootUnknown",
  14: "ReceiptRootExpired",
  15: "NullifierAlreadyClaimed",
  17: "WrongDestination",
  18: "VerifierRouterFailed",
  19: "InvalidConfig",
  20: "CctpSettlementFailed",
  21: "InvalidCctpSettlement",
  22: "PrivatePoolNotConfigured",
  23: "PrivatePoolFailed",
  24: "InvalidPrivatePoolDeposit",
  25: "InvalidSettlementAmount",
} as const;

export type NebulaRelayErrorCode = keyof typeof nebulaRelayErrorNames;
export type Hex = `0x${string}`;

const ZERO_HEX32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export interface PrivatePoolClaimArgs {
  seal: Hex;
  imageId: Hex;
  journal: Hex;
  cctpMessage: Hex;
  cctpAttestation: Hex;
  privateDeposit: StellarSdk.xdr.ScVal;
}

export interface UpstreamPrivatePoolPreparedTx {
  proof_uncompressed?: unknown;
  proofUncompressed?: unknown;
  ext_data?: unknown;
  extData?: unknown;
  prepared?: unknown;
}

export interface BuildPrivatePoolDepositScValParams {
  upstream: UpstreamPrivatePoolPreparedTx | unknown;
  expectedPoolId?: string;
  expectedSettlementAmount?: bigint | number | string;
  expectedNoteCommitment?: Hex;
  noteOutputIndex?: 0 | 1;
}

export interface PrivatePoolPreparedTxInspection {
  proofUncompressedBytes: number;
  recipient: string;
  extAmount: string;
  publicAmount: Hex;
  outputCommitments: readonly [Hex, Hex];
  selectedOutputIndex: 0 | 1;
  selectedNoteCommitment: Hex;
}

export interface BuildPrivatePoolClaimTransactionParams {
  sourceAccount: StellarSdk.Account;
  contractId: string;
  networkPassphrase: string;
  claim: PrivatePoolClaimArgs;
  fee?: string;
  timeoutSeconds?: number;
}

export interface PreparedTransaction {
  transaction: StellarSdk.Transaction;
  simulation: SimulationResponse;
}

export type SimulationResponse = Awaited<
  ReturnType<StellarSdk.rpc.Server["simulateTransaction"]>
>;

export interface StellarRpcClient {
  getAccount(accountId: string): Promise<StellarSdk.Account>;
  simulateTransaction(transaction: StellarSdk.Transaction): Promise<SimulationResponse>;
  sendTransaction(transaction: StellarSdk.Transaction): Promise<SendTransactionResponse>;
  getTransaction(hash: string): Promise<GetTransactionResponse>;
}

export interface SendTransactionResponse {
  status: string;
  hash: string;
  errorResult?: string;
}

export interface GetTransactionResponse {
  status: string;
  returnValue?: StellarSdk.xdr.ScVal;
  resultXdr?: string;
}

export interface BuildAndPreparePrivatePoolClaimParams
  extends Omit<BuildPrivatePoolClaimTransactionParams, "sourceAccount"> {
  sourceAddress: string;
}

export interface SimulateOptions {
  assembleTransaction?: (
    transaction: StellarSdk.Transaction,
    simulation: SimulationResponse
  ) => StellarSdk.Transaction;
}

export interface SubmitOptions {
  pollIntervalMs?: number;
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SubmitResult {
  hash: string;
  status: string;
  returnValue?: StellarSdk.xdr.ScVal;
}

export interface WalletSignOptions {
  networkPassphrase: string;
  address?: string;
}

export type WalletSignResult =
  | string
  | {
      signedTxXdr?: string;
      signedXDR?: string;
      error?: { message?: string } | string;
    };

export type WalletSigner =
  | ((xdr: string, options: WalletSignOptions) => Promise<WalletSignResult>)
  | {
      signTransaction(
        xdr: string,
        options: WalletSignOptions
      ): Promise<WalletSignResult>;
    };

export class StellarClientError extends Error {
  constructor(
    readonly code:
      | "SIMULATION_FAILED"
      | "SUBMISSION_FAILED"
      | "CONFIRMATION_FAILED"
      | "CONFIRMATION_TIMEOUT"
      | "WALLET_SIGNING_FAILED"
      | "INVALID_HEX"
      | "INVALID_PRIVATE_POOL_DEPOSIT",
    message: string,
    readonly causeValue?: unknown
  ) {
    super(message);
    this.name = "StellarClientError";
  }
}

export class NebulaRelayClient {
  private readonly contract: StellarSdk.Contract;

  constructor(readonly contractId: string) {
    this.contract = new StellarSdk.Contract(contractId);
  }

  buildPrivatePoolClaimTransaction(
    params: Omit<BuildPrivatePoolClaimTransactionParams, "contractId">
  ) {
    return buildPrivatePoolClaimTransaction({
      ...params,
      contractId: this.contractId,
    });
  }

  privatePoolClaimOperation(claim: PrivatePoolClaimArgs): StellarSdk.xdr.Operation {
    return this.contract.call(
      "claim_to_private_pool",
      ...privatePoolClaimArgsToScVals(claim)
    );
  }
}

export function privatePoolClaimArgsToScVals(
  claim: PrivatePoolClaimArgs
): StellarSdk.xdr.ScVal[] {
  return [
    bytesScVal(claim.seal),
    bytesScVal(claim.imageId),
    bytesScVal(claim.journal),
    bytesScVal(claim.cctpMessage),
    bytesScVal(claim.cctpAttestation),
    claim.privateDeposit,
  ];
}

export function buildPrivatePoolDepositScVal(
  params: BuildPrivatePoolDepositScValParams
): StellarSdk.xdr.ScVal {
  const parsed = readPrivatePoolPreparedTx(params);

  const proofScVal = sortedMap([
    mapEntry("a", bytesScValFromBytes(parsed.proofUncompressed.slice(0, 64))),
    mapEntry("b", bytesScValFromBytes(parsed.proofUncompressed.slice(64, 192))),
    mapEntry("c", bytesScValFromBytes(parsed.proofUncompressed.slice(192, 256))),
  ]);
  const inputNullifiers = arrayField(
    getFirst(parsed.publicInputs, ["input_nullifiers", "inputNullifiers"]),
    "input_nullifiers"
  ).map((value, index) =>
    u256ScVal(normalizeFieldHex(value, `input_nullifiers[${index}]`))
  );

  const privateProofScVal = sortedMap([
    mapEntry(
      "asp_membership_root",
      u256ScVal(
        normalizeFieldHex(
          getFirst(parsed.publicInputs, ["asp_membership_root", "aspMembershipRoot"]),
          "asp_membership_root"
        )
      )
    ),
    mapEntry(
      "asp_non_membership_root",
      u256ScVal(
        normalizeFieldHex(
          getFirst(parsed.publicInputs, [
            "asp_non_membership_root",
            "aspNonMembershipRoot",
          ]),
          "asp_non_membership_root"
        )
      )
    ),
    mapEntry(
      "ext_data_hash",
      bytesScValFromBytes(
        bytesFromUnknown(
          getFirst(parsed.publicInputs, ["ext_data_hash_be", "extDataHashBe"]),
          "ext_data_hash_be",
          32
        )
      )
    ),
    mapEntry("input_nullifiers", StellarSdk.xdr.ScVal.scvVec(inputNullifiers)),
    mapEntry("output_commitment0", u256ScVal(parsed.outputCommitment0)),
    mapEntry("output_commitment1", u256ScVal(parsed.outputCommitment1)),
    mapEntry("proof", proofScVal),
    mapEntry("public_amount", u256ScVal(parsed.publicAmount)),
    mapEntry(
      "root",
      u256ScVal(
        normalizeFieldHex(getFirst(parsed.publicInputs, ["pool_root", "poolRoot", "root"]), "root")
      )
    ),
  ]);

  const encryptedOutput0 = bytesFromUnknown(
    getFirst(parsed.extData, ["encrypted_output0", "encryptedOutput0"]),
    "encrypted_output0"
  );
  const encryptedOutput1 = bytesFromUnknown(
    getFirst(parsed.extData, ["encrypted_output1", "encryptedOutput1"]),
    "encrypted_output1"
  );
  if (encryptedOutput0.length === 0 && encryptedOutput1.length === 0) {
    throw privatePoolError("private pool deposit must include encrypted output data");
  }
  const extDataScVal = sortedMap([
    mapEntry("encrypted_output0", bytesScValFromBytes(encryptedOutput0)),
    mapEntry("encrypted_output1", bytesScValFromBytes(encryptedOutput1)),
    mapEntry("ext_amount", i256ScVal(parsed.extAmount)),
    mapEntry("recipient", StellarSdk.Address.fromString(parsed.recipient).toScVal()),
  ]);

  return sortedMap([
    mapEntry("ext_data", extDataScVal),
    mapEntry("proof", privateProofScVal),
  ]);
}

export function inspectPrivatePoolPreparedTx(
  params: BuildPrivatePoolDepositScValParams
): PrivatePoolPreparedTxInspection {
  const parsed = readPrivatePoolPreparedTx(params);
  return {
    proofUncompressedBytes: parsed.proofUncompressed.length,
    recipient: parsed.recipient,
    extAmount: parsed.extAmount.toString(),
    publicAmount: parsed.publicAmount,
    outputCommitments: [parsed.outputCommitment0, parsed.outputCommitment1],
    selectedOutputIndex: parsed.selectedOutputIndex,
    selectedNoteCommitment: parsed.selectedNoteCommitment,
  };
}

export function privatePoolDepositScValToXdr(
  params: BuildPrivatePoolDepositScValParams
): string {
  return buildPrivatePoolDepositScVal(params).toXDR("base64");
}

interface ParsedPrivatePoolPreparedTx {
  proofUncompressed: Uint8Array;
  extData: Record<string, unknown>;
  publicInputs: Record<string, unknown>;
  outputCommitment0: Hex;
  outputCommitment1: Hex;
  selectedOutputIndex: 0 | 1;
  selectedNoteCommitment: Hex;
  extAmount: bigint;
  recipient: string;
  publicAmount: Hex;
}

function readPrivatePoolPreparedTx(
  params: BuildPrivatePoolDepositScValParams
): ParsedPrivatePoolPreparedTx {
  const prepared = asRecord(params.upstream, "upstream prepared transaction");
  const proofUncompressed = bytesFromUnknown(
    getFirst(prepared, ["proof_uncompressed", "proofUncompressed"]),
    "proof_uncompressed"
  );
  if (proofUncompressed.length !== 256) {
    throw privatePoolError(
      `proof_uncompressed must be 256 bytes, got ${proofUncompressed.length}`
    );
  }

  const extData = asRecord(
    getFirst(prepared, ["ext_data", "extData"]),
    "ext_data"
  );
  const publicInputs = asRecord(
    getFirst(prepared, ["prepared", "public", "publicInputs"]),
    "prepared"
  );
  const outputCommitments = getFirst(publicInputs, [
    "output_commitments",
    "outputCommitments",
  ]);
  const outputCommitment0 = normalizeFieldHex(
    getFirst(
      publicInputs,
      ["output_commitment0", "outputCommitment0"],
      () => arrayItem(outputCommitments, 0, "output_commitments")
    ),
    "output_commitment0"
  );
  const outputCommitment1 = normalizeFieldHex(
    getFirst(
      publicInputs,
      ["output_commitment1", "outputCommitment1"],
      () => arrayItem(outputCommitments, 1, "output_commitments")
    ),
    "output_commitment1"
  );
  const extAmount = parseI128(
    getFirst(extData, ["ext_amount", "extAmount"]),
    "ext_amount"
  );
  const recipient = stringField(
    getFirst(extData, ["recipient"]),
    "recipient"
  );
  const publicAmount = normalizeFieldHex(
    getFirst(publicInputs, ["public_amount", "publicAmount"]),
    "public_amount"
  );

  if (params.expectedPoolId && recipient !== params.expectedPoolId) {
    throw privatePoolError(
      `private pool recipient mismatch: got ${recipient}, expected ${params.expectedPoolId}`
    );
  }
  if (params.expectedSettlementAmount !== undefined) {
    const expected = parseI128(
      params.expectedSettlementAmount,
      "expectedSettlementAmount"
    );
    if (extAmount !== expected) {
      throw privatePoolError(
        `private pool ext_amount mismatch: got ${extAmount}, expected ${expected}`
      );
    }
    if (publicAmount !== bigintToHex32(expected)) {
      throw privatePoolError(
        "private pool public_amount does not match settlement amount"
      );
    }
  }
  if (params.expectedNoteCommitment) {
    const expectedNote = normalizeHex32(
      params.expectedNoteCommitment,
      "expectedNoteCommitment"
    );
    if (outputCommitment0 !== expectedNote && outputCommitment1 !== expectedNote) {
      throw privatePoolError(
        "private pool output commitments do not include the Nebula note commitment"
      );
    }
  }

  const selectedOutputIndex = params.noteOutputIndex ?? 0;
  if (selectedOutputIndex !== 0 && selectedOutputIndex !== 1) {
    throw privatePoolError("noteOutputIndex must be 0 or 1");
  }
  const selectedNoteCommitment =
    selectedOutputIndex === 0 ? outputCommitment0 : outputCommitment1;
  if (selectedNoteCommitment === ZERO_HEX32) {
    throw privatePoolError(
      `selected private-pool output commitment ${selectedOutputIndex} is zero`
    );
  }

  return {
    proofUncompressed,
    extData,
    publicInputs,
    outputCommitment0,
    outputCommitment1,
    selectedOutputIndex,
    selectedNoteCommitment,
    extAmount,
    recipient,
    publicAmount,
  };
}

export function buildPrivatePoolClaimOperation(
  contractId: string,
  claim: PrivatePoolClaimArgs
): StellarSdk.xdr.Operation {
  return new StellarSdk.Contract(contractId).call(
    "claim_to_private_pool",
    ...privatePoolClaimArgsToScVals(claim)
  );
}

export function buildPrivatePoolClaimTransaction(
  params: BuildPrivatePoolClaimTransactionParams
): StellarSdk.Transaction {
  return new StellarSdk.TransactionBuilder(params.sourceAccount, {
    fee: params.fee ?? StellarSdk.BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(buildPrivatePoolClaimOperation(params.contractId, params.claim))
    .setTimeout(params.timeoutSeconds ?? 180)
    .build();
}

export async function buildAndPreparePrivatePoolClaimTransaction(
  rpc: Pick<StellarRpcClient, "getAccount" | "simulateTransaction">,
  params: BuildAndPreparePrivatePoolClaimParams,
  options: SimulateOptions = {}
): Promise<PreparedTransaction> {
  const sourceAccount = await rpc.getAccount(params.sourceAddress);
  const transaction = buildPrivatePoolClaimTransaction({
    ...params,
    sourceAccount,
  });
  return simulateAndAssembleTransaction(rpc, transaction, options);
}

export async function simulateAndAssembleTransaction(
  rpc: Pick<StellarRpcClient, "simulateTransaction">,
  transaction: StellarSdk.Transaction,
  options: SimulateOptions = {}
): Promise<PreparedTransaction> {
  const simulation = await rpc.simulateTransaction(transaction);
  if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
    throw new StellarClientError(
      "SIMULATION_FAILED",
      `Simulation failed: ${simulation.error}`,
      simulation
    );
  }

  const assemble =
    options.assembleTransaction ??
    ((tx: StellarSdk.Transaction, sim: SimulationResponse) =>
      StellarSdk.rpc.assembleTransaction(tx, sim).build());
  return {
    transaction: assemble(transaction, simulation),
    simulation,
  };
}

export async function signTransactionXdr(
  transactionXdr: string,
  signer: WalletSigner,
  options: WalletSignOptions
): Promise<string> {
  const result =
    typeof signer === "function"
      ? await signer(transactionXdr, options)
      : await signer.signTransaction(transactionXdr, options);
  if (typeof result === "string") {
    return result;
  }
  if (result.error) {
    const message =
      typeof result.error === "string"
        ? result.error
        : result.error.message ?? "wallet rejected signing";
    throw new StellarClientError("WALLET_SIGNING_FAILED", message, result);
  }
  const signed = result.signedTxXdr ?? result.signedXDR;
  if (!signed) {
    throw new StellarClientError(
      "WALLET_SIGNING_FAILED",
      "wallet did not return a signed transaction XDR",
      result
    );
  }
  return signed;
}

export async function signPreparedTransaction(
  prepared: PreparedTransaction,
  signer: WalletSigner,
  networkPassphrase: string,
  address?: string
): Promise<string> {
  return signTransactionXdr(prepared.transaction.toXDR(), signer, {
    networkPassphrase,
    address,
  });
}

export async function submitSignedTransaction(
  rpc: Pick<StellarRpcClient, "sendTransaction" | "getTransaction">,
  signedXdr: string,
  networkPassphrase: string,
  options: SubmitOptions = {}
): Promise<SubmitResult> {
  const transaction = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    networkPassphrase
  );
  if (!(transaction instanceof StellarSdk.Transaction)) {
    throw new StellarClientError(
      "SUBMISSION_FAILED",
      "fee-bump transactions are not supported by this helper"
    );
  }

  const response = await rpc.sendTransaction(transaction);
  if (response.status === "ERROR") {
    throw new StellarClientError(
      "SUBMISSION_FAILED",
      toReadableStellarError(response.errorResult ?? response.status),
      response
    );
  }

  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const maxPolls = options.maxPolls ?? 30;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const result = await rpc.getTransaction(response.hash);
    if (result.status === "SUCCESS") {
      return {
        hash: response.hash,
        status: result.status,
        returnValue: result.returnValue,
      };
    }
    if (result.status !== "NOT_FOUND") {
      throw new StellarClientError(
        "CONFIRMATION_FAILED",
        toReadableStellarError(result.status),
        result
      );
    }
    await sleep(pollIntervalMs);
  }

  throw new StellarClientError(
    "CONFIRMATION_TIMEOUT",
    `transaction ${response.hash} was not confirmed after ${maxPolls} polls`
  );
}

export function toReadableStellarError(error: unknown): string {
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : JSON.stringify(error);
  const contractCode = /#(\d+)/.exec(text)?.[1];
  if (contractCode) {
    const parsed = Number(contractCode);
    if (isNebulaRelayErrorCode(parsed)) {
      return `NebulaRelay ${nebulaRelayErrorNames[parsed]} (#${parsed})`;
    }
  }
  return text;
}

export function isNebulaRelayErrorCode(
  code: number
): code is NebulaRelayErrorCode {
  return code in nebulaRelayErrorNames;
}

function bytesScVal(hex: Hex): StellarSdk.xdr.ScVal {
  return bytesScValFromBytes(hexToBuffer(hex));
}

function hexToBuffer(hex: Hex): Uint8Array {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(hex)) {
    throw new StellarClientError("INVALID_HEX", `invalid hex string: ${hex}`);
  }
  const bytes = new Uint8Array(hex.length / 2 - 1);
  for (let i = 2; i < hex.length; i += 2) {
    bytes[(i - 2) / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesScValFromBytes(bytes: Uint8Array): StellarSdk.xdr.ScVal {
  return StellarSdk.nativeToScVal(bytes, { type: "bytes" });
}

function sortedMap(entries: StellarSdk.xdr.ScMapEntry[]): StellarSdk.xdr.ScVal {
  entries.sort((a, b) => String(a.key().sym()).localeCompare(String(b.key().sym())));
  return StellarSdk.xdr.ScVal.scvMap(entries);
}

function mapEntry(
  key: string,
  val: StellarSdk.xdr.ScVal
): StellarSdk.xdr.ScMapEntry {
  return new StellarSdk.xdr.ScMapEntry({
    key: StellarSdk.xdr.ScVal.scvSymbol(key),
    val,
  });
}

function u256ScVal(hex: Hex): StellarSdk.xdr.ScVal {
  const value = BigInt(hex);
  const mask = (1n << 64n) - 1n;
  return StellarSdk.xdr.ScVal.scvU256(
    new StellarSdk.xdr.UInt256Parts({
      hiHi: uint64((value >> 192n) & mask),
      hiLo: uint64((value >> 128n) & mask),
      loHi: uint64((value >> 64n) & mask),
      loLo: uint64(value & mask),
    })
  );
}

function i256ScVal(value: bigint): StellarSdk.xdr.ScVal {
  const low = BigInt.asUintN(128, value);
  const mask = (1n << 64n) - 1n;
  return StellarSdk.xdr.ScVal.scvI256(
    new StellarSdk.xdr.Int256Parts({
      hiHi: int64(value < 0n ? -1n : 0n),
      hiLo: uint64(value < 0n ? mask : 0n),
      loHi: uint64((low >> 64n) & mask),
      loLo: uint64(low & mask),
    })
  );
}

function uint64(value: bigint): StellarSdk.xdr.Uint64 {
  return StellarSdk.xdr.Uint64.fromString(value.toString());
}

function int64(value: bigint): StellarSdk.xdr.Int64 {
  return StellarSdk.xdr.Int64.fromString(value.toString());
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw privatePoolError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function getFirst(
  record: Record<string, unknown>,
  names: string[],
  deriveValue?: () => unknown
): unknown {
  for (const name of names) {
    if (record[name] !== undefined) {
      return record[name];
    }
  }
  if (deriveValue) {
    return deriveValue();
  }
  throw privatePoolError(`missing ${names[0]}`);
}

function arrayField(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw privatePoolError(`${field} must be an array`);
  }
  return value;
}

function arrayItem(value: unknown, index: number, field: string): unknown {
  const array = arrayField(value, field);
  if (array[index] === undefined) {
    throw privatePoolError(`${field}[${index}] is required`);
  }
  return array[index];
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw privatePoolError(`${field} must be a non-empty string`);
  }
  return value;
}

function bytesFromUnknown(
  value: unknown,
  field: string,
  expectedLength?: number
): Uint8Array {
  let bytes: Uint8Array;
  if (Array.isArray(value)) {
    bytes = new Uint8Array(
      value.map((item) => {
        if (!Number.isInteger(item) || item < 0 || item > 255) {
          throw privatePoolError(`${field} contains a non-byte value`);
        }
        return item;
      })
    );
  } else if (typeof value === "string") {
    bytes = hexToBuffer(normalizeHex(value, field));
  } else if (value instanceof Uint8Array) {
    bytes = value;
  } else {
    throw privatePoolError(`${field} must be a byte array or 0x hex string`);
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw privatePoolError(
      `${field} must be ${expectedLength} bytes, got ${bytes.length}`
    );
  }
  return bytes;
}

function normalizeFieldHex(value: unknown, field: string): Hex {
  if (Array.isArray(value) || value instanceof Uint8Array) {
    const bytes = bytesFromUnknown(value, field, 32);
    return bytesToHex(bytes);
  }
  if (typeof value === "bigint" || typeof value === "number") {
    return bigintToHex32(parseU256(value, field));
  }
  if (typeof value !== "string") {
    throw privatePoolError(`${field} must be a 32-byte field value`);
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return value.toLowerCase() as Hex;
  }
  if (/^[0-9]+$/.test(value)) {
    return bigintToHex32(BigInt(value));
  }
  throw privatePoolError(`${field} must be 0x-prefixed 32-byte hex or decimal`);
}

function normalizeHex32(value: Hex, field: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw privatePoolError(`${field} must be 32-byte 0x hex`);
  }
  return value.toLowerCase() as Hex;
}

function normalizeHex(value: string, field: string): Hex {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw privatePoolError(`${field} must be 0x-prefixed hex`);
  }
  return value as Hex;
}

function parseI128(value: unknown, field: string): bigint {
  let parsed: bigint;
  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw privatePoolError(`${field} must be a safe integer`);
    }
    parsed = BigInt(value);
  } else if (typeof value === "string" && /^-?[0-9]+$/.test(value)) {
    parsed = BigInt(value);
  } else {
    throw privatePoolError(`${field} must be an integer`);
  }
  const min = -(1n << 127n);
  const max = (1n << 127n) - 1n;
  if (parsed < min || parsed > max) {
    throw privatePoolError(`${field} is outside i128 range`);
  }
  return parsed;
}

function parseU256(value: bigint | number, field: string): bigint {
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed < 0n || parsed >= 1n << 256n) {
    throw privatePoolError(`${field} is outside u256 range`);
  }
  return parsed;
}

function bigintToHex32(value: bigint): Hex {
  if (value < 0n || value >= 1n << 256n) {
    throw privatePoolError("value is outside u256 range");
  }
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}` as Hex;
}

function privatePoolError(message: string): StellarClientError {
  return new StellarClientError("INVALID_PRIVATE_POOL_DEPOSIT", message);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
