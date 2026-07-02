"use client";

import Link from "next/link";
import {
  ArrowDownToLine,
  CheckCircle2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  baseUnitsToUsdc,
  getNoteBackup,
  getIntent,
  shortHash,
  usdcToBaseUnits,
} from "@/lib/nebula-api";
import { usePrivateProverRuntime } from "@/lib/private-prover-runtime";
import {
  findSpendablePrivateNote,
  type PrivateNoteRecoveryResult,
  type PrivateProverWithdrawResult,
  type StellarWithdrawFeeEstimate,
} from "@/lib/privateProver";
import { decryptNoteBackup } from "@/lib/note-backup";
import {
  getNoteByIntentId,
  markNoteRuntimeState,
  storeRestoredNote,
  type NebulaNoteRecord,
} from "@/lib/note-vault";

type RecipientMode = "connected" | "custom";

export function WithdrawPage({ intentId }: { intentId?: string }) {
  const prover = usePrivateProverRuntime();
  const [amount, setAmount] = useState("1000");
  const [recipientMode, setRecipientMode] =
    useState<RecipientMode>("connected");
  const [customRecipient, setCustomRecipient] = useState("");
  const [result, setResult] = useState<PrivateProverWithdrawResult>();
  const [feeEstimate, setFeeEstimate] = useState<StellarWithdrawFeeEstimate>();
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeError, setFeeError] = useState<string>();
  const [error, setError] = useState<string>();
  const [noteError, setNoteError] = useState<string>();
  const [noteRecord, setNoteRecord] = useState<NebulaNoteRecord | null>(null);
  const [noteLoading, setNoteLoading] = useState(Boolean(intentId));
  const [restoreWorking, setRestoreWorking] = useState(false);
  const [recoverWorking, setRecoverWorking] = useState(false);
  const [runtimeRecovered, setRuntimeRecovered] = useState<boolean | null>(
    null,
  );
  const [runtimeNoteCount, setRuntimeNoteCount] = useState<number | null>(null);
  const [recoveryResult, setRecoveryResult] =
    useState<PrivateNoteRecoveryResult>();
  const [working, setWorking] = useState(false);

  const intentQuery = useQuery({
    queryKey: ["intent", intentId],
    queryFn: () => getIntent(intentId ?? ""),
    enabled: Boolean(intentId),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (intentQuery.data?.receiveAmount) {
      setAmount(baseUnitsToUsdc(intentQuery.data.receiveAmount));
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem("nebula.privateProver.latest") ?? "null",
      ) as { amount?: unknown } | null;
      if (typeof parsed?.amount === "string") {
        setAmount(baseUnitsToUsdc(parsed.amount));
      }
    } catch {
      // Ignore malformed local runtime cache; the user can type the amount.
    }
  }, [intentQuery.data]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!intentId) {
        setNoteLoading(false);
        setNoteRecord(null);
        return;
      }
      setNoteLoading(true);
      setNoteError(undefined);
      try {
        const record = await getNoteByIntentId(intentId);
        if (!cancelled) {
          setNoteRecord(record);
          setRuntimeRecovered(
            record?.runtimeState === "runtime_recovered" ? true : null,
          );
        }
      } catch (caught) {
        if (!cancelled) {
          setNoteError(
            caught instanceof Error ? caught.message : String(caught),
          );
        }
      } finally {
        if (!cancelled) {
          setNoteLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [intentId]);

  const recipient = useMemo(
    () =>
      recipientMode === "connected"
        ? prover.walletAddress
        : customRecipient.trim(),
    [customRecipient, prover.walletAddress, recipientMode],
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setFeeError(undefined);
        try {
          const amountBaseUnits = usdcToBaseUnits(amount);
          setFeeLoading(true);
          const estimate = await prover.quoteWithdrawFee({
            amount: amountBaseUnits,
            recipient,
            quiet: true,
          });
          if (!cancelled) {
            setFeeEstimate(estimate);
          }
        } catch (caught) {
          if (!cancelled) {
            setFeeEstimate(undefined);
            setFeeError(
              caught instanceof Error ? caught.message : String(caught),
            );
          }
        } finally {
          if (!cancelled) {
            setFeeLoading(false);
          }
        }
      })();
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [amount, prover.quoteWithdrawFee, recipient]);

  const recoverRuntimeNote = async (
    record: NebulaNoteRecord,
    ownerAddress: string,
  ): Promise<boolean> => {
    setRecoverWorking(true);
    setNoteError(undefined);
    try {
      const recovery = await prover.recoverNoteState({
        address: ownerAddress,
        noteCommitment: record.noteCommitment,
        poolId: record.poolId,
        amount: record.amount,
        timeoutMs: 90_000,
        forceKeyDerivation:
          record.runtimeState !== "runtime_recovered" &&
          runtimeRecovered !== true,
      });
      const verifiedMatch = findSpendablePrivateNote(recovery.notes, {
        noteCommitment: record.noteCommitment,
        poolId: record.poolId,
        amount: record.amount,
      });
      const verifiedRecovery = {
        ...recovery,
        ...verifiedMatch,
        recovered: recovery.recovered && verifiedMatch.spendable,
      };
      setRecoveryResult(verifiedRecovery);
      setRuntimeNoteCount(verifiedRecovery.count);
      setRuntimeRecovered(verifiedRecovery.recovered);
      if (!verifiedRecovery.recovered) {
        setNoteError(recoveryFailureMessage(verifiedRecovery));
        if (record.intentId) {
          const updated = await markNoteRuntimeState(
            record.intentId,
            "runtime_recovery_pending",
          );
          setNoteRecord(
            updated ?? { ...record, runtimeState: "runtime_recovery_pending" },
          );
        }
        return false;
      }

      if (record.intentId) {
        const updated = await markNoteRuntimeState(
          record.intentId,
          "runtime_recovered",
        );
        setNoteRecord(
          updated ?? { ...record, runtimeState: "runtime_recovered" },
        );
      } else {
        setNoteRecord({ ...record, runtimeState: "runtime_recovered" });
      }
      setNoteError(undefined);
      return true;
    } finally {
      setRecoverWorking(false);
    }
  };

  const submitWithdraw = async () => {
    setError(undefined);
    setNoteError(undefined);
    setResult(undefined);
    setWorking(true);
    try {
      const connected = prover.walletAddress || (await prover.connectStellar());
      if (intentId) {
        const record = noteRecord ?? (await getNoteByIntentId(intentId));
        if (!record) {
          throw new Error(
            "Restore the encrypted note backup or use the original browser before withdrawing this intent.",
          );
        }
        if (record.ownerAddress !== connected) {
          throw new Error(
            "Connect the Stellar wallet that owns this private note.",
          );
        }
        const recovered = await recoverRuntimeNote(record, connected);
        if (!recovered) {
          throw new Error(
            "The encrypted note backup is restored, but the private prover has not rebuilt the spendable note state yet. Keep this screen open and retry recovery once the indexer catches up.",
          );
        }
      }
      const withdrawRecipient =
        recipientMode === "connected" ? connected : customRecipient.trim();
      const response = await prover.withdraw({
        amount: usdcToBaseUnits(amount),
        recipient: withdrawRecipient,
      });
      setResult(response);
      if (response.feeEstimate) {
        setFeeEstimate(response.feeEstimate);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWorking(false);
    }
  };

  const restoreNote = async () => {
    if (!intentId) {
      return;
    }
    setRestoreWorking(true);
    setNoteError(undefined);
    try {
      const connected = prover.walletAddress || (await prover.connectStellar());
      const backup = await getNoteBackup({
        intentId,
        stellarAccount: connected,
      });
      const restored = await decryptNoteBackup({
        backup,
        networkPassphrase: prover.networkPassphrase,
      });
      const saved = await storeRestoredNote(restored);
      setNoteRecord(saved);
      await recoverRuntimeNote(saved, connected);
    } catch (caught) {
      setNoteError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRestoreWorking(false);
    }
  };

  const recoverCurrentNote = async () => {
    if (!noteRecord) {
      return;
    }
    setNoteError(undefined);
    try {
      const connected = prover.walletAddress || (await prover.connectStellar());
      if (noteRecord.ownerAddress !== connected) {
        throw new Error(
          "Connect the Stellar wallet that owns this private note.",
        );
      }
      await recoverRuntimeNote(noteRecord, connected);
    } catch (caught) {
      setNoteError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <main className="product-page">
      {prover.frame}
      <div className="page-head">
        <div>
          <span className="label-caps">
            <ShieldCheck size={15} /> Private Pool
          </span>
          <h1>Withdraw Privately</h1>
          <p className="lead">
            Spend an owned Stellar private-pool note to the connected wallet or
            another Stellar public key.
          </p>
        </div>
        <span
          className={`status-pill ${prover.withdrawAvailable ? "ok" : "warn"}`}
        >
          {prover.withdrawAvailable ? "Withdraw ready" : "Runtime loading"}
        </span>
      </div>

      <div className="withdraw-layout">
        <aside className="withdraw-card">
          <h2>Available private balance</h2>
          <p>
            {intentId
              ? "Prefilled from the selected bridge intent."
              : "Prefilled from the latest prepared note when available."}
          </p>
          <div className="balance-number">{amount}</div>
          <span className="caption">USDC</span>
          <div className="summary-list">
            <div className="summary-row">
              <span>Intent</span>
              <strong className="mono">{shortHash(intentId)}</strong>
            </div>
            <div className="summary-row">
              <span>Connected owner</span>
              <strong className="mono">
                {shortHash(prover.walletAddress)}
              </strong>
            </div>
            <div className="summary-row">
              <span>Runtime</span>
              <strong>{prover.status}</strong>
            </div>
            <div className="summary-row">
              <span>Note record</span>
              <strong>
                {noteLoading
                  ? "Checking..."
                  : noteRecord
                    ? noteRecord.backupStatus === "restored"
                      ? "Restored"
                      : "Local"
                    : "Missing"}
              </strong>
            </div>
            <div className="summary-row">
              <span>Runtime notes</span>
              <strong>
                {runtimeNoteCount === null
                  ? "Unchecked"
                  : `${runtimeNoteCount} indexed`}
              </strong>
            </div>
            <div className="summary-row">
              <span>Runtime note state</span>
              <strong>{runtimeStateLabel(runtimeRecovered, noteRecord)}</strong>
            </div>
          </div>
          <button
            className="button-secondary"
            type="button"
            onClick={() => void prover.connectStellar()}
          >
            <Wallet size={16} /> Connect Stellar Owner
          </button>
          {intentId && !noteRecord ? (
            <button
              className="button-secondary"
              type="button"
              disabled={restoreWorking}
              onClick={() => void restoreNote()}
            >
              <ShieldCheck size={16} />
              {restoreWorking ? "Restoring note" : "Restore Encrypted Note"}
            </button>
          ) : null}
          {intentId && noteRecord ? (
            <button
              className="button-secondary"
              type="button"
              disabled={recoverWorking || restoreWorking}
              onClick={() => void recoverCurrentNote()}
            >
              <ShieldCheck size={16} />
              {recoverWorking
                ? "Recovering note state"
                : runtimeRecovered
                  ? "Recheck Note State"
                  : "Recover Note State"}
            </button>
          ) : null}
        </aside>

        <section className="withdraw-card">
          <h2>Withdraw recipient</h2>
          <p>
            Use the note owner wallet for a fast withdrawal, or send to a
            different Stellar wallet without exposing the EVM source wallet.
          </p>

          <div className="radio-grid">
            <button
              className={`radio-card ${recipientMode === "connected" ? "active" : ""}`}
              type="button"
              onClick={() => setRecipientMode("connected")}
            >
              <strong>Connected Stellar Wallet</strong>
              <span>
                {prover.walletAddress
                  ? shortHash(prover.walletAddress)
                  : "Connect wallet first"}
              </span>
            </button>
            <button
              className={`radio-card ${recipientMode === "custom" ? "active" : ""}`}
              type="button"
              onClick={() => setRecipientMode("custom")}
            >
              <strong>Another Address</strong>
              <span>Withdraw to any Stellar public key you control.</span>
            </button>
          </div>

          {recipientMode === "custom" ? (
            <label className="field">
              <span>Stellar address</span>
              <input
                className="text-input mono"
                placeholder="G..."
                value={customRecipient}
                onChange={(event) => setCustomRecipient(event.target.value)}
                spellCheck={false}
              />
            </label>
          ) : null}

          <label className="field">
            <span>Withdraw amount</span>
            <input
              className="text-input amount-input"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              spellCheck={false}
            />
          </label>

          <div className="summary-list">
            <div className="summary-row">
              <span>Recipient</span>
              <strong className="mono">{shortHash(recipient)}</strong>
            </div>
            <div className="summary-row">
              <span>Estimated receive</span>
              <strong>{amount} USDC</strong>
            </div>
            <div className="summary-row">
              <span>Stellar fee</span>
              <strong>
                {feeLoading
                  ? "Estimating..."
                  : feeEstimate
                    ? `${feeEstimate.totalFeeXlm} XLM`
                    : "Connect owner for estimate"}
              </strong>
            </div>
            <div className="summary-row">
              <span>Fee basis</span>
              <strong>
                {feeEstimate ? feeBasisLabel(feeEstimate) : "Soroban XLM"}
              </strong>
            </div>
          </div>

          {error ? <div className="notice danger">{error}</div> : null}
          {noteError ? <div className="notice warn">{noteError}</div> : null}
          {feeError ? <div className="notice warn">{feeError}</div> : null}
          {prover.error ? (
            <div className="notice warn">{prover.error}</div>
          ) : null}
          {recoveryResult?.recovered ? (
            <div className="notice">
              Spendable note state recovered after {recoveryResult.attempts}{" "}
              check
              {recoveryResult.attempts === 1 ? "" : "s"}.
            </div>
          ) : null}

          {prover.progress.length > 0 ? (
            <div className="runtime-progress">
              {prover.progress.slice(-3).map((event, index) => (
                <p
                  key={`${event.flow ?? "flow"}-${event.stage ?? "stage"}-${index}`}
                >
                  {event.message ??
                    event.stage ??
                    event.flow ??
                    "Private prover progress"}
                </p>
              ))}
            </div>
          ) : null}

          <div className="cta-row">
            <button
              className="button-primary"
              type="button"
              disabled={
                working ||
                restoreWorking ||
                recoverWorking ||
                (Boolean(intentId) && !noteRecord)
              }
              onClick={() => void submitWithdraw()}
            >
              {working
                ? "Preparing withdrawal"
                : recoverWorking
                  ? "Recovering note"
                  : intentId && !noteRecord
                    ? "Restore Note First"
                    : "Prepare Withdrawal"}
              <ArrowDownToLine size={16} />
            </button>
            <Link className="button-secondary" href="/activity">
              View Activity
            </Link>
          </div>

          {result ? (
            <div className="result-box">
              <span className="status-pill ok">
                <CheckCircle2 size={14} /> Withdrawal submitted
              </span>
              <div className="ledger">
                <div className="ledger-row">
                  <span>Tx hash</span>
                  <strong className="mono">
                    {shortHash(result.txHash, 10, 8)}
                  </strong>
                </div>
                <div className="ledger-row">
                  <span>Status</span>
                  <strong>{result.status ?? "submitted"}</strong>
                </div>
                <div className="ledger-row">
                  <span>Recipient</span>
                  <strong className="mono">
                    {shortHash(result.withdrawRecipient, 8, 6)}
                  </strong>
                </div>
                {result.feeEstimate ? (
                  <div className="ledger-row">
                    <span>Estimated Stellar fee</span>
                    <strong>{result.feeEstimate.totalFeeXlm} XLM</strong>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function feeBasisLabel(fee: StellarWithdrawFeeEstimate): string {
  if (fee.source === "runtime-plan-estimate") {
    return `${fee.stepCount} private tx${fee.stepCount === 1 ? "" : "s"}, plan-aware`;
  }
  return "Conservative fallback";
}

function runtimeStateLabel(
  recovered: boolean | null,
  record: NebulaNoteRecord | null,
): string {
  if (!record) {
    return "Missing";
  }
  if (recovered === true || record.runtimeState === "runtime_recovered") {
    return "Recovered";
  }
  if (
    recovered === false ||
    record.runtimeState === "runtime_recovery_pending"
  ) {
    return "Recovery pending";
  }
  return "Unchecked";
}

function recoveryFailureMessage(recovery: PrivateNoteRecoveryResult): string {
  const lastError = recovery.lastError
    ? ` Last runtime error: ${recovery.lastError}`
    : "";
  return `Encrypted note backup restored, but this browser has not rebuilt the upstream spendable-note state for the exact commitment yet. Recovery checked ${recovery.attempts} time${recovery.attempts === 1 ? "" : "s"} and found ${recovery.count} unspent indexed note${recovery.count === 1 ? "" : "s"}.${lastError}`;
}
