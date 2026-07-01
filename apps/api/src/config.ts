import { z } from "zod";
import { getAddress, isAddress, type Address, type Hex } from "viem";

export type ComplianceMode =
  | "disabled-demo"
  | "allowlist-membership"
  | "denylist-non-membership";

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  redisUrl: string | null;
  frontendOrigin: string;
  workerEnabled: boolean;
  autoMigrate: boolean;
  workerPollMs: number;
  workerLockMs: number;
  sourceNetwork: "ethereum-sepolia";
  destinationNetwork: "stellar-testnet";
  evmChainId: number;
  sepoliaRpcUrl: string;
  escrowAddress: Address;
  usdcAddress: Address;
  cctpTokenMessengerAddress: Address;
  cctpIrisApiUrl: string;
  cctpSourceDomain: number;
  cctpDestinationDomain: number;
  cctpMaxFee: string;
  cctpMinFinalityThreshold: number;
  cctpStellarForwarderId: string;
  cctpStellarForwarderBytes32: Hex;
  cctpStellarForwarderHookData: Hex;
  cctpFeeQuoteBaseUnits: string;
  complianceHint: Hex;
  complianceRoot: Hex;
  complianceMode: ComplianceMode;
  nebulaNetworkDomain: Hex;
  nebulaExpiresAtLedger: number;
  nebulaMinAmount: string;
  nebulaMaxAmount: string;
  privatePaymentsPoolId: string;
  privatePoolNoteOutputIndex: 0 | 1;
  stellarNetwork: "testnet";
  stellarRpcUrl: string;
  stellarNetworkPassphrase: string;
  stellarSourceSecret: string;
  stellarAssetContractId: string;
  nebulaRelayContractId: string;
  risc0VerifierRouterId: string;
  nebulaImageId: Hex;
  nebulaHostBin: string;
  boundlessRpcUrl: string;
  boundlessPrivateKey: string;
  boundlessProgramUrl: string | null;
  pinataJwt: string | null;
}

const hexBytes = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})*$/, "expected 0x-prefixed even-length hex")
  .transform((value) => value.toLowerCase() as Hex);
const hex32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected 32-byte hex")
  .transform((value) => value.toLowerCase() as Hex);
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value : null));
const boolFromEnv = z
  .string()
  .optional()
  .transform((value) => value !== "0" && value !== "false");

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: optionalString,
  FRONTEND_ORIGIN: z.string().default("*"),
  NEBULA_WORKER_ENABLED: boolFromEnv,
  NEBULA_AUTO_MIGRATE: boolFromEnv,
  NEBULA_WORKER_POLL_MS: z.coerce.number().int().positive().default(5000),
  NEBULA_WORKER_LOCK_MS: z.coerce.number().int().positive().default(600000),
  NEXT_PUBLIC_EVM_CHAIN_ID: z.coerce.number().int().positive().default(11155111),
  SEPOLIA_RPC_URL: z.string().min(1),
  NEBULA_CCTP_ESCROW_ADDRESS: z.string().min(1),
  CCTP_USDC_ADDRESS: z.string().min(1),
  CCTP_TOKEN_MESSENGER_V2_ADDRESS: z.string().min(1),
  CCTP_IRIS_API_URL: z
    .string()
    .url()
    .default("https://iris-api-sandbox.circle.com"),
  CCTP_SOURCE_DOMAIN: z.coerce.number().int().nonnegative().default(0),
  CCTP_STELLAR_DOMAIN: z.coerce.number().int().nonnegative().default(27),
  CCTP_MAX_FEE: decimal,
  CCTP_MIN_FINALITY_THRESHOLD: z.coerce.number().int().nonnegative().default(1000),
  CCTP_STELLAR_FORWARDER_ID: z.string().min(1),
  CCTP_STELLAR_FORWARDER_BYTES32: hex32,
  CCTP_STELLAR_FORWARDER_HOOK_DATA: hexBytes,
  CCTP_FEE_QUOTE_BASE_UNITS: decimal.default("1000"),
  NEBULA_COMPLIANCE_HINT: hex32,
  NEBULA_COMPLIANCE_ROOT: hex32,
  NEBULA_COMPLIANCE_MODE: z.string().default("allowlist-membership"),
  NEBULA_NETWORK_DOMAIN: hex32,
  NEBULA_EXPIRES_AT_LEDGER: z.coerce.number().int().positive(),
  NEBULA_MIN_AMOUNT: decimal,
  NEBULA_MAX_AMOUNT: decimal,
  PRIVATE_PAYMENTS_POOL_ID: z.string().min(1),
  NEBULA_PRIVATE_POOL_NOTE_OUTPUT_INDEX: z
    .enum(["0", "1"])
    .default("0")
    .transform((value) => Number(value) as 0 | 1),
  STELLAR_NETWORK: z.literal("testnet").default("testnet"),
  STELLAR_RPC_URL: z.string().url(),
  STELLAR_NETWORK_PASSPHRASE: z
    .string()
    .default("Test SDF Network ; September 2015"),
  STELLAR_SOURCE_SECRET: z.string().min(1),
  STELLAR_ASSET_CONTRACT_ID: z.string().min(1),
  NEBULA_RELAY_CONTRACT_ID: z.string().min(1),
  RISC0_VERIFIER_ROUTER_ID: z.string().min(1),
  NEBULA_IMAGE_ID: hex32,
  NEBULA_HOST_BIN: z.string().default("target/release/nebula-host"),
  BOUNDLESS_RPC_URL: z.string().min(1),
  BOUNDLESS_PRIVATE_KEY: z.string().min(1),
  BOUNDLESS_PROGRAM_URL: optionalString,
  PINATA_JWT: optionalString,
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    frontendOrigin: parsed.FRONTEND_ORIGIN,
    workerEnabled: parsed.NEBULA_WORKER_ENABLED,
    autoMigrate: parsed.NEBULA_AUTO_MIGRATE,
    workerPollMs: parsed.NEBULA_WORKER_POLL_MS,
    workerLockMs: parsed.NEBULA_WORKER_LOCK_MS,
    sourceNetwork: "ethereum-sepolia",
    destinationNetwork: "stellar-testnet",
    evmChainId: parsed.NEXT_PUBLIC_EVM_CHAIN_ID,
    sepoliaRpcUrl: parsed.SEPOLIA_RPC_URL,
    escrowAddress: normalizeAddress(parsed.NEBULA_CCTP_ESCROW_ADDRESS, "NEBULA_CCTP_ESCROW_ADDRESS"),
    usdcAddress: normalizeAddress(parsed.CCTP_USDC_ADDRESS, "CCTP_USDC_ADDRESS"),
    cctpTokenMessengerAddress: normalizeAddress(parsed.CCTP_TOKEN_MESSENGER_V2_ADDRESS, "CCTP_TOKEN_MESSENGER_V2_ADDRESS"),
    cctpIrisApiUrl: parsed.CCTP_IRIS_API_URL,
    cctpSourceDomain: parsed.CCTP_SOURCE_DOMAIN,
    cctpDestinationDomain: parsed.CCTP_STELLAR_DOMAIN,
    cctpMaxFee: parsed.CCTP_MAX_FEE,
    cctpMinFinalityThreshold: parsed.CCTP_MIN_FINALITY_THRESHOLD,
    cctpStellarForwarderId: parsed.CCTP_STELLAR_FORWARDER_ID,
    cctpStellarForwarderBytes32: parsed.CCTP_STELLAR_FORWARDER_BYTES32,
    cctpStellarForwarderHookData: parsed.CCTP_STELLAR_FORWARDER_HOOK_DATA,
    cctpFeeQuoteBaseUnits: parsed.CCTP_FEE_QUOTE_BASE_UNITS,
    complianceHint: parsed.NEBULA_COMPLIANCE_HINT,
    complianceRoot: parsed.NEBULA_COMPLIANCE_ROOT,
    complianceMode: normalizeComplianceMode(parsed.NEBULA_COMPLIANCE_MODE),
    nebulaNetworkDomain: parsed.NEBULA_NETWORK_DOMAIN,
    nebulaExpiresAtLedger: parsed.NEBULA_EXPIRES_AT_LEDGER,
    nebulaMinAmount: parsed.NEBULA_MIN_AMOUNT,
    nebulaMaxAmount: parsed.NEBULA_MAX_AMOUNT,
    privatePaymentsPoolId: parsed.PRIVATE_PAYMENTS_POOL_ID,
    privatePoolNoteOutputIndex: parsed.NEBULA_PRIVATE_POOL_NOTE_OUTPUT_INDEX,
    stellarNetwork: parsed.STELLAR_NETWORK,
    stellarRpcUrl: parsed.STELLAR_RPC_URL,
    stellarNetworkPassphrase: parsed.STELLAR_NETWORK_PASSPHRASE,
    stellarSourceSecret: parsed.STELLAR_SOURCE_SECRET,
    stellarAssetContractId: parsed.STELLAR_ASSET_CONTRACT_ID,
    nebulaRelayContractId: parsed.NEBULA_RELAY_CONTRACT_ID,
    risc0VerifierRouterId: parsed.RISC0_VERIFIER_ROUTER_ID,
    nebulaImageId: parsed.NEBULA_IMAGE_ID,
    nebulaHostBin: parsed.NEBULA_HOST_BIN,
    boundlessRpcUrl: parsed.BOUNDLESS_RPC_URL,
    boundlessPrivateKey: parsed.BOUNDLESS_PRIVATE_KEY,
    boundlessProgramUrl: parsed.BOUNDLESS_PROGRAM_URL,
    pinataJwt: parsed.PINATA_JWT,
  };
}

function normalizeAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${label} must be an EVM address`);
  }
  return getAddress(value);
}

function normalizeComplianceMode(value: string): ComplianceMode {
  if (value === "0" || value === "disabled-demo") {
    return "disabled-demo";
  }
  if (value === "2" || value === "denylist-non-membership") {
    return "denylist-non-membership";
  }
  if (value === "1" || value === "allowlist-membership") {
    return "allowlist-membership";
  }
  throw new Error(`NEBULA_COMPLIANCE_MODE is not supported: ${value}`);
}
