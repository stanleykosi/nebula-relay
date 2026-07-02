import { stellarAuthHeaders } from "@/lib/stellar-auth";

export type BridgeStatus =
  | "waiting_source_tx"
  | "source_tx_submitted"
  | "source_finalized"
  | "cctp_pending"
  | "cctp_complete"
  | "witness_built"
  | "proving"
  | "proof_ready"
  | "claiming"
  | "claimed"
  | "replay_verified"
  | "fee_mismatch"
  | "failed";

export interface BackendConfig {
  mode: string;
  proofMode: string;
  verifierMode: string;
  sourceNetwork: string;
  destinationNetwork: string;
  evm: {
    chainId: number;
    escrow: string;
    usdc: string;
  };
  stellar: {
    network: string;
    relayContractId: string;
    privatePaymentsPoolId: string;
    assetContractId: string;
    risc0VerifierRouterId: string;
  };
  cctp: {
    sourceDomain: number;
    destinationDomain: number;
    minFinalityThreshold: number;
    expectedFee: string;
  };
}

export interface BridgeQuote {
  receiveAmount: string;
  expectedCctpFee: string;
  grossAmount: string;
  assetDecimals: number;
  sourceNetwork: string;
  destinationNetwork: string;
}

export interface SourceTransactionAction {
  to: string;
  calldata: string;
  spender?: string;
  amount?: string;
  functionName?: string;
}

export interface SourceAction {
  chainId: number;
  token: string;
  escrow: string;
  spender: string;
  receiveAmount: string;
  expectedCctpFee: string;
  grossAmount: string;
  noteCommitment: string;
  complianceHint: string;
  hookData: string;
  approval: SourceTransactionAction;
  lockAndBurn: SourceTransactionAction;
}

export interface BridgeEventRecord {
  id: number;
  intentId: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

export interface BridgeIntentRecord {
  id: string;
  status: BridgeStatus;
  stellarAccount: string | null;
  receiveAmount: string;
  grossAmount: string;
  expectedCctpFee: string;
  actualCctpFee: string | null;
  noteCommitment: string;
  poolId: string;
  privatePoolProof: unknown;
  privatePoolInspection: unknown;
  sourceAction: SourceAction;
  sourceTxHash: string | null;
  receipt: unknown;
  cctpSettlement: unknown;
  witness: unknown;
  proofArtifact: unknown;
  stellarClaimTxHash: string | null;
  claimNullifier: string | null;
  boundlessRequestId: string | null;
  replayChecked: boolean;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
}

export interface BridgeNoteBackupRecord {
  intentId: string;
  stellarAccount: string;
  noteCommitment: string;
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

export interface CreateIntentResponse {
  intent: BridgeIntentRecord;
  quote: BridgeQuote;
  sourceAction: SourceAction;
  nextAction:
    | "submit_source_transaction"
    | "frontend_checks_allowance_then_signs_approval_if_needed_then_lockAndBurn";
}

export interface IntentResponse {
  intent: BridgeIntentRecord;
}

export interface IntentsResponse {
  intents: BridgeIntentRecord[];
}

export interface EventsResponse {
  events: BridgeEventRecord[];
}

export interface NoteBackupResponse {
  backup: BridgeNoteBackupRecord;
}

const INTENT_STORAGE_KEY = "nebula.bridge.intentIds";
const USDC_BASE_UNITS = BigInt(1_000_000);

export async function getBackendConfig(): Promise<BackendConfig> {
  return apiFetch<BackendConfig>("/v1/config");
}

export async function createQuote(receiveAmount: string): Promise<BridgeQuote> {
  return apiFetch<BridgeQuote>("/v1/quotes", {
    method: "POST",
    body: JSON.stringify({ receiveAmount }),
  });
}

export async function createIntent(input: {
  receiveAmount: string;
  stellarAccount: string;
  privatePoolProof: unknown;
}): Promise<CreateIntentResponse> {
  return apiFetch<CreateIntentResponse>("/v1/intents", {
    method: "POST",
    body: JSON.stringify({
      receiveAmount: input.receiveAmount,
      stellarAccount: input.stellarAccount,
      privatePoolProof: input.privatePoolProof,
    }),
  });
}

export async function getIntent(intentId: string): Promise<BridgeIntentRecord> {
  const response = await apiFetch<IntentResponse>(`/v1/intents/${intentId}`);
  return response.intent;
}

export async function listIntents(input: {
  stellarAccount?: string;
  ids?: string[];
  limit?: number;
}): Promise<BridgeIntentRecord[]> {
  const params = new URLSearchParams();
  const stellarAccount = input.stellarAccount?.trim();
  const ids = Array.from(new Set(input.ids ?? [])).filter(Boolean);
  if (stellarAccount) {
    params.set("stellarAccount", stellarAccount);
  }
  if (ids.length > 0) {
    params.set("ids", ids.join(","));
  }
  if (input.limit) {
    params.set("limit", String(input.limit));
  }
  const path = `/v1/intents?${params}`;
  const headers = stellarAccount
    ? await stellarAuthHeaders({
        account: stellarAccount,
        method: "GET",
        path: "/v1/intents",
        scope: listIntentsAuthScope({
          stellarAccount,
          ids,
          limit: input.limit ?? 50,
        }),
      })
    : undefined;
  const response = await apiFetch<IntentsResponse>(path, { headers });
  return response.intents;
}

export async function getIntentEvents(
  intentId: string
): Promise<BridgeEventRecord[]> {
  const response = await apiFetch<EventsResponse>(`/v1/intents/${intentId}/events`);
  return response.events;
}

export async function attachSourceTx(input: {
  intentId: string;
  txHash: string;
}): Promise<BridgeIntentRecord> {
  const response = await apiFetch<IntentResponse>(
    `/v1/intents/${input.intentId}/source-tx`,
    {
      method: "POST",
      body: JSON.stringify({ txHash: input.txHash }),
    }
  );
  return response.intent;
}

export async function saveNoteBackup(input: {
  intentId: string;
  stellarAccount: string;
  noteCommitment: string;
  poolId: string;
  backupFormat: "nebula.note.backup.v1";
  schemaVersion: 1;
  kdfVersion: "freighter-signature-hkdf-sha256-aes-256-gcm-v1";
  salt: string;
  iv: string;
  ciphertext: string;
}): Promise<BridgeNoteBackupRecord> {
  const path = `/v1/intents/${input.intentId}/note-backup`;
  const response = await apiFetch<NoteBackupResponse>(
    path,
    {
      method: "POST",
      headers: await stellarAuthHeaders({
        account: input.stellarAccount,
        method: "POST",
        path,
        scope: noteBackupWriteAuthScope({
          intentId: input.intentId,
          stellarAccount: input.stellarAccount,
          noteCommitment: input.noteCommitment,
          poolId: input.poolId,
        }),
      }),
      body: JSON.stringify({
        stellarAccount: input.stellarAccount,
        noteCommitment: input.noteCommitment,
        poolId: input.poolId,
        backupFormat: input.backupFormat,
        schemaVersion: input.schemaVersion,
        kdfVersion: input.kdfVersion,
        salt: input.salt,
        iv: input.iv,
        ciphertext: input.ciphertext,
      }),
    }
  );
  return response.backup;
}

export async function getNoteBackup(input: {
  intentId: string;
  stellarAccount: string;
}): Promise<BridgeNoteBackupRecord> {
  const params = new URLSearchParams({ stellarAccount: input.stellarAccount });
  const path = `/v1/intents/${input.intentId}/note-backup`;
  const response = await apiFetch<NoteBackupResponse>(
    `${path}?${params}`,
    {
      headers: await stellarAuthHeaders({
        account: input.stellarAccount,
        method: "GET",
        path,
        scope: noteBackupReadAuthScope(input.intentId, input.stellarAccount),
      }),
    }
  );
  return response.backup;
}

export async function retryIntent(intentId: string): Promise<BridgeIntentRecord> {
  const response = await apiFetch<IntentResponse>(`/v1/intents/${intentId}/retry`, {
    method: "POST",
  });
  return response.intent;
}

export function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_NEBULA_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "http://localhost:3001";
  }
  return "";
}

export function usdcToBaseUnits(value: string): string {
  const trimmed = value.trim();
  if (!/^(0|[1-9]\d*)(\.\d{0,6})?$/.test(trimmed)) {
    throw new Error("Enter a USDC amount with up to 6 decimal places");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const padded = `${fraction}${"0".repeat(6)}`.slice(0, 6);
  const units = BigInt(whole) * USDC_BASE_UNITS + BigInt(padded || "0");
  if (units <= BigInt(0)) {
    throw new Error("Amount must be greater than zero");
  }
  return units.toString();
}

export function baseUnitsToUsdc(value?: string | null): string {
  if (!value) {
    return "0.00";
  }
  const units = BigInt(value);
  const whole = units / USDC_BASE_UNITS;
  const fraction = (units % USDC_BASE_UNITS).toString().padStart(6, "0");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : `${whole}.00`;
}

export function rememberIntentId(intentId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const ids = readStoredIntentIds().filter((id) => id !== intentId);
  window.localStorage.setItem(
    INTENT_STORAGE_KEY,
    JSON.stringify([intentId, ...ids].slice(0, 20))
  );
}

export function readStoredIntentIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(INTENT_STORAGE_KEY) ?? "[]"
    );
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function shortHash(value?: string | null, lead = 6, tail = 4): string {
  if (!value) {
    return "pending";
  }
  return value.length > lead + tail + 3
    ? `${value.slice(0, lead)}...${value.slice(-tail)}`
    : value;
}

export function statusLabel(status: BridgeStatus): string {
  return status
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function isTerminalStatus(status: BridgeStatus): boolean {
  return (
    status === "claimed" ||
    status === "replay_verified" ||
    status === "failed" ||
    status === "fee_mismatch"
  );
}

function listIntentsAuthScope(input: {
  stellarAccount: string;
  ids: string[];
  limit: number;
}): string {
  return [
    "intent-list",
    `stellarAccount=${input.stellarAccount}`,
    `ids=${input.ids.join(",")}`,
    `limit=${input.limit}`,
  ].join(";");
}

function noteBackupReadAuthScope(
  intentId: string,
  stellarAccount: string
): string {
  return [
    "note-backup-read",
    `intentId=${intentId}`,
    `stellarAccount=${stellarAccount}`,
  ].join(";");
}

function noteBackupWriteAuthScope(input: {
  intentId: string;
  stellarAccount: string;
  noteCommitment: string;
  poolId: string;
}): string {
  return [
    "note-backup-write",
    `intentId=${input.intentId}`,
    `stellarAccount=${input.stellarAccount}`,
    `noteCommitment=${input.noteCommitment.toLowerCase()}`,
    `poolId=${input.poolId}`,
  ].join(";");
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const base = apiBaseUrl();
  if (!base && typeof window !== "undefined" && window.location.hostname !== "localhost") {
    throw new Error("NEXT_PUBLIC_NEBULA_API_URL is required for hosted frontend builds");
  }
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(readApiError(body) ?? `Nebula API returned ${response.status}`);
  }
  return body as T;
}

function readApiError(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return null;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}
