export type ProofMode = "fixture" | "local-groth16" | "remote";
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
  privatePoolMode: "private-pool-proof";
}

const proofModes: readonly ProofMode[] = ["fixture", "local-groth16", "remote"];

function readProofMode(value: string | undefined): ProofMode {
  return proofModes.includes(value as ProofMode)
    ? (value as ProofMode)
    : "remote";
}

export const demoConfig: DemoConfig = {
  demoMode:
    process.env.NEXT_PUBLIC_DEMO_MODE === "fixture" ? "fixture" : "live",
  proofMode: readProofMode(process.env.NEXT_PUBLIC_PROOF_MODE),
  verifierMode:
    process.env.NEXT_PUBLIC_VERIFIER_MODE === "mock" ? "mock" : "real-router",
  stellarNetwork:
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === "localnet"
      ? "localnet"
      : "testnet",
  evmNetwork:
    process.env.NEXT_PUBLIC_EVM_NETWORK === "sepolia" ||
    process.env.NEXT_PUBLIC_EVM_NETWORK === "base-sepolia"
      ? process.env.NEXT_PUBLIC_EVM_NETWORK
      : "sepolia",
  nebulaRelayContractId:
    process.env.NEXT_PUBLIC_NEBULA_RELAY_CONTRACT_ID ?? "TBD",
  evmEscrowAddress:
    process.env.NEXT_PUBLIC_NEBULA_CCTP_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_EVM_ESCROW_ADDRESS ??
    "0x1111111111111111111111111111111111111111",
  privatePoolMode: "private-pool-proof",
};

export const implementedVsDemoOnly = [
  {
    label: "Implemented",
    text: "EVM Locked event parser, RISC Zero proof artifact boundary, Stellar private-pool claim builder, nullifier replay model, proof-bound CCTP settlement path, and upstream pool deposit adapter boundary.",
  },
  {
    label: "Fixture simulation",
    text: "Fixture receipt, simulated local claim state, and local replay/failure lab remain available for smoke tests. Fixture mode is not a claimable testnet proof.",
  },
  {
    label: "Planned",
    text: "Receipt-root finality, packaged headless Private Payments prover orchestration, hosted Railway workers, and repeated public CCTP testnet transcripts.",
  },
];
