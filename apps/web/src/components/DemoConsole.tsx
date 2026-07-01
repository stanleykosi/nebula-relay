"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  KeyRound,
  Lock,
  RadioTower,
  ShieldCheck,
  Sparkles,
  Wallet,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { serializeAuditorPacket } from "@/lib/auditor";
import { demoConfig } from "@/lib/config";
import { requestFreighterAddress } from "@/lib/freighter";
import type { PrivateProverResult } from "@/lib/privateProver";
import {
  buildFixtureWitness,
  claimFixtureOnStellar,
  completeStep,
  connectFixtureEvmWallet,
  connectFixtureStellarWallet,
  createInitialDemoState,
  demoSteps,
  exportAuditorPacket,
  generateFixtureNoteCommitment,
  generateFixtureProof,
  lockFixtureUsdc,
  runFullFixtureDemo,
  runInvalidTokenFailure,
  runReplayFailure,
  showNullifierStored,
  showPrivatePoolDeposit,
  settleFixtureCctp,
  type DemoState,
} from "@/lib/demo";
import { testnetProofArtifact, validLockWitness } from "@/lib/fixtures";
import {
  ActionButton,
  Badge,
  HashRow,
  ModeStrip,
  Panel,
} from "@/components/ui";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

type WalletWindow = Window & {
  ethereum?: EthereumProvider;
};

export function DemoConsole() {
  const [state, setState] = useState<DemoState>(() => createInitialDemoState());
  const progress = Math.round((state.completed.length / demoSteps.length) * 100);
  const auditorJson = useMemo(
    () =>
      state.auditorPacket
        ? serializeAuditorPacket(state.auditorPacket)
        : undefined,
    [state.auditorPacket]
  );

  useEffect(() => {
    function handlePrivateProverMessage(event: MessageEvent<unknown>) {
      if (event.origin !== window.location.origin) {
        return;
      }
      const data = event.data;
      if (!isPrivateProverPreparedMessage(data)) {
        return;
      }
      setState((current) =>
        completeStep(
          {
            ...current,
            noteCommitment: data.result.outputCommitment,
            privatePoolStatus:
              "Prepared private-pool proof received from browser prover.",
          },
          "note"
        )
      );
    }

    window.addEventListener("message", handlePrivateProverMessage);
    return () =>
      window.removeEventListener("message", handlePrivateProverMessage);
  }, []);

  const connectEvm = async () => {
    const provider = (window as WalletWindow).ethereum;
    if (!provider) {
      setState((current) => connectFixtureEvmWallet(current));
      return;
    }
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const account = Array.isArray(accounts) ? accounts[0] : undefined;
    setState((current) =>
      completeStep(
        {
          ...current,
          evmWallet:
            typeof account === "string"
              ? account
              : validLockWitness.senderAddress,
        },
        "evm-wallet"
      )
    );
  };

  const connectStellar = async () => {
    try {
      const address = await requestFreighterAddress();
      setState((current) =>
        completeStep(
          {
            ...current,
            stellarWallet: address,
          },
          "stellar-wallet"
        )
      );
    } catch (caught) {
      console.warn("Freighter wallet connection failed, using fixture wallet", caught);
      setState((current) => connectFixtureStellarWallet(current));
    }
  };

  const downloadAuditorPacket = () => {
    if (!auditorJson) {
      return;
    }
    const url = URL.createObjectURL(
      new Blob([auditorJson], { type: "application/json" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "nebula-auditor-packet.fixture.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openPrivateProver = () => {
    window.open("/private-prover", "nebula-private-prover");
  };

  return (
    <div className="page">
      <div className="status-row">
        <Badge tone="info">
          {demoConfig.demoMode === "live" ? "Testnet mode" : "Fixture mode"}
        </Badge>
        <Badge tone={demoConfig.verifierMode === "mock" ? "warn" : "ok"}>
          Verifier: {demoConfig.verifierMode}
        </Badge>
        <Badge tone="info">Network: {demoConfig.stellarNetwork}</Badge>
        <Badge tone="ok">Private pool proof</Badge>
      </div>
      <ModeStrip config={demoConfig} />

      <section className="section">
        <div className="grid">
          <div className="span-5">
            <h2>Guided Relay Flow</h2>
            <p>
              Complete the fixture flow locally, then use the failure lab and
              auditor packet to show what the claim proves.
            </p>
            <div className="status-row">
              <Badge tone="ok">{progress}% complete</Badge>
              <Badge tone={demoConfig.proofMode === "fixture" ? "warn" : "ok"}>
                Proof: {demoConfig.proofMode}
              </Badge>
            </div>
            <div className="actions">
              <ActionButton
                variant="primary"
                onClick={() => setState(runFullFixtureDemo())}
              >
                <Sparkles size={16} /> Run fixture demo
              </ActionButton>
              <ActionButton onClick={() => setState(createInitialDemoState())}>
                Reset
              </ActionButton>
            </div>
          </div>
          <div className="span-7 step-list">
            {demoSteps.map((step, index) => {
              const done = state.completed.includes(step.id);
              return (
                <div className={`step-row ${done ? "done" : ""}`} key={step.id}>
                  <span className="step-number">
                    {done ? <CheckCircle2 size={16} /> : index + 1}
                  </span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.caption}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="grid" style={{ marginTop: 14 }}>
        <Panel title="1. Connect wallets" className="span-6">
          <p>
            Live browser wallets are used when available; otherwise fixture
            addresses keep the demo moving.
          </p>
          <div className="actions">
            <ActionButton onClick={() => void connectEvm()}>
              <Wallet size={16} /> Connect EVM
            </ActionButton>
            <ActionButton onClick={() => void connectStellar()}>
              <KeyRound size={16} /> Connect Stellar
            </ActionButton>
          </div>
          <HashRow label="EVM wallet" value={state.evmWallet} />
          <HashRow label="Stellar wallet" value={state.stellarWallet} />
        </Panel>

        <Panel title="2. Recipient note" className="span-6">
          <p>
            Testnet mode uses the recipient note commitment bound into the
            configured proof artifact.
          </p>
          <div className="actions">
            <ActionButton
              onClick={() =>
                setState((current) => generateFixtureNoteCommitment(current))
              }
            >
              <Sparkles size={16} /> Generate note commitment
            </ActionButton>
            <ActionButton onClick={openPrivateProver}>
              <ShieldCheck size={16} /> Open private prover
            </ActionButton>
          </div>
          <HashRow label="Note commitment" value={state.noteCommitment} />
        </Panel>

        <Panel title="3. Source-chain lock" className="span-6">
          <p>
            The fixture receipt carries the canonical NebulaEscrow `Locked`
            event for mock USDC.
          </p>
          <div className="actions">
            <ActionButton
              onClick={() => setState((current) => lockFixtureUsdc(current))}
            >
              <Lock size={16} /> Lock fixture USDC
            </ActionButton>
          </div>
          <HashRow label="EVM tx hash" value={state.lockTxHash} />
          <HashRow
            label="Escrow"
            value={validLockWitness.escrowContract}
          />
        </Panel>

        <Panel title="4. Witness builder" className="span-6">
          <p>
            The EVM client parses the receipt log and emits schema-valid witness
            JSON for the prover.
          </p>
          <div className="actions">
            <ActionButton
              onClick={() => setState((current) => buildFixtureWitness(current))}
              disabled={!state.lockTxHash}
            >
              <FileJson size={16} /> Build witness
            </ActionButton>
          </div>
          <HashRow label="Lock ID" value={state.witness?.lockId} />
          <HashRow
            label="Receipt root"
            value={state.witness?.sourceReceiptRoot}
          />
        </Panel>

        <Panel title="5. ZK proof" className="span-7">
          <p>
            This deployment is configured for the selected proof mode. Local
            fixture artifacts remain available only for smoke tests.
          </p>
          <div className="actions">
            <ActionButton
              onClick={() =>
                setState((current) => generateFixtureProof(current))
              }
              disabled={!state.witness}
            >
              <ShieldCheck size={16} /> Generate proof artifact
            </ActionButton>
          </div>
          <div className="artifact-grid" style={{ marginTop: 12 }}>
            <HashRow label="Image ID" value={state.proof?.imageIdHex} />
            <HashRow
              label="Journal digest"
              value={state.proof?.journalDigestHex}
            />
            <HashRow
              label="Nullifier"
              value={state.proof?.publicOutputs.claimNullifier}
            />
            <HashRow
              label="Event commitment"
              value={state.proof?.publicOutputs.eventCommitment}
            />
            <HashRow
              label="Compliance root"
              value={state.proof?.publicOutputs.complianceRoot}
            />
            <HashRow
              label="CCTP message"
              value={state.proof?.publicOutputs.cctpMessageHash}
            />
          </div>
        </Panel>

        <Panel title="6. CCTP settlement" className="span-5">
          <p>
            The Circle message and attestation hashes are bound into the same
            journal the Stellar contract verifies before claim storage.
          </p>
          <div className="actions">
            <ActionButton
              onClick={() => setState((current) => settleFixtureCctp(current))}
              disabled={!state.proof}
            >
              <RadioTower size={16} /> Settle CCTP
            </ActionButton>
          </div>
          <HashRow label="Message hash" value={state.cctpMessageHash} />
          <HashRow label="Mint tx" value={state.cctpMintTxHash} />
        </Panel>

        <Panel title="7. Stellar verification" className="span-5">
          <p>
            The Stellar client package builds, simulates, signs, and submits the
            real claim call when RPC and contract IDs are configured.
          </p>
          <div className="actions">
            <ActionButton
              variant="primary"
              onClick={() => setState((current) => claimFixtureOnStellar(current))}
              disabled={!state.cctpMessageHash}
            >
              <RadioTower size={16} /> Claim on Stellar
            </ActionButton>
            <ActionButton
              onClick={() => setState((current) => showNullifierStored(current))}
              disabled={!state.claimTxHash}
            >
              Show nullifier stored
            </ActionButton>
          </div>
          <HashRow label="Claim tx" value={state.claimTxHash} />
          <HashRow
            label="Stored nullifier"
            value={
              state.nullifierStored
                ? testnetProofArtifact.publicOutputs.claimNullifier
                : undefined
            }
          />
        </Panel>

        <Panel title="8. Failure checks" className="span-6">
          <p>Replay and invalid-token failures are deterministic fixtures.</p>
          <div className="actions">
            <ActionButton
              variant="danger"
              onClick={() => setState((current) => runReplayFailure(current))}
            >
              <XCircle size={16} /> Run replay failure
            </ActionButton>
            <ActionButton
              variant="warn"
              onClick={() =>
                setState((current) => runInvalidTokenFailure(current))
              }
            >
              <AlertTriangle size={16} /> Invalid-token fixture
            </ActionButton>
          </div>
          {state.replayFailure ? (
            <p className="callout danger">{state.replayFailure}</p>
          ) : null}
          {state.invalidTokenFailure ? (
            <p className="callout">{state.invalidTokenFailure}</p>
          ) : null}
        </Panel>

        <Panel title="9. Private pool deposit" className="span-6">
          <p>
            The private claim uses an upstream Stellar Private Payments deposit
            proof and stores no visible claimant on NebulaRelay.
          </p>
          <div className="actions">
            <ActionButton
              onClick={() =>
                setState((current) => showPrivatePoolDeposit(current))
              }
              disabled={!state.nullifierStored}
            >
              <ShieldCheck size={16} /> Show pool deposit
            </ActionButton>
          </div>
          {state.privatePoolStatus ? (
            <p className="callout">{state.privatePoolStatus}</p>
          ) : null}
          <HashRow label="Private note" value={state.noteCommitment} />
        </Panel>

        <Panel title="10. Auditor packet" className="span-12">
          <p>
            User-exported disclosure packet with schema fields, verification
            steps, proof-mode caveats, testnet settlement details, and private
            pool proof boundaries.
          </p>
          <div className="actions">
            <ActionButton
              onClick={() => setState((current) => exportAuditorPacket(current))}
              disabled={!state.privatePoolStatus}
            >
              <FileJson size={16} /> Prepare packet
            </ActionButton>
            <ActionButton
              onClick={downloadAuditorPacket}
              disabled={!auditorJson}
              variant="primary"
            >
              <Download size={16} /> Export JSON
            </ActionButton>
          </div>
          {state.auditorPacket ? (
            <div className="instruction-list">
              {state.auditorPacket.verificationInstructions.map(
                (instruction) => (
                  <div className="instruction-row" key={instruction.title}>
                    <strong>{instruction.title}</strong>
                    <p>{instruction.description}</p>
                    {instruction.expected ? (
                      <span>{instruction.expected}</span>
                    ) : null}
                  </div>
                )
              )}
            </div>
          ) : null}
          {auditorJson ? (
            <pre className="hash-row" style={{ whiteSpace: "pre-wrap" }}>
              <code>{auditorJson}</code>
            </pre>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}

function isPrivateProverPreparedMessage(
  value: unknown
): value is {
  type: "nebula:private-prover:prepared";
  result: PrivateProverResult;
} {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as {
    type?: unknown;
    result?: { outputCommitment?: unknown };
  };
  return (
    candidate.type === "nebula:private-prover:prepared" &&
    typeof candidate.result?.outputCommitment === "string"
  );
}
