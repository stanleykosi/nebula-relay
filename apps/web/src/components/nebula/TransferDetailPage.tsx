"use client";

import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  LockKeyhole,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  baseUnitsToUsdc,
  getIntent,
  shortHash,
  statusLabel,
  type BridgeIntentRecord,
} from "@/lib/nebula-api";

export function TransferDetailPage({ intentId }: { intentId: string }) {
  const query = useQuery({
    queryKey: ["intent", intentId],
    queryFn: () => getIntent(intentId),
    refetchInterval: 8_000,
  });
  const intent = query.data;
  const ready = intent?.status === "claimed" || intent?.status === "replay_verified";

  return (
    <main className="product-page">
      <Link className="button-quiet" href="/activity">
        <ArrowLeft size={14} /> Back to Activity
      </Link>

      <div className="page-head" style={{ marginTop: 22 }}>
        <div>
          <span className="label-caps">
            <LockKeyhole size={15} /> Transfer Detail
          </span>
          <h1>{intent ? `${baseUnitsToUsdc(intent.receiveAmount)} USDC` : "Loading transfer"}</h1>
          <p className="lead">
            Intent lifecycle, proof references, source transaction, and private
            pool claim data.
          </p>
        </div>
        {intent ? (
          <span className={`status-pill ${ready ? "ok" : "live"}`}>
            {statusLabel(intent.status)}
          </span>
        ) : null}
      </div>

      <div className="detail-grid">
        <section className="timeline-card">
          <h2>Lifecycle</h2>
          {intent ? <DetailTimeline intent={intent} /> : <LoadingBars />}
        </section>

        <aside className="side-card">
          <h2>Summary</h2>
          {intent ? <Summary intent={intent} /> : <LoadingBars />}
          {ready ? (
            <Link className="button-primary" href={`/private?intent=${intentId}`}>
              Withdraw Privately <ArrowDownToLine size={16} />
            </Link>
          ) : (
            <Link className="button-secondary" href={`/bridge/${intentId}`}>
              View Progress
            </Link>
          )}
        </aside>
      </div>

      <section className="activity-panel" style={{ marginTop: 18 }}>
        <h2>Technical Ledger</h2>
        {intent ? <Ledger intent={intent} /> : <LoadingBars />}
      </section>
    </main>
  );
}

function DetailTimeline({ intent }: { intent: BridgeIntentRecord }) {
  const complete = {
    source: Boolean(intent.sourceTxHash),
    witness: Boolean(intent.witness),
    proof: Boolean(intent.proofArtifact),
    claim: Boolean(intent.stellarClaimTxHash),
    withdrawReady: intent.status === "claimed" || intent.status === "replay_verified",
  };
  const rows = [
    ["Intent Initiated", true],
    ["Source Funds Locked", complete.source],
    ["Witness Built", complete.witness],
    ["Proof Ready", complete.proof],
    ["Stellar Claim Created", complete.claim],
    ["Ready for Withdrawal", complete.withdrawReady],
  ] as const;
  return (
    <div className="progress-rail">
      {rows.map(([label, done]) => (
        <div className={`timeline-item ${done ? "complete" : ""}`} key={label}>
          <span className="timeline-dot">
            {done ? <CheckCircle2 size={15} /> : <CircleDashed size={15} />}
          </span>
          <div>
            <strong>{label}</strong>
            <p>{done ? "Recorded by Nebula" : "Waiting for backend transition"}</p>
          </div>
          <span className="status-pill">{done ? "Complete" : "Pending"}</span>
        </div>
      ))}
    </div>
  );
}

function Summary({ intent }: { intent: BridgeIntentRecord }) {
  return (
    <div className="summary-list">
      <div className="summary-row">
        <span>Intent ID</span>
        <strong className="mono">{shortHash(intent.id, 8, 6)}</strong>
      </div>
      <div className="summary-row">
        <span>Route</span>
        <strong>EVM Sepolia to Stellar</strong>
      </div>
      <div className="summary-row">
        <span>Created</span>
        <strong>{new Date(intent.createdAt).toLocaleDateString()}</strong>
      </div>
    </div>
  );
}

function Ledger({ intent }: { intent: BridgeIntentRecord }) {
  return (
    <div className="ledger">
      <LedgerRow label="Intent ID" value={intent.id} />
      <LedgerRow label="Source Tx" value={intent.sourceTxHash} />
      <LedgerRow label="Note Commitment" value={intent.noteCommitment} />
      <LedgerRow label="Claim Nullifier" value={intent.claimNullifier} />
      <LedgerRow label="Stellar Claim Tx" value={intent.stellarClaimTxHash} />
      <LedgerRow label="Boundless Request" value={intent.boundlessRequestId} />
      <LedgerRow label="Pool ID" value={intent.poolId} />
    </div>
  );
}

function LedgerRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="ledger-row">
      <span>{label}</span>
      <strong className="mono">{shortHash(value, 10, 8)}</strong>
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
