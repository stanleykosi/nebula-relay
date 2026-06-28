import { DemoConsole } from "@/components/DemoConsole";

export default function DemoPage() {
  return (
    <main>
      <section className="page">
        <span className="eyebrow">Guided demo</span>
        <h1 className="page-title">Relay proof to private Stellar note</h1>
        <p className="lead">
          Testnet mode is configured for EVM wallet connection, Stellar wallet
          connection, CCTP-backed settlement, and NebulaRelay claim submission
          once contract IDs and RPC endpoints are attached.
        </p>
      </section>
      <DemoConsole />
    </main>
  );
}
