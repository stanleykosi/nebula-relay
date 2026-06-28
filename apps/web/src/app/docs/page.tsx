import { BookOpen, RadioTower, ShieldCheck, WalletCards } from "lucide-react";
import { Badge, HashRow, ModeStrip, Panel } from "@/components/ui";
import {
  AUDITOR_VERIFICATION_INSTRUCTIONS,
  REQUIRED_AUDITOR_CAVEATS,
} from "@/lib/auditor";
import { demoConfig } from "@/lib/config";
import { devProofArtifact, validLockWitness } from "@/lib/fixtures";

export default function DocsPage() {
  return (
    <main className="page">
      <span className="eyebrow">Proof statement</span>
      <h1 className="page-title">What Nebula Relay proves</h1>
      <p className="lead">
        Nebula is relay-first: it proves source-chain lock intent and
        compliance fields, then gates a Stellar private-note-compatible claim.
        Settlement liquidity and CCTP-backed value movement are future layers.
      </p>
      <ModeStrip config={demoConfig} />

      <div className="grid">
        <Panel title="What ZK proves" className="span-6">
          <div className="status-row">
            <Badge tone="ok">
              <ShieldCheck size={14} /> RISC Zero first
            </Badge>
            <Badge tone="warn">Dev artifact in demo</Badge>
          </div>
          <p>
            The current statement validates a structured EVM lock witness:
            approved escrow, token, amount bounds, compliance root, destination,
            note commitment, event commitment, and nullifier.
          </p>
          <HashRow label="Image ID" value={devProofArtifact.imageIdHex} />
          <HashRow label="Journal digest" value={devProofArtifact.journalDigestHex} />
        </Panel>

        <Panel title="What Stellar verifies" className="span-6">
          <div className="status-row">
            <Badge tone="info">
              <RadioTower size={14} /> NebulaRelay
            </Badge>
            <Badge tone="ok">Replay blocked</Badge>
          </div>
          <p>
            `NebulaRelay` checks the verifier boundary, image ID, decoded
            journal, source config, compliance root, destination, and nullifier
            storage before recording the note.
          </p>
          <HashRow
            label="Nullifier"
            value={devProofArtifact.publicOutputs.claimNullifier}
          />
        </Panel>

        <Panel title="What is mocked or fixture-only" className="span-6">
          <div className="status-row">
            <Badge tone="warn">Fixture receipt</Badge>
            <Badge tone="warn">Simulated claim UI</Badge>
          </div>
          <p>
            The UI can complete without RPC. It labels fixture/dev proof mode
            and does not claim a live Stellar transaction unless configured
            outside this shell.
          </p>
          <HashRow label="Fixture tx" value={validLockWitness.txHash} />
        </Panel>

        <Panel title="Private Payments composition" className="span-6">
          <div className="status-row">
            <Badge tone="info">
              <WalletCards size={14} /> Mode A handoff
            </Badge>
            <Badge tone="danger">Not a full bridge</Badge>
          </div>
          <p>
            Stage 8 records a private-note-compatible commitment and adapter
            handoff. Direct upstream pool credit and CCTP-backed testnet
            settlement are production-path work.
          </p>
          <HashRow
            label="Note commitment"
            value={validLockWitness.stellarNoteCommitment}
          />
        </Panel>

        <Panel title="Selective disclosure" className="span-12">
          <div className="status-row">
            <Badge tone="ok">
              <BookOpen size={14} /> Auditor packet
            </Badge>
          </div>
          <p>
            The auditor packet is user-exported and contains source transaction,
            log index, proof image ID, journal digest, note commitment,
            nullifier, event commitment, and caveats. It is not a production
            view-key system.
          </p>
        </Panel>

        <Panel title="Auditor verification" className="span-8">
          <div className="instruction-list">
            {AUDITOR_VERIFICATION_INSTRUCTIONS.map((instruction) => (
              <div className="instruction-row" key={instruction.title}>
                <strong>{instruction.title}</strong>
                <p>{instruction.description}</p>
                {instruction.expected ? (
                  <span>{instruction.expected}</span>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Disclosure caveats" className="span-4">
          <div className="instruction-list">
            {REQUIRED_AUDITOR_CAVEATS.map((caveat) => (
              <div className="instruction-row" key={caveat}>
                <p>{caveat}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </main>
  );
}
