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
  publicAmount?: string;
  extDataHashBe?: number[] | string;
  aspMembershipRoot?: string;
  aspNonMembershipRoot?: string;
}

export interface PreparedProverTx {
  proofUncompressed: number[];
  extData: unknown;
  prepared: PrivateProverPreparedPublic;
  sorobanTx?: unknown;
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
    poolId: process.env.NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID ?? "",
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

export function extractOutputCommitment(prepared: PreparedProverTx): string {
  const commitment = prepared.prepared.outputCommitments?.[0];
  if (!commitment) {
    throw new Error("PreparedProverTx is missing outputCommitments[0]");
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

function asset(name: PrivateProverAssetName, path: string) {
  return { name, path };
}

function readOptionalEnv(value: string | undefined): string | undefined {
  return value && value.trim() !== "" ? value : undefined;
}
