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
    ? createClient({ url: config.redisUrl })
    : null;
  if (redis) {
    await redis.connect();
  }

  return {
    pg,
    redis,
    async close() {
      if (redis) {
        await redis.quit();
      }
      await pg.end();
    },
  };
}
