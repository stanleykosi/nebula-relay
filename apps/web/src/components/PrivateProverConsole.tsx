"use client";

import {
  ArrowDownToLine,
  KeyRound,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  checkPrivateProverAssets,
  decodeSignatureBytes,
  normalizeBaseUnitAmount,
  normalizeWithdrawRecipient,
  privateProverConfig,
  type PrivateProverAssetStatus,
  type PrivateProverProgressEvent,
  type PrivateProverResult,
  type PrivateProverWithdrawResult,
} from "@/lib/privateProver";
import {
  requestFreighterAddress,
  signFreighterMessage,
} from "@/lib/freighter";
import { ActionButton, Badge, HashRow, Panel } from "@/components/ui";

type RuntimeResponse<T> = {
  type: "nebula:private-prover:response";
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
};

type RuntimeProgressMessage = {
  type: "nebula:private-prover:progress";
  id: string;
  progress: PrivateProverProgressEvent;
};

type RuntimeReadyMessage = {
  type: "nebula:private-prover:ready";
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: number;
};

type RuntimeRequestOptions = {
  timeoutMs?: number;
};

type RuntimeHealth = {
  ok: boolean;
  assets: PrivateProverAssetStatus[];
};

type InitResult = {
  methods: Record<string, boolean>;
  patchedPrepareOnly: boolean;
};

type DerivedKeys = {
  keys?: {
    noteKeypair?: { public?: string };
    encryptionKeypair?: { public?: string };
  };
  aspSecret?: { membershipBlinding?: string };
};

type AspRegistrationPayload = {
  address: string;
  notePublicKey: string;
  encryptionPublicKey?: string;
  membershipBlinding: string;
  membershipLeaf: string;
};

const PREPARED_JSON = "nebula-private-pool-prepared.json";
const ASP_REQUEST_JSON = "nebula-asp-membership-request.json";
const PREPARE_PROOF_TIMEOUT_MS = 60 * 60_000;
const WITHDRAW_TIMEOUT_MS = 60 * 60_000;

export function PrivateProverConsole() {
  const config = useMemo(() => privateProverConfig(), []);
  const runtimeOrigin = useMemo(
    () =>
      typeof window === "undefined"
        ? ""
        : new URL(config.runtimeUrl, window.location.href).origin,
    [config.runtimeUrl]
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pending = useRef(new Map<string, PendingRequest>());
  const bootStarted = useRef(false);

  const [runtimeReady, setRuntimeReady] = useState(false);
  const [assetStatus, setAssetStatus] = useState<PrivateProverAssetStatus[]>(
    []
  );
  const [initialized, setInitialized] = useState(false);
  const [patchedPrepareOnly, setPatchedPrepareOnly] = useState(false);
  const [withdrawAvailable, setWithdrawAvailable] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [withdrawRecipient, setWithdrawRecipient] = useState("");
  const [amount, setAmount] = useState("10000000");
  const [derivedKeys, setDerivedKeys] = useState<DerivedKeys>();
  const [aspRegistration, setAspRegistration] =
    useState<AspRegistrationPayload>();
  const [preparedResult, setPreparedResult] = useState<PrivateProverResult>();
  const [withdrawResult, setWithdrawResult] =
    useState<PrivateProverWithdrawResult>();
  const [progress, setProgress] = useState<PrivateProverProgressEvent[]>([]);
  const [status, setStatus] = useState("Runtime waiting");
  const [error, setError] = useState<string>();

  useEffect(() => {
    function handleRuntimeMessage(event: MessageEvent<unknown>) {
      if (runtimeOrigin && event.origin !== runtimeOrigin) {
        return;
      }
      const data = event.data as
        | RuntimeResponse<unknown>
        | RuntimeProgressMessage
        | RuntimeReadyMessage;
      if (!data || typeof data !== "object") {
        return;
      }
      if (data.type === "nebula:private-prover:ready") {
        setRuntimeReady(true);
        return;
      }
      if (data.type === "nebula:private-prover:progress") {
        setProgress((current) => [...current.slice(-5), data.progress]);
        return;
      }
      if (data.type !== "nebula:private-prover:response") {
        return;
      }
      const request = pending.current.get(data.id);
      if (!request) {
        return;
      }
      pending.current.delete(data.id);
      window.clearTimeout(request.timeout);
      if (data.ok) {
        request.resolve(data.result);
      } else {
        request.reject(new Error(data.error ?? "Private prover request failed"));
      }
    }

    window.addEventListener("message", handleRuntimeMessage);
    return () => window.removeEventListener("message", handleRuntimeMessage);
  }, [runtimeOrigin]);

  const sendRuntime = async <T,>(
    command: string,
    payload?: Record<string, unknown>,
    options: RuntimeRequestOptions = {}
  ): Promise<T> => {
    const target = iframeRef.current?.contentWindow;
    if (!target) {
      throw new Error("Private prover runtime frame is unavailable");
    }
    const id = crypto.randomUUID();
    const promise = new Promise<T>((resolve, reject) => {
      pending.current.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout: window.setTimeout(() => {
          pending.current.delete(id);
          reject(
            new Error(
              `Private prover runtime did not respond to ${command}. Check that runtime assets are deployed at ${config.runtimeUrl}.`
            )
          );
        }, options.timeoutMs ?? 30_000),
      });
    });
    target.postMessage(
      {
        type: "nebula:private-prover:request",
        id,
        command,
        payload,
      },
      runtimeOrigin || window.location.origin
    );
    return promise;
  };

  const run = async (label: string, task: () => Promise<void>) => {
    setError(undefined);
    setStatus(label);
    try {
      await task();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setStatus("Action failed");
    }
  };

  useEffect(() => {
    if (bootStarted.current) {
      return;
    }
    bootStarted.current = true;
    void bootRuntime();
  }, []);

  const bootRuntime = async () =>
    run("Booting private prover runtime", async () => {
      if (!config.stellarRpcUrl) {
        throw new Error("NEXT_PUBLIC_STELLAR_RPC_URL is required");
      }

      setStatus("Checking prover assets");
      const pageAssets = await checkPrivateProverAssets(config.assetBaseUrl);
      setAssetStatus(pageAssets);
      const missing = pageAssets.filter((asset) => !asset.ok);
      if (missing.length) {
        throw new Error(
          `Private prover assets are missing: ${missing
            .map((asset) => `${asset.name}${asset.status ? ` (${asset.status})` : ""}`)
            .join(", ")}`
        );
      }

      setStatus("Waiting for runtime frame");
      await waitForRuntimeFrame();

      setStatus("Checking runtime health");
      const runtimeHealth = await retryRuntime<RuntimeHealth>("health", undefined, {
        attempts: 6,
        timeoutMs: 5_000,
        delayMs: 750,
      });
      setRuntimeReady(true);
      setAssetStatus(runtimeHealth.assets.length ? runtimeHealth.assets : pageAssets);
      if (!runtimeHealth.ok) {
        const failed = runtimeHealth.assets.filter((asset) => !asset.ok);
        throw new Error(
          `Private prover runtime assets are missing: ${failed
            .map((asset) => `${asset.name}${asset.status ? ` (${asset.status})` : ""}`)
            .join(", ")}`
        );
      }

      setStatus("Initializing browser prover");
      const result = await retryRuntime<InitResult>(
        "init",
        {
          rpcUrl: config.stellarRpcUrl,
          bootnodeUrl: config.bootnodeUrl,
        },
        {
          attempts: 2,
          timeoutMs: 90_000,
          delayMs: 1_000,
        }
      );
      setInitialized(true);
      setPatchedPrepareOnly(result.patchedPrepareOnly);
      setWithdrawAvailable(result.methods.executeWithdraw === true);
      if (!result.patchedPrepareOnly) {
        throw new Error("Runtime loaded without prepareDeposit");
      }
      setStatus("Private prover ready");
    });

  const retryRuntime = async <T,>(
    command: string,
    payload: Record<string, unknown> | undefined,
    options: { attempts: number; timeoutMs: number; delayMs: number }
  ): Promise<T> => {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
      try {
        return await sendRuntime<T>(command, payload, {
          timeoutMs: options.timeoutMs,
        });
      } catch (caught) {
        lastError = caught instanceof Error ? caught : new Error(String(caught));
        if (attempt < options.attempts) {
          await sleep(options.delayMs);
        }
      }
    }
    throw lastError ?? new Error(`Private prover runtime ${command} failed`);
  };

  const waitForRuntimeFrame = async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (iframeRef.current?.contentWindow) {
        return;
      }
      await sleep(100);
    }
    throw new Error("Private prover runtime frame did not mount");
  };

  const connectStellar = async () =>
    run("Connecting Stellar wallet", async () => {
      const address = await requestFreighterAddress();
      setWalletAddress(address);
      setWithdrawRecipient((current) => current || address);
      setStatus("Stellar wallet connected");
    });

  const signWithFreighter = async () =>
    run("Signing and preparing private proof", async () => {
      if (!walletAddress) {
        throw new Error("Connect a Stellar wallet first");
      }
      const message = await sendRuntime<string>("keyDerivationMessage");
      const response = await signFreighterMessage(message, {
        address: walletAddress,
        networkPassphrase: config.networkPassphrase,
      });
      await deriveKeys(response.signedMessage, { autoPrepare: true });
    });

  const deriveKeys = async (
    signature: string,
    options: { autoPrepare?: boolean } = {}
  ) => {
    if (!walletAddress) {
      throw new Error("Wallet address is required");
    }
    const signatureBytes = decodeSignatureBytes(signature);
    const result = await sendRuntime<DerivedKeys>("deriveKeys", {
      address: walletAddress,
      signatureBytes,
    });
    const registration = await sendRuntime<AspRegistrationPayload>(
      "aspRegistrationPayload",
      { address: walletAddress }
    );
    setDerivedKeys(result);
    setAspRegistration(registration);
    setStatus("Private note keys ready");
    if (options.autoPrepare) {
      await prepareOrExportAspRequest(registration);
    }
  };

  const prepareOrExportAspRequest = async (
    registration: AspRegistrationPayload
  ) => {
    setStatus("Preparing private pool proof");
    try {
      const result = await prepareDepositFromRuntime();
      downloadJson(PREPARED_JSON, result);
      publishPrepared(result);
      setStatus("PreparedProverTx exported and saved for Nebula");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!isAspRegistrationRequired(message)) {
        throw caught;
      }
      downloadJson(ASP_REQUEST_JSON, registration);
      setError(
        "ASP membership registration is required before this wallet can prepare a pool proof. The membership request JSON was exported."
      );
      setStatus("ASP membership request exported");
    }
  };

  const prepareDepositFromRuntime = async (): Promise<PrivateProverResult> => {
    if (!walletAddress) {
      throw new Error("Wallet address is required");
    }
    if (!config.poolId) {
      throw new Error("NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID is required");
    }
    const result = await sendRuntime<PrivateProverResult>("prepareDeposit", {
      poolId: config.poolId,
      address: walletAddress,
      amount,
      outputAmounts: [amount, "0"],
    }, { timeoutMs: PREPARE_PROOF_TIMEOUT_MS });
    setPreparedResult(result);
    window.localStorage.setItem(
      "nebula.privateProver.latest",
      JSON.stringify(result)
    );
    return result;
  };

  const withdrawFromRuntime = async () =>
    run("Withdrawing from private pool", async () => {
      if (!walletAddress) {
        throw new Error("Connect the Stellar wallet that owns the private note first");
      }
      if (!config.poolId) {
        throw new Error("NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID is required");
      }
      if (!withdrawAvailable) {
        throw new Error("The private prover runtime does not expose withdrawals");
      }

      const normalizedAmount = normalizeBaseUnitAmount(amount);
      const normalizedRecipient = normalizeWithdrawRecipient(
        withdrawRecipient || walletAddress
      );

      const result = await sendRuntime<PrivateProverWithdrawResult>(
        "executeWithdraw",
        {
          poolId: config.poolId,
          address: walletAddress,
          withdrawRecipient: normalizedRecipient,
          amount: normalizedAmount,
          networkPassphrase: config.networkPassphrase,
        },
        { timeoutMs: WITHDRAW_TIMEOUT_MS }
      );
      setWithdrawResult(result);
      window.localStorage.setItem(
        "nebula.privateProver.latestWithdraw",
        JSON.stringify(result)
      );
      setStatus("Private pool withdrawal submitted");
    });

  const downloadJson = (filename: string, value: unknown) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], {
        type: "application/json",
      })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const publishPrepared = (result: PrivateProverResult) => {
    window.opener?.postMessage(
      {
        type: "nebula:private-prover:prepared",
        result,
      },
      window.location.origin
    );
  };

  const assetsOk =
    assetStatus.length > 0 && assetStatus.every((asset) => asset.ok);

  return (
    <div className="page">
      <iframe
        ref={iframeRef}
        className="runtime-frame"
        src={config.runtimeUrl}
        title="Nebula private prover runtime"
        onLoad={() => {
          setStatus((current) =>
            current === "Runtime waiting" ? "Runtime frame loaded" : current
          );
        }}
      />

      <div className="status-row">
        <Badge tone={runtimeReady ? "ok" : "warn"}>
          Runtime: {runtimeReady ? "ready" : "loading"}
        </Badge>
        <Badge tone={assetsOk ? "ok" : "warn"}>
          Assets: {assetStatus.length ? (assetsOk ? "ready" : "missing") : "unchecked"}
        </Badge>
        <Badge tone={patchedPrepareOnly ? "ok" : "warn"}>
          Prepare-only: {patchedPrepareOnly ? "patched" : "unverified"}
        </Badge>
        <Badge tone={withdrawAvailable ? "ok" : "warn"}>
          Withdraw: {withdrawAvailable ? "ready" : "unavailable"}
        </Badge>
      </div>

      <div className="grid">
        <Panel title="1. Runtime" className="span-6">
          <p>
            Browser-hosted Stellar Private Payments runtime for Nebula private
            note preparation.
          </p>
          <HashRow label="Runtime URL" value={config.runtimeUrl} />
          <HashRow label="Asset base" value={config.assetBaseUrl} />
          <HashRow label="RPC" value={config.stellarRpcUrl} />
          {assetStatus.length ? (
            <div className="asset-list">
              {assetStatus.map((asset) => (
                <div className="asset-row" key={asset.name}>
                  <span>{asset.name}</span>
                  <strong>{asset.ok ? "ok" : asset.status ?? "missing"}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </Panel>

        <Panel title="2. Wallet and keys" className="span-6">
          <p>
            The signature derives local private-note keys; it does not authorize
            a payment.
          </p>
          <div className="actions">
            <ActionButton onClick={() => void connectStellar()}>
              <Wallet size={16} /> Connect Stellar
            </ActionButton>
            <ActionButton
              onClick={() => void signWithFreighter()}
              disabled={!initialized || !walletAddress}
            >
              <KeyRound size={16} /> Sign and prepare
            </ActionButton>
          </div>
          <label className="field">
            <span>Wallet address</span>
            <input
              className="input"
              value={walletAddress}
              onChange={(event) => {
                setWalletAddress(event.target.value);
                setWithdrawRecipient((current) => current || event.target.value);
              }}
              spellCheck={false}
            />
          </label>
          <HashRow
            label="Note public key"
            value={derivedKeys?.keys?.noteKeypair?.public}
          />
          <HashRow
            label="Encryption public key"
            value={derivedKeys?.keys?.encryptionKeypair?.public}
          />
          <HashRow
            label="ASP membership leaf"
            value={aspRegistration?.membershipLeaf}
          />
          <HashRow
            label="ASP membership blinding"
            value={derivedKeys?.aspSecret?.membershipBlinding}
          />
        </Panel>

        <Panel title="3. Prepared output" className="span-7">
          <p>
            The signed flow prepares the upstream private-pool output in this
            browser and stores the result for Nebula.
          </p>
          <label className="field">
            <span>Amount, base units</span>
            <input
              className="input"
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              spellCheck={false}
            />
          </label>
          <HashRow label="Pool" value={config.poolId} />
          <HashRow
            label="Output commitment"
            value={preparedResult?.outputCommitment}
          />
        </Panel>

        <Panel title="4. Withdraw from pool" className="span-5">
          <p>
            Spend an owned private note from the pool into the connected Stellar
            wallet, or send it to another Stellar wallet.
          </p>
          <label className="field">
            <span>Withdraw recipient</span>
            <input
              className="input"
              value={withdrawRecipient}
              onChange={(event) => setWithdrawRecipient(event.target.value)}
              placeholder={walletAddress || "G..."}
              spellCheck={false}
            />
          </label>
          <div className="actions">
            <ActionButton
              onClick={() => setWithdrawRecipient(walletAddress)}
              disabled={!walletAddress}
            >
              <Wallet size={16} /> Use connected wallet
            </ActionButton>
            <ActionButton
              onClick={() => void withdrawFromRuntime()}
              disabled={!initialized || !walletAddress || !withdrawAvailable}
              variant="primary"
            >
              <ArrowDownToLine size={16} /> Withdraw to Stellar
            </ActionButton>
          </div>
          <HashRow label="Withdraw tx" value={withdrawResult?.txHash} />
          <HashRow label="Withdraw status" value={withdrawResult?.status} />
          <HashRow
            label="Withdraw recipient"
            value={withdrawResult?.withdrawRecipient}
          />
        </Panel>

        <Panel title="5. Status" className="span-12">
          <p>{status}</p>
          {error ? <p className="callout danger">{error}</p> : null}
          {progress.length ? (
            <div className="progress-list">
              {progress.map((entry, index) => (
                <div className="progress-row" key={`${entry.stage}-${index}`}>
                  <span>{entry.stage ?? entry.flow ?? "progress"}</span>
                  <strong>{entry.message ?? "working"}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}

function isAspRegistrationRequired(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not registered in the asp membership tree") ||
    normalized.includes("asp membership registration is required") ||
    normalized.includes("register the asp membership leaf")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
