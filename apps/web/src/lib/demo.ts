import {
  LockWitnessSchema,
  ProofArtifactSchema,
  type AuditorPacket,
  type LockWitness,
  type ProofArtifact,
} from "@nebula/core";
import { buildLockWitnessFromReceipt } from "@nebula/evm-client";
import { buildAuditorPacket } from "./auditor";
import type { DemoConfig } from "./config";
import {
  invalidTokenWitness,
  testnetProofArtifact,
  validLockWitness,
  validReceipt,
} from "./fixtures";

type HexString = `0x${string}`;

export type DemoStepId =
  | "evm-wallet"
  | "stellar-wallet"
  | "note"
  | "lock"
  | "witness"
  | "proof"
  | "cctp"
  | "claim"
  | "nullifier"
  | "replay"
  | "invalid-token"
  | "handoff"
  | "auditor";

export interface DemoStep {
  id: DemoStepId;
  title: string;
  caption: string;
}

export interface DemoState {
  evmWallet?: string;
  stellarWallet?: string;
  noteCommitment?: string;
  lockTxHash?: string;
  witness?: LockWitness;
  proof?: ProofArtifact;
  cctpMessage?: string;
  cctpAttestation?: string;
  cctpMessageHash?: string;
  cctpMintTxHash?: string;
  claimTxHash?: string;
  nullifierStored: boolean;
  replayFailure?: string;
  invalidTokenFailure?: string;
  handoffStatus?: string;
  auditorPacket?: AuditorPacket;
  completed: DemoStepId[];
}

export const demoSteps: DemoStep[] = [
  {
    id: "evm-wallet",
    title: "Connect EVM wallet",
    caption: "Fixture mode can continue without a browser wallet.",
  },
  {
    id: "stellar-wallet",
    title: "Connect Stellar wallet",
    caption: "Used to sign the claim in live localnet/testnet mode.",
  },
  {
    id: "note",
    title: "Generate recipient note",
    caption: "Creates the private-note commitment used by the proof.",
  },
  {
    id: "lock",
    title: "Lock mock USDC",
    caption: "Fixture receipt mirrors the canonical NebulaEscrow event.",
  },
  {
    id: "witness",
    title: "Build witness",
    caption: "Receipt/log data becomes a schema-valid LockWitness.",
  },
  {
    id: "proof",
    title: "Generate proof artifact",
    caption: "Groth16 artifact binds seal, image ID, journal, and digest.",
  },
  {
    id: "cctp",
    title: "Settle CCTP USDC",
    caption: "Burn, attestation, and Stellar mint are bound into the proof.",
  },
  {
    id: "claim",
    title: "Claim on Stellar",
    caption: "In fixture mode this simulates the NebulaRelay state transition.",
  },
  {
    id: "nullifier",
    title: "Show nullifier stored",
    caption: "The same proof cannot claim twice.",
  },
  {
    id: "replay",
    title: "Run replay failure",
    caption: "Reusing the nullifier returns a readable failure.",
  },
  {
    id: "invalid-token",
    title: "Run invalid-token fixture",
    caption: "Wrong source token fails before claim.",
  },
  {
    id: "handoff",
    title: "Show private note handoff",
    caption: "Mode A handoff records a private-note-compatible commitment.",
  },
  {
    id: "auditor",
    title: "Export auditor packet",
    caption: "User-controlled disclosure bundle with demo caveats.",
  },
];

export function createInitialDemoState(): DemoState {
  return {
    nullifierStored: false,
    completed: [],
  };
}

export function completeStep(state: DemoState, step: DemoStepId): DemoState {
  return {
    ...state,
    completed: state.completed.includes(step)
      ? state.completed
      : [...state.completed, step],
  };
}

export function connectFixtureEvmWallet(state: DemoState): DemoState {
  return completeStep(
    {
      ...state,
      evmWallet: validLockWitness.senderAddress,
    },
    "evm-wallet"
  );
}

export function connectFixtureStellarWallet(state: DemoState): DemoState {
  return completeStep(
    {
      ...state,
      stellarWallet:
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    },
    "stellar-wallet"
  );
}

export function generateFixtureNoteCommitment(state: DemoState): DemoState {
  return completeStep(
    {
      ...state,
      noteCommitment: validLockWitness.stellarNoteCommitment,
    },
    "note"
  );
}

export function lockFixtureUsdc(state: DemoState): DemoState {
  return completeStep(
    {
      ...state,
      lockTxHash: validReceipt.transactionHash,
    },
    "lock"
  );
}

export function buildFixtureWitness(state: DemoState): DemoState {
  const witness = buildLockWitnessFromReceipt(validReceipt, {
    sourceChainId: validLockWitness.sourceChainId,
    escrowContract: validLockWitness.escrowContract as HexString,
    sourceReceiptRoot: validLockWitness.sourceReceiptRoot as HexString,
    complianceRoot: validLockWitness.complianceRoot as HexString,
    complianceMode: validLockWitness.complianceMode,
    cctpSettlement: validLockWitness.cctpSettlement,
    expected: {
      ...validLockWitness.expected,
      escrowContract: validLockWitness.expected.escrowContract as HexString,
      tokenAddress: validLockWitness.expected.tokenAddress as HexString,
      complianceRoot: validLockWitness.expected.complianceRoot as HexString,
      networkDomain: validLockWitness.expected.networkDomain as HexString,
      cctpMintRecipient: validLockWitness.expected.cctpMintRecipient as HexString,
    },
  });
  return completeStep(
    {
      ...state,
      witness: LockWitnessSchema.parse(witness),
    },
    "witness"
  );
}

export function generateFixtureProof(state: DemoState): DemoState {
  return completeStep(
    {
      ...state,
      proof: ProofArtifactSchema.parse(testnetProofArtifact),
    },
    "proof"
  );
}

export function settleFixtureCctp(state: DemoState): DemoState {
  return completeStep(
    {
      ...state,
      cctpMessage: validLockWitness.cctpSettlement.message,
      cctpAttestation: "0x0a0b0c0d",
      cctpMessageHash: validLockWitness.cctpSettlement.messageHash,
      cctpMintTxHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    "cctp"
  );
}

export function claimFixtureOnStellar(state: DemoState): DemoState {
  return completeStep(
    {
      ...state,
      claimTxHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nullifierStored: true,
    },
    "claim"
  );
}

export function showNullifierStored(state: DemoState): DemoState {
  return completeStep({ ...state, nullifierStored: true }, "nullifier");
}

export function runReplayFailure(state: DemoState): DemoState {
  const message = state.nullifierStored
    ? "Replay blocked: NebulaRelay NullifierAlreadyClaimed (#15)."
    : "Replay unavailable until the first claim stores a nullifier.";
  return completeStep({ ...state, replayFailure: message }, "replay");
}

export function runInvalidTokenFailure(state: DemoState): DemoState {
  const valid =
    invalidTokenWitness.tokenAddress ===
    invalidTokenWitness.expected.tokenAddress;
  return completeStep(
    {
      ...state,
      invalidTokenFailure: valid
        ? "Unexpected pass"
        : "Invalid token rejected: witness token does not match expected token.",
    },
    "invalid-token"
  );
}

export function showPrivateNoteHandoff(state: DemoState): DemoState {
  return completeStep(
    {
      ...state,
      handoffStatus:
        "Mode A handoff ready: private-note-compatible commitment recorded; direct pool credit is planned.",
    },
    "handoff"
  );
}

export function exportAuditorPacket(state: DemoState): DemoState {
  const witness = state.witness ?? LockWitnessSchema.parse(validLockWitness);
  const proof = state.proof ?? ProofArtifactSchema.parse(testnetProofArtifact);
  return completeStep(
    {
      ...state,
      auditorPacket: buildAuditorPacket({
        witness,
        proof,
        stellarClaimTxHash: state.claimTxHash,
      }),
    },
    "auditor"
  );
}

export function runFullFixtureDemo(): DemoState {
  return [
    connectFixtureEvmWallet,
    connectFixtureStellarWallet,
    generateFixtureNoteCommitment,
    lockFixtureUsdc,
    buildFixtureWitness,
    generateFixtureProof,
    settleFixtureCctp,
    claimFixtureOnStellar,
    showNullifierStored,
    runReplayFailure,
    runInvalidTokenFailure,
    showPrivateNoteHandoff,
    exportAuditorPacket,
  ].reduce((state, action) => action(state), createInitialDemoState());
}

export function demoModeSummary(config: DemoConfig): string {
  return [
    `proof=${config.proofMode}`,
    `verifier=${config.verifierMode}`,
    `stellar=${config.stellarNetwork}`,
    `evm=${config.evmNetwork}`,
    `private-payments=${config.privatePoolMode}`,
  ].join(" | ");
}
