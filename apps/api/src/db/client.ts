import { Pool } from "pg";
import { createClient } from "redis";
import type { AppConfig } from "../config.js";
import { bridgeBackendSchemaSql } from "./schema.js";

type RedisClient = ReturnType<typeof createClient>;

export interface AppClients {
  pg: Pool;
  redis: RedisClient | null;
  close(): Promise<void>;
}

export async function createAppClients(config: AppConfig): Promise<AppClients> {
  const pg = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  if (config.autoMigrate) {
    await pg.query(bridgeBackendSchemaSql);
  }

  const redis = config.redisUrl
    ? createClient({
        url: config.redisUrl,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: 10_000,
          reconnectStrategy(retries, cause) {
            if (retries > 10) {
              console.error(
                "redis reconnect exhausted",
                formatRedisError(cause)
              );
              return false;
            }
            return Math.min(500 + retries * 500, 5_000);
          },
        },
      })
    : null;
  if (redis) {
    redis.on("error", (error) => {
      console.warn("redis connection error", formatRedisError(error));
    });
    void redis.connect().catch((error) => {
      console.warn(
        "redis unavailable at startup; continuing without redis",
        formatRedisError(error)
      );
    });
  }

  return {
    pg,
    redis,
    async close() {
      if (redis) {
        await redis.quit().catch((error) => {
          console.warn("redis shutdown error", formatRedisError(error));
        });
      }
      await pg.end();
    },
  };
}

function formatRedisError(error: unknown): string {
  if (error instanceof Error) {
    const code =
      "code" in error && typeof error.code === "string" ? error.code : null;
    return code ? `${error.name}: ${error.message} (${code})` : `${error.name}: ${error.message}`;
  }
  return String(error);
}
