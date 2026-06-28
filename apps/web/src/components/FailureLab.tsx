import { AlertTriangle, Ban, ShieldX, XCircle } from "lucide-react";
import { Badge, HashRow, Panel } from "@/components/ui";
import { devProofArtifact, invalidTokenWitness, validLockWitness } from "@/lib/fixtures";

const cases = [
  {
    icon: XCircle,
    title: "Replay same nullifier",
    result: "NebulaRelay NullifierAlreadyClaimed (#15)",
    tone: "danger" as const,
    detail:
      "The nullifier is stored after a successful claim. A second claim with the same proof is rejected.",
  },
  {
    icon: AlertTriangle,
    title: "Wrong token",
    result: "Witness token does not match expected token",
    tone: "warn" as const,
    detail:
      "The invalid-token fixture changes the source token while expected config still requires the approved mock USDC.",
  },
  {
    icon: Ban,
    title: "Wrong escrow",
    result: "Source contract mismatch",
    tone: "warn" as const,
    detail:
      "The source escrow is part of the proven statement. A forged source contract cannot satisfy the witness.",
  },
  {
    icon: ShieldX,
    title: "Bad compliance root",
    result: "ComplianceRootInvalid",
    tone: "danger" as const,
    detail:
      "The demo compliance root stands in for the future ASP membership/non-membership policy layer.",
  },
];

export function FailureLab() {
  return (
    <div className="grid">
      {cases.map((item) => {
        const Icon = item.icon;
        return (
          <Panel title={item.title} className="span-6" key={item.title}>
            <div className="status-row">
              <Badge tone={item.tone}>
                <Icon size={14} /> {item.result}
              </Badge>
            </div>
            <p>{item.detail}</p>
          </Panel>
        );
      })}
      <Panel title="Fixture comparison" className="span-12">
        <p>
          These fields make the invalid-token failure visible without requiring
          judges to inspect JSON files.
        </p>
        <div className="grid" style={{ marginTop: 12 }}>
          <div className="span-6">
            <HashRow label="Expected token" value={validLockWitness.tokenAddress} />
          </div>
          <div className="span-6">
            <HashRow label="Invalid token" value={invalidTokenWitness.tokenAddress} />
          </div>
          <div className="span-6">
            <HashRow
              label="Replay nullifier"
              value={devProofArtifact.publicOutputs.claimNullifier}
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}
