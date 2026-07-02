import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { AppClients } from "./db/client.js";
import { BridgeRepository } from "./db/repository.js";
import { ApiError } from "./errors.js";
import { parseBody, pathParts, readJson, sendError, sendJson, writeCorsHeaders } from "./http.js";
import { requireStellarAuth } from "./auth/stellar.js";
import { normalizeAndValidatePrivatePoolProof } from "./bridge/private-pool.js";
import { quoteBridgeReceiveAmount } from "./bridge/quote.js";
import { createSourceAction } from "./bridge/source-action.js";
import type { BridgeWorker } from "./bridge/worker.js";
import type { BridgeIntentRecord } from "./types.js";

const decimalSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
const txHashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase() as `0x${string}`);

const quoteRequestSchema = z.object({
  receiveAmount: decimalSchema,
});

const createIntentRequestSchema = z
  .object({
    receiveAmount: decimalSchema,
    stellarAccount: z.string().min(1).optional(),
    privatePoolPreparedTx: z.unknown().optional(),
    privatePoolProof: z.unknown().optional(),
  })
  .passthrough();

const sourceTxRequestSchema = z.object({
  txHash: txHashSchema,
});

const intentIdSchema = z.string().uuid();
const listIntentLimitSchema = z.coerce.number().int().min(1).max(100).default(50);
const redisHealthTimeoutMs = 1_000;
const backupBlobSchema = z
  .string()
  .min(16)
  .max(2_000_000)
  .regex(/^[A-Za-z0-9+/_=-]+$/);
const noteBackupRequestSchema = z
  .object({
    stellarAccount: z.string().trim().min(1).max(128),
    noteCommitment: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .transform((value) => value.toLowerCase() as `0x${string}`),
    poolId: z.string().trim().min(1).max(256),
    backupFormat: z.literal("nebula.note.backup.v1"),
    schemaVersion: z.literal(1),
    kdfVersion: z.literal("freighter-signature-hkdf-sha256-aes-256-gcm-v1"),
    salt: backupBlobSchema,
    iv: backupBlobSchema,
    ciphertext: backupBlobSchema,
  })
  .strict();

export function createApiServer(params: {
  config: AppConfig;
  clients: AppClients;
  repo: BridgeRepository;
  worker: BridgeWorker;
}): Server {
  const { config, clients, repo, worker } = params;

  return createServer(async (request, response) => {
    const origin = config.frontendOrigin;
    try {
      if (request.method === "OPTIONS") {
        writeCorsHeaders(response, origin);
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      const parts = pathParts(url);

      if (request.method === "GET" && url.pathname === "/health") {
        await clients.pg.query("SELECT 1");
        const redis =
          clients.redis === null ? "not_configured" : await pingRedis(clients);
        sendJson(
          response,
          200,
          {
            ok: true,
            service: "@nebula/api",
            mode: "testnet",
            sourceNetwork: config.sourceNetwork,
            destinationNetwork: config.destinationNetwork,
            workerEnabled: config.workerEnabled,
            redis,
          },
          origin
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/config") {
        sendJson(
          response,
          200,
          {
            mode: "testnet",
            proofMode: "remote",
            verifierMode: "real-router",
            sourceNetwork: config.sourceNetwork,
            destinationNetwork: config.destinationNetwork,
            evm: {
              chainId: config.evmChainId,
              escrow: config.escrowAddress,
              usdc: config.usdcAddress,
            },
            stellar: {
              network: config.stellarNetwork,
              relayContractId: config.nebulaRelayContractId,
              privatePaymentsPoolId: config.privatePaymentsPoolId,
              assetContractId: config.stellarAssetContractId,
              risc0VerifierRouterId: config.risc0VerifierRouterId,
            },
            cctp: {
              sourceDomain: config.cctpSourceDomain,
              destinationDomain: config.cctpDestinationDomain,
              minFinalityThreshold: config.cctpMinFinalityThreshold,
              expectedFee: config.cctpFeeQuoteBaseUnits,
            },
          },
          origin
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/quotes") {
        const body = parseBody(quoteRequestSchema, await readJson(request));
        const quote = quoteBridgeReceiveAmount(config, body.receiveAmount);
        sendJson(response, 200, quote, origin);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/intents") {
        const body = parseBody(createIntentRequestSchema, await readJson(request));
        const proofPayload =
          body.privatePoolPreparedTx ?? body.privatePoolProof ?? body;
        const quote = quoteBridgeReceiveAmount(config, body.receiveAmount);
        const privatePool = normalizeAndValidatePrivatePoolProof(
          config,
          quote,
          proofPayload
        );
        const sourceAction = createSourceAction(
          config,
          quote,
          privatePool.inspection.selectedNoteCommitment
        );
        const intent = await repo.createIntent({
          id: randomUUID(),
          stellarAccount: body.stellarAccount ?? null,
          quote,
          noteCommitment: privatePool.inspection.selectedNoteCommitment,
          poolId: config.privatePaymentsPoolId,
          privatePoolProof: privatePool.upstream,
          privatePoolInspection: privatePool.inspection,
          sourceAction,
        });

        sendJson(
          response,
          201,
          {
            intent,
            quote,
            sourceAction,
            nextAction: "frontend_checks_allowance_then_signs_approval_if_needed_then_lockAndBurn",
          },
          origin
        );
        return;
      }

      if (
        request.method === "GET" &&
        parts[0] === "v1" &&
        parts[1] === "intents" &&
        parts.length === 2
      ) {
        const query = parseListIntentsQuery(url);
        if (query.stellarAccount) {
          requireStellarAuth(request, {
            account: query.stellarAccount,
            path: url.pathname,
            scope: listIntentsAuthScope(query),
          });
        }
        const intents = await repo.listIntents(query);
        sendJson(response, 200, { intents }, origin);
        return;
      }

      if (request.method === "GET" && parts[0] === "v1" && parts[1] === "intents" && parts[2]) {
        if (parts.length === 3) {
          const intent = await mustGetIntent(repo, parts[2]);
          sendJson(response, 200, { intent }, origin);
          return;
        }
        if (parts.length === 4 && parts[3] === "events") {
          const after = Number(url.searchParams.get("after") ?? "0");
          if (!Number.isSafeInteger(after) || after < 0) {
            throw new ApiError(400, "invalid_cursor", "after must be a nonnegative integer");
          }
          await mustGetIntent(repo, parts[2]);
          const events = await repo.listEvents(parts[2], after);
          sendJson(response, 200, { events }, origin);
          return;
        }
        if (parts.length === 4 && parts[3] === "note-backup") {
          const stellarAccount = url.searchParams.get("stellarAccount")?.trim();
          if (!stellarAccount) {
            throw new ApiError(
              400,
              "missing_stellar_account",
              "stellarAccount is required to fetch an encrypted note backup"
            );
          }
          const intent = await mustGetIntent(repo, parts[2]);
          assertNoteBackupScope(intent, { stellarAccount });
          requireStellarAuth(request, {
            account: stellarAccount,
            path: url.pathname,
            scope: noteBackupReadAuthScope(intent.id, stellarAccount),
          });
          const backup = await repo.getNoteBackup(intent.id);
          if (!backup || backup.stellarAccount !== stellarAccount) {
            throw new ApiError(
              404,
              "note_backup_not_found",
              "encrypted note backup not found for this intent and Stellar account"
            );
          }
          sendJson(response, 200, { backup }, origin);
          return;
        }
      }

      if (
        request.method === "POST" &&
        parts[0] === "v1" &&
        parts[1] === "intents" &&
        parts[2] &&
        parts[3] === "note-backup"
      ) {
        const intent = await mustGetIntent(repo, parts[2]);
        const body = parseBody(noteBackupRequestSchema, await readJson(request));
        assertNoteBackupScope(intent, body);
        requireStellarAuth(request, {
          account: body.stellarAccount,
          path: url.pathname,
          scope: noteBackupWriteAuthScope({
            intentId: intent.id,
            stellarAccount: body.stellarAccount,
            noteCommitment: body.noteCommitment,
            poolId: body.poolId,
          }),
        });
        const existingBackup = await repo.getNoteBackup(intent.id);
        if (existingBackup) {
          assertExistingNoteBackupMatches(existingBackup, body);
          sendJson(response, 200, { backup: existingBackup }, origin);
          return;
        }
        const backup = await repo.upsertNoteBackup({
          intentId: intent.id,
          stellarAccount: body.stellarAccount,
          noteCommitment: body.noteCommitment,
          poolId: body.poolId,
          backupFormat: body.backupFormat,
          schemaVersion: body.schemaVersion,
          kdfVersion: body.kdfVersion,
          salt: body.salt,
          iv: body.iv,
          ciphertext: body.ciphertext,
        });
        await repo.appendEvent(intent.id, "note_backup_saved", {
          backupFormat: backup.backupFormat,
          schemaVersion: backup.schemaVersion,
          noteCommitment: backup.noteCommitment,
        });
        sendJson(response, 201, { backup }, origin);
        return;
      }

      if (
        request.method === "POST" &&
        parts[0] === "v1" &&
        parts[1] === "intents" &&
        parts[2] &&
        parts[3] === "source-tx"
      ) {
        await mustGetIntent(repo, parts[2]);
        const body = parseBody(sourceTxRequestSchema, await readJson(request));
        const intent = await repo.attachSourceTx(parts[2], body.txHash);
        void worker.runOnce();
        sendJson(response, 202, { intent }, origin);
        return;
      }

      if (
        request.method === "POST" &&
        parts[0] === "v1" &&
        parts[1] === "intents" &&
        parts[2] &&
        parts[3] === "retry"
      ) {
        const existing = await mustGetIntent(repo, parts[2]);
        if (!existing.sourceTxHash) {
          throw new ApiError(
            409,
            "missing_source_tx",
            "source transaction is required before retry"
          );
        }
        const intent = await repo.patchIntent(
          existing.id,
          { status: "source_tx_submitted", lastError: null },
          "retry_requested",
          { previousStatus: existing.status }
        );
        void worker.runOnce();
        sendJson(response, 202, { intent }, origin);
        return;
      }

      throw new ApiError(404, "not_found", "route not found");
    } catch (error) {
      sendError(response, error, origin);
    }
  });
}

function listIntentsAuthScope(input: {
  stellarAccount?: string;
  ids: string[];
  limit: number;
}): string {
  return [
    "intent-list",
    `stellarAccount=${input.stellarAccount ?? ""}`,
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

function parseListIntentsQuery(url: URL): {
  stellarAccount?: string;
  ids: string[];
  limit: number;
} {
  const stellarAccount =
    url.searchParams.get("stellarAccount")?.trim() ||
    url.searchParams.get("stellar_account")?.trim() ||
    undefined;
  const rawIds = [
    ...url.searchParams.getAll("id"),
    ...url.searchParams
      .getAll("ids")
      .flatMap((value) => value.split(",")),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  const ids = Array.from(new Set(rawIds));

  const parsedIds = z.array(intentIdSchema).max(50).safeParse(ids);
  if (!parsedIds.success) {
    throw new ApiError(400, "invalid_intent_ids", "ids must be valid UUIDs");
  }

  const limit = parseBody(
    listIntentLimitSchema,
    url.searchParams.get("limit") ?? undefined
  );

  if (!stellarAccount && parsedIds.data.length === 0) {
    throw new ApiError(
      400,
      "missing_activity_scope",
      "provide stellarAccount or ids to list intents"
    );
  }

  return {
    stellarAccount,
    ids: parsedIds.data,
    limit,
  };
}

async function mustGetIntent(
  repo: BridgeRepository,
  id: string
) {
  const intent = await repo.getIntent(id);
  if (!intent) {
    throw new ApiError(404, "intent_not_found", `intent not found: ${id}`);
  }
  return intent;
}

function assertNoteBackupScope(
  intent: BridgeIntentRecord,
  backup: {
    stellarAccount: string;
    noteCommitment?: string;
    poolId?: string;
  }
) {
  if (!intent.stellarAccount) {
    throw new ApiError(
      409,
      "intent_missing_stellar_owner",
      "intent must have a Stellar note owner before it can store a note backup"
    );
  }
  if (backup.stellarAccount !== intent.stellarAccount) {
    throw new ApiError(
      403,
      "note_backup_owner_mismatch",
      "encrypted note backup owner does not match the bridge intent"
    );
  }
  if (
    backup.noteCommitment &&
    backup.noteCommitment.toLowerCase() !== intent.noteCommitment.toLowerCase()
  ) {
    throw new ApiError(
      409,
      "note_backup_commitment_mismatch",
      "encrypted note backup commitment does not match the bridge intent"
    );
  }
  if (backup.poolId && backup.poolId !== intent.poolId) {
    throw new ApiError(
      409,
      "note_backup_pool_mismatch",
      "encrypted note backup pool does not match the bridge intent"
    );
  }
}

function assertExistingNoteBackupMatches(
  existing: {
    stellarAccount: string;
    noteCommitment: string;
    poolId: string;
    backupFormat: string;
    schemaVersion: number;
    kdfVersion: string;
    salt: string;
    iv: string;
    ciphertext: string;
  },
  requested: z.infer<typeof noteBackupRequestSchema>
) {
  const same =
    existing.stellarAccount === requested.stellarAccount &&
    existing.noteCommitment.toLowerCase() === requested.noteCommitment.toLowerCase() &&
    existing.poolId === requested.poolId &&
    existing.backupFormat === requested.backupFormat &&
    existing.schemaVersion === requested.schemaVersion &&
    existing.kdfVersion === requested.kdfVersion &&
    existing.salt === requested.salt &&
    existing.iv === requested.iv &&
    existing.ciphertext === requested.ciphertext;
  if (!same) {
    throw new ApiError(
      409,
      "note_backup_already_exists",
      "encrypted note backup already exists for this intent and cannot be overwritten"
    );
  }
}

async function pingRedis(clients: Pick<AppClients, "redis">): Promise<string> {
  if (!clients.redis) {
    return "not_configured";
  }
  try {
    const pong = await withTimeout(clients.redis.ping(), redisHealthTimeoutMs);
    return pong === "PONG" ? "ok" : pong;
  } catch (error) {
    return `degraded:${formatHealthError(error)}`;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`timeout_after_${timeoutMs}ms`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function formatHealthError(error: unknown): string {
  if (error instanceof Error) {
    const code =
      "code" in error && typeof error.code === "string" ? error.code : null;
    return code ?? error.name;
  }
  return "unknown";
}
