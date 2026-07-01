import { PrivateProverConsole } from "@/components/PrivateProverConsole";

export default function PrivateProverPage() {
  return (
    <main>
      <section className="page">
        <span className="eyebrow">Browser private prover</span>
        <h1 className="page-title">Prepare a private Stellar pool note</h1>
        <p className="lead">
          Nebula hosts the upstream Stellar Private Payments prover runtime in
          the browser so private-note material stays client-side.
        </p>
      </section>
      <PrivateProverConsole />
    </main>
  );
}
