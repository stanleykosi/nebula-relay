"use client";

import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  RadioTower,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  attachSourceTx,
  baseUnitsToUsdc,
  createIntent,
  createQuote,
  getBackendConfig,
  rememberIntentId,
  saveNoteBackup,
  shortHash,
  usdcToBaseUnits,
  type BackendConfig,
  type BridgeQuote,
} from "@/lib/nebula-api";
import {
  connectEvmWallet,
  readErc20Allowance,
  sendEvmAction,
  storedWalletAddress,
  switchEvmChain,
  waitForEvmReceipt,
  type ConnectedEvmWallet,
} from "@/lib/evm-wallet";
import { usePrivateProverRuntime } from "@/lib/private-prover-runtime";
import { encryptNoteBackup } from "@/lib/note-backup";
import {
  createDraftNoteRecord,
  markNoteBackupSaved,
  promoteDraftNoteToIntent,
  saveDraftNote,
} from "@/lib/note-vault";

type BridgePhase =
  | "idle"
  | "quote"
  | "prepare_note"
  | "save_note"
  | "create_intent"
  | "backup_note"
  | "check_allowance"
  | "approve"
  | "lock"
  | "confirm_lock"
  | "attach"
  | "complete";

const phaseCopy: Record<BridgePhase, string> = {
  idle: "Ready",
  quote: "Fetching quote",
  prepare_note: "Preparing private note",
  save_note: "Saving local note",
  create_intent: "Creating bridge intent",
  backup_note: "Encrypting note backup",
  check_allowance: "Checking USDC allowance",
  approve: "Requesting USDC approval",
  lock: "Signing EVM lock",
  confirm_lock: "Confirming source lock",
  attach: "Handing source tx to Nebula",
  complete: "Bridge submitted",
};

const phaseProgress: Record<BridgePhase, number> = {
  idle: 0,
  quote: 4,
  prepare_note: 18,
  save_note: 26,
  create_intent: 36,
  backup_note: 46,
  check_allowance: 56,
  approve: 66,
  lock: 76,
  confirm_lock: 86,
  attach: 94,
  complete: 100,
};

export function BridgePage() {
  const router = useRouter();
  const prover = usePrivateProverRuntime();
  const [amount, setAmount] = useState("1000");
  const [stellarOwner, setStellarOwner] = useState("");
  const [config, setConfig] = useState<BackendConfig>();
  const [quote, setQuote] = useState<BridgeQuote>();
  const [phase, setPhase] = useState<BridgePhase>("idle");
  const [evmWallet, setEvmWallet] = useState<ConnectedEvmWallet>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [notePrepared, setNotePrepared] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [noteBackedUp, setNoteBackedUp] = useState(false);
  const [noteBackupAt, setNoteBackupAt] = useState("");
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [approvalSkipped, setApprovalSkipped] = useState(false);
  const [lastApprovalHash, setLastApprovalHash] = useState("");
  const [lastLockHash, setLastLockHash] = useState("");
  const [lockConfirmed, setLockConfirmed] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setStellarOwner(storedWalletAddress("nebula.stellarAddress"));
  }, []);

  useEffect(() => {
    setReviewOpen(false);
  }, [amount]);

  useEffect(() => {
    let cancelled = false;
    void getBackendConfig()
      .then((value) => {
        if (!cancelled) {
          setConfig(value);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      try {
        const receiveAmount = usdcToBaseUnits(amount);
        setPhase((current) => (current === "idle" ? "quote" : current));
        void createQuote(receiveAmount)
          .then((value) => {
            if (!cancelled) {
              setQuote(value);
              setPhase((current) => (current === "quote" ? "idle" : current));
            }
          })
          .catch((caught) => {
            if (!cancelled) {
              setQuote(undefined);
              setPhase((current) => (current === "quote" ? "idle" : current));
              setError(caught instanceof Error ? caught.message : String(caught));
            }
          });
      } catch {
        setQuote(undefined);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [amount]);

  const isWorking = phase !== "idle" && phase !== "quote";
  const netAmount = useMemo(() => {
    try {
      return baseUnitsToUsdc(usdcToBaseUnits(amount));
    } catch {
      return "0.00";
    }
  }, [amount]);

  const connectEvm = async () => {
    setError(undefined);
    try {
      const wallet = await connectEvmWallet();
      setEvmWallet(wallet);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const connectStellar = async () => {
    setError(undefined);
    try {
      const address = await prover.connectStellar();
      setStellarOwner(address);
      setReviewOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const openReview = async () => {
    setError(undefined);
    if (!stellarOwner) {
      try {
        const address = await prover.connectStellar();
        setStellarOwner(address);
        setReviewOpen(true);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
      return;
    }
    setReviewOpen(true);
  };

  const submitBridge = async () => {
    if (!quote) {
      setError("Quote is not ready yet.");
      return;
    }
    setError(undefined);
    setReviewOpen(false);
    setNotePrepared(false);
    setNoteSaved(false);
    setNoteBackedUp(false);
    setNoteBackupAt("");
    setApprovalConfirmed(false);
    setApprovalSkipped(false);
    setLastApprovalHash("");
    setLastLockHash("");
    setLockConfirmed(false);
    try {
      const receiveAmount = usdcToBaseUnits(amount);
      const stellarAccount = stellarOwner || (await prover.connectStellar());
      setStellarOwner(stellarAccount);

      setPhase("prepare_note");
      const privatePoolProof = await prover.prepareDeposit(receiveAmount, stellarAccount);
      setNotePrepared(true);

      setPhase("save_note");
      const draftNote = createDraftNoteRecord({
        ownerAddress: stellarAccount,
        preparedProverResult: privatePoolProof,
        quote,
      });
      await saveDraftNote(draftNote);
      setNoteSaved(true);

      setPhase("create_intent");
      const response = await createIntent({
        receiveAmount,
        stellarAccount,
        privatePoolProof,
      });
      rememberIntentId(response.intent.id);

      const intentNote = await promoteDraftNoteToIntent({
        draftId: draftNote.draftId,
        intent: response.intent,
        quote: response.quote,
      });
      setPhase("backup_note");
      const encryptedBackup = await encryptNoteBackup({
        record: intentNote,
        networkPassphrase: prover.networkPassphrase,
      });
      const savedBackup = await saveNoteBackup({
        intentId: response.intent.id,
        ...encryptedBackup,
      });
      await markNoteBackupSaved(response.intent.id, savedBackup.updatedAt);
      setNoteBackupAt(savedBackup.updatedAt);
      setNoteBackedUp(true);

      const wallet = evmWallet ?? (await connectEvmWallet());
      setEvmWallet(wallet);
      if (wallet.chainId !== response.sourceAction.chainId) {
        await switchEvmChain(response.sourceAction.chainId);
      }

      setPhase("check_allowance");
      const allowance = await readErc20Allowance({
        token: response.sourceAction.token,
        owner: wallet.address,
        spender: response.sourceAction.spender,
      });
      if (allowance < BigInt(response.sourceAction.grossAmount)) {
        setPhase("approve");
        const approvalHash = await sendEvmAction({
          from: wallet.address,
          action: response.sourceAction.approval,
        });
        setLastApprovalHash(approvalHash);
        await waitForEvmReceipt(approvalHash, { label: "approval transaction" });
      } else {
        setApprovalSkipped(true);
      }
      setApprovalConfirmed(true);

      setPhase("lock");
      const lockHash = await sendEvmAction({
        from: wallet.address,
        action: response.sourceAction.lockAndBurn,
      });
      setLastLockHash(lockHash);
      setPhase("confirm_lock");
      await waitForEvmReceipt(lockHash, { label: "source lock transaction" });
      setLockConfirmed(true);

      setPhase("attach");
      await attachSourceTx({ intentId: response.intent.id, txHash: lockHash });

      setPhase("complete");
      router.push(`/bridge/${response.intent.id}`);
    } catch (caught) {
      setPhase("idle");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <main className="product-page">
      {prover.frame}
      <div className="page-head">
        <div>
          <span className="label-caps">
            <RadioTower size={15} /> Initialize Bridge
          </span>
          <h1>Bridge Assets</h1>
          <p className="lead">
            Connect the Stellar wallet that will own the private note, review
            the gross EVM spend, then let Nebula prove and claim settlement into
            the private pool.
          </p>
        </div>
        <div className="head-actions">
          <span className={`status-pill ${prover.initialized ? "ok" : "warn"}`}>
            {prover.initialized ? "Prover ready" : "Prover warming"}
          </span>
        </div>
      </div>

      <div className="bridge-layout">
        <section className="bridge-card">
          <h2>Transfer setup</h2>
          <p>Source and destination are fixed to the current Nebula testnet route.</p>

          <div className="route-card">
            <div className="route-row">
              <span className="route-label">Source Network</span>
              <strong className="route-value">
                {config?.sourceNetwork ?? "Ethereum Sepolia"}
              </strong>
            </div>
            <div className="route-row">
              <span className="route-label">Destination</span>
              <strong className="route-value">
                {config?.destinationNetwork ?? "Stellar private pool"}
              </strong>
            </div>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>Amount</span>
              <input
                className="text-input amount-input"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Asset</span>
              <input className="text-input" readOnly value="USDC" />
            </label>
          </div>

          <label className="field">
            <span>Private note owner</span>
            <input
              className="text-input mono"
              placeholder="Connect Stellar wallet"
              value={stellarOwner}
              readOnly
              spellCheck={false}
            />
          </label>

          <div className="button-row">
            <button className="button-secondary" type="button" onClick={connectEvm}>
              <Wallet size={17} />
              {evmWallet?.address ? shortHash(evmWallet.address) : "Connect EVM"}
            </button>
            <button className="button-secondary" type="button" onClick={connectStellar}>
              <ShieldCheck size={17} />
              {stellarOwner ? shortHash(stellarOwner) : "Connect Stellar"}
            </button>
          </div>

          <div className="notice">
            The connected Stellar wallet is the note owner for this bridge. Use
            the withdrawal screen later to send the private balance to another
            Stellar address.
          </div>

          <div className="summary-list">
            <div className="summary-row">
              <span>Net private note</span>
              <strong>{netAmount} USDC</strong>
            </div>
            <div className="summary-row">
              <span>CCTP fee estimate</span>
              <strong>{quote ? baseUnitsToUsdc(quote.expectedCctpFee) : "..."}</strong>
            </div>
            <div className="summary-row">
              <span>Gross EVM spend</span>
              <strong>{quote ? baseUnitsToUsdc(quote.grossAmount) : "..."} USDC</strong>
            </div>
            <div className="summary-row">
              <span>Private pool</span>
              <strong className="mono">
                {shortHash(config?.stellar.privatePaymentsPoolId, 8, 6)}
              </strong>
            </div>
            <div className="summary-row">
              <span>Note safety gate</span>
              <strong>
                {noteBackedUp
                  ? "Encrypted backup saved"
                  : noteSaved
                    ? "Local note saved"
                    : "Before EVM lock"}
              </strong>
            </div>
          </div>

          {reviewOpen && quote ? (
            <div className="review-panel">
              <span className="label-caps">
                <ShieldCheck size={15} /> Review Before Signing
              </span>
              <h3>Confirm this private bridge</h3>
              <div className="summary-list">
                <div className="summary-row">
                  <span>Private note owner</span>
                  <strong className="mono">{shortHash(stellarOwner, 8, 6)}</strong>
                </div>
                <div className="summary-row">
                  <span>Net private note</span>
                  <strong>{netAmount} USDC</strong>
                </div>
                <div className="summary-row">
                  <span>CCTP fee estimate</span>
                  <strong>{baseUnitsToUsdc(quote.expectedCctpFee)} USDC</strong>
                </div>
                <div className="summary-row">
                  <span>Maximum EVM spend</span>
                  <strong>{baseUnitsToUsdc(quote.grossAmount)} USDC</strong>
                </div>
              </div>
              <p>
                Nebula saves this private note locally and uploads only an
                encrypted backup before your EVM wallet is asked to approve or
                lock USDC. The source lock transaction is attached after it is
                mined.
              </p>
              <div className="button-row">
                <button
                  className="button-primary"
                  type="button"
                  disabled={isWorking || !stellarOwner}
                  onClick={() => void submitBridge()}
                >
                  Prepare note and bridge <ArrowRight size={17} />
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  disabled={isWorking}
                  onClick={() => setReviewOpen(false)}
                >
                  Edit
                </button>
              </div>
            </div>
          ) : null}

          {error ? <div className="notice danger">{error}</div> : null}

          <div className="cta-row">
            <button
              className="button-primary"
              type="button"
              disabled={isWorking || !quote}
              onClick={() => void openReview()}
            >
              {phase === "idle" || phase === "quote"
                ? stellarOwner
                  ? "Review Bridge"
                  : "Connect Stellar Owner"
                : phaseCopy[phase]}
              <ArrowRight size={17} />
            </button>
            <span className="fine-print">
              Review first. Then private proof, allowance check, EVM lock, and
              backend handoff.
            </span>
          </div>
        </section>

        <aside className="side-card">
          <h2>Transaction path</h2>
          <p>
            The UI is connected to the live API state machine. Each step below is
            a user-visible action or backend transition.
          </p>
          <div className="progress-meter" aria-label="Local bridge progress">
            <span style={{ width: `${phaseProgress[phase]}%` }} />
          </div>
          <div className="progress-rail">
            <MiniStep active={phase === "prepare_note"} complete={notePrepared}>
              Prepare private note
            </MiniStep>
            <MiniStep
              active={phase === "save_note" || phase === "backup_note"}
              complete={noteBackedUp}
            >
              Save encrypted note backup
            </MiniStep>
            <MiniStep
              active={phase === "check_allowance" || phase === "approve"}
              complete={approvalConfirmed}
            >
              {approvalSkipped ? "USDC allowance ready" : "Approve USDC"}
            </MiniStep>
            <MiniStep
              active={phase === "lock" || phase === "confirm_lock"}
              complete={lockConfirmed}
            >
              Lock and confirm source funds
            </MiniStep>
            <MiniStep active={phase === "attach"} complete={phase === "complete"}>
              Submit source tx to Nebula
            </MiniStep>
          </div>

          <div className="summary-list">
            <div className="summary-row">
              <span>Approval tx</span>
              <strong className="mono">
                {approvalSkipped ? "Sufficient allowance" : shortHash(lastApprovalHash)}
              </strong>
            </div>
            <div className="summary-row">
              <span>Lock tx</span>
              <strong className="mono">{shortHash(lastLockHash)}</strong>
            </div>
            <div className="summary-row">
              <span>Runtime</span>
              <strong>{prover.status}</strong>
            </div>
            <div className="summary-row">
              <span>Note backup</span>
              <strong>
                {noteBackedUp
                  ? shortHash(noteBackupAt, 10, 8)
                  : noteSaved
                    ? "Local only"
                    : "pending"}
              </strong>
            </div>
          </div>

          {prover.progress.length > 0 ? (
            <div className="runtime-progress">
              {prover.progress.slice(-3).map((event, index) => (
                <p key={`${event.stage ?? "stage"}-${index}`}>
                  {event.message ?? event.stage ?? event.flow ?? "Private prover progress"}
                </p>
              ))}
            </div>
          ) : null}

          {prover.error ? <div className="notice warn">{prover.error}</div> : null}
        </aside>
      </div>
    </main>
  );
}

function MiniStep({
  active,
  complete,
  children,
}: {
  active: boolean;
  complete: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`timeline-item ${complete ? "complete" : ""} ${active ? "active" : ""}`}>
      <span className="timeline-dot">
        {complete ? <CheckCircle2 size={15} /> : <CircleDashed size={15} />}
      </span>
      <div>
        <strong>{children}</strong>
        <p>{active ? "In progress" : complete ? "Complete" : "Waiting"}</p>
      </div>
    </div>
  );
}
