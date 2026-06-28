export type ProofMode = "fixture" | "dev" | "local-groth16" | "remote";
export type VerifierMode = "mock" | "real-router";
export type StellarNetwork = "localnet" | "testnet";

export interface DemoConfig {
  demoMode: "fixture" | "live";
  proofMode: ProofMode;
  verifierMode: VerifierMode;
  stellarNetwork: StellarNetwork;
  evmNetwork: "fixture" | "sepolia" | "base-sepolia";
  nebulaRelayContractId: string;
  evmEscrowAddress: string;
  privatePoolMode: "mode-a-handoff" | "direct-pool-credit-planned";
}

export const demoConfig: DemoConfig = {
  demoMode:
    process.env.NEXT_PUBLIC_DEMO_MODE === "live" ? "live" : "fixture",
  proofMode: (process.env.NEXT_PUBLIC_PROOF_MODE as ProofMode) ?? "fixture",
  verifierMode:
    process.env.NEXT_PUBLIC_VERIFIER_MODE === "real-router"
      ? "real-router"
      : "mock",
  stellarNetwork:
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === "testnet"
      ? "testnet"
      : "localnet",
  evmNetwork:
    process.env.NEXT_PUBLIC_EVM_NETWORK === "sepolia" ||
    process.env.NEXT_PUBLIC_EVM_NETWORK === "base-sepolia"
      ? process.env.NEXT_PUBLIC_EVM_NETWORK
      : "fixture",
  nebulaRelayContractId:
    process.env.NEXT_PUBLIC_NEBULA_RELAY_CONTRACT_ID ?? "TBD",
  evmEscrowAddress:
    process.env.NEXT_PUBLIC_EVM_ESCROW_ADDRESS ??
    "0x1111111111111111111111111111111111111111",
  privatePoolMode: "mode-a-handoff",
};

export const implementedVsDemoOnly = [
  {
    label: "Implemented",
    text: "EVM Locked event parser, RISC Zero dev artifact, Stellar claim builder, nullifier replay model, and Mode A private-note handoff.",
  },
  {
    label: "Demo-only",
    text: "Fixture receipt, fixture proof artifact, simulated local claim state, and local replay/failure lab.",
  },
  {
    label: "Planned",
    text: "Live router Groth16 run, receipt-root finality, direct private-pool credit, and CCTP-backed testnet settlement.",
  },
];
