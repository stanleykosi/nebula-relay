import {
  AuditorPacketSchema,
  type AuditorPacket,
  type AuditorVerificationInstruction,
  type LockWitness,
  type ProofArtifact,
} from "@nebula/core";

export const REQUIRED_AUDITOR_CAVEATS = [
  "User-exported selective disclosure; the user chooses when and where to share it.",
  "This packet is not a production view-key system and does not provide ongoing account surveillance.",
  "Packet does not reveal private keys, note secrets, recipient secrets, or allowlist witness paths.",
  "Private-pool claim requires an upstream Stellar Private Payments deposit proof and stores no visible claimant.",
  "CCTP settlement is proof-bound in the artifact, but this packet is not a legal or security audit.",
] as const;

export const FORBIDDEN_AUDITOR_CLAIMS = [
  "production-grade view key",
  "production finality",
  "is a complete value bridge",
  "decrypt private notes",
  "auditor can view private history",
] as const;

export const AUDITOR_VERIFICATION_INSTRUCTIONS: readonly AuditorVerificationInstruction[] =
  [
    {
      title: "Validate packet schema",
      description:
        "Parse the JSON with @nebula/core AuditorPacketSchema before relying on any field.",
      expected:
        "The packet has version 1, required hashes, at least one caveat, and verification instructions.",
    },
    {
      title: "Confirm source lock",
      description:
        "Compare sourceChainId, sourceTxHash, and sourceLogIndex against the source-chain receipt or deterministic fixture.",
      expected:
        "The referenced log is the canonical NebulaEscrow Locked event for this claim.",
    },
    {
      title: "Confirm proof binding",
      description:
        "Compare proofImageId and journalDigest against the proof artifact supplied to NebulaRelay.",
      expected:
        "The proof artifact commits to the same note commitment, nullifier, event commitment, and compliance root.",
    },
    {
      title: "Confirm Stellar claim",
      description:
        "Check the Stellar claim transaction when one is present, then confirm the nullifier is stored once.",
      expected:
        "A replay with the same claimNullifier fails with NebulaRelay's replay protection.",
    },
    {
      title: "Confirm CCTP settlement",
      description:
        "Compare the CCTP message hash, attestation hash, and nonce against the Circle Iris message used for the Stellar mint.",
      expected:
        "The Nebula journal and auditor packet bind to the same CCTP burn/mint message.",
    },
    {
      title: "Review disclosure caveats",
      description:
        "Read every caveat before treating this as audit evidence.",
      expected:
        "The packet is user-controlled selective disclosure, not production view-key disclosure.",
    },
  ];

export interface BuildAuditorPacketInput {
  witness: LockWitness;
  proof: ProofArtifact;
  stellarClaimTxHash?: string;
  disclosureMode?: AuditorPacket["disclosureMode"];
  extraCaveats?: readonly string[];
}

export function buildAuditorPacket(
  input: BuildAuditorPacketInput
): AuditorPacket {
  assertProofMatchesWitness(input.witness, input.proof);

  const packet = AuditorPacketSchema.parse({
    version: 1,
    sourceChainId: input.witness.sourceChainId,
    sourceTxHash: input.witness.txHash,
    sourceLogIndex: input.witness.logIndex,
    stellarClaimTxHash: input.stellarClaimTxHash,
    noteCommitment: input.witness.stellarNoteCommitment,
    claimNullifier: input.proof.publicOutputs.claimNullifier,
    eventCommitment: input.proof.publicOutputs.eventCommitment,
    proofImageId: input.proof.imageIdHex,
    journalDigest: input.proof.journalDigestHex,
    cctpMessageHash: input.proof.publicOutputs.cctpMessageHash,
    cctpAttestationHash: input.proof.publicOutputs.cctpAttestationHash,
    cctpNonce: input.proof.publicOutputs.cctpNonce,
    disclosureMode: input.disclosureMode ?? "user-exported",
    caveats: buildCaveats(input.proof.proofMode, input.extraCaveats),
    verificationInstructions: AUDITOR_VERIFICATION_INSTRUCTIONS.map(
      (instruction) => ({ ...instruction })
    ),
  });

  assertNoFalseDisclosureClaims(packet);
  return packet;
}

export function serializeAuditorPacket(packet: AuditorPacket): string {
  return `${JSON.stringify(AuditorPacketSchema.parse(packet), null, 2)}\n`;
}

export function assertNoFalseDisclosureClaims(packet: AuditorPacket): void {
  const text = JSON.stringify(packet).toLowerCase();
  const forbidden = FORBIDDEN_AUDITOR_CLAIMS.find((claim) =>
    text.includes(claim)
  );
  if (forbidden) {
    throw new Error(`auditor packet contains forbidden claim: ${forbidden}`);
  }
}

function buildCaveats(
  proofMode: ProofArtifact["proofMode"],
  extraCaveats: readonly string[] = []
): string[] {
  return uniqueStrings([
    proofModeCaveat(proofMode),
    ...REQUIRED_AUDITOR_CAVEATS,
    ...extraCaveats,
  ]);
}

function proofModeCaveat(proofMode: ProofArtifact["proofMode"]): string {
  if (proofMode === "local-groth16") {
    return "Local Groth16 proof mode requires the configured Stellar verifier router and matching image ID before testnet use.";
  }
  return "Remote proof mode depends on the configured prover and verifier; review prover trust and availability before production use.";
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function assertProofMatchesWitness(
  witness: LockWitness,
  proof: ProofArtifact
): void {
  const outputs = proof.publicOutputs;
  const checks: readonly [string, string | number, string | number][] = [
    ["sourceChainId", witness.sourceChainId, outputs.sourceChainId],
    ["sourceBlockNumber", witness.sourceBlockNumber, outputs.sourceBlockNumber],
    ["sourceReceiptRoot", witness.sourceReceiptRoot, outputs.sourceReceiptRoot],
    ["escrowContract", witness.escrowContract, outputs.escrowContract],
    ["token", witness.tokenAddress, outputs.token],
    ["amount", witness.amount, outputs.amount],
    [
      "stellarNoteCommitment",
      witness.stellarNoteCommitment,
      outputs.stellarNoteCommitment,
    ],
    ["complianceRoot", witness.complianceRoot, outputs.complianceRoot],
    ["destinationChainId", witness.destinationChainId, outputs.destinationChainId],
    [
      "cctpSourceDomain",
      witness.cctpSettlement.sourceDomain,
      outputs.cctpSourceDomain,
    ],
    [
      "cctpDestinationDomain",
      witness.cctpSettlement.destinationDomain,
      outputs.cctpDestinationDomain,
    ],
    ["cctpNonce", witness.cctpSettlement.nonce, outputs.cctpNonce],
    [
      "cctpMessageHash",
      witness.cctpSettlement.messageHash,
      outputs.cctpMessageHash,
    ],
    [
      "cctpAttestationHash",
      witness.cctpSettlement.attestationHash,
      outputs.cctpAttestationHash,
    ],
    [
      "cctpMintRecipient",
      witness.cctpSettlement.mintRecipient,
      outputs.cctpMintRecipient,
    ],
  ];

  const mismatch = checks.find(([, left, right]) => !sameValue(left, right));
  if (mismatch) {
    throw new Error(`proof does not match witness field: ${mismatch[0]}`);
  }
}

function sameValue(left: string | number, right: string | number): boolean {
  if (typeof left === "string" && typeof right === "string") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}
