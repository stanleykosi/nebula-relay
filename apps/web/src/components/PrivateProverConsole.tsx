"use client";

import {
  CheckCircle2,
  Download,
  FileJson,
  KeyRound,
  RadioTower,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  checkPrivateProverAssets,
  decodeSignatureBytes,
  privateProverConfig,
  type PrivateProverAssetStatus,
  type PrivateProverProgressEvent,
  type PrivateProverResult,
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

  const [runtimeReady, setRuntimeReady] = useState(false);
  const [assetStatus, setAssetStatus] = useState<PrivateProverAssetStatus[]>(
    []
  );
  const [initialized, setInitialized] = useState(false);
  const [patchedPrepareOnly, setPatchedPrepareOnly] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [amount, setAmount] = useState("10000000");
  const [signatureInput, setSignatureInput] = useState("");
  const [derivedKeys, setDerivedKeys] = useState<DerivedKeys>();
  const [aspRegistration, setAspRegistration] =
    useState<AspRegistrationPayload>();
  const [preparedResult, setPreparedResult] = useState<PrivateProverResult>();
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
    payload?: Record<string, unknown>
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
        }, 30_000),
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

  const checkAssets = async () =>
    run("Checking prover assets", async () => {
      const [pageAssets, runtimeHealth] = await Promise.all([
        checkPrivateProverAssets(config.assetBaseUrl),
        sendRuntime<RuntimeHealth>("health"),
      ]);
      setAssetStatus(runtimeHealth.assets.length ? runtimeHealth.assets : pageAssets);
      setStatus(runtimeHealth.ok ? "Assets ready" : "Assets missing");
    });

  const initializeRuntime = async () =>
    run("Initializing browser prover", async () => {
      if (!config.stellarRpcUrl) {
        throw new Error("NEXT_PUBLIC_STELLAR_RPC_URL is required");
      }
      const result = await sendRuntime<InitResult>("init", {
        rpcUrl: config.stellarRpcUrl,
        bootnodeUrl: config.bootnodeUrl,
      });
      setInitialized(true);
      setPatchedPrepareOnly(result.patchedPrepareOnly);
      setStatus(
        result.patchedPrepareOnly
          ? "Prepare-only prover ready"
          : "Runtime loaded without prepareDeposit"
      );
    });

  const connectStellar = async () =>
    run("Connecting Stellar wallet", async () => {
      const address = await requestFreighterAddress();
      setWalletAddress(address);
      setStatus("Stellar wallet connected");
    });

  const signWithFreighter = async () =>
    run("Signing privacy key seed", async () => {
      if (!walletAddress) {
        throw new Error("Connect a Stellar wallet first");
      }
      const message = await sendRuntime<string>("keyDerivationMessage");
      const response = await signFreighterMessage(message, {
        address: walletAddress,
        networkPassphrase: config.networkPassphrase,
      });
      setSignatureInput(response.signedMessage);
      await deriveKeys(response.signedMessage);
    });

  const deriveFromManualSignature = async () =>
    run("Deriving private note keys", async () => {
      await deriveKeys(signatureInput);
    });

  const deriveKeys = async (signature: string) => {
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
  };

  const prepareDeposit = async () =>
    run("Preparing private pool proof", async () => {
      if (!walletAddress) {
        throw new Error("Wallet address is required");
      }
      if (!config.poolId) {
        throw new Error("NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID is required");
      }
      if (!derivedKeys) {
        throw new Error("Derive private note keys first");
      }
      const result = await sendRuntime<PrivateProverResult>("prepareDeposit", {
        poolId: config.poolId,
        address: walletAddress,
        amount,
        outputAmounts: [amount, "0"],
      });
      setPreparedResult(result);
      window.localStorage.setItem(
        "nebula.privateProver.latest",
        JSON.stringify(result)
      );
      setStatus("PreparedProverTx ready");
    });

  const downloadAspRegistration = () => {
    if (!aspRegistration) {
      return;
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(aspRegistration, null, 2)], {
        type: "application/json",
      })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "nebula-asp-membership-request.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadPrepared = () => {
    if (!preparedResult) {
      return;
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(preparedResult, null, 2)], {
        type: "application/json",
      })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "nebula-private-pool-prepared.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const returnToNebula = () => {
    if (!preparedResult) {
      return;
    }
    window.opener?.postMessage(
      {
        type: "nebula:private-prover:prepared",
        result: preparedResult,
      },
      window.location.origin
    );
    setStatus("PreparedProverTx saved for Nebula");
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
          setRuntimeReady(true);
          setStatus((current) =>
            current === "Runtime waiting" ? "Runtime loaded" : current
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
      </div>

      <div className="grid">
        <Panel title="1. Runtime" className="span-6">
          <p>
            Browser-hosted Stellar Private Payments runtime for Nebula private
            note preparation.
          </p>
          <div className="actions">
            <ActionButton onClick={() => void checkAssets()}>
              <FileJson size={16} /> Check assets
            </ActionButton>
            <ActionButton
              onClick={() => void initializeRuntime()}
              disabled={!runtimeReady}
              variant="primary"
            >
              <RadioTower size={16} /> Initialize
            </ActionButton>
          </div>
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
              <KeyRound size={16} /> Sign keys
            </ActionButton>
          </div>
          <label className="field">
            <span>Wallet address</span>
            <input
              className="input"
              value={walletAddress}
              onChange={(event) => setWalletAddress(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Signature</span>
            <textarea
              className="textarea"
              value={signatureInput}
              onChange={(event) => setSignatureInput(event.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="actions">
            <ActionButton
              onClick={() => void deriveFromManualSignature()}
              disabled={!initialized || !walletAddress || !signatureInput}
            >
              <KeyRound size={16} /> Derive keys
            </ActionButton>
          </div>
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
          <div className="actions">
            <ActionButton
              onClick={downloadAspRegistration}
              disabled={!aspRegistration}
            >
              <Download size={16} /> Export ASP request
            </ActionButton>
          </div>
        </Panel>

        <Panel title="3. Prepare pool proof" className="span-7">
          <p>
            Generates the upstream private-pool `PreparedProverTx` in this
            browser and exposes the first output commitment to Nebula.
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
          <div className="actions">
            <ActionButton
              variant="primary"
              onClick={() => void prepareDeposit()}
              disabled={!initialized || !patchedPrepareOnly || !derivedKeys}
            >
              <ShieldCheck size={16} /> Prepare proof
            </ActionButton>
            <ActionButton onClick={downloadPrepared} disabled={!preparedResult}>
              <Download size={16} /> Export JSON
            </ActionButton>
            <ActionButton onClick={returnToNebula} disabled={!preparedResult}>
              <CheckCircle2 size={16} /> Return to Nebula
            </ActionButton>
          </div>
          <HashRow label="Pool" value={config.poolId} />
          <HashRow
            label="Output commitment"
            value={preparedResult?.outputCommitment}
          />
        </Panel>

        <Panel title="4. Status" className="span-5">
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
