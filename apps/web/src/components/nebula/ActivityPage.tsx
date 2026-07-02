"use client";

import Link from "next/link";
import {
  ArrowDownToLine,
  Clock3,
  ExternalLink,
  ListFilter,
  ShieldCheck,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { persistWallet, storedWalletAddress } from "@/lib/evm-wallet";
import { requestFreighterAddress } from "@/lib/freighter";
import {
  baseUnitsToUsdc,
  listIntents,
  readStoredIntentIds,
  shortHash,
  statusLabel,
  type BridgeIntentRecord,
} from "@/lib/nebula-api";

type Filter = "all" | "active" | "ready" | "failed";

export function ActivityPage() {
  const [ids, setIds] = useState<string[]>([]);
  const [stellarAccount, setStellarAccount] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [walletError, setWalletError] = useState<string>();

  useEffect(() => {
    setIds(readStoredIntentIds());
    setStellarAccount(storedWalletAddress("nebula.stellarAddress"));
  }, []);

  const activityQuery = useQuery({
    queryKey: ["intents", stellarAccount || "local", ids],
    queryFn: () =>
      stellarAccount
        ? listIntents({ stellarAccount, limit: 50 })
        : listIntents({ ids, limit: 50 }),
    enabled: Boolean(stellarAccount || ids.length > 0),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const intents = useMemo(
    () =>
      [...(activityQuery.data ?? [])]
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        ),
    [activityQuery.data]
  );

  const filtered = intents.filter((intent) => {
    if (filter === "all") {
      return true;
    }
    if (filter === "active") {
      return !["claimed", "replay_verified", "failed", "fee_mismatch"].includes(
        intent.status
      );
    }
    if (filter === "ready") {
      return intent.status === "claimed" || intent.status === "replay_verified";
    }
    return intent.status === "failed" || intent.status === "fee_mismatch";
  });

  const connectStellar = async () => {
    setWalletError(undefined);
    try {
      const address = await requestFreighterAddress();
      persistWallet("nebula.stellarAddress", address);
      setStellarAccount(address);
    } catch (caught) {
      setWalletError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <main className="product-page">
      <div className="page-head">
        <div>
          <span className="label-caps">
            <Clock3 size={15} /> Activity
          </span>
          <h1>Transfer Activity</h1>
          <p className="lead">
            Transfer history from your connected Stellar wallet, refreshed from
            the Nebula backend.
          </p>
        </div>
        <div className="button-row">
          {stellarAccount ? (
            <span className="status-pill ok">
              <ShieldCheck size={14} /> {shortHash(stellarAccount)}
            </span>
          ) : (
            <button
              className="button-secondary"
              type="button"
              onClick={() => void connectStellar()}
            >
              <ShieldCheck size={16} /> Connect Stellar
            </button>
          )}
          <Link className="button-primary" href="/bridge">
            New Bridge
          </Link>
        </div>
      </div>

      <section className="activity-panel">
        <div className="activity-toolbar">
          <span className="status-pill">
            <ListFilter size={14} /> Filter
          </span>
          {(["all", "active", "ready", "failed"] as const).map((item) => (
            <button
              className={`filter-pill ${filter === item ? "status-pill live" : ""}`}
              key={item}
              type="button"
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="activity-list">
          {walletError ? <div className="notice danger">{walletError}</div> : null}
          {activityQuery.isError ? (
            <div className="notice danger">
              {activityQuery.error instanceof Error
                ? activityQuery.error.message
                : "Could not load activity."}
            </div>
          ) : null}
          {activityQuery.isLoading ? (
            <div className="notice">Loading your transfer activity...</div>
          ) : null}
          {filtered.map((intent) => (
            <ActivityRow intent={intent} key={intent.id} />
          ))}
          {!stellarAccount && ids.length === 0 ? (
            <div className="notice">
              Connect your Stellar wallet to load wallet-scoped activity, or
              start a bridge to create the first local activity record.
            </div>
          ) : null}
          {(stellarAccount || ids.length > 0) &&
          !activityQuery.isLoading &&
          filtered.length === 0 ? (
            <p className="empty-state">
              {filter === "all"
                ? "No transfers found for this activity scope."
                : "No transfers match this filter."}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function ActivityRow({ intent }: { intent: BridgeIntentRecord }) {
  const ready = intent.status === "claimed" || intent.status === "replay_verified";
  const failed = intent.status === "failed" || intent.status === "fee_mismatch";
  return (
    <div className="activity-row">
      <div>
        <strong>{baseUnitsToUsdc(intent.receiveAmount)} USDC</strong>
        <div className="activity-meta">
          <span className="mono">{shortHash(intent.id, 8, 6)}</span>
          <span>{new Date(intent.updatedAt).toLocaleString()}</span>
          <span>{shortHash(intent.sourceTxHash)}</span>
        </div>
      </div>
      <div className="button-row">
        <span className={`status-pill ${ready ? "ok" : failed ? "danger" : "live"}`}>
          {statusLabel(intent.status)}
        </span>
        {ready ? (
          <Link className="button-quiet" href={`/private?intent=${intent.id}`}>
            <ArrowDownToLine size={14} /> Withdraw
          </Link>
        ) : null}
        <Link className="button-quiet" href={`/activity/${intent.id}`}>
          Details <ExternalLink size={14} />
        </Link>
      </div>
    </div>
  );
}
