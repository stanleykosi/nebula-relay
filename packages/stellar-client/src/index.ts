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
  16: "PoolAdapterFailed",
  17: "WrongDestination",
  18: "VerifierRouterFailed",
} as const;

export type NebulaRelayErrorCode = keyof typeof nebulaRelayErrorNames;
export type Hex = `0x${string}`;

export interface ClaimArgs {
  claimant: string;
  seal: Hex;
  imageId: Hex;
  journal: Hex;
  poolPayload: Hex;
}

export interface BuildClaimTransactionParams {
  sourceAccount: StellarSdk.Account;
  contractId: string;
  networkPassphrase: string;
  claim: ClaimArgs;
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

export interface BuildAndPrepareClaimParams
  extends Omit<BuildClaimTransactionParams, "sourceAccount"> {
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
      | "INVALID_HEX",
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

  buildClaimTransaction(params: Omit<BuildClaimTransactionParams, "contractId">) {
    return buildClaimTransaction({
      ...params,
      contractId: this.contractId,
    });
  }

  claimOperation(claim: ClaimArgs): StellarSdk.xdr.Operation {
    return this.contract.call("claim", ...claimArgsToScVals(claim));
  }
}

export function claimArgsToScVals(claim: ClaimArgs): StellarSdk.xdr.ScVal[] {
  return [
    StellarSdk.Address.fromString(claim.claimant).toScVal(),
    bytesScVal(claim.seal),
    bytesScVal(claim.imageId),
    bytesScVal(claim.journal),
    bytesScVal(claim.poolPayload),
  ];
}

export function buildClaimOperation(
  contractId: string,
  claim: ClaimArgs
): StellarSdk.xdr.Operation {
  return new StellarSdk.Contract(contractId).call(
    "claim",
    ...claimArgsToScVals(claim)
  );
}

export function buildClaimTransaction(
  params: BuildClaimTransactionParams
): StellarSdk.Transaction {
  return new StellarSdk.TransactionBuilder(params.sourceAccount, {
    fee: params.fee ?? StellarSdk.BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(buildClaimOperation(params.contractId, params.claim))
    .setTimeout(params.timeoutSeconds ?? 180)
    .build();
}

export async function buildAndPrepareClaimTransaction(
  rpc: Pick<StellarRpcClient, "getAccount" | "simulateTransaction">,
  params: BuildAndPrepareClaimParams,
  options: SimulateOptions = {}
): Promise<PreparedTransaction> {
  const sourceAccount = await rpc.getAccount(params.sourceAddress);
  const transaction = buildClaimTransaction({
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
  return StellarSdk.nativeToScVal(hexToBuffer(hex), { type: "bytes" });
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

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
