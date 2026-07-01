import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { AppClients } from "./db/client.js";
import { BridgeRepository } from "./db/repository.js";
import { ApiError } from "./errors.js";
import { parseBody, pathParts, readJson, sendError, sendJson, writeCorsHeaders } from "./http.js";
import { normalizeAndValidatePrivatePoolProof } from "./bridge/private-pool.js";
import { quoteBridgeReceiveAmount } from "./bridge/quote.js";
import { createSourceAction } from "./bridge/source-action.js";
import type { BridgeWorker } from "./bridge/worker.js";

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

async function pingRedis(clients: Pick<AppClients, "redis">): Promise<string> {
  if (!clients.redis) {
    return "not_configured";
  }
  const pong = await clients.redis.ping();
  return pong === "PONG" ? "ok" : pong;
}
