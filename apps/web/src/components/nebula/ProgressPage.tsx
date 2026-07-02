"use client";

import Link from "next/link";
import {
  ArrowDownToLine,
  CheckCircle2,
  CircleDashed,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  baseUnitsToUsdc,
  getIntent,
  getIntentEvents,
  isTerminalStatus,
  retryIntent,
  shortHash,
  statusLabel,
  type BridgeIntentRecord,
  type BridgeStatus,
} from "@/lib/nebula-api";

const statusRank: Record<BridgeStatus, number> = {
  waiting_source_tx: 0,
  source_tx_submitted: 1,
  source_finalized: 2,
  cctp_pending: 2,
  cctp_complete: 3,
  witness_built: 4,
  proving: 5,
  proof_ready: 5,
  claiming: 6,
  claimed: 7,
  replay_verified: 7,
  fee_mismatch: 2,
  failed: 0,
};

const steps = [
  ["Source Signed", "EVM wallet submitted the source lock transaction.", 1],
  ["Source Confirmed", "The source transaction is finalized and receipt-ready.", 2],
  ["Attestation Ready", "Circle CCTP settlement data is available.", 3],
  ["Proof Generating", "Nebula is building the RISC Zero proof artifact.", 5],
  ["Stellar Claiming", "The Stellar relay contract is receiving the claim.", 6],
  ["Private Received", "The private-pool note is available for withdrawal.", 7],
] as const;

const statusDetail: Record<BridgeStatus, string> = {
  waiting_source_tx: "Waiting for the frontend to attach the mined source transaction.",
  source_tx_submitted: "Reading the source-chain receipt from the EVM RPC.",
  source_finalized: "Source receipt is finalized; waiting for Circle CCTP settlement data.",
  cctp_pending: "Circle attestation is not complete yet. Nebula will keep retrying.",
  cctp_complete: "CCTP settlement is available and the net amount matches the private note.",
  witness_built: "Witness is ready. The backend is preparing the proof request.",
  proving: "RISC Zero proof generation is running through the configured prover.",
  proof_ready: "Proof is ready and being checked against the stored intent.",
  claiming: "The backend relayer is submitting the proof-backed Stellar claim.",
  claimed: "The private-pool claim has landed on Stellar.",
  replay_verified: "Replay protection has been checked. Withdrawal is ready.",
  fee_mismatch: "Actual CCTP fee changed the net amount, so Nebula stopped before claim.",
  failed: "The worker stopped on an unrecovered error. Review the message and retry when fixed.",
};

export function ProgressPage({ intentId }: { intentId: string }) {
  const intentQuery = useQuery({
    queryKey: ["intent", intentId],
    queryFn: () => getIntent(intentId),
    refetchInterval: (query) =>
      query.state.data && isTerminalStatus(query.state.data.status) ? false : 4_000,
  });
  const eventsQuery = useQuery({
    queryKey: ["intent-events", intentId],
    queryFn: () => getIntentEvents(intentId),
    refetchInterval: 8_000,
  });

  const intent = intentQuery.data;
  const rank = intent ? statusRank[intent.status] : 0;
  const failed = intent?.status === "failed" || intent?.status === "fee_mismatch";

  const retry = async () => {
    await retryIntent(intentId);
    await intentQuery.refetch();
    await eventsQuery.refetch();
  };

  return (
    <main className="product-page">
      <div className="page-head">
        <div>
          <span className="label-caps">
            <ShieldCheck size={15} /> Transfer Progress
          </span>
          <h1>{failed ? "Action required" : "Nebula is proving the source event"}</h1>
          <p className="lead">
            Watch the source lock move through CCTP settlement, witness build,
            proof generation, and Stellar private-pool claim.
          </p>
        </div>
        <span className={`status-pill ${failed ? "danger" : rank >= 7 ? "ok" : "live"}`}>
          {intent ? statusLabel(intent.status) : "Loading"}
        </span>
      </div>

      <div className="progress-layout">
        <section className="timeline-card">
          <h2>Lifecycle</h2>
          <p>
            These states come directly from the Nebula backend intent record.
          </p>
          {intent ? (
            <>
              <div className="progress-meter" aria-label="Backend bridge progress">
                <span style={{ width: `${Math.round((rank / 7) * 100)}%` }} />
              </div>
              <div className={`notice ${failed ? "danger" : rank >= 7 ? "" : "warn"}`}>
                {statusDetail[intent.status]}
              </div>
            </>
          ) : null}
          {intentQuery.isLoading ? <LoadingBars /> : null}
          {intent ? (
            <div className="progress-rail">
              {steps.map(([title, body, stepRank]) => (
                <div
                  className={`timeline-item ${
                    rank >= stepRank ? "complete" : ""
                  } ${rank + 1 === stepRank ? "active" : ""}`}
                  key={title}
                >
                  <span className="timeline-dot">
                    {rank >= stepRank ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <CircleDashed size={15} />
                    )}
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <p>{body}</p>
                  </div>
                  <span className="status-pill">
                    {rank >= stepRank ? "Complete" : rank + 1 === stepRank ? "Active" : "Queued"}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <aside className="side-card">
          <h2>Transfer summary</h2>
          {intent ? <Summary intent={intent} /> : <LoadingBars />}
          {intent?.lastError ? (
            <div className="notice danger">{intent.lastError}</div>
          ) : null}
          <div className="button-row">
            {failed ? (
              <button className="button-secondary" type="button" onClick={() => void retry()}>
                <RefreshCcw size={16} /> Retry worker
              </button>
            ) : null}
            {rank >= 7 ? (
              <Link className="button-primary" href={`/private?intent=${intentId}`}>
                Withdraw Privately <ArrowDownToLine size={16} />
              </Link>
            ) : (
              <Link className="button-secondary" href="/activity">
                View Activity
              </Link>
            )}
          </div>
        </aside>
      </div>

      <section className="activity-panel" style={{ marginTop: 18 }}>
        <h2>Recent events</h2>
        <div className="activity-list">
          {(eventsQuery.data ?? []).slice(-6).reverse().map((event) => (
            <div className="activity-row" key={event.id}>
              <div>
                <strong>{event.eventType}</strong>
                <div className="activity-meta">
                  <span>{new Date(event.createdAt).toLocaleString()}</span>
                  <span className="mono">{shortHash(event.intentId, 8, 6)}</span>
                </div>
              </div>
              <span className="status-pill">Event</span>
            </div>
          ))}
          {eventsQuery.data?.length === 0 ? (
            <p className="empty-state">No backend events have been recorded yet.</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function Summary({ intent }: { intent: BridgeIntentRecord }) {
  return (
    <div className="summary-list">
      <div className="summary-row">
        <span>Amount</span>
        <strong>{baseUnitsToUsdc(intent.receiveAmount)} USDC</strong>
      </div>
      <div className="summary-row">
        <span>Intent ID</span>
        <strong className="mono">{shortHash(intent.id, 8, 6)}</strong>
      </div>
      <div className="summary-row">
        <span>Source tx</span>
        <strong className="mono">{shortHash(intent.sourceTxHash)}</strong>
      </div>
      <div className="summary-row">
        <span>Stellar claim</span>
        <strong className="mono">{shortHash(intent.stellarClaimTxHash)}</strong>
      </div>
      <div className="summary-row">
        <span>Note commitment</span>
        <strong className="mono">{shortHash(intent.noteCommitment, 8, 6)}</strong>
      </div>
    </div>
  );
}

function LoadingBars() {
  return (
    <div className="loading-bars" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}
