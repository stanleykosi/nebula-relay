import { DemoConsole } from "@/components/DemoConsole";

export default function DemoPage() {
  return (
    <main>
      <section className="page">
        <span className="eyebrow">Guided demo</span>
        <h1 className="page-title">Relay proof to private Stellar note</h1>
        <p className="lead">
          Fixture mode completes locally. Live localnet/testnet calls can be
          wired through the same EVM and Stellar client packages when contract
          IDs and RPC endpoints are configured.
        </p>
      </section>
      <DemoConsole />
    </main>
  );
}
