import { FailureLab } from "@/components/FailureLab";
import { ModeStrip } from "@/components/ui";
import { demoConfig } from "@/lib/config";

export default function FailureLabPage() {
  return (
    <main className="page">
      <span className="eyebrow">Failure lab</span>
      <h1 className="page-title">The claim path rejects bad proofs</h1>
      <p className="lead">
        Fixture failures make the security boundaries visible: replayed
        nullifiers, wrong token, wrong escrow, bad compliance root, and wrong
        image ID are not happy-path states.
      </p>
      <ModeStrip config={demoConfig} />
      <FailureLab />
    </main>
  );
}
