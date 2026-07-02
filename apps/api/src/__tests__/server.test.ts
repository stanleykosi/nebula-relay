import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStellarAuthMessage } from "../auth/stellar.js";
import type { AppConfig } from "../config.js";
import type { AppClients } from "../db/client.js";
import type { BridgeRepository } from "../db/repository.js";
import { createApiServer } from "../server.js";
import type { BridgeWorker } from "../bridge/worker.js";

const createdServers: Server[] = [];
const owner = Keypair.random();
const ownerAccount = owner.publicKey();

describe("api server intent listing", () => {
  afterEach(async () => {
    await Promise.all(
      createdServers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          })
      )
    );
  });

  it("lists intents for a scoped Stellar account", async () => {
    const listIntents = vi.fn().mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        status: "waiting_source_tx",
        stellarAccount: ownerAccount,
        receiveAmount: "1000000",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ]);
    const server = createTestServer({ listIntents });
    const baseUrl = await listen(server);

    const response = await fetch(
      `${baseUrl}/v1/intents?stellarAccount=${ownerAccount}&limit=25`,
      {
        headers: stellarAuthHeaders({
          account: ownerAccount,
          method: "GET",
          path: "/v1/intents",
          scope: `intent-list;stellarAccount=${ownerAccount};ids=;limit=25`,
        }),
      }
    );
    const body = (await response.json()) as { intents: unknown[] };

    expect(response.status).toBe(200);
    expect(listIntents).toHaveBeenCalledWith({
      stellarAccount: ownerAccount,
      ids: [],
      limit: 25,
    });
    expect(body.intents).toHaveLength(1);
  });

  it("rejects unauthenticated account-scoped intent list requests", async () => {
    const listIntents = vi.fn();
    const server = createTestServer({ listIntents });
    const baseUrl = await listen(server);

    const response = await fetch(
      `${baseUrl}/v1/intents?stellarAccount=${ownerAccount}&limit=25`
    );
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe("missing_stellar_auth");
    expect(listIntents).not.toHaveBeenCalled();
  });

  it("rejects unscoped intent list requests", async () => {
    const listIntents = vi.fn();
    const server = createTestServer({ listIntents });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/v1/intents`);
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };

    expect(response.status).toBe(400);
    expect(listIntents).not.toHaveBeenCalled();
    expect(body.error?.code).toBe("missing_activity_scope");
  });

  it("stores encrypted note backups only when scoped to the bridge intent", async () => {
    const getIntent = vi.fn().mockResolvedValue(testIntent(ownerAccount));
    const upsertNoteBackup = vi.fn().mockImplementation(async (input) => ({
      ...input,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    }));
    const getNoteBackup = vi.fn().mockResolvedValue(null);
    const appendEvent = vi.fn();
    const server = createTestServer({
      getIntent,
      getNoteBackup,
      upsertNoteBackup,
      appendEvent,
      listIntents: vi.fn(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(
      `${baseUrl}/v1/intents/11111111-1111-4111-8111-111111111111/note-backup`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...stellarAuthHeaders({
            account: ownerAccount,
            method: "POST",
            path: "/v1/intents/11111111-1111-4111-8111-111111111111/note-backup",
            scope:
              `note-backup-write;intentId=11111111-1111-4111-8111-111111111111;stellarAccount=${ownerAccount};` +
              `noteCommitment=${testEncryptedBackup(ownerAccount).noteCommitment};poolId=CPOOL`,
          }),
        },
        body: JSON.stringify(testEncryptedBackup(ownerAccount)),
      }
    );
    const body = (await response.json()) as { backup?: { intentId?: string } };

    expect(response.status).toBe(201);
    expect(body.backup?.intentId).toBe("11111111-1111-4111-8111-111111111111");
    expect(upsertNoteBackup).toHaveBeenCalledWith({
      intentId: "11111111-1111-4111-8111-111111111111",
      ...testEncryptedBackup(ownerAccount),
      noteCommitment: testEncryptedBackup(ownerAccount).noteCommitment.toLowerCase(),
    });
    expect(appendEvent).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "note_backup_saved",
      expect.objectContaining({ backupFormat: "nebula.note.backup.v1" })
    );
  });

  it("rejects unauthenticated note-backup writes before upserting", async () => {
    const getIntent = vi.fn().mockResolvedValue(testIntent(ownerAccount));
    const upsertNoteBackup = vi.fn();
    const server = createTestServer({
      getIntent,
      upsertNoteBackup,
      appendEvent: vi.fn(),
      listIntents: vi.fn(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(
      `${baseUrl}/v1/intents/11111111-1111-4111-8111-111111111111/note-backup`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(testEncryptedBackup(ownerAccount)),
      }
    );
    const body = (await response.json()) as { error?: { code?: string } };

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe("missing_stellar_auth");
    expect(upsertNoteBackup).not.toHaveBeenCalled();
  });

  it("does not overwrite an existing encrypted note backup", async () => {
    const getIntent = vi.fn().mockResolvedValue(testIntent(ownerAccount));
    const existingBackup = {
      intentId: "11111111-1111-4111-8111-111111111111",
      ...testEncryptedBackup(ownerAccount),
      ciphertext: "ZXhpc3RpbmctY2lwaGVydGV4dA==",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    };
    const getNoteBackup = vi.fn().mockResolvedValue(existingBackup);
    const upsertNoteBackup = vi.fn();
    const server = createTestServer({
      getIntent,
      getNoteBackup,
      upsertNoteBackup,
      appendEvent: vi.fn(),
      listIntents: vi.fn(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(
      `${baseUrl}/v1/intents/11111111-1111-4111-8111-111111111111/note-backup`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...stellarAuthHeaders({
            account: ownerAccount,
            method: "POST",
            path: "/v1/intents/11111111-1111-4111-8111-111111111111/note-backup",
            scope:
              `note-backup-write;intentId=11111111-1111-4111-8111-111111111111;stellarAccount=${ownerAccount};` +
              `noteCommitment=${testEncryptedBackup(ownerAccount).noteCommitment};poolId=CPOOL`,
          }),
        },
        body: JSON.stringify(testEncryptedBackup(ownerAccount)),
      }
    );
    const body = (await response.json()) as { error?: { code?: string } };

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("note_backup_already_exists");
    expect(upsertNoteBackup).not.toHaveBeenCalled();
  });

  it("rejects note backups with plaintext-shaped extra fields", async () => {
    const getIntent = vi.fn().mockResolvedValue(testIntent(ownerAccount));
    const upsertNoteBackup = vi.fn();
    const server = createTestServer({
      getIntent,
      upsertNoteBackup,
      appendEvent: vi.fn(),
      listIntents: vi.fn(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(
      `${baseUrl}/v1/intents/11111111-1111-4111-8111-111111111111/note-backup`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...testEncryptedBackup(ownerAccount),
          rawNote: "do-not-store-me",
        }),
      }
    );
    const body = (await response.json()) as { error?: { code?: string } };

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("invalid_request");
    expect(upsertNoteBackup).not.toHaveBeenCalled();
  });

  it("returns encrypted note backups only to the matching Stellar owner scope", async () => {
    const getIntent = vi.fn().mockResolvedValue(testIntent(ownerAccount));
    const getNoteBackup = vi.fn().mockResolvedValue({
      intentId: "11111111-1111-4111-8111-111111111111",
      ...testEncryptedBackup(ownerAccount),
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });
    const server = createTestServer({
      getIntent,
      getNoteBackup,
      listIntents: vi.fn(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(
      `${baseUrl}/v1/intents/11111111-1111-4111-8111-111111111111/note-backup?stellarAccount=${ownerAccount}`,
      {
        headers: stellarAuthHeaders({
          account: ownerAccount,
          method: "GET",
          path: "/v1/intents/11111111-1111-4111-8111-111111111111/note-backup",
          scope:
            `note-backup-read;intentId=11111111-1111-4111-8111-111111111111;stellarAccount=${ownerAccount}`,
        }),
      }
    );
    const body = (await response.json()) as { backup?: { stellarAccount?: string } };

    expect(response.status).toBe(200);
    expect(body.backup?.stellarAccount).toBe(ownerAccount);
    expect(getNoteBackup).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("keeps health available when Redis is degraded", async () => {
    const redis = {
      ping: vi.fn().mockRejectedValue(Object.assign(new Error("read ETIMEDOUT"), {
        code: "ETIMEDOUT",
      })),
    };
    const server = createTestServer(
      { listIntents: vi.fn() },
      { redis: redis as unknown as AppClients["redis"] }
    );
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/health`);
    const body = (await response.json()) as { ok?: boolean; redis?: string };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.redis).toBe("degraded:ETIMEDOUT");
  });
});

function createTestServer(
  params: Record<string, ReturnType<typeof vi.fn>>,
  options: { redis?: AppClients["redis"] } = {}
): Server {
  return createApiServer({
    config: {
      frontendOrigin: "*",
      sourceNetwork: "ethereum-sepolia",
      destinationNetwork: "stellar-testnet",
      workerEnabled: true,
    } as AppConfig,
    clients: {
      pg: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      redis: options.redis ?? null,
    } as unknown as AppClients,
    repo: params as unknown as BridgeRepository,
    worker: { runOnce: vi.fn() } as unknown as BridgeWorker,
  });
}

async function listen(server: Server): Promise<string> {
  createdServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function testIntent(stellarAccount = ownerAccount) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "waiting_source_tx",
    stellarAccount,
    receiveAmount: "1000000",
    grossAmount: "1000000",
    expectedCctpFee: "0",
    actualCctpFee: null,
    noteCommitment:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    poolId: "CPOOL",
    privatePoolProof: {},
    privatePoolInspection: {},
    sourceAction: {},
    sourceTxHash: null,
    receipt: null,
    cctpSettlement: null,
    witness: null,
    proofArtifact: null,
    stellarClaimTxHash: null,
    claimNullifier: null,
    boundlessRequestId: null,
    replayChecked: false,
    lastError: null,
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    claimedAt: null,
  };
}

function testEncryptedBackup(stellarAccount = ownerAccount) {
  return {
    stellarAccount,
    noteCommitment:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    poolId: "CPOOL",
    backupFormat: "nebula.note.backup.v1",
    schemaVersion: 1,
    kdfVersion: "freighter-signature-hkdf-sha256-aes-256-gcm-v1",
    salt: "YWJjZGVmZ2hpamtsbW5vcA==",
    iv: "YWJjZGVmZ2hpamtsbW5vcA==",
    ciphertext: "YWJjZGVmZ2hpamtsbW5vcA==",
  } as const;
}

function stellarAuthHeaders(input: {
  account: string;
  method: string;
  path: string;
  scope: string;
}) {
  const timestamp = String(Date.now());
  const message = buildStellarAuthMessage({ ...input, timestamp });
  return {
    "x-nebula-auth-account": input.account,
    "x-nebula-auth-timestamp": timestamp,
    "x-nebula-auth-signature": owner.sign(Buffer.from(message, "utf8")).toString("base64"),
  };
}
