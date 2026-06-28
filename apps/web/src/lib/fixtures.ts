import type {
  AuditorPacket,
  LockWitness,
  ProofArtifact,
} from "@nebula/core";
import type { EvmReceiptLike } from "@nebula/evm-client";

export const validLockWitness = {
  version: 1,
  sourceChainId: 11155111,
  sourceBlockNumber: 123456,
  sourceReceiptRoot:
    "0x5555555555555555555555555555555555555555555555555555555555555555",
  txHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
  logIndex: 0,
  lockId: "0x6666666666666666666666666666666666666666666666666666666666666666",
  escrowContract: "0x1111111111111111111111111111111111111111",
  senderAddress: "0x3333333333333333333333333333333333333333",
  tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  amount: "100000000",
  stellarNoteCommitment:
    "0x7777777777777777777777777777777777777777777777777777777777777777",
  complianceHint:
    "0x8888888888888888888888888888888888888888888888888888888888888888",
  complianceRoot:
    "0x9999999999999999999999999999999999999999999999999999999999999999",
  complianceMode: "allowlist-membership",
  destinationChainId: 1501,
  expected: {
    sourceChainId: 11155111,
    escrowContract: "0x1111111111111111111111111111111111111111",
    tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    minAmount: "1000000",
    maxAmount: "500000000",
    complianceRoot:
      "0x9999999999999999999999999999999999999999999999999999999999999999",
    destinationChainId: 1501,
    networkDomain:
      "0x4e4542554c415f5354454c4c41525f544553544e45545f563100000000000000",
    expiresAtLedger: 999999,
  },
  complianceWitness: {
    valid: true,
    mode: "allowlist-membership",
  },
} satisfies LockWitness;

export const invalidTokenWitness = {
  ...validLockWitness,
  tokenAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
} satisfies LockWitness;

export const validReceipt = {
  transactionHash:
    "0x4444444444444444444444444444444444444444444444444444444444444444",
  blockNumber: 123456,
  logs: [
    {
      address: "0x1111111111111111111111111111111111111111",
      logIndex: 0,
      topics: [
        "0x3c320067d5ee148ab39dc093d6116428cc30da7f3015e8b8be132363b5a968b1",
        "0x6666666666666666666666666666666666666666666666666666666666666666",
        "0x0000000000000000000000003333333333333333333333333333333333333333",
        "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ],
      data: "0x0000000000000000000000000000000000000000000000000000000005f5e10077777777777777777777777777777777777777777777777777777777777777778888888888888888888888888888888888888888888888888888888888888888000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000005dd",
    },
  ],
} satisfies EvmReceiptLike;

export const devProofArtifact = {
  version: 1,
  proofMode: "dev",
  sealHex:
    "0x4e4542554c415f4445565f5345414c5f5631763a5cdc714cc36e9374a42cb7994cfc482e7808b405a92ce98fadc7ce9fb1f3",
  imageIdHex:
    "0x4e4542554c415f4445565f494d4147455f49445f563100000000000000000000",
  journalHex:
    "0x000000014e4542554c415f5354454c4c41525f544553544e45545f5631000000000000000000000000aa36a7000000000001e24055555555555555555555555555555555555555555555555555555555555555551111111111111111111111111111111111111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00000000000000000000000005f5e100000000000000006477777777777777777777777777777777777777777777777777777777777777779999999999999999999999999999999999999999999999999999999999999999011006ef406317cfd6ea321c2cafe0db761d37f03051f4dacee869a4263b8a6e9b691eacc317ed90271348ac26f7939932ebbb4783ad4254add2897b4dc758cc4b00000000000005dd000f423f",
  journalDigestHex:
    "0x763a5cdc714cc36e9374a42cb7994cfc482e7808b405a92ce98fadc7ce9fb1f3",
  publicOutputs: {
    version: 1,
    domain:
      "0x4e4542554c415f5354454c4c41525f544553544e45545f563100000000000000",
    sourceChainId: 11155111,
    sourceBlockNumber: 123456,
    sourceReceiptRoot:
      "0x5555555555555555555555555555555555555555555555555555555555555555",
    escrowContract: "0x1111111111111111111111111111111111111111",
    token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    amount: "100000000",
    amountBucket: 100,
    stellarNoteCommitment:
      "0x7777777777777777777777777777777777777777777777777777777777777777",
    complianceRoot:
      "0x9999999999999999999999999999999999999999999999999999999999999999",
    complianceMode: 1,
    claimNullifier:
      "0x1006ef406317cfd6ea321c2cafe0db761d37f03051f4dacee869a4263b8a6e9b",
    eventCommitment:
      "0x691eacc317ed90271348ac26f7939932ebbb4783ad4254add2897b4dc758cc4b",
    destinationChainId: 1501,
    expiresAtLedger: 999999,
  },
  generatedAt: "2026-06-27T17:15:08Z",
  witnessHash:
    "0xa481d442d27ad2ec8694fb468bcf466aebe58a9975bfe7c52af4d4aeb454ae56",
} satisfies ProofArtifact;

export const fixtureAuditorPacket = {
  version: 1,
  sourceChainId: validLockWitness.sourceChainId,
  sourceTxHash: validLockWitness.txHash,
  sourceLogIndex: validLockWitness.logIndex,
  stellarClaimTxHash:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  noteCommitment: validLockWitness.stellarNoteCommitment,
  claimNullifier: devProofArtifact.publicOutputs.claimNullifier,
  eventCommitment: devProofArtifact.publicOutputs.eventCommitment,
  proofImageId: devProofArtifact.imageIdHex,
  journalDigest: devProofArtifact.journalDigestHex,
  disclosureMode: "user-exported",
  caveats: [
    "Fixture/dev proof artifact; not a production Groth16 proof.",
    "Mode A private-note-compatible handoff; no direct upstream pool credit.",
    "User-funded Stellar deposit path is not a complete value bridge.",
  ],
} satisfies AuditorPacket;
