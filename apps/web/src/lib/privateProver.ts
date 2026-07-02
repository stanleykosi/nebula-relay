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

export interface PrivateProverWithdrawResult {
  poolId: string;
  ownerAddress: string;
  withdrawRecipient: string;
  amount: string;
  status?: string;
  txHash?: string;
  result: unknown;
  submittedAt: string;
}

export interface PrivateProverProgressEvent {
  flow?: string;
  stage?: string;
  message?: string;
}

const DEFAULT_RUNTIME_URL = "/private-prover-runtime/nebula-prover-host.html";
const DEFAULT_ASSET_BASE_URL = "/private-prover-runtime";
const DEFAULT_TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

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

export function normalizeBaseUnitAmount(input: string): string {
  const trimmed = input.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(trimmed)) {
    throw new Error("Amount must be an integer number of base units");
  }
  if (BigInt(trimmed) <= BigInt(0)) {
    throw new Error("Amount must be greater than zero");
  }
  return trimmed;
}

export function isLikelyStellarPublicKey(input: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(input.trim());
}

export function normalizeWithdrawRecipient(input: string): string {
  const trimmed = input.trim();
  if (!isLikelyStellarPublicKey(trimmed)) {
    throw new Error("Withdraw recipient must be a Stellar public key");
  }
  return trimmed;
}

function asset(name: PrivateProverAssetName, path: string) {
  return { name, path };
}

function readOptionalEnv(value: string | undefined): string | undefined {
  return value && value.trim() !== "" ? value : undefined;
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
