import { loadConfig } from "./config.js";
import { createAppClients } from "./db/client.js";
import { BridgeRepository } from "./db/repository.js";
import { createApiServer } from "./server.js";
import { BridgeWorker } from "./bridge/worker.js";

async function main() {
  const config = loadConfig();
  const clients = await createAppClients(config);
  const repo = new BridgeRepository(clients.pg);
  const worker = new BridgeWorker(config, repo);
  const server = createApiServer({ config, clients, repo, worker });

  server.listen(config.port, () => {
    console.log(`Nebula API listening on :${config.port}`);
  });
  worker.start();

  const shutdown = async () => {
    worker.stop();
    server.close();
    await clients.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
