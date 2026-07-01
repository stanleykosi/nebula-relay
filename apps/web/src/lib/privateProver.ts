import { scValToNative, xdr } from "@stellar/stellar-sdk";

export type PrivateProverAssetName =
  | "wasm-facade"
  | "web-module"
  | "storage-worker"
  | "prover-worker"
  | "policy-wasm"
  | "policy-r1cs"
  | "disclosure-wasm"
  | "disclosure-r1cs";

export interface PrivateProverAssetStatus {
  name: PrivateProverAssetName;
  path: string;
  ok: boolean;
  status?: number;
}

export interface PrivateProverConfig {
  assetBaseUrl: string;
  runtimeUrl: string;
  stellarRpcUrl: string;
  bootnodeUrl?: string;
  networkPassphrase: string;
  poolId: string;
  aspMembershipContractId: string;
  privatePaymentsDeploymentLedger: number;
}

export interface PrivateProverPreparedPublic {
  poolRoot?: string;
  inputNullifiers?: string[];
  outputCommitments?: string[];
  output_commitments?: string[];
  outputCommitment0?: string;
  output_commitment0?: string;
  outputCommitment1?: string;
  output_commitment1?: string;
  publicAmount?: string;
  public_amount?: string;
  extDataHashBe?: number[] | string;
  ext_data_hash_be?: number[] | string;
  aspMembershipRoot?: string;
  asp_membership_root?: string;
  aspNonMembershipRoot?: string;
  asp_non_membership_root?: string;
}

export interface PreparedProverTx {
  proofUncompressed?: number[];
  proof_uncompressed?: number[];
  extData: unknown;
  ext_data?: unknown;
  prepared?: PrivateProverPreparedPublic;
  public?: PrivateProverPreparedPublic;
  publicInputs?: PrivateProverPreparedPublic;
  sorobanTx?: unknown;
  soroban_tx?: unknown;
}

export interface PrivateProverResult {
  preparedProverTx: PreparedProverTx;
  outputCommitment: string;
  amount: string;
  poolId: string;
  generatedAt: string;
}

export interface PrivateProverProgressEvent {
  flow?: string;
  stage?: string;
  message?: string;
}

export interface AspMembershipLeafEvent {
  id: string;
  ledger: number;
  leaf: string;
  index: string;
  root: string;
  txHash?: string;
}

interface FindAspMembershipLeafEventOptions {
  rpcUrl: string;
  contractId: string;
  startLedger: number;
  leaf: string;
  maxPages?: number;
  pageLimit?: number;
}

const DEFAULT_RUNTIME_URL = "/private-prover-runtime/nebula-prover-host.html";
const DEFAULT_ASSET_BASE_URL = "/private-prover-runtime";
const DEFAULT_TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const DEFAULT_ASP_MEMBERSHIP_CONTRACT_ID =
  "CCCZVCAZJNJBXESBNA5NSO2DUWXB3EAE2WASTTAWJL3TI7ATYEMP6HSB";
const DEFAULT_PRIVATE_PAYMENTS_DEPLOYMENT_LEDGER = 3369482;

export function privateProverConfig(): PrivateProverConfig {
  const assetBaseUrl =
    process.env.NEXT_PUBLIC_PRIVATE_PROVER_ASSET_BASE_URL ??
    DEFAULT_ASSET_BASE_URL;
  return {
    assetBaseUrl: normalizeBaseUrl(assetBaseUrl),
    runtimeUrl:
      process.env.NEXT_PUBLIC_PRIVATE_PROVER_RUNTIME_URL ??
      DEFAULT_RUNTIME_URL,
    stellarRpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? "",
    bootnodeUrl: readOptionalEnv(process.env.NEXT_PUBLIC_PRIVATE_PROVER_BOOTNODE_URL),
    networkPassphrase:
      process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
      DEFAULT_TESTNET_PASSPHRASE,
    poolId: readRequiredPublicEnv(process.env.NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID),
    aspMembershipContractId:
      readOptionalEnv(process.env.NEXT_PUBLIC_PRIVATE_PAYMENTS_ASP_MEMBERSHIP_ID) ??
      DEFAULT_ASP_MEMBERSHIP_CONTRACT_ID,
    privatePaymentsDeploymentLedger: readOptionalPositiveInteger(
      process.env.NEXT_PUBLIC_PRIVATE_PAYMENTS_DEPLOYMENT_LEDGER,
      DEFAULT_PRIVATE_PAYMENTS_DEPLOYMENT_LEDGER
    ),
  };
}

export function privateProverAssetPaths(assetBaseUrl: string) {
  const base = normalizeBaseUrl(assetBaseUrl);
  return [
    asset("wasm-facade", `${base}/js/wasm-facade.js`),
    asset("web-module", `${base}/js/web.js`),
    asset("storage-worker", `${base}/js/storage-worker.js`),
    asset("prover-worker", `${base}/js/prover-worker.js`),
    asset("policy-wasm", `${base}/circuits/policy_tx_2_2.wasm`),
    asset("policy-r1cs", `${base}/circuits/policy_tx_2_2.r1cs`),
    asset(
      "disclosure-wasm",
      `${base}/circuits/selectiveDisclosure_1.wasm`
    ),
    asset(
      "disclosure-r1cs",
      `${base}/circuits/selectiveDisclosure_1.r1cs`
    ),
  ] satisfies Array<{ name: PrivateProverAssetName; path: string }>;
}

export async function checkPrivateProverAssets(
  assetBaseUrl: string
): Promise<PrivateProverAssetStatus[]> {
  return Promise.all(
    privateProverAssetPaths(assetBaseUrl).map(async ({ name, path }) => {
      try {
        const response = await fetch(path, { method: "HEAD", cache: "no-store" });
        return { name, path, ok: response.ok, status: response.status };
      } catch {
        return { name, path, ok: false };
      }
    })
  );
}

export function extractOutputCommitment(prepared: unknown): string {
  if (prepared === null) {
    throw new Error(
      "Private Payments returned no PreparedProverTx. The wallet is not registered in the ASP membership tree yet."
    );
  }
  const record = asRecord(prepared, "PreparedProverTx");
  const publicInputs = asRecord(
    getFirst(record, ["prepared", "public", "publicInputs"]),
    "PreparedProverTx public inputs"
  );
  const outputCommitments = getOptional(publicInputs, [
    "outputCommitments",
    "output_commitments",
  ]);
  const commitment = getOptional(publicInputs, [
    "outputCommitment0",
    "output_commitment0",
  ]) ?? arrayItem(outputCommitments, 0);
  if (typeof commitment !== "string" || commitment.trim() === "") {
    throw new Error(
      "PreparedProverTx is missing the first output commitment; checked prepared.outputCommitments[0], prepared.output_commitments[0], outputCommitment0, and output_commitment0."
    );
  }
  return commitment;
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    return DEFAULT_ASSET_BASE_URL;
  }
  return trimmed.replace(/\/+$/, "");
}

export function decodeSignatureBytes(input: string): number[] {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new Error("Signature is required");
  }
  if (/^(0x)?[0-9a-fA-F]+$/.test(trimmed) && trimmed.replace(/^0x/, "").length % 2 === 0) {
    const hex = trimmed.replace(/^0x/, "");
    return Array.from({ length: hex.length / 2 }, (_, index) =>
      Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    );
  }
  const binary = globalThis.atob(trimmed);
  return Array.from(binary, (char) => char.charCodeAt(0));
}

export async function findAspMembershipLeafEvent({
  rpcUrl,
  contractId,
  startLedger,
  leaf,
  maxPages = 8,
  pageLimit = 200,
}: FindAspMembershipLeafEventOptions): Promise<AspMembershipLeafEvent | undefined> {
  const expectedLeaf = normalizeFieldDecimal(leaf);
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const params: Record<string, unknown> = {
      filters: [
        {
          type: "contract",
          contractIds: [contractId],
          topics: [["**"]],
        },
      ],
      pagination: cursor ? { cursor, limit: pageLimit } : { limit: pageLimit },
    };
    if (!cursor) {
      params.startLedger = startLedger;
    }

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `nebula-asp-${page}`,
        method: "getEvents",
        params,
      }),
    });
    if (!response.ok) {
      throw new Error(`Stellar RPC getEvents failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as StellarRpcResponse;
    if (payload.error) {
      throw new Error(
        `Stellar RPC getEvents failed: ${payload.error.message ?? payload.error.code}`
      );
    }

    const result = payload.result;
    if (!result?.events?.length) {
      return undefined;
    }

    for (const event of result.events) {
      if (event.contractId !== contractId || !event.value) {
        continue;
      }
      const decoded = decodeLeafAddedEvent(event);
      if (decoded?.leaf === expectedLeaf) {
        return decoded;
      }
    }

    if (!result.cursor || result.cursor === cursor) {
      return undefined;
    }
    cursor = result.cursor;
  }

  return undefined;
}

function asset(name: PrivateProverAssetName, path: string) {
  return { name, path };
}

function readOptionalEnv(value: string | undefined): string | undefined {
  return value && value.trim() !== "" ? value : undefined;
}

function readOptionalPositiveInteger(
  value: string | undefined,
  fallback: number
): number {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readRequiredPublicEnv(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed && trimmed !== "TBD" ? trimmed : "";
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function getFirst(
  record: Record<string, unknown>,
  keys: readonly string[]
): unknown {
  const value = getOptional(record, keys);
  if (value === undefined) {
    throw new Error(`${keys[0]} is required`);
  }
  return value;
}

function getOptional(
  record: Record<string, unknown>,
  keys: readonly string[]
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

function arrayItem(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : undefined;
}

interface StellarRpcResponse {
  result?: {
    events?: StellarRpcEvent[];
    cursor?: string;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

interface StellarRpcEvent {
  id: string;
  ledger: number;
  contractId: string;
  txHash?: string;
  value?: string;
}

function decodeLeafAddedEvent(
  event: StellarRpcEvent
): AspMembershipLeafEvent | undefined {
  let decoded: unknown;
  try {
    decoded = scValToNative(xdr.ScVal.fromXDR(event.value ?? "", "base64"));
  } catch {
    return undefined;
  }
  if (!isRecord(decoded)) {
    return undefined;
  }
  const leaf = fieldToDecimal(decoded.leaf);
  const index = fieldToDecimal(decoded.index);
  const root = fieldToDecimal(decoded.root);
  if (!leaf || !index || !root) {
    return undefined;
  }
  return {
    id: event.id,
    ledger: event.ledger,
    txHash: event.txHash,
    leaf,
    index,
    root,
  };
}

function normalizeFieldDecimal(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("0x") ? BigInt(trimmed).toString() : BigInt(trimmed).toString();
}

function fieldToDecimal(value: unknown): string | undefined {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value.toString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    return normalizeFieldDecimal(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
