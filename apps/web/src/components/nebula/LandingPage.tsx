import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CircleCheck,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";

const privateSignals = [
  {
    icon: Fingerprint,
    title: "ZK-Proof Obfuscation",
    body: "A RISC Zero proof binds the source lock and private-pool claim without exposing unnecessary sender history.",
  },
  {
    icon: LockKeyhole,
    title: "Non-custodial Routing",
    body: "The user signs the EVM lock and owns the Stellar private note keys. Nebula coordinates proof-backed settlement.",
  },
  {
    icon: ShieldCheck,
    title: "Deterministic Settlement",
    body: "Intent IDs, note commitments, CCTP fees, and replay checks are tracked end-to-end.",
  },
];

const steps = [
  ["Prepare Note", "Generate a private-pool output for the connected Stellar wallet."],
  ["Sign on EVM", "Approve if needed, then lock USDC from the source wallet."],
  ["Prove", "Nebula builds the RISC Zero witness and proof artifact."],
  ["Claim Stellar", "The Stellar relay contract accepts only proof-backed settlement."],
  ["Withdraw", "Spend the private note to the same wallet or another Stellar address."],
];

export function LandingPage() {
  return (
    <main>
      <section className="landing-hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">
              <Sparkles size={15} /> Testnet Privacy Bridge
            </span>
            <h1>Nebula Relay</h1>
            <p>
              Move USDC from EVM into Stellar private pools with proof-backed
              settlement. Institutional-grade privacy. No public sprawl.
            </p>
            <div className="hero-actions">
              <Link className="button-primary" href="/bridge">
                Launch Bridge <ArrowRight size={17} />
              </Link>
              <Link className="button-secondary" href="#how-it-works">
                How it works
              </Link>
            </div>
          </div>

          <div className="hero-visual">
            <Image
              alt="Nebula sealed private note artifact"
              height={900}
              priority
              src="/stitch/sealed-note.png"
              width={900}
            />
            <div className="privacy-caption">
              <CircleCheck size={20} color="var(--primary)" />
              <div>
                <strong>Private note prepared</strong>
                <span>
                  Your Stellar recipient receives a spendable private-pool note
                  after the proof-backed claim completes.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-band" aria-labelledby="private-settlement">
        <div className="section-head">
          <div>
            <span className="label-caps">Private Settlement</span>
            <h2 id="private-settlement">Built for proof-backed movement.</h2>
          </div>
          <p>
            Nebula keeps the user journey focused: create a private note, lock
            source USDC, watch proof progress, then withdraw privately on Stellar.
          </p>
        </div>
        <div className="info-grid">
          {privateSignals.map((item) => (
            <article className="info-card" key={item.title}>
              <item.icon size={22} color="var(--primary)" />
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="section-band"
        id="how-it-works"
        aria-labelledby="how-it-works-title"
      >
        <div className="section-head">
          <div>
            <span className="label-caps">Flow</span>
            <h2 id="how-it-works-title">Five actions. One private result.</h2>
          </div>
          <p>
            The interface follows the actual backend state machine: source
            transaction, CCTP settlement, witness build, proof, Stellar claim,
            and private-pool withdrawal.
          </p>
        </div>
        <div className="step-grid">
          {steps.map(([title, body], index) => (
            <article className="step-card" key={title}>
              <span className="step-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-band">
        <div className="bridge-card">
          <div className="page-head" style={{ marginBottom: 0 }}>
            <div>
              <span className="label-caps">
                <Wallet size={15} /> Ready
              </span>
              <h2 className="display-title">Bridge into a private note.</h2>
              <p>
                Connect EVM and Stellar wallets, prepare the private proof, and
                submit the source-chain lock from one production flow.
              </p>
            </div>
            <Link className="button-primary" href="/bridge">
              Start Bridge <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
