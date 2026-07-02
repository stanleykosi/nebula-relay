"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkPrivateProverAssets,
  decodeSignatureBytes,
  estimateStellarWithdrawFee,
  normalizeBaseUnitAmount,
  normalizeStepCount,
  normalizeWithdrawRecipient,
  privateProverConfig,
  type PrivateProverAssetStatus,
  type PrivateNoteRecoveryResult,
  type PrivateProverProgressEvent,
  type PrivateProverResult,
  type PrivateProverWithdrawResult,
  type StellarWithdrawFeeEstimate,
} from "@/lib/privateProver";
import { requestFreighterAddress, signFreighterMessage } from "@/lib/freighter";
import { persistWallet, storedWalletAddress } from "@/lib/evm-wallet";

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

type RuntimeHealth = {
  ok: boolean;
  assets: PrivateProverAssetStatus[];
};

type InitResult = {
  methods: Record<string, boolean>;
  patchedPrepareOnly: boolean;
};

type RuntimeWithdrawFeePlan = {
  source?: string;
  stepCount?: number;
  step_count?: number;
};

export interface RuntimeUserNotesResult {
  available: boolean;
  notes: unknown;
  count: number;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: number;
};

const PREPARE_PROOF_TIMEOUT_MS = 60 * 60_000;
const WITHDRAW_TIMEOUT_MS = 60 * 60_000;
const NOTE_RECOVERY_TIMEOUT_MS = 90_000;

export function usePrivateProverRuntime() {
  const config = useMemo(() => privateProverConfig(), []);
  const runtimeOrigin = useMemo(
    () =>
      typeof window === "undefined"
        ? ""
        : new URL(config.runtimeUrl, window.location.href).origin,
    [config.runtimeUrl],
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pending = useRef(new Map<string, PendingRequest>());
  const bootPromise = useRef<Promise<void> | null>(null);
  const initializedRef = useRef(false);
  const derivedForAddress = useRef<string>("");

  const [runtimeReady, setRuntimeReady] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [patchedPrepareOnly, setPatchedPrepareOnly] = useState(false);
  const [withdrawAvailable, setWithdrawAvailable] = useState(false);
  const [assets, setAssets] = useState<PrivateProverAssetStatus[]>([]);
  const [walletAddress, setWalletAddress] = useState("");
  const [status, setStatus] = useState("Private prover warming up");
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<PrivateProverProgressEvent[]>([]);
  const [withdrawFee, setWithdrawFee] = useState<StellarWithdrawFeeEstimate>();

  useEffect(() => {
    setWalletAddress(storedWalletAddress("nebula.stellarAddress"));
  }, []);

  useEffect(() => {
    function handleRuntimeMessage(event: MessageEvent<unknown>) {
      if (runtimeOrigin && event.origin !== runtimeOrigin) {
        return;
      }
      const data = event.data as
        RuntimeResponse<unknown> | RuntimeProgressMessage | RuntimeReadyMessage;
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
        request.reject(
          new Error(data.error ?? "Private prover request failed"),
        );
      }
    }

    window.addEventListener("message", handleRuntimeMessage);
    return () => window.removeEventListener("message", handleRuntimeMessage);
  }, [runtimeOrigin]);

  const sendRuntime = useCallback(
    async <T,>(
      command: string,
      payload?: Record<string, unknown>,
      options: { timeoutMs?: number } = {},
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
                `Private prover runtime did not respond to ${command}. Check ${config.runtimeUrl}.`,
              ),
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
        runtimeOrigin || window.location.origin,
      );
      return promise;
    },
    [config.runtimeUrl, runtimeOrigin],
  );

  const retryRuntime = useCallback(
    async <T,>(
      command: string,
      payload: Record<string, unknown> | undefined,
      options: { attempts: number; timeoutMs: number; delayMs: number },
    ): Promise<T> => {
      let lastError: Error | undefined;
      for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
        try {
          return await sendRuntime<T>(command, payload, {
            timeoutMs: options.timeoutMs,
          });
        } catch (caught) {
          lastError =
            caught instanceof Error ? caught : new Error(String(caught));
          if (attempt < options.attempts) {
            await sleep(options.delayMs);
          }
        }
      }
      throw lastError ?? new Error(`Private prover runtime ${command} failed`);
    },
    [sendRuntime],
  );

  const bootRuntime = useCallback(async () => {
    if (bootPromise.current) {
      return bootPromise.current;
    }
    bootPromise.current = (async () => {
      setError(undefined);
      if (!config.stellarRpcUrl) {
        throw new Error("NEXT_PUBLIC_STELLAR_RPC_URL is required");
      }
      setStatus("Checking private prover assets");
      const pageAssets = await checkPrivateProverAssets(config.assetBaseUrl);
      setAssets(pageAssets);
      const missing = pageAssets.filter((asset) => !asset.ok);
      if (missing.length > 0) {
        throw new Error(
          `Private prover assets are missing: ${missing
            .map(
              (asset) =>
                `${asset.name}${asset.status ? ` (${asset.status})` : ""}`,
            )
            .join(", ")}`,
        );
      }

      setStatus("Waiting for private prover frame");
      await waitForRuntimeFrame(iframeRef);

      setStatus("Checking private prover runtime");
      const runtimeHealth = await retryRuntime<RuntimeHealth>(
        "health",
        undefined,
        {
          attempts: 6,
          timeoutMs: 5_000,
          delayMs: 750,
        },
      );
      setRuntimeReady(true);
      setAssets(
        runtimeHealth.assets.length ? runtimeHealth.assets : pageAssets,
      );
      if (!runtimeHealth.ok) {
        throw new Error("Private prover runtime assets failed health check");
      }

      setStatus("Initializing private prover runtime");
      const init = await retryRuntime<InitResult>(
        "init",
        {
          rpcUrl: config.stellarRpcUrl,
          bootnodeUrl: config.bootnodeUrl,
        },
        {
          attempts: 2,
          timeoutMs: 90_000,
          delayMs: 1_000,
        },
      );
      if (!init.patchedPrepareOnly) {
        throw new Error("Private prover runtime loaded without prepareDeposit");
      }
      initializedRef.current = true;
      setInitialized(true);
      setPatchedPrepareOnly(init.patchedPrepareOnly);
      setWithdrawAvailable(init.methods.executeWithdraw === true);
      setStatus("Private prover ready");
    })().catch((caught) => {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setStatus("Private prover unavailable");
      bootPromise.current = null;
      throw caught;
    });
    return bootPromise.current;
  }, [config, retryRuntime]);

  useEffect(() => {
    void bootRuntime().catch(() => undefined);
  }, [bootRuntime]);

  const connectStellar = useCallback(async (): Promise<string> => {
    setStatus("Connecting Stellar wallet");
    const address = await requestFreighterAddress();
    persistWallet("nebula.stellarAddress", address);
    setWalletAddress(address);
    setStatus("Stellar wallet connected");
    return address;
  }, []);

  const ensureWalletKeys = useCallback(
    async (address: string, options: { force?: boolean } = {}) => {
      await bootRuntime();
      if (!initializedRef.current) {
        throw new Error("Private prover runtime is not initialized");
      }
      if (!options.force && derivedForAddress.current === address) {
        return;
      }
      setStatus("Signing note-key derivation message");
      const message = await sendRuntime<string>("keyDerivationMessage");
      const response = await signFreighterMessage(message, {
        address,
        networkPassphrase: config.networkPassphrase,
      });
      const signatureBytes = decodeSignatureBytes(response.signedMessage);
      setStatus("Deriving private note keys");
      await sendRuntime("deriveKeys", { address, signatureBytes });
      await sendRuntime("aspRegistrationPayload", { address });
      derivedForAddress.current = address;
      setStatus("Private note keys ready");
    },
    [bootRuntime, config.networkPassphrase, sendRuntime],
  );

  const prepareDeposit = useCallback(
    async (
      amount: string,
      ownerAddress?: string,
    ): Promise<PrivateProverResult> => {
      const address = ownerAddress || walletAddress || (await connectStellar());
      await ensureWalletKeys(address);
      if (!config.poolId) {
        throw new Error("NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID is required");
      }
      const normalizedAmount = normalizeBaseUnitAmount(amount);
      setStatus("Preparing private pool proof");
      const result = await sendRuntime<PrivateProverResult>(
        "prepareDeposit",
        {
          poolId: config.poolId,
          address,
          amount: normalizedAmount,
          outputAmounts: [normalizedAmount, "0"],
        },
        { timeoutMs: PREPARE_PROOF_TIMEOUT_MS },
      );
      window.localStorage.setItem(
        "nebula.privateProver.latest",
        JSON.stringify(result),
      );
      setStatus("Private pool proof ready");
      return result;
    },
    [
      config.poolId,
      connectStellar,
      ensureWalletKeys,
      sendRuntime,
      walletAddress,
    ],
  );

  const quoteWithdrawFee = useCallback(
    async (input: {
      amount: string;
      recipient?: string;
      address?: string;
      quiet?: boolean;
    }): Promise<StellarWithdrawFeeEstimate> => {
      const normalizedAmount = normalizeBaseUnitAmount(input.amount);
      if (input.recipient?.trim()) {
        normalizeWithdrawRecipient(input.recipient);
      }
      const ownerAddress = input.address || walletAddress;
      let fee = estimateStellarWithdrawFee({
        resourceFeeStroopsPerStep: config.withdrawResourceFeeEstimateStroops,
        source: "base-estimate",
      });

      if (ownerAddress && config.poolId && withdrawAvailable) {
        try {
          await bootRuntime();
          if (!input.quiet) {
            setStatus("Estimating Stellar withdrawal fee");
          }
          const plan = await sendRuntime<RuntimeWithdrawFeePlan>(
            "quoteWithdrawFee",
            {
              poolId: config.poolId,
              address: ownerAddress,
              amount: normalizedAmount,
            },
            { timeoutMs: 12_000 },
          );
          fee = estimateStellarWithdrawFee({
            stepCount: normalizeStepCount(plan.stepCount ?? plan.step_count),
            resourceFeeStroopsPerStep:
              config.withdrawResourceFeeEstimateStroops,
            source: "runtime-plan-estimate",
          });
        } catch {
          fee = estimateStellarWithdrawFee({
            resourceFeeStroopsPerStep:
              config.withdrawResourceFeeEstimateStroops,
            source: "base-estimate",
          });
        }
      }

      setWithdrawFee(fee);
      if (!input.quiet) {
        setStatus("Stellar withdrawal fee estimated");
      }
      return fee;
    },
    [
      bootRuntime,
      config.poolId,
      config.withdrawResourceFeeEstimateStroops,
      sendRuntime,
      walletAddress,
      withdrawAvailable,
    ],
  );

  const withdraw = useCallback(
    async (input: {
      amount: string;
      recipient: string;
    }): Promise<PrivateProverWithdrawResult> => {
      const address = walletAddress || (await connectStellar());
      await ensureWalletKeys(address);
      if (!config.poolId) {
        throw new Error("NEXT_PUBLIC_PRIVATE_PAYMENTS_POOL_ID is required");
      }
      if (!withdrawAvailable) {
        throw new Error("Private prover runtime does not expose withdrawals");
      }
      const normalizedAmount = normalizeBaseUnitAmount(input.amount);
      const normalizedRecipient = normalizeWithdrawRecipient(
        input.recipient || address,
      );
      const feeEstimate = await quoteWithdrawFee({
        amount: normalizedAmount,
        recipient: normalizedRecipient,
        address,
        quiet: true,
      });
      setStatus("Submitting private withdrawal");
      const result = await sendRuntime<PrivateProverWithdrawResult>(
        "executeWithdraw",
        {
          poolId: config.poolId,
          address,
          withdrawRecipient: normalizedRecipient,
          amount: normalizedAmount,
          networkPassphrase: config.networkPassphrase,
        },
        { timeoutMs: WITHDRAW_TIMEOUT_MS },
      );
      const withdrawResult = { ...result, feeEstimate };
      window.localStorage.setItem(
        "nebula.privateProver.latestWithdraw",
        JSON.stringify(withdrawResult),
      );
      setStatus("Private withdrawal submitted");
      return withdrawResult;
    },
    [
      config.networkPassphrase,
      config.poolId,
      connectStellar,
      ensureWalletKeys,
      quoteWithdrawFee,
      sendRuntime,
      walletAddress,
      withdrawAvailable,
    ],
  );

  const getUserNotes = useCallback(
    async (
      input: {
        address?: string;
        limit?: number;
      } = {},
    ): Promise<RuntimeUserNotesResult> => {
      const address =
        input.address || walletAddress || (await connectStellar());
      await ensureWalletKeys(address);
      return sendRuntime<RuntimeUserNotesResult>(
        "getUserNotes",
        {
          address,
          limit: input.limit ?? 25,
        },
        { timeoutMs: 20_000 },
      );
    },
    [connectStellar, ensureWalletKeys, sendRuntime, walletAddress],
  );

  const recoverNoteState = useCallback(
    async (input: {
      address?: string;
      noteCommitment: string;
      poolId: string;
      amount: string;
      limit?: number;
      timeoutMs?: number;
      pollIntervalMs?: number;
      forceKeyDerivation?: boolean;
    }): Promise<PrivateNoteRecoveryResult> => {
      const address =
        input.address || walletAddress || (await connectStellar());
      await ensureWalletKeys(address, {
        force: input.forceKeyDerivation ?? true,
      });
      const timeoutMs = input.timeoutMs ?? NOTE_RECOVERY_TIMEOUT_MS;
      setStatus("Recovering private note state");
      const result = await sendRuntime<PrivateNoteRecoveryResult>(
        "recoverNoteState",
        {
          address,
          noteCommitment: input.noteCommitment,
          poolId: input.poolId,
          amount: normalizeBaseUnitAmount(input.amount),
          limit: input.limit ?? 50,
          timeoutMs,
          pollIntervalMs: input.pollIntervalMs ?? 1_500,
        },
        { timeoutMs: timeoutMs + 15_000 },
      );
      setStatus(
        result.recovered
          ? "Private note state recovered"
          : "Private note recovery still syncing",
      );
      return result;
    },
    [connectStellar, ensureWalletKeys, sendRuntime, walletAddress],
  );

  const frame = (
    <iframe
      ref={iframeRef}
      className="runtime-frame"
      src={config.runtimeUrl}
      title="Nebula private prover runtime"
      onLoad={() => setRuntimeReady(true)}
    />
  );

  return {
    assets,
    bootRuntime,
    connectStellar,
    error,
    frame,
    getUserNotes,
    initialized,
    networkPassphrase: config.networkPassphrase,
    patchedPrepareOnly,
    prepareDeposit,
    progress,
    quoteWithdrawFee,
    recoverNoteState,
    runtimeReady,
    status,
    walletAddress,
    withdraw,
    withdrawAvailable,
    withdrawFee,
  };
}

function waitForRuntimeFrame(ref: React.RefObject<HTMLIFrameElement | null>) {
  return new Promise<void>((resolve, reject) => {
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      if (ref.current?.contentWindow) {
        resolve();
        return;
      }
      if (attempts > 50) {
        reject(new Error("Private prover runtime frame did not mount"));
        return;
      }
      window.setTimeout(tick, 100);
    };
    tick();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
