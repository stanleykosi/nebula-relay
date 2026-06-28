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
import { useMemo, useState } from "react";
import { serializeAuditorPacket } from "@/lib/auditor";
import { demoConfig } from "@/lib/config";
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
  showPrivateNoteHandoff,
  settleFixtureCctp,
  type DemoState,
} from "@/lib/demo";
import { devProofArtifact, validLockWitness } from "@/lib/fixtures";
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

type FreighterLike = {
  requestAccess?: () => Promise<{
    address?: string;
    error?: { message?: string };
  }>;
};

type WalletWindow = Window & {
  ethereum?: EthereumProvider;
  freighterApi?: FreighterLike;
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
    const freighter = (window as WalletWindow).freighterApi;
    if (!freighter?.requestAccess) {
      setState((current) => connectFixtureStellarWallet(current));
      return;
    }
    const response = await freighter.requestAccess();
    if (response.error) {
      throw new Error(response.error.message ?? "Freighter rejected access");
    }
    setState((current) =>
      completeStep(
        {
          ...current,
          stellarWallet:
            response.address ??
            "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        },
        "stellar-wallet"
      )
    );
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
        <Badge tone="warn">Mode A handoff</Badge>
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
              <Badge tone={demoConfig.proofMode === "dev" ? "warn" : "ok"}>
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
                ? devProofArtifact.publicOutputs.claimNullifier
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

        <Panel title="9. Private note / pool handoff" className="span-6">
          <p>
            Stage 8 implements Mode A: note registry and adapter handoff. Direct
            pool credit is planned, not claimed.
          </p>
          <div className="actions">
            <ActionButton
              onClick={() =>
                setState((current) => showPrivateNoteHandoff(current))
              }
              disabled={!state.nullifierStored}
            >
              <ShieldCheck size={16} /> Show handoff
            </ActionButton>
          </div>
          {state.handoffStatus ? (
            <p className="callout">{state.handoffStatus}</p>
          ) : null}
          <HashRow label="Private note" value={state.noteCommitment} />
        </Panel>

        <Panel title="10. Auditor packet" className="span-12">
          <p>
            User-exported disclosure packet with schema fields, verification
            steps, proof-mode caveats, testnet settlement details, and Mode A
            handoff.
          </p>
          <div className="actions">
            <ActionButton
              onClick={() => setState((current) => exportAuditorPacket(current))}
              disabled={!state.handoffStatus}
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
