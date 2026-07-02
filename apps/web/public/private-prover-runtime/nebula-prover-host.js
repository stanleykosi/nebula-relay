const REQUEST_TYPE = "nebula:private-prover:request";
const RESPONSE_TYPE = "nebula:private-prover:response";
const PROGRESS_TYPE = "nebula:private-prover:progress";
const READY_TYPE = "nebula:private-prover:ready";

let wasmFacade = null;
let wasmHandle = null;

const statusEl = document.getElementById("status");

setStatus("ready");
postReady();

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.type !== REQUEST_TYPE || typeof message.id !== "string") {
    return;
  }

  void handleRequest(message, event);
});

async function handleRequest(message, event) {
  const { id, command, payload } = message;
  try {
    let result;
    switch (command) {
      case "health":
        result = await checkHealth();
        break;
      case "init":
        result = await initialize(payload);
        break;
      case "keyDerivationMessage":
        result = keyDerivationMessage();
        break;
      case "deriveKeys":
        result = await deriveKeys(payload);
        break;
      case "aspRegistrationPayload":
        result = await aspRegistrationPayload(payload);
        break;
      case "prepareDeposit":
        result = await prepareDeposit(id, payload);
        break;
      case "executeWithdraw":
        result = await executeWithdraw(id, payload);
        break;
      default:
        throw new Error(`Unknown private prover command: ${command}`);
    }
    reply(event, id, { ok: true, result: toPlain(result) });
  } catch (error) {
    reply(event, id, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function checkHealth() {
  const assets = [
    ["wasm-facade", "./js/wasm-facade.js"],
    ["web-module", "./js/web.js"],
    ["storage-worker", "./js/storage-worker.js"],
    ["prover-worker", "./js/prover-worker.js"],
    ["policy-wasm", "./circuits/policy_tx_2_2.wasm"],
    ["policy-r1cs", "./circuits/policy_tx_2_2.r1cs"],
    ["disclosure-wasm", "./circuits/selectiveDisclosure_1.wasm"],
    ["disclosure-r1cs", "./circuits/selectiveDisclosure_1.r1cs"],
  ];

  const checks = await Promise.all(
    assets.map(async ([name, path]) => {
      try {
        const response = await fetch(path, { method: "HEAD", cache: "no-store" });
        return { name, path, ok: response.ok, status: response.status };
      } catch {
        return { name, path, ok: false };
      }
    })
  );
  return {
    ok: checks.every((check) => check.ok),
    assets: checks,
  };
}

async function initialize(payload) {
  const rpcUrl = requireString(payload?.rpcUrl, "rpcUrl");
  const bootnodeUrl = optionalString(payload?.bootnodeUrl);
  setStatus("initializing");
  wasmFacade = await import("./js/wasm-facade.js");
  wasmHandle = await wasmFacade.initializeWasm(rpcUrl, bootnodeUrl || null);
  const client = clientOrThrow();
  const methods = {
    prepareDeposit: typeof client.prepareDeposit === "function",
    executeWithdraw: typeof client.executeWithdraw === "function",
    deriveAndSaveUserKeys: typeof client.deriveAndSaveUserKeys === "function",
    getUserKeys: typeof client.getUserKeys === "function",
    getASPSecret: typeof client.getASPSecret === "function",
  };
  setStatus("initialized");
  return {
    methods,
    patchedPrepareOnly: methods.prepareDeposit,
  };
}

function keyDerivationMessage() {
  const client = clientOrThrow();
  return client.keyDerivationMessage();
}

async function deriveKeys(payload) {
  const client = clientOrThrow();
  const address = requireString(payload?.address, "address");
  const signatureBytes = payload?.signatureBytes;
  if (!Array.isArray(signatureBytes)) {
    throw new Error("signatureBytes must be an array");
  }
  await client.deriveAndSaveUserKeys(address, Uint8Array.from(signatureBytes));
  const keys = await client.getUserKeys(address);
  const aspSecret = await client.getASPSecret(address);
  return {
    keys,
    aspSecret,
  };
}

async function prepareDeposit(requestId, payload) {
  const client = clientOrThrow();
  if (typeof client.prepareDeposit !== "function") {
    throw new Error(
      "Hosted Stellar Private Payments WASM is missing prepareDeposit. Apply patches/stellar-private-payments/browser-prepare-only.patch before staging runtime assets."
    );
  }

  const poolId = requireString(payload?.poolId, "poolId");
  const address = requireString(payload?.address, "address");
  const amount = requireString(payload?.amount, "amount");
  const outputAmounts = Array.isArray(payload?.outputAmounts)
    ? payload.outputAmounts
    : [amount, "0"];

  const preparedProverTx = await client.prepareDeposit(
    poolId,
    address,
    BigInt(amount),
    outputAmounts.map((value) => BigInt(value)),
    (progress) => {
      window.parent.postMessage(
        {
          type: PROGRESS_TYPE,
          id: requestId,
          progress: toPlain(progress),
        },
        window.location.origin
      );
    }
  );

  const outputCommitment = extractOutputCommitment(preparedProverTx);

  return {
    preparedProverTx,
    outputCommitment,
    amount,
    poolId,
    generatedAt: new Date().toISOString(),
  };
}

async function executeWithdraw(requestId, payload) {
  const client = clientOrThrow();
  if (typeof client.executeWithdraw !== "function") {
    throw new Error(
      "Hosted Stellar Private Payments WASM is missing executeWithdraw. Stage a runtime build that exposes withdraw support before enabling private pool withdrawals."
    );
  }

  const poolId = requireString(payload?.poolId, "poolId");
  const address = requireString(payload?.address, "address");
  const withdrawRecipient = requireString(
    payload?.withdrawRecipient,
    "withdrawRecipient"
  );
  const amount = requireString(payload?.amount, "amount");
  const networkPassphrase = requireString(
    payload?.networkPassphrase,
    "networkPassphrase"
  );

  const result = await client.executeWithdraw(
    poolId,
    address,
    withdrawRecipient,
    BigInt(amount),
    networkPassphrase,
    (progress) => {
      window.parent.postMessage(
        {
          type: PROGRESS_TYPE,
          id: requestId,
          progress: toPlain(progress),
        },
        window.location.origin
      );
    }
  );

  const plain = toPlain(result);
  return {
    poolId,
    ownerAddress: address,
    withdrawRecipient,
    amount,
    status: findStringValue(plain, ["status", "resultStatus"]),
    txHash: findStringValue(plain, [
      "hash",
      "txHash",
      "transactionHash",
      "transaction_hash",
    ]),
    result: plain,
    submittedAt: new Date().toISOString(),
  };
}

async function aspRegistrationPayload(payload) {
  const client = clientOrThrow();
  const address = requireString(payload?.address, "address");
  const keys = await client.getUserKeys(address);
  const aspSecret = await client.getASPSecret(address);
  const notePublicKey = keys?.noteKeypair?.public;
  const encryptionPublicKey = keys?.encryptionKeypair?.public;
  const membershipBlinding = aspSecret?.membershipBlinding;
  if (!notePublicKey || !membershipBlinding) {
    throw new Error("Private note keys and ASP secret must be derived before ASP registration payload export");
  }
  const membershipLeaf = await client.deriveAspUserLeaf(
    BigInt(membershipBlinding),
    notePublicKey
  );
  return {
    address,
    notePublicKey,
    encryptionPublicKey,
    membershipBlinding,
    membershipLeaf,
  };
}

function extractOutputCommitment(preparedProverTx) {
  if (preparedProverTx === null) {
    throw new Error(
      "Private Payments returned no PreparedProverTx because this wallet is not registered in the ASP membership tree yet. Register the ASP membership leaf for this note, wait for indexing, then run Prepare proof again."
    );
  }
  const publicInputs =
    preparedProverTx?.prepared ??
    preparedProverTx?.public ??
    preparedProverTx?.publicInputs;
  const outputCommitments =
    publicInputs?.outputCommitments ?? publicInputs?.output_commitments;
  const outputCommitment = Array.isArray(outputCommitments)
    ? outputCommitments[0]
    : publicInputs?.outputCommitment0 ?? publicInputs?.output_commitment0;
  if (typeof outputCommitment !== "string" || outputCommitment.trim() === "") {
    throw new Error(
      "PreparedProverTx is missing the first output commitment; checked prepared.outputCommitments[0], prepared.output_commitments[0], outputCommitment0, and output_commitment0."
    );
  }
  return outputCommitment;
}

function clientOrThrow() {
  const client = wasmHandle?.webClient ?? wasmFacade?.getHandle?.().webClient;
  if (!client) {
    throw new Error("Private prover runtime is not initialized");
  }
  return client;
}

function reply(event, id, payload) {
  event.source?.postMessage(
    {
      type: RESPONSE_TYPE,
      id,
      ...payload,
    },
    event.origin
  );
}

function postReady() {
  window.parent.postMessage({ type: READY_TYPE }, window.location.origin);
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optionalString(value) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function setStatus(value) {
  if (statusEl) {
    statusEl.textContent = value;
  }
}

function findStringValue(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate;
    }
  }
  return undefined;
}

function toPlain(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toPlain(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toPlain(entry)])
    );
  }
  return value;
}
