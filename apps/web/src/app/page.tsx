import { ArrowRight, BookOpen, FileText } from "lucide-react";
import { RelayCanvas } from "@/components/RelayCanvas";
import { ButtonLink, ModeStrip } from "@/components/ui";
import { demoConfig, implementedVsDemoOnly } from "@/lib/config";

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <RelayCanvas />
        <div className="hero-content">
          <span className="eyebrow">Compliance-forward Stellar privacy</span>
          <h1>Prove an EVM stablecoin lock. Claim a private Stellar note.</h1>
          <p>
            Nebula Relay is a relay-first MVP: source-chain payment intent is
            proven with RISC Zero and handed into Stellar as a replay-protected,
            private-note-compatible claim.
          </p>
          <div className="actions">
            <ButtonLink href="/demo" variant="primary">
              Start demo <ArrowRight size={16} />
            </ButtonLink>
            <ButtonLink href="/docs">
              Read proof statement <BookOpen size={16} />
            </ButtonLink>
            <ButtonLink href="/failure-lab">
              View failure lab <FileText size={16} />
            </ButtonLink>
          </div>
          <ModeStrip config={demoConfig} />
        </div>
      </section>

      <section className="page">
        <div className="grid">
          {implementedVsDemoOnly.map((item) => (
            <article className="panel span-4" key={item.label}>
              <h2>{item.label}</h2>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
